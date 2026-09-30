# Marketing & Sales Dashboard — Build Scope

Status: **draft for review** · Written 2026-09-30 · First month tracked: **October 2026**

## 1. What we're building

One dashboard that answers, at any point in the month: **"Are we on pace to
bring in this month's new members, and if not, which step of the funnel is
leaking?"**

It sits alongside the existing daily Slack report in this repo (Calendly
bookings + cash pace). **That report is not touched by this build.** The new
dashboard lives in its own folder with its own workflow, so if anything goes
wrong during the platform switch, the report the team relies on today keeps
running.

### "Version 1 vs Version 2"

| | Version 1 — now (October) | Version 2 — after the switch |
|---|---|---|
| Webinar platform | Demio (live) | WebinarJam (live) + EverWebinar (evergreen) |
| Webinar data | You give me the numbers (CSV / pasted sheet) | Pulled automatically from WebinarJam + EverWebinar APIs |
| Sales call data | You give me the numbers from the closers' Google Sheet | Read directly from the Google Sheet |
| Refresh | When you send new numbers | Daily (automatic) |

Both versions use **the exact same metrics, targets, and screens** — only the
data source changes. Every webinar record is tagged with its platform and
type (`demio-live`, `webinarjam-live`, `everwebinar-evergreen`), so you can
compare old vs. new side by side instead of the switch muddying the numbers.

## 2. Monthly goal

Every month starts with setting the goal. For October: **30 new members**.

| Tier | October goal | Actual | Pace |
|---|---|---|---|
| Collective | _TBD_ | | |
| Insiders | _TBD_ | | |
| Inner Circle | _TBD_ | | |
| **Total** | **30** | | |

The goal (total + per-tier split) is a single editable row per month — change
it any month without touching code. The dashboard shows actual vs. goal and
whether we're on a straight-line pace for the day of the month.

## 3. Metrics & targets

Each metric shows: this month's number, the target, a green / amber / red
status, and a per-webinar or per-week trend.

### Webinars (per webinar and month-to-date, split live vs. evergreen)

| # | Metric | Formula | Target |
|---|---|---|---|
| W1 | Qualified registrants | registrants reporting **$50k+/yr** ÷ all registrants | **≥ 25%** |
| W2 | Show-up rate | attendees ÷ registrants (every webinar) | **≥ 20%** |
| W3 | Qualified booking rate | $50k+ people who booked a call ÷ $50k+ people _(see Q1)_ | **≥ 20%** |

W3 is also broken out by revenue band so you can see which segment is booking:
**$50k–$100k · $100k–$500k · $500k+** (and, for context, under-$50k bookings).

### Sales calls (month-to-date, per closer)

| # | Metric | Formula | Target |
|---|---|---|---|
| S1 | Show-up rate | calls held ÷ calls booked | **≥ 80%** |
| S2 | Offer rate | offers made ÷ calls held | **≥ 90%** |
| S3 | Close rate | closed ÷ calls held _(see Q3)_ | **≥ 30%** |
| S4 | Payment split | pay-in-full vs. payment plan, of closed deals | **≥ 50% pay-in-full** _(see Q4)_ |

Closed deals also roll up by tier (Collective / Insiders / Inner Circle) to
feed the monthly goal in section 2.

## 4. What 30 members actually requires (back-solved from your targets)

If every target is hit exactly, working backwards from 30 closes:

| Step | Needed | Rule used |
|---|---|---|
| New members | **30** | goal |
| Sales calls held | 100 | 30% close |
| Sales calls booked | 125 | 80% show |
| Qualified ($50k+) people who book | 125 | assumes all calls come from webinars |
| Qualified people in the pool | 625 | 20% book |
| Total webinar registrants | **2,500** _or_ **12,500** | depends on Q1 below |

- If W3's denominator is **qualified registrants**: 625 ÷ 25% = **~2,500
  registrants/month**.
- If it's **qualified attendees**: 625 ÷ 20% show ÷ 25% qualified = **~12,500
  registrants/month**.

That 5× gap is why Q1 matters. The dashboard will show this back-solve live
each month, so you can see the registrant number you need **given the month's
actual rates**, not just the targets. (Calls Blake sets outside of webinars
reduce the webinar requirement — they'll be shown as a separate source.)

## 5. Data needed

### 5a. Webinar data (one row per webinar session)

| Field | Example | V1 source | V2 source |
|---|---|---|---|
| date | 2026-10-07 | you | WebinarJam / EverWebinar |
| platform_type | `demio-live` | you | automatic |
| webinar_name | "Scale to $500k" | you | automatic |
| registrants | 412 | Demio export | API |
| attendees | 91 | Demio export | API |
| registrants by revenue band | under $50k / $50–100k / $100–500k / $500k+ | Demio export | registration form custom question |
| attendees by revenue band | same bands | Demio export | API |
| calls booked by revenue band | same bands | Calendly / closers' sheet | matched by email |

### 5b. Sales call data (one row per call — from the closers' Google Sheet)

| Field | Example |
|---|---|
| call_date | 2026-10-09 |
| closer | Oz |
| lead_email | used to match back to the webinar |
| lead_source | webinar / Blake set / other |
| revenue_band | $100k–$500k |
| showed | yes / no |
| offer_made | yes / no |
| closed | yes / no |
| tier | Collective / Insiders / Inner Circle |
| payment_type | pay-in-full / payment plan |
| cash_collected | 4,000 _(optional — ties to the cash report)_ |

For V1, send whatever the sheet already has; I'll map it. If a column above
doesn't exist yet, that's the list of columns to add before we automate.

## 6. Build plan

### Phase 1 — V1 dashboard (this week)
1. Define the data files (`dashboard/data/goals.csv`, `webinars.csv`,
   `calls.csv`) in the shapes above.
2. Build the dashboard page: goal tracker, webinar funnel, sales funnel,
   revenue-band breakdown, live vs. evergreen / Demio vs. WebinarJam
   comparison, and the back-solve from section 4.
3. Load your current October data (and September/earlier if you have it, as a
   baseline).
4. Publish as a private web page you can open from phone or desktop.

### Phase 2 — V2 automation (next week onward)
1. **Google Sheet** — connect via a Google service account (read-only, shared
   on the closers' sheet). Nightly pull.
2. **WebinarJam + EverWebinar** — both use the same API (one API key from the
   account's Integrations settings). Pull webinars, registrants, attendance,
   and registration custom fields nightly.
3. **Registration form change** — add a required "annual business revenue"
   question with exactly the four bands above to every WebinarJam /
   EverWebinar registration page. Without it, W1 and W3 can't be automated.
4. **Matching** — tie registrants to booked calls by email (lower-cased,
   trimmed). Unmatched bookings show as "unattributed" rather than silently
   dropping.
5. **Demio history** — one-time export of past webinars so the V1-vs-V2
   comparison has a baseline.
6. Optional: add a few headline lines to the existing daily Slack post (goal
   pace + any red metrics), only once V2 numbers are verified.

### Guardrails for the switch
- New code lives in `dashboard/` with a separate GitHub Actions workflow;
  `src/` and `daily-report.yml` stay as-is.
- If a source fails or returns nothing, the dashboard shows "data missing for
  X" — it never shows zeros that look like real numbers.
- During overlap (Demio and WebinarJam both running), both feed the same
  metrics, tagged by platform.

## 7. Decisions (answered 2026-09-30)

1. **Webinar booking rate** — primary: 20% of **$50k+ attendees** book. Also shown: % of $50k+ registrants.
2. **Monthly goal** — 30 members total (no tier split yet). Cash goal **$150,000/month** from October (September's sheet goal was $120,000).
3. **Close rate** — closed ÷ calls **held** (people who actually showed up).
4. **Payment split** — at least 50% pay-in-full. 50/50 = good, 60/40 = better, 70/30 = best.
5. **Members** — every member comes through a sales call, so members = closed calls.
6. **Where** — private web page (claude.ai artifact). Source in `dashboard/`.
7. **Closer data** — "Closer Tracker – September 2026" Google Sheet, one tab per closer, one row per call.

Rhythm: weeks of Sep 28 and Oct 5 are loaded by hand; automated feeds start after that.
