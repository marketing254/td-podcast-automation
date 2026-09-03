// ============================================================
// CONFIG — on Vercel everything comes from Environment Variables.
// For local dev, create config.local.js (git-ignored) with the
// same keys and it fills the gaps.
// ============================================================
let local = {};
try { local = require("../config.local.js"); } catch (e) { /* no local overrides */ }

const v = (name, fallback) => process.env[name] || local[name] || fallback || "";

module.exports = {
  // AI writing
  ANTHROPIC_API_KEY: v("ANTHROPIC_API_KEY"),
  ANTHROPIC_MODEL: v("ANTHROPIC_MODEL", "claude-sonnet-5"),
  OPENAI_API_KEY: v("OPENAI_API_KEY"),
  OPENAI_MODEL: v("OPENAI_MODEL", "gpt-4o-mini"),

  // Kit
  KIT_API_KEY: v("KIT_API_KEY"),
  KIT_API_V3_KEY: v("KIT_API_V3_KEY"),
  KIT_API_SECRET: v("KIT_API_SECRET"),

  // Libsyn (optional — live check works without it)
  LIBSYN_CLIENT_ID: v("LIBSYN_CLIENT_ID"),
  LIBSYN_CLIENT_SECRET: v("LIBSYN_CLIENT_SECRET"),
  LIBSYN_SHOW_ID: v("LIBSYN_SHOW_ID"),

  // Slack
  SLACK_WEBHOOK_URL: v("SLACK_WEBHOOK_URL"),

  // Google Sheets database (the copy of the master tracker)
  // EASY PATH: Apps Script web app inside the sheet (see apps-script/Code.gs)
  SHEETS_WEBAPP_URL: v("SHEETS_WEBAPP_URL"),       // the Deploy → Web app URL
  SHEETS_WEBAPP_SECRET: v("SHEETS_WEBAPP_SECRET"),
  // ALTERNATIVE: service account (only if the webapp URL is empty)
  SHEET_ID: v("SHEET_ID"),
  ARCHIVE_TAB: v("ARCHIVE_TAB", "Episode Summary"),
  GOOGLE_SA_EMAIL: v("GOOGLE_SA_EMAIL"),
  GOOGLE_SA_KEY: v("GOOGLE_SA_KEY"),

  // Optional local CSV fallback — unused; the archive loads live from the Topic Tracker
  ARCHIVE_CSV_PATH: v("ARCHIVE_CSV_PATH"),

  // Business settings
  MSM_LINK: v("MSM_LINK", "https://thrivingdentist.com/msm/"),
  CSM_LINK: v("CSM_LINK", "https://thrivingdentist.com/csm/"),
  HOT_KEYWORDS: ["msm", "booking", "csm", "strategy"],
  WARM_KEYWORDS: ["episode", "notes", "replay"],
  KIT_SCHEDULE_DAYS_BEFORE: 2,
  PORT: 3764,
};
