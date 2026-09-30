# Collective Growth Scoreboard

Private web page (claude.ai artifact) showing monthly and week-over-week
funnel numbers against goal. Separate from the daily Slack report in `src/` —
nothing here touches it.

- `index.html` — the page. It reads `data.json` published next to it.
- `data.json` — all numbers and targets. **V1:** edited by hand.
  **V2:** regenerated from WebinarJam / EverWebinar and the Closer Tracker sheet.

## data.json shape

- `targets` — rate targets (webinar $50k+ share, show-up, $50k+ booking; call show, offer, close; pay-in-full tiers).
- `months[]` — `goalMembers`, `goalCash`, and the week list (Monday-start weeks, labelled with the dates inside the month).
- `webinars[]` — one entry per webinar (or per week of evergreen sessions): `month`, `week`, `platform`, `format`, and `bands[]` of revenue level with `registrants`, `attended`, `booked`. Bands with `min >= 50000` count as qualified; `group` puts them in $50k–$100k / $100k–$500k / $500k+.
- `calls[]` — one entry per closer per week: `booked`, `held`, `no_show`, `cancelled`, `rescheduled`, `not_logged`, `offers`, `wins`, `pif`, `plan`, `revenue`, `cash`.
- `notes[]` — data caveats shown at the bottom of the page.

Definitions: call show-up = held ÷ booked (booked includes no-shows and
cancels, excludes reschedules). Close = wins ÷ held. Offer = offers ÷ held.
A win is pay-in-full when cash collected equals total revenue.
