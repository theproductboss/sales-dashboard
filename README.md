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

# Closer Tracker Recap

A second, independent report: a Slack recap of the closer tracker that posts
**Monday and Wednesday at 9am ET** (a short pulse) and **Friday at 5pm ET**
(the full week wrap).

```bash
npm run closer-recap:sample   # print a recap from the bundled fixture, no credentials needed
DRY_RUN=true npm run closer-recap   # print a recap from the live sheet
npm run closer-recap                # post it to Slack
npm test                            # verify the math against the audited fixture
```

## Why it recomputes everything instead of reading the tracker's summary cells

The tracker's own `Overview` / `WEEK 1..5` summary blocks do not match the
call rows underneath them. Audited against Jill's September tab:

| Metric | Tracker says | Actually | What's wrong |
|---|---|---|---|
| Total No-Shows (month) | 1 | **12** | Counts rows whose `Sales Status` was literally typed `NO-SHOW`, instead of reading the `NO SHOW?` column |
| Completed Calls (month) | 5 | **23** | Counts rows with `CALL TYPE` filled in — a column reps mostly only fill on a win — so "completed" collapses to "won" |
| Show % (month) | 12.20% | **65.7%** | Divides that broken "completed" count by calls booked |
| Offer % (week 1) | 350% | **77.8%** | Divides offers by the same broken "completed" count (7 offers ÷ 2) instead of by calls held |
| Overall Close % | 100% | **21.7%** of held | Wins ÷ "completed", and "completed" already equals wins, so it's always 100% |
| Total Offers Made | 17 | 17 ✅ | correct |
| Total Wins / Revenue / Cash | 5 / $75,400 / $38,900 | same ✅ | correct |

So the counting columns are fine and the **rate** columns are all derived
from one bad denominator. This job reads the raw call rows and derives:

```
Show %   = calls held ÷ (booked − reschedules − rows not logged yet)
Offer %  = offers made ÷ calls held          (not ÷ wins)
Close %  = wins ÷ calls held, and wins ÷ offers made
```

Rows with a lead name but nothing else filled in (Kelly, Shakila in week 3)
are **excluded from every denominator** and listed under "Fix in the
tracker" instead — an unlogged row is a data gap, not a missed call.
Reschedules are excluded the same way: they haven't happened yet rather than
having been missed. A rate with no denominator prints as `—`, never `0%`.

## A new tracker each month

Nothing is hardcoded to a month or a tab name. On each run the job reads
every tab, keeps the ones whose `<MONTH> OVERALL` summary row matches the
current month, finds the `WEEK n (m/d-m/d)` blocks inside them, and maps
columns by their header text. Last month's and next month's leftover tabs
are ignored automatically, as are unnamed template tabs.

If a month's tracker labels things differently and auto-detection misses,
set `CLOSER_TABS` to an explicit comma-separated list of tab names.

Column headers are matched as "header contains" — `LEAD NAME`, `OFFER
MADE?`, `NO SHOW?`, `LEAD CXL?`, `Sales Status`, `TOTAL REVENUE GENERATED`,
`CASH COLLECTED TODAY`, `CALL TYPE`. Reword them freely; just don't drop the
keyword.

## Setup

### 1. Google service account (read-only access to the sheet)

1. <https://console.cloud.google.com> → create (or pick) a project.
2. **APIs & Services → Library → Google Sheets API → Enable**.
3. **APIs & Services → Credentials → Create credentials → Service account**.
   Name it something like `closer-tracker-reader`. No roles needed.
4. Open the service account → **Keys → Add key → Create new key → JSON**.
   Download it.
5. Copy the `client_email` out of that JSON (it looks like
   `closer-tracker-reader@your-project.iam.gserviceaccount.com`) and
   **share the closer tracker with it as a Viewer**, exactly like sharing
   with a person.
6. The whole JSON file's contents become `GOOGLE_SERVICE_ACCOUNT_JSON`.
   Base64-encoding it first (`base64 -w0 key.json`) also works and avoids
   newline mangling in secrets.

### 2. Slack

Reuses the existing `SLACK_BOT_TOKEN` and its `chat:write` scope. Invite the
bot to whichever channel should get the recap and set
`CLOSER_RECAP_CHANNEL_ID`.

### 3. GitHub secrets

Add `GOOGLE_SERVICE_ACCOUNT_JSON`, `CLOSER_TRACKER_SHEET_ID`, and
`CLOSER_RECAP_CHANNEL_ID` (`SLACK_BOT_TOKEN` is already there). Optionally
add a repo **variable** `CLOSER_TRACKER_URL` to link the sheet from the
message footer.

Then **Actions → Closer Tracker Recap → Run workflow**, with
`dry_run: true` for a no-post test — the run log prints the exact message.

## Changing the cadence

Edit the two `cron` lines in `.github/workflows/closer-recap.yml`. The job
picks its own style from the day (Friday → wrap, otherwise → pulse); set
`RECAP_MODE` to override. Daily instead of Mon/Wed/Fri is
`- cron: '0 13 * * 1-4'` plus the existing Friday line.

## KPI flags

✅ / ⚠️ / 🔴 come from `SHOW_RATE_KPI` (default 0.70) and `OFFER_RATE_KPI`
(default 0.90), which are the KPIs written into the tracker itself. There's
no close-rate KPI anywhere in the sheet, so close rate is reported
**unflagged** until you set `CLOSE_RATE_KPI`.
