# Sales Dashboard

Posts a daily Slack report of sales call bookings (from Calendly) and cash
collected pace (from the existing `Daily Cash Report` channel), so the team
can see at a glance whether Oz and Blake are on pace for the week's goals.

**Targets tracked:**
- $37,000 new cash collected per week (so the month clears $100,000+)
- Oz: 15 calls booked per week
- Blake: 20 calls booked per week

**Call breakdown tracked (Oz's calendar):**
- Booked from webinar
- Set by Blake
- Other

**Blake's own calendar:** total booked, and how many of those were her sets for Oz.

Runs automatically every day at 8am ET via GitHub Actions and posts to a
dedicated Slack channel. No server or database to host.

---

## How it works

1. Pulls Calendly's `scheduled_events` for the current week and current month.
2. Splits those events into buckets by **who's hosting** (Oz vs. Blake) and
   **which event type they came through** (matched by keywords in the event
   name — see "Calendly setup" below).
3. Reads the latest message in the private `Daily Cash Report` Slack channel
   and parses out this week's cash-so-far, last week's total, and
   month-to-date new cash.
4. Posts one combined summary to a new Slack channel, with ✅ / ⚠️ / 🔴 flags
   showing whether each number is on pace for a flat linear run at the
   weekly/monthly target.

**Important assumption to verify:** "calls Blake has set" and "calls on Oz's
calendar that are from Blake" are currently treated as the same number (the
calls she books onto Oz's calendar). If Blake also sets calls that land
somewhere else, tell me and I'll add a separate category.

---

## Setup

You'll need to do four things once: set up Calendly event types, get a
Calendly API token, create a Slack app, and add GitHub secrets.

### 1. Calendly event types

Calendly has no built-in field for "who booked this on behalf of the host,"
so the only reliable way to tell these apart is via **separate booking
links/event types**. Create these three event types if they don't already
exist:

| Event type | Host | Used for | Naming requirement |
|---|---|---|---|
| Oz — Webinar follow-up call | Oz | Link shared on/after the webinar | Name must contain **"webinar"** |
| Oz — Call set by Blake | Oz | The link Blake uses when she books a prospect straight onto Oz's calendar | Name must contain **"blake"** |
| Blake — Discovery call | Blake | Blake's own booking link | Any name — it's matched by host, not keyword |

Any other event type hosted by Oz that doesn't match "webinar" or "blake"
falls into an "Other" bucket automatically — nothing breaks if you add more
event types later, they just won't be separately categorized until you
update `src/config.js`.

> If you'd rather not create new event types, an alternative is tagging
> Calendly booking links with UTM parameters (e.g. `?utm_source=webinar`)
> and matching on that instead. That's not built yet — say the word and I'll
> add it.

### 2. Calendly API token + URIs

1. In Calendly: **Account → Integrations → API & Webhooks → Personal Access
   Tokens** → create a token. This requires a paid Calendly plan.
2. Get your org and user URIs by calling, with that token:
   ```bash
   curl -H "Authorization: Bearer YOUR_TOKEN" https://api.calendly.com/users/me
   ```
   The response gives you `resource.uri` (this user's URI) and
   `resource.current_organization` (the org URI).
3. Repeat for Oz's and Blake's own accounts (or ask them for their
   `users/me` URI) to get `CALENDLY_OZ_USER_URI` and `CALENDLY_BLAKE_USER_URI`.

### 3. Slack app

1. Go to <https://api.slack.com/apps> → **Create New App** → From scratch.
2. Under **OAuth & Permissions**, add these Bot Token Scopes:
   - `chat:write` — to post the daily report
   - `groups:history` — to read the private Daily Cash Report channel
   - `channels:history` — in case the dashboard channel or cash channel end up public
3. Install the app to your workspace, copy the **Bot User OAuth Token**
   (`xoxb-...`) → this is `SLACK_BOT_TOKEN`.
4. Create the new dashboard channel (e.g. `#sales-calls-dashboard`).
5. **Invite the bot** to both the `Daily Cash Report` channel and the new
   dashboard channel (`/invite @YourBotName` in each).
6. Get each channel's ID: right-click the channel → **View channel details**
   → ID is at the bottom (`C0XXXXXXX`).

### 4. GitHub repo secrets

In this repo: **Settings → Secrets and variables → Actions → New repository
secret**, add:

- `CALENDLY_API_TOKEN`
- `CALENDLY_ORG_URI`
- `CALENDLY_OZ_USER_URI`
- `CALENDLY_BLAKE_USER_URI`
- `SLACK_BOT_TOKEN`
- `CASH_REPORT_CHANNEL_ID`
- `DASHBOARD_CHANNEL_ID`

Then run the workflow manually once to test: **Actions → Daily Sales
Dashboard → Run workflow**.

---

## Local testing

```bash
npm install
cp .env.example .env   # fill in the values from setup above
DRY_RUN=true npm run report   # prints the report instead of posting to Slack
npm run report                # actually posts to Slack
```

## Adjusting targets

Edit the defaults in `src/config.js`, or override per-environment via the
`WEEKLY_REVENUE_TARGET`, `MONTHLY_REVENUE_FLOOR`, `OZ_WEEKLY_CALL_TARGET`,
`BLAKE_WEEKLY_CALL_TARGET` env vars / GitHub secrets.

## If the Daily Cash Report format changes

`src/cashReport.js` parses that message with regex against specific phrases
("`$X on the board`", "`Last week (...) closed at $X`", "`New cash collected
this month: $X`"). If whatever generates that report changes its wording,
those fields will silently come back `null` and the dashboard will say it
couldn't read the cash report — it won't post wrong numbers. Update the
regexes in that file to match the new wording.

## Changing the schedule

Edit the `cron` line in `.github/workflows/daily-report.yml`. Remember
GitHub Actions cron is UTC and doesn't auto-adjust for daylight saving —
there's a note in that file with both UTC times for ET.

---

# Zoom call transcripts

Pulls the transcript of every recorded Zoom sales call automatically and files
it in a Google Drive folder as readable markdown — no going into Zoom and
downloading anything by hand.

Runs every 6 hours via GitHub Actions. Each run is idempotent: anything already
in the Drive folder is skipped, so re-running costs nothing and nothing gets
duplicated.

**Currently scoped to Jill's calls only** (`ZOOM_HOST_EMAILS`). Adding Oz or
Blake later is just appending their Zoom login emails to that one secret,
comma-separated.

## What you get

One markdown file per call, named
`2026-09-15 Jill - Discovery call - Dana Reed [85123456789].md`, containing:

- Host, local date/time, scheduled length, actual transcript length, meeting ID,
  and a link back to the Zoom recording
- A **talk share** table (words per speaker, and each speaker's percentage) — a
  rough but useful proxy for who dominated the call
- The full transcript, speaker-attributed, with consecutive lines from the same
  speaker merged into readable paragraphs and a timestamp on each turn

Zoom's raw `.vtt` is one fragment per line and close to unreadable; this is the
same content in a form you can actually skim or hand to an analysis step later.

## How it works

1. Mints a Zoom Server-to-Server OAuth token (`account_credentials` grant, one
   hour TTL, no refresh token — a fresh one per run).
2. Looks up each host in `ZOOM_HOST_EMAILS` directly by email.
3. Lists that host's cloud recordings over the lookback window. Zoom rejects a
   `from`/`to` range wider than one month, so longer backfills are split into
   29-day chunks automatically.
4. Skips meetings whose topic matches `TRANSCRIPT_TOPIC_EXCLUDE` (or misses
   `TRANSCRIPT_TOPIC_INCLUDE`, if you set it).
5. For each remaining meeting, finds the `TRANSCRIPT` recording file (a VTT),
   checks Drive for it, and if it's new: downloads, parses, and uploads.

Dedupe is keyed on Zoom's recording-file ID, stored in Drive's `appProperties`.
That means no state file to keep in sync, and renaming a file in Drive won't
cause it to be re-pulled.

## Setup

### 1. Zoom: turn on cloud recording with transcripts

In the Zoom web portal for **The Product Bosses account**, as an admin:
**Settings → Recording**:

- **Cloud recording** — on, and on for Jill's user specifically
- **Create audio transcript** — on (this is the setting that produces the VTT;
  without it there is no transcript to pull, and it can't be applied
  retroactively to calls already recorded)

Jill needs a **licensed** seat on this account — Basic (free) seats can't record
to the cloud at all.

### 2. Zoom: create a Server-to-Server OAuth app

1. <https://marketplace.zoom.us> → **Develop → Build App → Server-to-Server OAuth**.
   You need admin rights on the Product Bosses account to create it.
2. Copy the **Account ID**, **Client ID**, and **Client Secret**.
3. Under **Scopes**, add:
   - `cloud_recording:read:list_user_recordings:admin` — list a user's recordings
   - `user:read:user:admin` — resolve Jill's email to her Zoom user
   - Add `user:read:list_users:admin` *only* if you later leave
     `ZOOM_HOST_EMAILS` blank to pull the whole account.
4. **Activate** the app.

Server-to-Server OAuth apps are internal to your account — they do **not** go
through Zoom's ~4-week marketplace review.

### 3. Google: service account + Drive folder

1. <https://console.cloud.google.com> → create (or pick) a project → **APIs &
   Services → Enable APIs** → enable **Google Drive API**.
2. **IAM & Admin → Service Accounts → Create**. Then **Keys → Add Key → JSON**
   and download it. You need two fields out of that JSON: `client_email` and
   `private_key`.
3. Create the Drive folder for transcripts and **share it with the service
   account's `client_email`** as **Editor**.
4. Get the folder ID from its URL:
   `https://drive.google.com/drive/folders/<THIS_PART>`

> **Use a Shared Drive folder if you can.** Service accounts have no Drive
> storage quota of their own, so uploading into a regular *My Drive* folder
> fails with `storageQuotaExceeded` — the file would be owned by the service
> account, and it has nowhere to put it. A folder on a **Shared Drive** is owned
> by the drive, not the uploader, so it works. If you're on Workspace and want a
> My Drive folder instead, enable **domain-wide delegation** on the service
> account and set `GOOGLE_IMPERSONATE_SUBJECT` to a user's email — the job then
> writes as that person. The code detects this specific failure and tells you
> which fix to apply.

### 4. GitHub repo secrets

**Settings → Secrets and variables → Actions**. As **secrets**:

- `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`
- `ZOOM_HOST_EMAILS` — Jill's Zoom login email
- `GOOGLE_SERVICE_ACCOUNT_EMAIL` — the `client_email` from the JSON key
- `GOOGLE_PRIVATE_KEY` — the `private_key` from the JSON key. Paste it whole,
  including the `-----BEGIN PRIVATE KEY-----` lines. Newlines being flattened to
  literal `\n` is expected and handled.
- `TRANSCRIPT_DRIVE_FOLDER_ID`
- `GOOGLE_IMPERSONATE_SUBJECT` — only for the domain-wide delegation route

As **variables** (optional, not secret):

- `TRANSCRIPT_TOPIC_INCLUDE` / `TRANSCRIPT_TOPIC_EXCLUDE`

Then **Actions → Pull Zoom Transcripts → Run workflow**, with **dry run** set to
`true` for a first pass — it prints what it *would* pull and touches neither
Drive nor any credentials for it.

## Local testing

```bash
npm install
cp .env.example .env    # fill in the values from setup above
DRY_RUN=true npm run transcripts    # list what would be pulled, write nothing
npm run transcripts                 # actually pull into Drive
```

To backfill history, raise the lookback (it chunks automatically):

```bash
TRANSCRIPT_LOOKBACK_DAYS=90 npm run transcripts
```

## Things worth knowing

**Transcripts lag the call.** Zoom takes roughly 2x the meeting length to
produce one, and occasionally up to 24 hours. A call that just ended shows up as
`… transcript not ready` and gets picked up on a later run — that's normal, not
a failure.

**English only.** Zoom's audio transcription doesn't support other languages.

**Speaker names are Zoom display names**, whatever the participant was called in
that meeting. A prospect who joined as "iPhone" appears as "iPhone". Lines Zoom
couldn't attribute show up as "Unknown".

**Transcripts are only as private as the Drive folder.** These contain whatever
prospects said on the call, so keep the folder's sharing tight — that's exactly
why they aren't committed into this repo.

**Nothing here is retroactive.** Enabling audio transcripts only affects calls
recorded *after* you turn it on. Calls already in the cloud with no transcript
file can't have one generated after the fact.

## Analysis

Not built yet, by design — worth looking at real transcripts first to decide
what's actually worth scoring. The output format is already set up for it: one
self-contained markdown file per call, speaker-attributed, with talk share
precomputed.
