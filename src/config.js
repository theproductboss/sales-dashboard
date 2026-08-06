function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const targets = {
  weeklyRevenue: Number(process.env.WEEKLY_REVENUE_TARGET || 37000),
  monthlyRevenueFloor: Number(process.env.MONTHLY_REVENUE_FLOOR || 100000),
  ozWeeklyCalls: Number(process.env.OZ_WEEKLY_CALL_TARGET || 15),
  blakeWeeklyCalls: Number(process.env.BLAKE_WEEKLY_CALL_TARGET || 20),
};

// Calendly doesn't natively track "who booked this on behalf of the host,"
// so calls are categorized by which event type they came through. Each
// category is matched against the scheduled event's name (case-insensitive
// substring match). This means the Calendly event types described in
// README.md's "Calendly setup" section need to exist and be named to match
// before these categories mean anything.
//
// `fallback: true` catches anything hosted by that owner that didn't match
// a more specific category above it in the list.
const eventCategories = [
  { key: 'oz_webinar', owner: 'oz', label: 'Oz — booked from webinar', nameIncludes: ['webinar'] },
  { key: 'oz_from_blake', owner: 'oz', label: 'Oz — set by Blake', nameIncludes: ['blake'] },
  { key: 'oz_other', owner: 'oz', label: 'Oz — other', fallback: true },
  { key: 'blake_calendar', owner: 'blake', label: "Blake's calendar", fallback: true },
];

// Product buckets for the revenue dashboard. Payments are matched by
// case-insensitive substring against the charge description (Stripe/SamCart)
// or cart item name (PayPal) — see categorize() in src/revenue.js.
//
// ⚠️ EDIT THE KEYWORDS to match your actual product names as they appear on
// charges. Anything that doesn't match shows up under "Other / unmatched" in
// the report with its raw name, so you can copy the right keyword from there.
//
// `recurringDefault: true` means subscription/recurring charges that match no
// keywords still land here (the coaching program is the only recurring billing).
const productCategories = [
  { key: 'mini', label: 'Mini product', keywords: ['mini', 'tiny'] },
  { key: 'coaching', label: 'Coaching program', keywords: ['coach', 'program', 'mastermind'], recurringDefault: true },
  { key: 'event', label: 'Event', keywords: ['event', 'ticket'] },
  { key: 'other', label: 'Other / unmatched', fallback: true },
];

module.exports = { requireEnv, targets, eventCategories, productCategories };
