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

# Webinar live attendee alerts (Demio → Slack)

During the weekly Demio webinar, posts to a Slack channel at **2 minutes in**
and **15 minutes in** with the attendees who are live at that moment and who
selected one of the high-revenue tiers on the registration form:

- $1,000,000 to $5,000,000
- $500,000 to $1,000,000
- $100,000 to $500,000

Message format:

```
These attendees are live!

*$1,000,000 to $5,000,000*
Jane Smith, jane@example.com

*$500,000 to $1,000,000*
...
```

Tiers with nobody live are omitted; if no high-tier registrants are live at
all, it posts a short "No attendees in the $100K+ revenue tiers are live
right now." so you know the check ran.

## How it works

The `Webinar Live Attendee Alerts` GitHub Actions workflow fires at the
webinar's scheduled start time. The script then:

1. Asks Demio for the event's session ("date") happening right now and
   anchors t=0 to Demio's scheduled start time — so even if GitHub starts
   the job a few minutes late (Actions cron can lag), the 2- and 15-minute
   marks stay accurate.
2. At each mark, pulls the session's participants report, keeps only people
   who have **joined the room**, matches their revenue dropdown answer
   against the three target tiers, and posts the message.

**What "live" means:** Demio's public API reports who has *joined* the
session; it doesn't expose second-by-second "still in the room" status. At
2 and 15 minutes in, joined ≈ present, so in practice this is who's online.

## Setup

### 1. Demio API credentials + event ID

1. In Demio: **Settings → API** → copy the **API Key** and **API Secret**.
   (API access requires Demio's Growth plan or above.)
2. Find your webinar's event ID — it's the number in the URL when you open
   the event in Demio (`my.demio.com/manage/events/<ID>/...`), or run:
   ```bash
   DEMIO_API_KEY=... DEMIO_API_SECRET=... npm run demio-events
   ```
   which lists upcoming events with their IDs.

### 2. Slack channel

Reuses the same Slack app/bot as the daily dashboard (`SLACK_BOT_TOKEN`).
Create (or pick) the channel for these alerts, **invite the bot** to it
(`/invite @YourBotName`), and grab the channel ID (right-click the channel →
View channel details → ID at the bottom).

### 3. GitHub repo secrets

Add these repo secrets (Settings → Secrets and variables → Actions):

- `DEMIO_API_KEY`
- `DEMIO_API_SECRET`
- `DEMIO_EVENT_ID`
- `WEBINAR_ALERTS_CHANNEL_ID`

(`SLACK_BOT_TOKEN` should already exist from the daily dashboard setup.)

### 4. Set the schedule

Edit the `cron` line in `.github/workflows/webinar-alerts.yml` to your
webinar's weekly start time **in UTC** (instructions and an ET example are
in that file). The placeholder is Wednesday 12:00pm EDT — change it.

### 5. Test it

Do a dry run against a real session: open **Actions → Webinar Live Attendee
Alerts → Run workflow**, check **"Print the alerts instead of posting to
Slack"**, and run it while a session is live (or within ~3 hours of one —
it'll report against the nearest session). The job log shows exactly what
would have been posted. Uncheck dry-run to post for real.

Locally:

```bash
DRY_RUN=true npm run webinar-alerts
```

## Notes & knobs

- **Alert times:** set the `WEBINAR_ALERT_MINUTES` env var in the workflow
  (default `2,15`), e.g. `2,15,30` for a third alert.
- **Skipped weeks:** if no session is scheduled within 3 hours of the cron
  firing, the job logs "nothing to do" and exits green — no failure noise
  on holiday weeks.
- **Reworded dropdown options:** tier matching ignores case, spacing, `$`,
  commas, and "to" vs "-" (so "$100,000-$500,000" still matches). If the
  registration dropdown options are ever reworded beyond that, update
  `TARGET_TIERS` in `src/webinarAlerts.js`.
- **Webinar rescheduled to a different day/time:** update the cron line —
  the script finds the session automatically, but only if the workflow
  actually fires near it.
