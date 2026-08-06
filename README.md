# Sales Dashboard

Two daily Slack reports, no server or database to host:

1. **Sales calls & cash pace** — call bookings from Calendly plus cash pace
   parsed from the `Daily Cash Report` channel (details below).
2. **Revenue dashboard** — money actually collected, pulled straight from
   Stripe and PayPal: month-to-date and year-to-date net revenue, a
   per-product breakdown (units sold + revenue each), recurring coaching
   payments received, and failed payments. See
   [Revenue dashboard](#revenue-dashboard) below.

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

# Revenue dashboard

Posts a daily Slack message with, for **month-to-date and year-to-date**:

- Net revenue (gross sales minus refunds), split Stripe vs. PayPal
- Per-product breakdown: how many of each product sold and revenue each
  (mini product, coaching program, event, other)
- Recurring coaching-program payments received (count + dollars)
- **Failed payments** (count, dollars missed, split by processor)

## Why Stripe + PayPal are the only connections needed

Money always lands in a processor, no matter which cart sold it:

- **SamCart → Stripe**: SamCart is just the checkout; the charge itself is
  created in Stripe, so it's counted here — **including the Stripe payment
  profiles / charges that never show up inside SamCart**. Pulling from
  Stripe (not SamCart) is exactly what closes that gap.
- **Cart → PayPal**: same idea — whatever checkout feeds PayPal, the
  transaction is in PayPal's records and gets counted.

So the processors are the source of truth and nothing is double-counted or
missed. (The trade-off: product names come from the charge description /
cart item name, which is what the keyword matching below is for.)

## Setup

### 1. Stripe key

1. Stripe Dashboard → **Developers → API keys → Create restricted key**.
2. Grant **Read** on: **Charges**, **Refunds** (under Payments), and
   **Invoices** (under Billing — used to identify recurring coaching
   payments and name them). Everything else: None.
3. Copy the `rk_live_...` key → GitHub secret `STRIPE_SECRET_KEY`.

A restricted read-only key means this repo's automation can never move
money or modify anything in Stripe.

### 2. PayPal API app

1. Go to <https://developer.paypal.com/dashboard/applications/live> (log in
   with the business account) → **Create App**.
2. On the app's page under **Features**, make sure **Transaction Search**
   is checked (this is what lets the API list your transactions).
3. Copy **Client ID** → secret `PAYPAL_CLIENT_ID`, and **Secret** →
   `PAYPAL_CLIENT_SECRET`.

Note: PayPal's reporting API lags live activity by up to a few hours, and
Transaction Search may take up to ~24h after first being enabled to start
returning data.

### 3. GitHub secrets

Add under **Settings → Secrets and variables → Actions**:

- `STRIPE_SECRET_KEY`
- `PAYPAL_CLIENT_ID`
- `PAYPAL_CLIENT_SECRET`
- `SLACK_BOT_TOKEN` (already set up for the calls dashboard)
- `DASHBOARD_CHANNEL_ID` (already set), or `REVENUE_CHANNEL_ID` to post the
  revenue report to a different channel

The report still runs if only one processor is configured — it posts what
it has and flags the missing source.

### 4. Product name keywords — the one thing to tune

Payments are bucketed into products by keyword match against the charge
description (Stripe/SamCart) or cart item name (PayPal), in
`src/config.js` → `productCategories`:

- **Mini product** — keywords `mini`, `tiny` (placeholder — set these!)
- **Coaching program** — keywords `coach`, `program`, `mastermind`; plus
  any recurring/subscription charge that matches nothing else lands here
- **Event** — keywords `event`, `ticket`
- **Other / unmatched** — everything else

You don't have to guess the right keywords up front: the report lists the
raw names of unmatched payments at the bottom, so run it once
(`DRY_RUN=true npm run revenue`), see what shows up, and add those words to
the keyword lists.

Then test: **Actions → Daily Revenue Dashboard → Run workflow**, or locally:

```bash
DRY_RUN=true npm run revenue   # prints the report instead of posting
```

## Notes & limits

- Totals are **net cash collected** (successful charges minus refunds) in
  USD; non-USD payments are excluded and flagged in the report if any exist.
- "Failed payments" = Stripe declined charges + PayPal denied transactions.
  Each retry of a recurring payment counts as its own failure.
- PayPal bank transfers, fees, and withdrawals are excluded so moving money
  to your bank doesn't look like negative revenue.
- Schedule lives in `.github/workflows/daily-revenue.yml` (8:05am ET daily,
  same DST caveat as the other workflow).
