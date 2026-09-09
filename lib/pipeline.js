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

const DB_PATH = path.join(process.cwd(), "data", "db.json");
let db = null;
let dirty = false;

async function ready() {
  // ALWAYS reload fresh. On Vercel each API route is a separate function with
  // its own module instance — caching here made routes serve stale state and
  // hid freshly created episodes. The sheet/file is the single source of truth.
  if (SDB.enabled()) {
    db = (await SDB.loadJson()) || { episodes: [], approvals: [], leads: [], log: [] };
  } else {
    try { db = JSON.parse(fs.readFileSync(DB_PATH, "utf8")); }
    catch (e) { db = { episodes: [], approvals: [], leads: [], log: [] }; }
  }
  dirty = false;
  return db;
}
function markDirty() { dirty = true; }
async function flush() {
  if (!dirty || !db) return;
  if (SDB.enabled()) await SDB.saveJson(db);
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
  "AWAITING_TRANSCRIPT", "GENERATING_SHOWNOTES", "REVIEW_SHOWNOTES", "TICKET_READY",
  "GENERATING_NEWSLETTERS", "REVIEW_NEWSLETTERS", "SCHEDULED_IN_KIT",
  "RELEASED", "KPI_READY", "LEADS_READY", "COMPLETE",
];

// AI models sometimes emit markdown fences and literal "\n" text — strip them
// so previews and Stripo pastes are clean HTML.
function sanitizeAI(s) {
  if (!s) return s;
  return s
    .replace(/```[a-zA-Z]*\r?\n?/g, "")
    .replace(/\\n/g, "\n")
    .replace(/\r/g, "")
    .trim();
}

function createEpisode({ epNum, title, guest, releaseDate }) {
  const e = {
    id: "ep-" + epNum + "-" + Date.now().toString(36),
    ep: String(epNum), title, guest: guest || "", releaseDate,
    link: `https://thrivingdentist.com/episodes/${epNum}?src=nl`,
    stage: "AWAITING_TRANSCRIPT",
    transcript: "", shownotes: "", ticket: "",
    newsletters: {}, kit: [], kpi: null, live: null,
    created: new Date().toISOString(),
  };
  db.episodes.unshift(e);
  log(e.id, `Episode ${e.ep} created — waiting for the clean transcript.`);
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
  const sys = "You produce show-notes packages for the Thriving Dentist podcast. Names spelled exactly: Naren, Gary, Ekwa, Thriving Dentist. 5th-grade level. No em dashes. Never invent facts.";
  const user =
    `Episode ${e.ep}: "${e.title}"${e.guest ? " with guest " + e.guest : ""}.\n` +
    `Produce: 1) 300-500 word SEO episode description, 2) 8-12 timestamps, 3) 5 key takeaways, 4) guest bio blurb (if guest), 5) SEO title tag <60 chars + meta description <155 chars, 6) CTA paragraph weaving in MSM ${cfg.MSM_LINK} and CSM ${cfg.CSM_LINK}.\n` +
    (revisionNotes ? `REVISION REQUESTED — apply these notes: ${revisionNotes}\n` : "") +
    `TRANSCRIPT:\n${e.transcript}`;
  let out = await A.aiGenerate(sys, user);
  out = out == null ? A.mockShownotes(e) : sanitizeAI(out);
  e.shownotes = out;
  e.stage = "REVIEW_SHOWNOTES";
  addApproval(e, "SHOWNOTES", "Show notes for EP " + e.ep, out);
  log(e.id, `Show notes generated (${A.mode.aiProvider}). ⛭ Waiting for approval.`);
  await A.slackNotify(`⛭ Approval needed: show notes for TD EP ${e.ep} — open the dashboard to review.`);
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
      log(e.id, "Show notes approved. Building webmaster ticket…");
      buildTicket(e);
      e.stage = "GENERATING_NEWSLETTERS";
      log(e.id, "Generating both newsletters…");
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

function buildTicket(e) {
  e.ticket =
    `WEBMASTER TICKET — Thriving Dentist EP ${e.ep}\n` +
    `Title: ${e.title}\nRelease: ${e.releaseDate}\nGuest: ${e.guest || "None"}\n` +
    `MSM CTA: ${cfg.MSM_LINK} | CSM CTA: ${cfg.CSM_LINK}\n\n--- APPROVED SHOW NOTES ---\n${e.shownotes}`;
  e.stage = "TICKET_READY";
  log(e.id, "Webmaster ticket built — copy it from the episode card.");
}

async function genNewsletters(e, revisionNotes) {
  const sys = "You write promo newsletters for the Thriving Dentist podcast in Robert Collier style: short sentences, every paragraph pulls to the next, 5th-grade level, no em dashes. Start with a line 'SUBJECT: ...' then output complete 600px table-layout email HTML with inline CSS (Stripo/Kit-ready).";
  for (const kind of ["weekly", "weekend"]) {
    const user =
      `Write the ${kind.toUpperCase()} newsletter for EP ${e.ep}: "${e.title}"${e.guest ? " with " + e.guest : ""}.\n` +
      `Episode link: ${e.link}\nMSM segment required: ${cfg.MSM_LINK}\n` +
      (revisionNotes ? `REVISION NOTES: ${revisionNotes}\n` : "") +
      `SOURCE (approved show notes):\n${e.shownotes}`;
    let out = await A.aiGenerate(sys, user);
    out = out == null ? A.mockNewsletter(e, kind) : sanitizeAI(out);
    e.newsletters[kind] = out;
  }
  e.stage = "REVIEW_NEWSLETTERS";
  addApproval(e, "NEWSLETTERS", "Weekly + weekend newsletters for EP " + e.ep,
    "=== WEEKLY ===\n" + e.newsletters.weekly + "\n\n=== WEEKEND ===\n" + e.newsletters.weekend);
  log(e.id, `Both newsletters generated (${A.mode.aiProvider}). ⛭ Waiting for approval.`);
  await A.slackNotify(`⛭ Approval needed: newsletters for TD EP ${e.ep}.`);
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
