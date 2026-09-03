const P = require("../../lib/pipeline");
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
    await P.ready();
    await P.tick(req.body.id);
    await P.flush();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

export const config = { maxDuration: 180 };
