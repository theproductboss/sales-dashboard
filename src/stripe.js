const STRIPE_BASE = 'https://api.stripe.com/v1';

async function stripeGet(apiKey, path, params = []) {
  const url = new URL(`${STRIPE_BASE}/${path}`);
  params.forEach(([key, value]) => url.searchParams.append(key, value));
  const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  const data = await res.json();
  if (data.error) {
    throw new Error(`Stripe API error on ${path}: ${data.error.message}`);
  }
  return data;
}

async function stripeList(apiKey, path, params) {
  const items = [];
  let startingAfter = null;
  for (;;) {
    const pageParams = [...params, ['limit', '100']];
    if (startingAfter) pageParams.push(['starting_after', startingAfter]);
    const page = await stripeGet(apiKey, path, pageParams);
    items.push(...page.data);
    if (!page.has_more || page.data.length === 0) return items;
    startingAfter = page.data[page.data.length - 1].id;
  }
}

// Best human-readable name for what a charge was for. SamCart puts the product
// name in the charge description; Stripe subscription charges usually have no
// description, so fall back to the invoice's first line item.
function chargeLabel(charge) {
  if (charge.description) return charge.description;
  const invoice = charge.invoice && typeof charge.invoice === 'object' ? charge.invoice : null;
  const line = invoice?.lines?.data?.[0];
  if (line?.description) return line.description;
  const metadataValues = Object.values(charge.metadata || {}).filter((v) => typeof v === 'string' && v);
  if (metadataValues.length) return metadataValues.join(' ');
  return charge.calculated_statement_descriptor || '(no description)';
}

// Returns normalized payment records since `sinceSeconds` (epoch):
//   { source, ts (ms), cents, currency, kind: 'sale'|'refund'|'failed', recurring, label }
// Refunds are fetched separately so they land on the date the refund happened,
// not the date of the original charge.
async function fetchStripePayments(apiKey, sinceSeconds) {
  const [charges, refunds] = await Promise.all([
    stripeList(apiKey, 'charges', [
      ['created[gte]', String(sinceSeconds)],
      ['expand[]', 'data.invoice'],
    ]),
    stripeList(apiKey, 'refunds', [
      ['created[gte]', String(sinceSeconds)],
      ['expand[]', 'data.charge'],
    ]),
  ]);

  const payments = [];

  for (const charge of charges) {
    if (charge.status !== 'succeeded' && charge.status !== 'failed') continue; // skip pending
    payments.push({
      source: 'stripe',
      ts: charge.created * 1000,
      cents: charge.amount,
      currency: charge.currency,
      kind: charge.status === 'succeeded' ? 'sale' : 'failed',
      recurring: Boolean(charge.invoice), // invoice-backed = subscription billing
      label: chargeLabel(charge),
    });
  }

  for (const refund of refunds) {
    if (refund.status !== 'succeeded') continue;
    const charge = refund.charge && typeof refund.charge === 'object' ? refund.charge : null;
    payments.push({
      source: 'stripe',
      ts: refund.created * 1000,
      cents: refund.amount,
      currency: refund.currency,
      kind: 'refund',
      recurring: Boolean(charge?.invoice),
      label: charge ? chargeLabel(charge) : '(refund)',
    });
  }

  return payments;
}

module.exports = { fetchStripePayments };
