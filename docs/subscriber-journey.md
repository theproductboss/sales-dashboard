# Subscriber journey tracking — setup notes

Goal: for subscribers who came in through specific ManyChat opt-ins, show
**when and how** they entered The Product Boss world and **where they went
afterwards** (webinars, offers, purchases).

## Opt-ins tracked (Kit tags)

| Opt-in | Main tag | Source-channel tags (prefix) |
|---|---|---|
| Your Next $10K | `Your Next $10K Freebie` | `10K Freebie \| ` (Instagram Comments, Instagram Stories + DMs, Facebook Comments, Facebook Messenger) |
| AI Holiday Photographer | `AI Holiday Photographer Freebie` | `AI Holiday Photographer \| ` (same four channels) |
| Black Friday Plan 2026 | `Black Friday Freebie 2026` | `Black Friday Plan 2026 \| ` (Instagram, Facebook) |

"Came in" = show both the subscriber's first-ever Kit signup date and the
date the freebie tag was applied (distinguishes new vs. existing subscribers).

"Went afterwards" = later tags in date order (webinar registered / attended /
not attended, `[AI Holiday Team] …`, Payoff tags, PBSA / Inner Circle /
Collective, anything ending in "Paid"), plus purchases. Ignore admin tags
(`Imported …`, `[temp] …`, `Resend needed …`).

## Purchase data sources

ClickFunnels is **Classic** (no order API), so purchases come from Stripe.
There are no Stripe Connect accounts — each Stripe account has its own key.

| Env var | Stripe account covers |
|---|---|
| `STRIPE_API_KEY` | ClickFunnels payments |
| `STRIPE_FGFUNNELS_API_KEY` | FG Funnels payments |
| `STRIPE_SAMCART_API_KEY` | SamCart payments (separate Stripe account) |
| `KIT_API_KEY` | Kit v4 API (needed for an unattended/scheduled report) |

Any further Stripe accounts follow the pattern `STRIPE_<NAME>_API_KEY`.
All Stripe keys are restricted, read-only (Customers, Charges, Payment
Intents, Checkout Sessions, Invoices, Subscriptions, Products, Prices).

Keys live in the Claude cloud environment settings (and later as GitHub
Actions secrets for a scheduled report) — never in the repo.

## Open questions

- Output destination: **local dashboard** (`npm run dashboard`, see below).

## Running it

`npm run journey -- <output.json>` (needs `KIT_API_KEY` and the `STRIPE_*`
keys in the environment). Writes subscriber tag histories + matched Stripe
charges to a JSON file (default `journey-data.json`, gitignored — it holds
subscriber PII).

## Dashboard

`npm run dashboard` serves http://localhost:3000 (see the README). It runs the
same export through `runJourneyExport()` in `src/journey.js`, keeps the raw
result in `data/journey-raw.json` and serves only the totals built by
`src/journey-totals.js` (cached in `data/totals-cache.json`). `data/` is
gitignored.

### Dashboard metrics

Each metric is counted for "All opt-ins" and for each opt-in, using the
subscriber's first opt-in date in that group (for "All": their earliest
tracked opt-in).

- **Opted in**: unique subscribers with the main tag or any channel tag.
- **New to the list**: Kit account created within 24 hours of the opt-in, or
  after it. Everyone else is **Already on list**.
- **Already customers / bought before**: a paid Stripe charge before the opt-in.
- **Webinar funnel**, from tags applied after the opt-in only:
  1. Registered for or attended a Collective webinar: tag contains
     `[The Collective Webinar]` and contains `Registered` or ends with `Attended`.
  2. Attended: such a tag ending with `Attended` (`Not Attend` tags do not match).
  3. Booked a Collective call: tag contains `Call Scheduled`.
  4. Bought after opting in: any paid charge on or after the opt-in.

  Steps can be skipped, so the counts are not strictly decreasing.
- **Opt-ins by day**: count per day (in `REPORT_TIMEZONE`, default
  America/New_York), opt-in and channel. Channel is the text after the channel
  prefix of the first channel tag applied; with no channel tag it is
  "Main tag only", which the channel chart leaves out.
- **Purchases by product**: product, timing (before / after the opt-in),
  buyers, charges and net revenue (amount minus refunds).

Admin tags are ignored (`Imported …`, `[temp] …`, `Resend needed …`,
`Welcome Sequence`). Charges are matched through Stripe customers with the
subscriber's email, so guest charges without a customer are not found.

### Product labels

Stripe descriptions are cleaned before they leave the server
(`cleanProductLabel` in `src/journey-totals.js`):

- `[email] | Product: X` and `Seller | [email] | Products: X` become `X`.
- Personalized suffixes go: ` - CHERYL` (a word in capitals) and
  ` - jacqoffer` (a word ending in "offer"). Capitalized suffixes that are
  part of a real product name are listed in `KEPT_SUFFIXES`; add to it if a
  product name gets cut short.
- `Invoice XXXX-0002` becomes "Invoice installments", `Shop 1-IN-5 - Order 123`
  becomes "Shop 1-IN-5", `Purchase of X via ThriveCart` becomes "X".
- Spellings that differ only in capitals are merged into one row.

The totals builder refuses to publish if anything still contains an "@" or a
Kit subscriber ID.
