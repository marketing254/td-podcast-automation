// ============================================================
// SHEETDB — Google Sheets as the database. Zero npm deps:
// service-account JWT is signed with node:crypto.
// Tabs used in the connected spreadsheet (the master-tracker copy):
//   System_DB     — pipeline state (chunked JSON, machine-owned)
//   Analytics     — per-episode/broadcast analytics (human-readable)
//   <ARCHIVE_TAB> — the existing "Episode Summary" tab (read-only)
// ============================================================
const crypto = require("crypto");
const cfg = require("./config");

const b64u = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

let tok = { token: null, exp: 0 };
async function token() {
  if (tok.token && Date.now() < tok.exp - 60000) return tok.token;
  const now = Math.floor(Date.now() / 1000);
  const input =
    b64u(JSON.stringify({ alg: "RS256", typ: "JWT" })) + "." +
    b64u(JSON.stringify({
      iss: cfg.GOOGLE_SA_EMAIL,
      scope: "https://www.googleapis.com/auth/spreadsheets",
      aud: "https://oauth2.googleapis.com/token",
      iat: now, exp: now + 3600,
    }));
  const key = cfg.GOOGLE_SA_KEY.replace(/\\n/g, "\n");
  const sig = crypto.createSign("RSA-SHA256").update(input).sign(key);
  const jwt = input + "." + b64u(sig);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=" + jwt,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("Google auth failed: " + JSON.stringify(data).slice(0, 200));
  tok = { token: data.access_token, exp: Date.now() + (data.expires_in || 3600) * 1000 };
  return tok.token;
}

const BASE = () => `https://sheets.googleapis.com/v4/spreadsheets/${cfg.SHEET_ID}`;
async function gs(path, opts = {}) {
  const t = await token();
  const res = await fetch(BASE() + path, {
    ...opts,
    headers: { authorization: "Bearer " + t, "content-type": "application/json", ...(opts.headers || {}) },
  });
  if (!res.ok) throw new Error("Sheets API " + res.status + ": " + (await res.text()).slice(0, 300));
  return res.json();
}

const useWebApp = () => Boolean(cfg.SHEETS_WEBAPP_URL);
const enabled = () => useWebApp() || Boolean(cfg.SHEET_ID && cfg.GOOGLE_SA_EMAIL && cfg.GOOGLE_SA_KEY);

// ---- Apps Script web app backend (the easy path) ----
// Google occasionally serves a transient auth interstitial instead of running
// the script; retrying almost always clears it, so retry before failing.
async function wa(op, payload = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(cfg.SHEETS_WEBAPP_URL, {
        method: "POST",
        headers: { "content-type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ secret: cfg.SHEETS_WEBAPP_SECRET, op, ...payload }),
        redirect: "follow",
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); }
      catch (e) { throw new Error("TRANSIENT: webapp returned non-JSON (Google interstitial): " + text.slice(0, 80)); }
      if (data.error) throw new Error("Sheet webapp: " + data.error);
      return data;
    } catch (err) {
      lastErr = err;
      const transient = /TRANSIENT|fetch failed|timeout/i.test(err.message);
      if (!transient || attempt === 4) break;
      await new Promise((r) => setTimeout(r, 1200 * attempt));
    }
  }
  throw lastErr;
}

let tabsEnsured = false;
async function ensureTabs() {
  if (tabsEnsured) return;
  const meta = await gs("?fields=sheets.properties.title");
  const have = new Set(meta.sheets.map((s) => s.properties.title));
  const want = ["System_DB", "Analytics"].filter((t) => !have.has(t));
  if (want.length) {
    await gs(":batchUpdate", {
      method: "POST",
      body: JSON.stringify({ requests: want.map((t) => ({ addSheet: { properties: { title: t } } })) }),
    });
  }
  tabsEnsured = true;
}

const CHUNK = 45000;
async function loadJson() {
  if (useWebApp()) {
    const { raw } = await wa("loadDb");
    return raw && raw.trim() ? JSON.parse(raw) : null;
  }
  await ensureTabs();
  const data = await gs("/values/System_DB!A:A");
  const raw = (data.values || []).map((r) => r[0] || "").join("");
  if (!raw.trim()) return null;
  return JSON.parse(raw);
}
async function saveJson(obj) {
  const raw = JSON.stringify(obj);
  if (useWebApp()) { await wa("saveDb", { raw }); return; }
  await ensureTabs();
  const rows = [];
  for (let i = 0; i < raw.length; i += CHUNK) rows.push([raw.slice(i, i + CHUNK)]);
  await gs("/values/System_DB!A:A:clear", { method: "POST", body: "{}" });
  await gs("/values/System_DB!A1?valueInputOption=RAW", {
    method: "PUT",
    body: JSON.stringify({ values: rows }),
  });
}

// Covered topics from the Topic Tracker ("Topic Bank - Covered" + "✅ Already Covered")
// — the corpus for the duplicate check, reaching back before episode 631.
async function readCovered() {
  const { topics } = await wa("readCovered");
  return topics || [];
}

const AN_HEADER = ["Type", "Ref", "Date", "Title / Subject", "Recipients", "Open %", "Click %", "Total clicks", "Unique clickers", "Live check", "Updated"];
async function writeAnalytics(rows) {
  if (useWebApp()) { await wa("writeAnalytics", { rows: [AN_HEADER, ...rows] }); return; }
  await ensureTabs();
  await gs("/values/Analytics!A:Z:clear", { method: "POST", body: "{}" });
  await gs("/values/Analytics!A1?valueInputOption=RAW", {
    method: "PUT",
    body: JSON.stringify({ values: [AN_HEADER, ...rows] }),
  });
}

// Append rows to the 🔍 Gap Tracker tab of the TD Podcast Topic Tracker.
// Columns: Topic Title | Category | Source | Source Title | URL | Date | Priority | Gap Confirmed | Notes | Status
async function appendGapRows(rows) {
  if (!useWebApp()) throw new Error("Topic tracker append requires the Apps Script connector");
  return wa("appendGapRows", { rows });
}

module.exports = { enabled, loadJson, saveJson, readCovered, writeAnalytics, appendGapRows };
