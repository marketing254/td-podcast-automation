// ============================================================
// NEWSLETTER BUILDER — deterministic modern template.
// The AI writes ONLY structured content fields (JSON); this file
// pours them into lib/templates/modern.html, so the design can
// never break, and headshots are swapped in dynamically.
// ============================================================
const fs = require("fs");
const path = require("path");
const cfg = require("./config");

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function paras(arr) {
  return (arr || []).map((p) => `<p style="margin:0 0 14px;">${esc(p)}</p>`).join("");
}
function takeaways(arr) {
  return (arr || []).map((t) =>
    `<tr><td width="18" valign="top" style="font-size:15px;line-height:24px;color:#2D7FB4;font-weight:bold;">&bull;</td>` +
    `<td style="font-size:15px;line-height:24px;color:#3A4B57;padding-bottom:10px;">${esc(t)}</td></tr>`
  ).join("");
}
// One circular headshot unit. With an image URL -> photo circle;
// without -> initials circle (email-safe colored disc).
function hostUnit(name, img) {
  const initials = String(name || "").split(/\s+/).map((w) => w[0] || "").join("").slice(0, 2).toUpperCase();
  const circle = img
    ? `<img src="${esc(img)}" width="110" height="110" alt="${esc(name)}" style="display:block;width:110px;height:110px;border-radius:55px;object-fit:cover;border:0;">`
    : `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td align="center" valign="middle" width="110" height="110" style="width:110px;height:110px;border-radius:55px;background-color:#2D7FB4;font-family:Georgia,serif;font-size:34px;color:#FFFFFF;font-weight:bold;">${esc(initials)}</td></tr></table>`;
  return `<td align="center" style="padding:8px 14px;">${circle}` +
    `<div style="font-size:13px;font-weight:bold;color:#1E3A52;padding-top:10px;">${esc(name)}</div></td>`;
}
function hostsHtml(episode) {
  let hosts = Array.isArray(episode.people) && episode.people.length ? episode.people.slice(0, 4) : null;
  if (!hosts) {
    hosts = [
      { name: "Gary Takacs", img: cfg.GARY_HEADSHOT_URL },
      { name: "Naren Arulrajah", img: cfg.NAREN_HEADSHOT_URL },
    ];
    const guest = (episode.guest || "").trim();
    if (guest) hosts.push({ name: guest, img: episode.headshot || "" });
  }
  // config fallbacks for the two core hosts if a row has no photo
  hosts = hosts.map((h) => {
    let img = h.img || "";
    if (!img && /^gary/i.test(h.name)) img = cfg.GARY_HEADSHOT_URL || "";
    if (!img && /^naren/i.test(h.name)) img = cfg.NAREN_HEADSHOT_URL || "";
    return { name: h.name, img };
  });
  return `<table role="presentation" cellpadding="0" cellspacing="0"><tr>` +
    hosts.map((h) => hostUnit(h.name, h.img)).join("") + `</tr></table>`;
}

// fields: subject, preview, eyebrow, title, deck, intro[], section_head,
// section[], quote, quote_by, take_head, takeaways[], extra, card[], card_label, card_url
function build(episode, fields, kind) {
  const tpl = fs.readFileSync(path.join(process.cwd(), "lib", "templates", "modern.html"), "utf8");
  const map = {
    "{{PREVIEW}}": esc(fields.preview || ""),
    "{{EYEBROW}}": esc(fields.eyebrow || ((kind === "weekend" ? "WEEKEND LISTEN" : "NEW EPISODE") + " · " + episode.ep)),
    "{{TITLE}}": esc(fields.title || episode.title),
    "{{DECK}}": esc(fields.deck || ""),
    "{{HOSTS_HTML}}": hostsHtml(episode),
    "{{INTRO_HTML}}": paras(fields.intro),
    "{{SECTION_HEAD}}": esc(fields.section_head || ""),
    "{{SECTION_HTML}}": paras(fields.section),
    "{{QUOTE}}": esc(fields.quote || ""),
    "{{QUOTE_BY}}": esc(fields.quote_by || ""),
    "{{TAKE_HEAD}}": esc(fields.take_head || (kind === "weekend" ? "Three Takeaways Worth Your Weekend Listen" : "Five Things You Will Take From This Episode")),
    "{{TAKEAWAYS_HTML}}": takeaways(fields.takeaways),
    "{{EXTRA_HTML}}": paras(fields.extra ? [fields.extra] : []),
    "{{LISTEN_URL}}": esc(episode.link || cfg.MSM_LINK),
    "{{APPLE_URL}}": esc(cfg.APPLE_PODCASTS_URL),
    "{{YT_URL}}": esc(cfg.YOUTUBE_URL),
    "{{CARD_HTML}}": paras(fields.card),
    "{{CARD_URL}}": esc(kind === "weekend" ? cfg.CSM_LINK : cfg.MSM_LINK),
    "{{CARD_LABEL}}": esc(fields.card_label || (kind === "weekend" ? "Book a Strategy Meeting with Gary" : "Book a Marketing Strategy Meeting")),
  };
  let html = tpl;
  for (const [k, v] of Object.entries(map)) html = html.split(k).join(v);
  return "SUBJECT: " + (fields.subject || `TD EP ${episode.ep}`) + "\n" + html;
}

module.exports = { build };
