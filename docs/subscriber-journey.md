# Subscriber journey tracking — setup notes

Goal: for subscribers who came in through specific ManyChat opt-ins, show
**when and how** they entered The Product Boss world and **where they went
afterwards** (webinars, offers, purchases).

## Opt-ins tracked (Kit tags)

| Opt-in | Main tag | Source-channel tags (prefix) |
|---|---|---|
| Your Next $10K | `Your Next $10K Freebie` | `10K Freebie \| ` (Instagram Comments, Instagram Stories + DMs, Facebook Comments, Facebook Messenger) |
| AI Holiday Photographer | `AI Holiday Photographer Freebie` | `AI Holiday Photographer \| ` (same four channels) |

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
| `SAMCART_API_KEY` | SamCart orders (if added) |
| `KIT_API_KEY` | Kit v4 API (needed for an unattended/scheduled report) |

Any further Stripe accounts follow the pattern `STRIPE_<NAME>_API_KEY`.
All Stripe keys are restricted, read-only (Customers, Charges, Payment
Intents, Checkout Sessions, Invoices, Subscriptions, Products, Prices).

Keys live in the Claude cloud environment settings (and later as GitHub
Actions secrets for a scheduled report) — never in the repo.

## Open questions

- Which Stripe account (if any) SamCart charges through.
- Output destination: shareable page, Slack post, spreadsheet, or Notion.
- One-off analysis vs. recurring report.
