const ARC = require("../../../lib/archive");
export default async function handler(req, res) {
  try {
    await ARC.ensureLoaded();
    res.json(await ARC.recommend());
  } catch (e) { res.status(500).json({ error: e.message }); }
}

export const config = { maxDuration: 120 };
