// Buckets a payment into a product category by case-insensitive substring
// match against the payment's label (charge description / cart item name).
// A recurring payment that matches no keywords falls into the category marked
// `recurringDefault` (the coaching program), since subscription charges are
// the only recurring billing we run. Everything else lands in the fallback.
function categorize(payment, categories) {
  const label = (payment.label || '').toLowerCase();
  const match = categories.find((c) => (c.keywords || []).some((k) => label.includes(k)));
  if (match) return match.key;
  if (payment.recurring) {
    const recurringHome = categories.find((c) => c.recurringDefault);
    if (recurringHome) return recurringHome.key;
  }
  return categories.find((c) => c.fallback).key;
}

function emptyTotals(categories) {
  const byProduct = {};
  categories.forEach((c) => {
    byProduct[c.key] = { count: 0, cents: 0 };
  });
  return {
    netCents: 0,
    salesCents: 0,
    refundCents: 0,
    refundCount: 0,
    bySource: { stripe: 0, paypal: 0 },
    failed: { count: 0, cents: 0, stripe: 0, paypal: 0 },
    recurring: { count: 0, cents: 0 },
    byProduct,
    unmatchedLabels: new Map(), // label -> { count, cents }
    skippedCurrencies: new Set(),
  };
}

// Aggregates normalized payments falling inside [startMs, endMs).
function aggregate(payments, { startMs, endMs }, categories, currency) {
  const totals = emptyTotals(categories);
  const fallbackKey = categories.find((c) => c.fallback).key;

  for (const p of payments) {
    if (p.ts < startMs || p.ts >= endMs) continue;
    if (p.currency && p.currency !== currency) {
      totals.skippedCurrencies.add(p.currency.toUpperCase());
      continue;
    }

    if (p.kind === 'failed') {
      totals.failed.count += 1;
      totals.failed.cents += p.cents;
      totals.failed[p.source] += 1;
      continue;
    }

    if (p.kind === 'refund') {
      totals.refundCount += 1;
      totals.refundCents += p.cents;
      totals.netCents -= p.cents;
      totals.byProduct[categorize(p, categories)].cents -= p.cents;
      continue;
    }

    // sale
    totals.salesCents += p.cents;
    totals.netCents += p.cents;
    totals.bySource[p.source] += p.cents;
    if (p.recurring) {
      totals.recurring.count += 1;
      totals.recurring.cents += p.cents;
    }
    const key = categorize(p, categories);
    totals.byProduct[key].count += 1;
    totals.byProduct[key].cents += p.cents;
    if (key === fallbackKey) {
      const entry = totals.unmatchedLabels.get(p.label) || { count: 0, cents: 0 };
      entry.count += 1;
      entry.cents += p.cents;
      totals.unmatchedLabels.set(p.label, entry);
    }
  }

  return totals;
}

module.exports = { aggregate, categorize };
