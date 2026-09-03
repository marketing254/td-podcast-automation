const P = require("../../lib/pipeline");
const AN = require("../../lib/analytics");
export default async function handler(req, res) {
  try {
    const db = await P.ready();
    const out = await AN.refresh(db);
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
}

export const config = { maxDuration: 180 };
