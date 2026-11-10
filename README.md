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

This repo also builds a **searchable webinar lead tracker**. See
[Lead tracker](#lead-tracker) below.

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

## Lead tracker

A searchable page of every webinar lead, showing the ad they came from,
whether they showed up live, whether they booked a call, and whether they paid.

**What it answers:**
- How many leads registered between two dates (presets: 7 / 30 / 90 days)
- How many attended live vs. no-showed
- How many went on to book a call, and how many paid
- All of the above broken down **by ad** (utm_campaign / content / source /
  medium / term) and **by webinar session**
- Who a specific person is: search by name, email, phone, or UTM

Leads whose webinar hasn't happened yet show as **upcoming / "Not yet
eligible"** and are left out of attendance and booking rates, so next week's
registrants don't make this week's ads look bad.

### How it works

| Data | Source | Matched by |
|---|---|---|
| Leads, registration date, webinar session, live attendance, UTMs, phone, revenue level | WebinarJam API (`/webinars`, `/webinar`, `/registrants`) | n/a |
| Call booked | `#collective-calls-booked` (the Calendly → Zapier messages) | email |
| Paid | `#payments` "New Payment from … (email)" messages | email |

- One row per email. If someone registered more than once, the **first**
  registration sets their registration date and ad (first-touch), and the
  **latest** session is the webinar shown.
- A booking or payment only counts if it came in **on or after** they
  registered. Someone who booked months earlier from another source doesn't
  count as a webinar conversion.
- Recurring `Subscription Payment: 198.00` messages have no email, so they're
  ignored. Only new payments are matched.
- If WebinarJam doesn't return a revenue answer, the revenue level falls back
  to the one in their call-booked message ("Under 50k", "$25,000-$50,000").

### Where it lives

The tracker is a **private page on claude.ai**, shared with the team from its
**Share** menu. Nobody outside the people it's shared with can open it, and
no lead data is stored in this repo or on GitHub.

On that page, anyone on the team can:
- search and filter leads, sort the list, and export what they're looking at to CSV
- type a question in **Ask about your leads** ("Where did jane@… come from?",
  "Which campaign booked the most calls last month?"). Claude answers from
  the leads on the page, using each viewer's own Claude account.

**Refreshing the data:** a scheduled Claude Code cloud task runs
`npm run leads` and republishes `dist/artifact.html` to the same page. That
cloud environment needs the secrets listed below.

### Setup

1. **WebinarJam API key.** WebinarJam has to approve API access first. Follow
   [Apply for an API key](https://support.webinarjam.com/en/articles/15370143-apply-for-an-api-key-for-webinarjam-or-everwebinar),
   then copy the key from your account's API settings.
2. **Slack bot access.** Use the same Slack app as the daily dashboard.
   Make sure it has `channels:history` and `groups:history`, then invite it
   to both channels:
   `/invite @YourBotName` in `#collective-calls-booked` and in `#payments`.
3. **Environment secrets** for the cloud environment that runs the refresh:
   - `WEBINARJAM_API_KEY`
   - `SLACK_BOT_TOKEN` (the same bot token the daily dashboard uses)
   - `CALLS_BOOKED_CHANNEL_ID`: `C09UEM5M1V5`
   - `PAYMENTS_CHANNEL_ID`: `G017H4V9ACS`
   - `WEBINARJAM_NAME_INCLUDES` (optional): only webinars whose name contains
     this are included. Defaults to `Collective Webinar`; webinars with "TEST"
     in the name are always skipped.
   - `WEBINARJAM_WEBINAR_IDS` (optional): comma-separated webinar IDs to use
     instead of matching by name.

### Webinar performance tab

A second tab compares every Collective webinar: registered, live, show rate,
peak attendance and when it hit, average minutes watched, calls booked, and
the booking rate by revenue range against the goal of **over 20% of live
attendees in every $25K+ range booking a call**. Click a webinar for:

- a minute-by-minute curve of who was in the room (rebuilt from each
  attendee's join time and watch time), with the peak, the biggest drop-off
  and a mark for each live attendee who booked, plus an optional comparison
  line for another webinar
- the booked-by-revenue-range table, in the same layout as Joelle's
  post-webinar screenshot
- Joelle's post-webinar stats from `#collective-webinars` (set
  `WEBINAR_STATS_CHANNEL_ID`)
- notes on what happened on the call, from `webinar-notes.json`, published
  with the private page like `email-aliases.json`:
  `{ "2026-11-09": { "summary": "...", "points": ["..."], "source": "..." } }`

WebinarJam's API has no chat or transcript, so those come from WebinarJam's
own export and the replay, and get summarized into the notes file.

### Registrants by webinar tab

A third tab lists everyone who registered for each webinar, grouped by month,
then week, then webinar. For each person: the ad that brought them to that
webinar, revenue level, live attendance and minutes watched, booked and paid,
and, from Kit (set `KIT_API_KEY`):

- how long they'd been on the list when they registered, and the date they
  joined (or "New to the list")
- badges for **Collective, MSM, Sales Accelerator and Academy (PBA)**, from
  Kit purchase and member tags; hover a badge for the tags behind it. The
  tag rules live in `src/leads/kit.js` (`PROGRAMS`)
- how many Collective webinars Kit tagged them as attending before
- "Not getting emails" when they've unsubscribed or bounced in Kit

Filters show only past customers, one program, returning attendees, people
new to the list, or bookers, and a search finds a person across webinars.

### Someone paid or booked with a different email

The tracker matches bookings and payments to leads by email. When the email
doesn't match a registration, each refresh tries, in order:

1. **A hand-entered link** in `email-aliases.json` (below).
2. **The payment's Slack thread:** if a teammate posted an email there that
   belongs to a webinar lead, the payment goes to that lead.
3. **Exact full name:** if the first and last name on the payment or booking
   match exactly one lead's registration, it goes to that lead. First names
   alone never match, and neither do names two leads share.

Matches from 2 and 3 show a tag on the lead ("Paid as … (matched by name)") so
the team can check them. To link a pair by hand, or to stop a wrong automatic
match (map the email to `null`), edit `email-aliases.json`, which is published
with the private tracker page (never committed here, since it holds customer
emails):

```json
{ "jane@herbrand.com": "jane@gmail.com" }
```

The key is the email they paid or booked with, and the value is the email
they registered with. Run locally with `LEAD_EMAIL_ALIASES_FILE=path/to/email-aliases.json`.
The page's **Payments not matched to a lead** list shows the payments that
might need one.

### Hosting it on Render

`src/server.js` runs the tracker as its own website, for people who aren't on
the team's Claude account. It:

- rebuilds the page at start-up and hourly from 7am to 7pm Eastern (at :07),
  serving the last good build in between (a full pull takes about 6 minutes)
- is open to anyone with the address (`PUBLIC_ACCESS=true`, the Blueprint's
  setting), or asks for a team password first when `PUBLIC_ACCESS` is off and
  `TEAM_PASSWORD` is set; either way it tells search engines not to list it
- limits the question box to 60 Claude calls per visitor per hour (600 in
  all), since every question is billed to the team's Anthropic account
- answers the "Ask about your leads" box through the Claude API
  (`ANTHROPIC_API_KEY`, model `claude-opus-5-5`, with server-side refusal
  fallback on); the page still runs its own lookup tools on its own data
- lets CSV exports download normally
- shows build state at `/status` (after login) and answers `/healthz` for
  Render's health check

`render.yaml` is a Render Blueprint: in Render, **New > Blueprint**, pick this
repository, and fill in the private values it asks for. The two hand-kept
data sets go in as JSON text: `LEAD_EMAIL_ALIASES_JSON` (the email links) and
`WEBINAR_NOTES_JSON` (the notes on each webinar).

```bash
TEAM_PASSWORD=pick-one npm run start:demo   # made-up data on http://localhost:3000
```

### Run it locally

```bash
npm run leads:demo   # made-up data, no keys needed; writes dist/lead-tracker.html
npm run leads        # real data from .env; writes dist/lead-tracker.html and dist/artifact.html
npm test
```

### First real run: check the WebinarJam fields

WebinarJam's docs don't fully specify the registrant response, so a few
fields are mapped defensively in `normalizeRegistrant()` in
`src/leads/webinarjam.js`:
- **Webinar session date:** from the registrant's `schedule` (an ID looked up
  against the webinar's schedules, or a date), falling back to `date_live`.
  If the "Webinar" column shows **Unknown** for many leads, this mapping
  needs adjusting.
- **Revenue level:** any field whose name contains "revenue". If your
  registration question is worded differently, update `findRevenueLevel()`.
- **Pagination:** handles both a plain list and a `{ data, last_page }` shape.
