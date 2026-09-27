const P = require("../../lib/pipeline");
const A = require("../../lib/adapters");
const ARC = require("../../lib/archive");
const SDB = require("../../lib/sheetdb");
export default async function handler(req, res) {
  try {
    const db = await P.ready();
    const arc = await ARC.ensureLoaded();
    res.json({ ...db, people: db.people || {}, mode: { ...A.mode, sheets: SDB.enabled() ? "REAL" : "MOCK" }, stages: P.STAGES,
      archive: { ok: arc.ok, count: ARC.count(), source: arc.source } });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

export const config = { maxDuration: 60 };
