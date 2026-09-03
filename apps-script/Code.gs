// ============================================================
// TD AUTOMATION — TOPIC TRACKER CONNECTOR (Google Apps Script)
// Paste this into the TD PODCAST TOPIC TRACKER (the copy):
// Extensions → Apps Script → delete default code → paste this →
// Deploy → New deployment → Web app → Execute as: Me →
// Who has access: Anyone → Deploy → authorize → copy the URL.
// (This replaces the old master-tracker script — the system now
// connects ONLY to the Topic Tracker.)
// ============================================================
const SECRET = "PASTE_THE_SHARED_SECRET_HERE"; // same value as SHEETS_WEBAPP_SECRET in the app config

function doPost(e) {
  let res;
  try {
    const req = JSON.parse(e.postData.contents);
    if (req.secret !== SECRET) throw new Error("unauthorized");
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    if (req.op === "ping") {
      res = { ok: true, name: ss.getName(), tabs: ss.getSheets().map(s => s.getName()) };

    } else if (req.op === "loadDb") {
      const sh = ensure(ss, "System_DB");
      const n = sh.getLastRow();
      const vals = n ? sh.getRange(1, 1, n, 1).getValues() : [];
      res = { raw: vals.map(r => r[0] || "").join("") };

    } else if (req.op === "saveDb") {
      const sh = ensure(ss, "System_DB");
      sh.clearContents();
      const raw = req.raw || "", C = 45000, rows = [];
      for (let i = 0; i < raw.length; i += C) rows.push([raw.slice(i, i + C)]);
      if (rows.length) sh.getRange(1, 1, rows.length, 1).setValues(rows);
      res = { ok: true, chunks: rows.length };

    } else if (req.op === "readCovered") {
      // Everything TD has already covered, for the duplicate check:
      // 1) "Topic Bank - Covered" — matrix of titles under category columns
      // 2) "✅ Already Covered" — Topic Title + Category rows
      const topics = [];
      const bank = ss.getSheets().find(s => s.getName().indexOf("Topic Bank") > -1);
      if (bank && bank.getLastRow() > 2) {
        const vals = bank.getRange(1, 1, bank.getLastRow(), bank.getLastColumn()).getValues();
        const heads = vals[1] || []; // category header row
        for (let r = 2; r < vals.length; r++) {
          for (let c = 1; c < vals[r].length; c++) {
            const t = String(vals[r][c] || "").trim();
            if (t.length > 8) topics.push({ title: t, category: String(heads[c] || "").trim() });
          }
        }
      }
      const cov = ss.getSheets().find(s => s.getName().indexOf("Already Covered") > -1);
      if (cov && cov.getLastRow() > 1) {
        const vals = cov.getRange(2, 1, cov.getLastRow() - 1, 2).getValues();
        vals.forEach(r => {
          const t = String(r[0] || "").trim();
          if (t.length > 8) topics.push({ title: t, category: String(r[1] || "").trim() });
        });
      }
      res = { topics: topics };

    } else if (req.op === "writeAnalytics") {
      const sh = ensure(ss, "Analytics");
      sh.clearContents();
      const rows = req.rows || [];
      if (rows.length) sh.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
      sh.getRange(1, 1, 1, (rows[0] || [1]).length).setFontWeight("bold");
      res = { ok: true, rows: rows.length };

    } else if (req.op === "appendGapRows") {
      let sh = ss.getSheets().find(s => s.getName().indexOf("Gap Tracker") > -1);
      if (!sh) throw new Error("Gap Tracker tab not found");
      const rows = req.rows || [];
      if (rows.length) {
        const start = sh.getLastRow() + 1;
        sh.getRange(start, 1, rows.length, rows[0].length).setValues(rows);
      }
      res = { ok: true, appended: rows.length, tab: sh.getName() };

    } else throw new Error("unknown op: " + req.op);
  } catch (err) {
    res = { error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
}

function ensure(ss, name) { return ss.getSheetByName(name) || ss.insertSheet(name); }
