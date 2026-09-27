// Receives a small (browser-resized) headshot as base64, stores it in the
// team's Google Drive via the sheet connector, returns a public image URL.
const SDB = require("../../lib/sheetdb");

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
    const { name, mime, data } = req.body || {};
    if (!data) return res.status(400).json({ error: "no image data" });
    if (data.length > 2_500_000) return res.status(413).json({ error: "image too large after resize — try a smaller photo" });
    const r = await SDB.uploadImage(name || "headshot.jpg", mime || "image/jpeg", data);
    // Drive thumbnail URL renders reliably in browsers AND email clients
    res.json({ ok: true, url: "https://drive.google.com/thumbnail?id=" + r.id + "&sz=w400" });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

export const config = { maxDuration: 60, api: { bodyParser: { sizeLimit: "4mb" } } };
