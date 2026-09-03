// Vercel Cron hits this daily: releases due episodes + refreshes analytics.
const P = require("../../lib/pipeline");
const AN = require("../../lib/analytics");
export default async function handler(req, res) {
  try {
    const db = await P.ready();
    await P.tick();
    const a = await AN.refresh(db);
    await P.flush();
    res.json({ ok: true, analyticsRows: a.count, wroteToSheet: a.wroteToSheet });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

export const config = { maxDuration: 300 };
