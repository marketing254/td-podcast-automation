// Appends recommended topics into the 🔍 Gap Tracker tab of the
// TD Podcast Topic Tracker (row format = the master prompt's TASK 1 spec).
const SDB = require("../../../lib/sheetdb");

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
    const topics = req.body.topics || [];
    if (!topics.length) return res.status(400).json({ error: "no topics" });
    const today = new Date().toISOString().slice(0, 10);
    const rows = topics.map((t) => [
      t.title,
      t.category || "",
      "TD Automation system — archive gap analysis",
      "",
      "",
      today,
      t.priority || "Medium",
      t.dup && t.dup.top < 30 ? "Yes" : "Needs review",
      (t.why || "") + (t.dup && t.dup.matches && t.dup.matches[0]
        ? ` [Dedup: closest EP ${t.dup.matches[0].ep} at ${t.dup.top}%]` : " [Dedup: nothing close in archive]"),
      "Open Gap",
    ]);
    const r = await SDB.appendGapRows(rows);
    res.json({ ok: true, appended: r.appended, tab: r.tab });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

export const config = { maxDuration: 60 };
