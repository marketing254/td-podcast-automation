# TD Automation — Next.js / Vercel edition

The TD Podcast automation pipeline as a Next.js app: Google Sheets as the database,
Vercel Cron as the scheduler, the dashboard at `/`. Same pipeline as v1
(transcript → AI show notes → gate → ticket + newsletters → gate → Kit → release →
KPI → leads) plus a full **Analytics** module.

## Local dev

```
cd td-automation-next
npm install
npm run dev        # http://localhost:3764
```

Local keys live in `config.local.js` (git-ignored). On Vercel, use Environment
Variables — same names.

## Deploy: GitHub → Vercel (one-time, ~15 min)

1. **GitHub**: create a PRIVATE repo, push this folder.
   `config.local.js`, `data/`, `.env*` are git-ignored — keys never leave the machine.
2. **Vercel**: Add New Project → import the repo. Framework auto-detects Next.js.
3. **Environment Variables** (Project → Settings → Environment Variables):

   | Name | Value |
   |---|---|
   | `OPENAI_API_KEY` | the OpenAI key |
   | `KIT_API_V3_KEY` | Kit v3 API key |
   | `KIT_API_SECRET` | Kit v3 API secret |
   | `SHEET_ID` | ID of the master-tracker COPY (from its URL) |
   | `GOOGLE_SA_EMAIL` | service-account email (…@…iam.gserviceaccount.com) |
   | `GOOGLE_SA_KEY` | service-account private key (paste the full PEM; newlines as \n are fine) |
   | `SLACK_WEBHOOK_URL` | optional — approval pings |

4. Deploy. The daily cron (`vercel.json` → `/api/cron`, 10:00 UTC) releases due
   episodes and refreshes analytics automatically.

## Google Sheets database setup (one-time, ~10 min)

1. Copy the **entire "Thriving Dentist Master"** spreadsheet (File → Make a copy).
   Keep the tab name **"Episode Summary"** — the archive/topics read from it.
2. console.cloud.google.com → create/select a project → APIs & Services →
   enable **Google Sheets API**.
3. IAM & Admin → **Service Accounts** → Create → any name → done.
   Open it → Keys → Add key → **JSON** → download.
4. From the JSON: `client_email` → `GOOGLE_SA_EMAIL`, `private_key` → `GOOGLE_SA_KEY`.
5. **Share the sheet copy** with the service-account email as **Editor**.
6. Sheet ID = the long string in the sheet URL between `/d/` and `/edit`.

The app creates its own tabs in the copy: `System_DB` (pipeline state) and
`Analytics` (per-episode / per-newsletter performance, human-readable).

## Analytics

Dashboard → Analytics tab → Refresh: pulls real Kit broadcast stats (recipients,
open %, click %, unique clickers), episode live-status checks, and pipeline KPI
snapshots — renders them and writes the same rows to the sheet's `Analytics` tab.
Also runs automatically via the daily cron. Libsyn download numbers join the same
table when API access is granted; Meta (FB/IG) insights join when page tokens are
added.

## Notes

- Kit calls route through `lib/khttp.js` (fetch with curl fallback) because this
  dev machine's network intermittently blocks Node's TLS to Kit. Vercel is unaffected.
- The archive loads from the connected sheet's "Episode Summary" tab; with no sheet
  connected it falls back to the local CSV export.
- v1 (`td-automation-system/`, plain Node) is superseded by this app.
