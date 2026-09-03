const ARC = require("../../lib/archive");
export default async function handler(req, res) {
  try {
    await ARC.ensureLoaded();
    res.json(ARC.search(req.query.q || ""));
  } catch (e) { res.status(500).json({ error: e.message }); }
}
