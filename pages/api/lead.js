const P = require("../../lib/pipeline");
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
    await P.ready();
    P.leadAction(req.body.leadId, req.body.status);
    await P.flush();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}
