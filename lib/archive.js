// ============================================================
// ARCHIVE + TOPICS — loads the Episode Summary CSV, powers
// past-topic search, duplicate checking, and new-topic
// recommendations (AI when key present, rule-based gap
// analysis in mock mode).
// ============================================================
const fs = require("fs");
const cfg = require("./config");
const A = require("./adapters");

let EPISODES = []; // {ep, date, title, guest} — numbered episodes from CSV
let COVERED = [];  // {title, category} — covered topics from the Topic Tracker
function corpus() {
  return EPISODES.concat(COVERED.map((t) => ({ ep: "bank", date: "", title: t.title, guest: t.category || "" })));
}

const STOP = new Set(("a an and are as at be by can do for from how i in is it of on or that the this to vs with what when where why your you our we my their his her its not no more most can't practice dental dentist dentistry thriving").split(" "));

function words(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

function load() {
  try {
    const raw = fs.readFileSync(cfg.ARCHIVE_CSV_PATH, "utf8");
    // simple CSV parse handling quoted fields
    const rows = [];
    let row = [], field = "", inQ = false;
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (inQ) {
        if (c === '"' && raw[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') inQ = false;
        else field += c;
      } else if (c === '"') inQ = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && raw[i + 1] === "\n") i++;
        row.push(field); field = "";
        rows.push(row); row = [];
      } else field += c;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    EPISODES = rows
      .filter((r) => r[0] && /^\d+$/.test(r[0].trim()))
      .map((r) => ({ ep: r[0].trim(), date: (r[2] || "").trim(), title: (r[3] || "").trim(), guest: (r[5] || "").trim() }))
      .filter((e) => e.title);
    return { ok: true, count: EPISODES.length };
  } catch (e) {
    EPISODES = [];
    return { ok: false, error: e.message };
  }
}

function search(q) {
  if (!q) return corpus().slice().reverse().slice(0, 200);
  const qw = words(q);
  const ql = q.toLowerCase();
  return corpus()
    .map((e) => {
      const tl = e.title.toLowerCase();
      let score = tl.includes(ql) ? 100 : 0;
      const tw = new Set(words(e.title));
      qw.forEach((w) => { if (tw.has(w)) score += 10; });
      return { ...e, score };
    })
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 200);
}

// similarity of a proposed topic vs one past title (0..100)
function similarity(topic, title) {
  const a = new Set(words(topic)), b = new Set(words(title));
  if (!a.size || !b.size) return 0;
  let inter = 0;
  a.forEach((w) => { if (b.has(w)) inter++; });
  const jac = inter / (a.size + b.size - inter);
  const sub = title.toLowerCase().includes(topic.toLowerCase()) || topic.toLowerCase().includes(title.toLowerCase()) ? 0.3 : 0;
  return Math.round(Math.min(1, jac + sub) * 100);
}

function checkDuplicate(topic) {
  const matches = corpus()
    .map((e) => ({ ep: e.ep, title: e.title, sim: similarity(topic, e.title) }))
    .filter((m) => m.sim > 0)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, 5);
  const top = matches[0] ? matches[0].sim : 0;
  return {
    verdict: top >= 60 ? "DUPLICATE" : top >= 30 ? "SIMILAR — needs a new angle" : "CLEAR",
    top, matches,
  };
}

// ---- mock recommendation: gap analysis against a business-topic bank ----
const CANDIDATES = [
  ["Insurance Negotiation: Getting a Real Fee Increase Out of Your Worst PPO", "fees & insurance"],
  ["The Associate Pay Model That Keeps Producers for 5+ Years", "team & compensation"],
  ["Case Acceptance: The Handoff Script Between Doctor and Treatment Coordinator", "case acceptance"],
  ["Membership Plans That Replace PPO Revenue — Real Numbers", "fees & insurance"],
  ["Making the Hygiene Department Profitable Without Burning Out Hygienists", "hygiene"],
  ["The DSO Offer on Your Desk: How to Read It and When to Walk", "exits & DSOs"],
  ["Patient Reactivation: Turning the Dormant Chart List into Next Month's Production", "patients & recare"],
  ["From 3.9 to 4.8 Stars: A Review System the Front Desk Actually Runs", "marketing"],
  ["Phone Skills That Convert: Auditing Your Front Desk's First 20 Seconds", "front desk"],
  ["Embezzlement-Proofing Your Practice: The 5 Controls Every Owner Needs", "finance"],
  ["Overhead Benchmarks by Category — and the First Line Item to Cut", "finance"],
  ["Your First Associate: The Math That Says When You're Ready", "team & compensation"],
  ["Opening Location #2: The Numbers That Must Be True First", "growth"],
  ["AI at the Front Desk: What Actually Works in a Practice Today", "technology"],
  ["The Morning Huddle That Adds $2,000 a Day", "leadership"],
  ["Treatment Financing: Third-Party Options Compared for Case Acceptance", "case acceptance"],
  ["Recare That Runs Itself: Automating the 6-Month Machine", "patients & recare"],
  ["Payroll Percent Out of Control? A 90-Day Reset Plan", "finance"],
  ["Partner Buy-In Deals: Structures That Don't End Friendships", "exits & DSOs"],
  ["The New-Patient Experience: First Visit to Yes in One Appointment", "patients & recare"],
];

// Categories and rules from the team's MASTER PROMPT (TD Podcast Episode Topic Research)
const TT_CATEGORIES = "Financial & Wealth, Practice Valuation & Exit, Scaling & Systems, Team & Leadership, Burnout & Wellbeing, Marketing & Operations, Production Optimization, DSO & Ownership, Practice Protection, Technology, Ownership & Career";

async function recommend() {
  const titles = corpus().map((e) => (e.ep === "bank" ? "" : e.ep + ": ") + e.title).join("\n");
  if (A.mode.anthropic === "REAL") {
    const sys =
      "You are a podcast content strategist for the Thriving Dentist Show, hosted by Gary Takacs (43 years coaching dental practices, co-owner of LifeSmiles Dental Care, teaches 24 proven business systems and 9 core KPIs) and Naren Arulrajah (founder/CEO of Ekwa Marketing, dental digital marketing). " +
      "AUDIENCE: private dental practice owners 3-15 years into ownership — not beginners, not DSO operators. They respond to honesty, real numbers, and specific situations, never hype. " +
      "TITLE RULES: plain language describing what the episode is actually about — not clickbait. Never use: transformative, game-changer, leverage, actionable, empower, innovative, holistic, seamless, robust, cutting-edge, unpack, delve. " +
      "CATEGORIES (pick one per topic): " + TT_CATEGORIES + ". " +
      "PRIORITY: High = trending now / strong relevance for growth-phase owners / fills a significant catalog gap. Medium = solid evergreen with a clear angle. Low = useful, not urgent. " +
      "Every topic must be one Gary can speak to from experience and must lead naturally to a CSM/MSM conversation.";
    const user = `Here is the full archive of past episode titles:\n${titles}\n\nPropose exactly 5 new topics that fill real gaps in this catalog. JSON only:\n[{"title":"...","category":"one of the categories","priority":"High|Medium|Low","why":"what TD has and has not covered and why this angle is new"}]`;
    const out = await A.aiGenerate(sys, user);
    try {
      const arr = JSON.parse(out.slice(out.indexOf("["), out.lastIndexOf("]") + 1));
      return arr.slice(0, 5).map((t) => ({ ...t, dup: checkDuplicate(t.title), source: "AI" }));
    } catch (e) { /* fall through to mock on parse failure */ }
  }
  // MOCK: gap analysis — themes with least coverage first, dedup-checked
  const themeCover = {};
  CANDIDATES.forEach(([, theme]) => (themeCover[theme] = 0));
  corpus().forEach((e) => {
    CANDIDATES.forEach(([cand, theme]) => {
      if (similarity(cand, e.title) >= 25) themeCover[theme] = (themeCover[theme] || 0) + 1;
    });
  });
  const scored = CANDIDATES.map(([title, theme]) => {
    const dup = checkDuplicate(title);
    return { title, theme, dup, cover: themeCover[theme] || 0 };
  })
    .filter((t) => t.dup.top < 60)
    .sort((a, b) => (a.cover - b.cover) || (a.dup.top - b.dup.top))
    .slice(0, 5);
  return scored.map((t) => ({
    title: t.title,
    category: t.theme,
    priority: "Medium",
    why: `Gap: only ${t.cover} past episode(s) near the "${t.theme}" theme` +
      (t.dup.matches[0] ? `; closest is EP ${t.dup.matches[0].ep} "${t.dup.matches[0].title}" at ${t.dup.top}% similarity` : "; nothing close in the archive"),
    dup: t.dup,
    source: "Gap analysis (no AI key)",
  }));
}

// Serverless entry. Two corpora:
//  EPISODES — numbered recent episodes from the local CSV export (search table)
//  COVERED  — every covered topic from the Topic Tracker's "Topic Bank - Covered"
//             and "✅ Already Covered" tabs (dedup reaches back before EP 631)
const SDB = require("./sheetdb");
let loadedFrom = null;
async function ensureLoaded() {
  if (!EPISODES.length) {
    const r = load(); // CSV episodes (fine if missing)
    loadedFrom = r.ok ? "csv" : "none";
  }
  // retry the tracker corpus until it loads (a slow cold start must not lock us to CSV-only)
  if (!COVERED.length && SDB.enabled()) {
    try {
      const topics = await SDB.readCovered();
      const have = new Set(EPISODES.map((e) => e.title.toLowerCase()));
      COVERED = topics.filter((t) => t.title && !have.has(t.title.toLowerCase()));
      loadedFrom = EPISODES.length ? "csv+tracker" : "tracker";
    } catch (e) { /* tracker unreachable right now — CSV only this round */ }
  }
  return { ok: EPISODES.length + COVERED.length > 0, count: EPISODES.length + COVERED.length, source: loadedFrom };
}

module.exports = { load, ensureLoaded, search, checkDuplicate, recommend, count: () => EPISODES.length + COVERED.length };
