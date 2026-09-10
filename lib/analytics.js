// ============================================================
// ANALYTICS — pulls real performance data and writes it to the
// Analytics tab of the connected master-tracker copy.
// Sources today: Kit broadcast stats (real), live URL checks
// (real), pipeline KPI snapshots. Libsyn downloads join when
// API access exists; Meta insights join when tokens are added.
// ============================================================
const cfg = require("./config");
const A = require("./adapters");
const SDB = require("./sheetdb");

// Only TD PODCAST sends belong in this dashboard - not every TD email.
const PODCAST_RE = /(\bEP\s*\d+)|episode|podcast|thriving dentist show|weekly nl|weekend nl|review before send/i;
function isPodcastBroadcast(b, systemIds) {
  if (systemIds.has(String(b.id))) return true;
  return PODCAST_RE.test(b.subject || "");
}
async function kitRecentBroadcasts(limit, db) {
  if (!cfg.KIT_API_SECRET) return [];
  const { kfetch } = require("./khttp");
  const res = await kfetch(`https://api.convertkit.com/v3/broadcasts?api_secret=${cfg.KIT_API_SECRET}&sort_order=desc`);
  if (!res.ok) return [];
  const data = await res.json();
  const systemIds = new Set();
  (db && db.episodes || []).forEach((e) => (e.kit || []).forEach((k) => systemIds.add(String(k.id))));
  return (data.broadcasts || []).filter((b) => isPodcastBroadcast(b, systemIds)).slice(0, limit || 12);
}

async function kitStats(id) {
  const { kfetch } = require("./khttp");
  const res = await kfetch(`https://api.convertkit.com/v3/broadcasts/${id}/stats?api_secret=${cfg.KIT_API_SECRET}`);
  if (!res.ok) return null;
  return (await res.json()).broadcast?.stats || null;
}

// Builds the analytics rows: newsletters (Kit) + episodes (pipeline)
async function buildRows(db) {
  const now = new Date().toISOString().slice(0, 16).replace("T", " ");
  const rows = [];

  // 1. Real Kit newsletter performance (degrades gracefully when Kit is unreachable)
  try {
    const bs = await kitRecentBroadcasts(12, db);
    for (const b of bs) {
      let s = null;
      try { s = await kitStats(b.id); } catch (e) { /* skip this one */ }
      if (!s) continue;
      rows.push(["Newsletter (Kit)", String(b.id), (b.created_at || "").slice(0, 10), b.subject || "",
        s.recipients ?? "", s.open_rate ?? "", s.click_rate ?? "", s.total_clicks ?? "", s.emails_clicked ?? "", "", now]);
    }
    if (!bs.length && cfg.KIT_API_SECRET) rows.push(["Note", "", "", "No TD Podcast sends found yet - only podcast-related emails are counted here", "", "", "", "", "", "", now]);
  } catch (e) {
    rows.push(["Note", "", "", "Kit temporarily unreachable from this network — retry shortly (" + e.message.slice(0, 60) + ")", "", "", "", "", "", "", now]);
  }

  // 2. Pipeline episodes: KPI snapshot + live check
  for (const e of (db?.episodes || [])) {
    rows.push(["Episode", "EP " + e.ep, e.releaseDate || "", e.title,
      "", "", "", e.kpi ? e.kpi.newsletterClicks : "", "",
      e.live ? (e.live.live ? "LIVE" : "NOT FOUND " + e.live.status) : (e.kpi ? "checked" : "pending"),
      now]);
  }
  return rows;
}

async function refresh(db) {
  const rows = await buildRows(db);
  let wrote = false;
  if (SDB.enabled()) { await SDB.writeAnalytics(rows); wrote = true; }
  return { rows, wroteToSheet: wrote, count: rows.length };
}

module.exports = { refresh };
