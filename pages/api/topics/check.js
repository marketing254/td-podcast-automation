const ARC = require("../../../lib/archive");
export default async function handler(req, res) {
  try {
    await ARC.ensureLoaded();
    res.json(ARC.checkDuplicate((req.body && req.body.title) || ""));
  } catch (e) { res.status(500).json({ error: e.message }); }
}
