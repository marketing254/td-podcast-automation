// ============================================================
// PIPELINE — episode state machine (serverless edition).
// State lives in Google Sheets (System_DB tab) when connected,
// else in a local JSON file for dev. Each API route calls
// ready() first and flush() after mutations.
// ============================================================
const fs = require("fs");
const path = require("path");
const cfg = require("./config");
const A = require("./adapters");
const SDB = require("./sheetdb");
const NL = require("./newsletter");

const DB_PATH = path.join(process.cwd(), "data", "db.json");
let db = null;
let dirty = false;
let _loadedAt = 0;

async function ready() {
  // Reload fresh, but with an 8s micro-cache: the dashboard polls often and the
  // Apps Script backend is slow — hammering it causes timeout pile-ups.
  if (SDB.enabled()) {
    if (db && Date.now() - _loadedAt < 8000) return db;
    db = (await SDB.loadJson()) || { episodes: [], approvals: [], leads: [], log: [] };
    if (!db.people) db.people = {};
    _loadedAt = Date.now();
  } else {
    try { db = JSON.parse(fs.readFileSync(DB_PATH, "utf8")); }
    catch (e) { db = { episodes: [], approvals: [], leads: [], log: [] }; }
    if (!db.people) db.people = {};
  }
  dirty = false;
  return db;
}
function markDirty() { dirty = true; }
async function flush() {
  if (!dirty || !db) return;
  if (SDB.enabled()) { await SDB.saveJson(db); _loadedAt = Date.now(); }
  else { fs.mkdirSync(path.dirname(DB_PATH), { recursive: true }); fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2)); }
  dirty = false;
}
function log(episodeId, msg) {
  db.log.unshift({ t: new Date().toISOString(), episodeId, msg });
  db.log = db.log.slice(0, 300);
  markDirty();
}
const ep = (id) => db.episodes.find((e) => e.id === id);

const STAGES = [
  "AWAITING_TRANSCRIPT", "GENERATING_SHOWNOTES", "REVIEW_SHOWNOTES",
  "GENERATING_NEWSLETTERS", "REVIEW_NEWSLETTERS", "SCHEDULED_IN_KIT",
  "RELEASED", "KPI_READY", "LEADS_READY", "COMPLETE",
];

// AI models sometimes emit markdown fences and literal "\n" text — strip them
// so previews and Stripo pastes are clean HTML.
function prettyDate(iso) {
  try {
    const d = new Date(iso + "T12:00:00");
    const n = d.getDate();
    const suf = n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th";
    const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    return n + suf + " " + months[d.getMonth()] + " " + d.getFullYear();
  } catch (e) { return iso; }
}
// the page package must be plain text: no markdown bold/headers/dividers
function plainText(s) {
  return String(s || "")
    .replace(/\*\*/g, "")
    .replace(/^#+\s*/gm, "")
    .replace(/^[-_]{3,}\s*$/gm, "")
    .trim();
}
function sanitizeAI(s) {
  if (!s) return s;
  return s
    .replace(/```[a-zA-Z]*\r?\n?/g, "")
    .replace(/\\n/g, "\n")
    .replace(/\r/g, "")
    .trim();
}

function createEpisode({ epNum, title, guest, releaseDate, headshot, people, thumb, wav, embed }) {
  // normalize people; remember any uploaded photo in the library for next time
  let ppl = Array.isArray(people) ? people.filter((x) => x && String(x.name || "").trim()) : [];
  if (!ppl.length) {
    ppl = [{ name: "Gary Takacs", img: "" }, { name: "Naren Arulrajah", img: "" }];
    if (guest && !/^(gary|naren)/i.test(guest)) ppl.push({ name: guest, img: headshot || "" });
  }
  ppl = ppl.map((x) => {
    const key = String(x.name).trim().toLowerCase();
    if (x.img) { db.people[key] = x.img; markDirty(); }
    return { name: String(x.name).trim(), img: x.img || db.people[key] || "" };
  });
  const others = ppl.map((x) => x.name).filter((n) => !/^(gary|naren)/i.test(n));
  const e = {
    id: "ep-" + epNum + "-" + Date.now().toString(36),
    ep: String(epNum), title, guest: others.join(", "), releaseDate,
    people: ppl,
    thumb: thumb || "", wav: wav || "", embed: embed || "",
    link: `https://thrivingdentist.com/episodes/${epNum}?src=nl`,
    stage: "AWAITING_TRANSCRIPT",
    transcript: "", shownotes: "",
    newsletters: {}, kit: [], kpi: null, live: null,
    created: new Date().toISOString(),
  };
  db.episodes.unshift(e);
  log(e.id, `Episode ${e.ep} created with ${ppl.length} people — waiting for the clean transcript.`);
  return e;
}

async function addTranscript(id, text) {
  const e = ep(id); if (!e) throw new Error("no episode");
  e.transcript = text;
  e.stage = "GENERATING_SHOWNOTES";
  log(id, `Transcript received (${text.length} chars). Generating show notes…`);
  await genShownotes(e);
}

async function genShownotes(e, revisionNotes) {
  const sys =
    "You produce the TD Podcast episode page package for the Thriving Dentist Show. " +
    "Names spelled exactly: Gary Takacs, Naren Arulrajah, Ekwa, Thriving Dentist. Plain language, short sentences, no em dashes, no markdown. " +
    "Every transcript quote must be VERBATIM from the supplied transcript - never invented.";
  const user =
    `Produce the episode page package in EXACTLY this layout (same headings, same order):\n\n` +
    `Hi Gayan,\n` +
    `Please be good enough to schedule the next episode of the TD Podcast on the TD website using the details below.\n\n` +
    `Date to schedule: ${prettyDate(e.releaseDate)}\n` +
    `Episode Number: ${e.ep}\n` +
    `Episode Title: "${e.title}"\n` +
    `Episode Thumbnail: ${e.thumb || "[ADD THUMBNAIL LINK]"}\n` +
    `Link - TD EP ${e.ep} WAV. MP3: ${e.wav || "[ADD FILE LINK]"}\n` +
    `Embed link: ${e.embed || "[ADD EMBED LINK]"}\n\n` +
    `Episode Intro (added above player)\n` +
    `{2 short paragraphs. First: the strongest hook from this episode - a number or an idea a practice owner cannot ignore. Second: invite to book a complimentary Marketing Strategy Meeting at ${cfg.MSM_LINK} tied to this topic.}\n\n` +
    `Key Takeaways\n` +
    `{5 one-line takeaways, each a complete standalone sentence with a number or specific claim where possible}\n\n` +
    `Show Notes with Timestamps\n` +
    `{6 to 12 segments covering the whole episode in order. Each segment:\n` +
    `HH:MM:SS - Segment Title\n` +
    `{1-2 one-line summary points}\n` +
    `View Transcript:\n` +
    `{2-4 verbatim quote lines from the transcript, each starting with the speaker name and a colon}\n}\n\n` +
    `Use real timestamps if the transcript has them; otherwise estimate sequential ones.\n` +
    `After the final segment, end the document with exactly:\nTitle: {SEO page title under 60 characters}\nMeta Description: {SEO description under 155 characters}\n` +
    `FORMAT RULES: plain text only. No markdown - no asterisks, no # headings, no bullets other than plain lines. Headings appear exactly as written above (Episode Intro (added above player) / Key Takeaways / Show Notes with Timestamps). The segments must cover the ENTIRE transcript start to finish, in order, with nothing skipped.\n` +
    (revisionNotes ? `REVISION REQUESTED - apply these notes: ${revisionNotes}\n` : "") +
    `\nEPISODE: ${e.ep} "${e.title}"${e.guest ? " with " + e.guest : ""}\nTRANSCRIPT:\n${e.transcript}`;
  let out = await A.aiGenerate(sys, user, 12000);
  out = out == null ? A.mockShownotes(e) : plainText(sanitizeAI(out));
  e.shownotes = out;
  e.stage = "REVIEW_SHOWNOTES";
  addApproval(e, "SHOWNOTES", "Episode page package for EP " + e.ep, out);
  log(e.id, `Episode page package generated (${A.mode.aiProvider}). Waiting for approval.`);
  await A.slackNotify(`Approval needed: episode page package for TD EP ${e.ep}.`);
}

function addApproval(e, type, label, content) {
  db.approvals.unshift({
    id: "ap-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    episodeId: e.id, type, label, content, status: "PENDING", created: new Date().toISOString(),
  });
  markDirty();
}

async function decide(approvalId, decision, notes) {
  const ap = db.approvals.find((a) => a.id === approvalId);
  if (!ap || ap.status !== "PENDING") throw new Error("approval not pending");
  const e = ep(ap.episodeId);
  ap.status = decision === "approve" ? "APPROVED" : "CHANGES";
  ap.notes = notes || "";
  ap.decided = new Date().toISOString();
  markDirty();

  if (ap.type === "SHOWNOTES") {
    if (decision === "approve") {
      e.stage = "GENERATING_NEWSLETTERS";
      log(e.id, "Episode page package approved. Generating both newsletters from the brand templates…");
      await genNewsletters(e);
    } else {
      log(e.id, "Changes requested on show notes: " + notes + " — regenerating.");
      e.stage = "GENERATING_SHOWNOTES";
      await genShownotes(e, notes);
    }
  } else if (ap.type === "NEWSLETTERS") {
    if (decision === "approve") {
      log(e.id, "Newsletters approved. Creating in Kit…");
      await scheduleKit(e);
    } else {
      log(e.id, "Changes requested on newsletters: " + notes + " — regenerating.");
      e.stage = "GENERATING_NEWSLETTERS";
      await genNewsletters(e, notes);
    }
  }
}

async function genNewsletters(e, revisionNotes) {
  for (const kind of ["weekly", "weekend"]) {
    const weekly = kind === "weekly";
    const sys =
      "You write content for the Thriving Dentist newsletter. Audience: US dental practice owners. " +
      "Voice: short sentences, plain language, real numbers from the episode, no hype words, no em dashes. " +
      "Respond with a single JSON object ONLY - no markdown, no commentary.";
    const user =
      "Write the " + kind.toUpperCase() + " newsletter content for EP " + e.ep + ' "' + e.title + '"' +
      (e.guest ? " with " + e.guest : "") + ".\n" +
      (revisionNotes ? "REVISION NOTES - apply these: " + revisionNotes + "\n" : "") +
      "JSON fields required:\n" +
      '{"subject": "email subject line",\n' +
      ' "preview": "preview text under 90 chars",\n' +
      ' "eyebrow": "' + (weekly ? "NEW EPISODE" : "WEEKEND LISTEN") + ' \u00b7 ' + e.ep + '",\n' +
      ' "title": "episode title, plain language",\n' +
      ' "deck": "one-sentence hook under the title",\n' +
      ' "intro": [' + (weekly ? '"2-3 short paragraphs introducing this week\u2019s episode and why it matters"' : '"2 short paragraphs: in case you missed it recap for a relaxed weekend read"') + '],\n' +
      ' "section_head": "a heading like Why This Matters to Practice Owners",\n' +
      ' "section": ["2-3 short paragraphs on the core teaching, with a real number or story from the episode"],\n' +
      ' "quote": "one strong verbatim-style quote from the episode, no quote marks",\n' +
      ' "quote_by": "Gary Takacs or Naren Arulrajah or the guest name",\n' +
      ' "take_head": "' + (weekly ? "Five Things You Will Take From This Episode" : "Three Takeaways Worth Your Weekend Listen") + '",\n' +
      ' "takeaways": [' + (weekly ? '"exactly 5 one-line takeaways"' : '"exactly 3 one-line takeaways"') + '],\n' +
      ' "extra": "one optional closing line, e.g. a clinical tip mention, or empty string",\n' +
      ' "card": ["2 short paragraphs pitching the ' + (weekly ? "free Marketing Strategy Meeting (Ekwa reviews rankings, reviews, AI visibility before the call)" : "free one-hour Coaching Strategy Meeting with Gary on Zoom, no cost, no obligation") + ' tied to this topic"],\n' +
      ' "card_label": "' + (weekly ? "Book a Marketing Strategy Meeting" : "Book a Strategy Meeting with Gary") + '"}\n' +
      "\nSOURCE 1 (approved episode page package):\n" + String(e.shownotes || "").slice(0, 6000) +
      "\n\nSOURCE 2 (transcript excerpt - use it for the verbatim quote):\n" + String(e.transcript || "").slice(0, 4000);
    let fields = null;
    for (let attempt = 0; attempt < 2 && !fields; attempt++) {
      const out = await A.aiGenerate(sys, attempt ? user + "\nREMINDER: valid JSON object only." : user, 3000);
      if (out == null) break;
      try { fields = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1)); } catch (err) { fields = null; }
    }
    if (!fields) throw new Error("Newsletter content generation failed for " + kind + " - try again");
    e.newsletters[kind] = NL.build(e, fields, kind);
    log(e.id, kind + " newsletter built on the modern TD template" + (e.headshot ? " with guest headshot" : "") + ".");
  }
  e.stage = "REVIEW_NEWSLETTERS";
  addApproval(e, "NEWSLETTERS", "Weekly + weekend newsletters for EP " + e.ep,
    "=== WEEKLY ===\n" + e.newsletters.weekly + "\n\n=== WEEKEND ===\n" + e.newsletters.weekend);
  log(e.id, `Both newsletters ready (${A.mode.aiProvider}). Waiting for approval.`);
  await A.slackNotify(`Approval needed: newsletters for TD EP ${e.ep}.`);
}

async function scheduleKit(e) {
  const sendAt = new Date(e.releaseDate + "T09:00:00").toISOString();
  const weekend = new Date(new Date(e.releaseDate + "T09:00:00").getTime() + 5 * 864e5).toISOString();
  const r1 = await A.kitScheduleBroadcast(e, "weekly", e.newsletters.weekly, sendAt);
  const r2 = await A.kitScheduleBroadcast(e, "weekend", e.newsletters.weekend, weekend);
  e.kit = [r1, r2];
  e.stage = "SCHEDULED_IN_KIT";
  log(e.id, `Kit: weekly ${r1.id}, weekend ${r2.id}. ${r1.note || r1.error || "Scheduled."}`);
  markDirty();
}

async function releaseFlow(e) {
  const live = await A.libsynVerifyLive(e);
  e.live = live;
  e.stage = "RELEASED";
  log(e.id, `Release check: ${live.live ? "LIVE" : "NOT FOUND (" + live.status + ")"} at ${live.url}.`);
  const k = await A.libsynGetDownloads(e).catch(() => null);
  e.kpi = k;
  e.stage = "KPI_READY";
  log(e.id, k ? `KPI pulled: ${k.downloads7d} downloads.` : "Download numbers not available — Libsyn API not connected yet. They will appear here once access is granted.");
  const clickers = await A.kitGetClickers(e).catch(() => []);
  if (clickers.length) {
    clickers.forEach((c) => {
      const l = c.link.toLowerCase();
      const score = cfg.HOT_KEYWORDS.some((x) => l.includes(x)) ? "HOT" : cfg.WARM_KEYWORDS.some((x) => l.includes(x)) ? "WARM" : "COLD";
      db.leads.unshift({
        id: "ld-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        episodeId: e.id, ep: e.ep, ...c, score,
        draft: A.mockLeadDraft(c, e), status: "PENDING",
      });
    });
    e.stage = "LEADS_READY";
    log(e.id, `Leads: ${clickers.length} real clickers scored and drafted. You send every message personally.`);
  } else {
    e.stage = "COMPLETE";
    log(e.id, "No newsletter click data yet — leads appear only after a broadcast actually sends to the audience. Episode pipeline complete.");
  }
  await A.slackNotify(`EP ${e.ep} release processed.`);
  markDirty();
}

function leadAction(leadId, status) {
  const l = db.leads.find((x) => x.id === leadId);
  if (!l) throw new Error("no lead");
  l.status = status;
  log(l.episodeId, `Lead ${l.name}: marked ${status}.`);
  const e = ep(l.episodeId);
  const open = db.leads.filter((x) => x.episodeId === l.episodeId && x.status === "PENDING" && x.score !== "COLD");
  if (e && open.length === 0 && e.stage === "LEADS_READY") {
    e.stage = "COMPLETE";
    log(e.id, `All hot/warm leads actioned — EP ${e.ep} COMPLETE.`);
  }
  markDirty();
}

async function tick(force) {
  const today = new Date().toISOString().slice(0, 10);
  for (const e of db.episodes) {
    if (e.stage === "SCHEDULED_IN_KIT" && (force === e.id || e.releaseDate <= today)) {
      log(e.id, force === e.id ? "DEMO: advancing to release day." : "Release day reached (cron).");
      await releaseFlow(e);
    }
  }
}

module.exports = { ready, flush, db: () => db, createEpisode, addTranscript, decide, leadAction, tick, log, STAGES, markDirty };
