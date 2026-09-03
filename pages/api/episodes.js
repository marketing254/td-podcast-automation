const P = require("../../lib/pipeline");
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
    await P.ready();
    const e = P.createEpisode(req.body);
    await P.flush();
    res.json(e);
  } catch (e) { res.status(500).json({ error: e.message }); }
}
