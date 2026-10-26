// Subscriber journey export: for everyone who came in through a tracked
// ManyChat opt-in (see docs/subscriber-journey.md), pull their full Kit tag
// history and every Stripe charge across all STRIPE_*_API_KEY accounts, then
// write one JSON file. Contains subscriber PII, so the output path defaults
// to a gitignored file.
//
// Usage: node src/journey.js [output.json]

require('dotenv').config();
const fs = require('fs');
const { requireEnv } = require('./config');

const OPT_INS = [
  { key: 'next10k', label: 'Your Next $10K', mainTag: 'Your Next $10K Freebie', channelPrefix: '10K Freebie | ' },
  { key: 'aiHoliday', label: 'AI Holiday Photographer', mainTag: 'AI Holiday Photographer Freebie', channelPrefix: 'AI Holiday Photographer | ' },
];

// Tags that are list admin, not a step anyone took.
const IGNORED_TAG_PATTERNS = [/^Imported /i, /^\[temp\]/i, /^Resend needed/i, /^Welcome Sequence$/i];

// Which business each Stripe key's account covers.
const STRIPE_ACCOUNT_LABELS = {
  STRIPE_API_KEY: 'ClickFunnels',
  STRIPE_CLICKFUNNELS_API_KEY: 'ClickFunnels',
  STRIPE_FGFUNNELS_API_KEY: 'FG Funnels',
  STRIPE_SAMCART_API_KEY: 'SamCart',
};

async function getJson(url, headers) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers });
    if (res.status === 429 && attempt < 5) {
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} ${url}: ${await res.text()}`);
    return res.json();
  }
}

// --- Kit -------------------------------------------------------------------

function kitGet(path, params = {}) {
  const url = new URL(`https://api.kit.com/v4${path}`);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  return getJson(url, { 'X-Kit-Api-Key': requireEnv('KIT_API_KEY'), Accept: 'application/json' });
}

async function kitPaginate(path, key, params = {}) {
  const items = [];
  let after;
  do {
    const page = await kitGet(path, { ...params, per_page: 1000, after });
    items.push(...page[key]);
    after = page.pagination.has_next_page ? page.pagination.end_cursor : null;
  } while (after);
  return items;
}

async function collectKit() {
  const tags = await kitPaginate('/tags', 'tags');
  const subscribers = new Map();

  for (const optIn of OPT_INS) {
    const main = tags.find((t) => t.name === optIn.mainTag);
    const optInTags = tags.filter((t) => t === main || t.name.startsWith(optIn.channelPrefix));
    for (const tag of optInTags) {
      const members = await kitPaginate(`/tags/${tag.id}/subscribers`, 'subscribers');
      for (const s of members) {
        if (!subscribers.has(s.id)) {
          subscribers.set(s.id, {
            id: s.id,
            email: s.email_address.toLowerCase(),
            firstName: s.first_name,
            state: s.state,
            kitCreatedAt: s.created_at,
          });
        }
      }
    }
  }

  for (const sub of subscribers.values()) {
    const subTags = await kitPaginate(`/subscribers/${sub.id}/tags`, 'tags');
    sub.tags = subTags
      .filter((t) => !IGNORED_TAG_PATTERNS.some((re) => re.test(t.name)))
      .map((t) => ({ name: t.name, taggedAt: t.tagged_at }))
      .sort((a, b) => a.taggedAt.localeCompare(b.taggedAt));

    sub.optIns = OPT_INS.flatMap((optIn) => {
      const main = sub.tags.find((t) => t.name === optIn.mainTag);
      const channels = sub.tags.filter((t) => t.name.startsWith(optIn.channelPrefix));
      if (!main && channels.length === 0) return [];
      const first = [main, ...channels].filter(Boolean).sort((a, b) => a.taggedAt.localeCompare(b.taggedAt))[0];
      return [{
        key: optIn.key,
        label: optIn.label,
        optedInAt: first.taggedAt,
        channels: channels.map((c) => c.name.slice(optIn.channelPrefix.length)),
      }];
    });
  }

  return [...subscribers.values()];
}

// --- Stripe ----------------------------------------------------------------

async function stripePaginate(apiKey, path, params) {
  const items = [];
  let startingAfter;
  for (;;) {
    const url = new URL(`https://api.stripe.com/v1${path}`);
    for (const [k, v] of params) url.searchParams.append(k, v);
    url.searchParams.set('limit', '100');
    if (startingAfter) url.searchParams.set('starting_after', startingAfter);
    const page = await getJson(url, { Authorization: `Bearer ${apiKey}` });
    items.push(...page.data);
    if (!page.has_more) return items;
    startingAfter = page.data[page.data.length - 1].id;
  }
}

function chargeEmail(charge) {
  const email = charge.billing_details?.email || charge.receipt_email || charge.customer?.email;
  return email ? email.toLowerCase() : null;
}

function chargeProduct(charge) {
  return charge.description || charge.calculated_statement_descriptor || null;
}

// Look charges up per subscriber email (via the Stripe customers with that
// email) instead of listing every charge on the account. Guest charges with
// no customer attached are not found this way.
async function chargesForEmail(apiKey, email) {
  const byId = new Map();
  const customers = await stripePaginate(apiKey, '/customers', [['email', email]]);
  for (const cust of customers) {
    for (const c of await stripePaginate(apiKey, '/charges', [['customer', cust.id]])) byId.set(c.id, c);
  }
  return [...byId.values()];
}

async function collectStripe(emails) {
  const keyNames = Object.keys(process.env).filter((k) => /^STRIPE_.*API_KEY$/.test(k));
  const purchases = [];
  for (const keyName of keyNames) {
    const account = STRIPE_ACCOUNT_LABELS[keyName] || keyName;
    let count = 0;
    const queue = [...emails];
    await Promise.all(Array.from({ length: 5 }, async () => {
      while (queue.length) {
        const email = queue.shift();
        for (const c of await chargesForEmail(process.env[keyName], email)) {
          if (!c.paid) continue;
          count++;
          purchases.push({
            email,
            account,
            createdAt: new Date(c.created * 1000).toISOString(),
            amount: c.amount / 100,
            amountRefunded: c.amount_refunded / 100,
            currency: c.currency,
            product: chargeProduct(c),
          });
        }
      }
    }));
    console.error(`${account}: ${count} matched charges`);
  }
  return { accounts: keyNames.map((k) => STRIPE_ACCOUNT_LABELS[k] || k), purchases };
}

async function main() {
  const outPath = process.argv[2] || 'journey-data.json';
  const subscribers = await collectKit();
  console.error(`Kit: ${subscribers.length} opt-in subscribers`);

  const { accounts, purchases } = await collectStripe(new Set(subscribers.map((s) => s.email)));
  for (const sub of subscribers) {
    sub.purchases = purchases.filter((p) => p.email === sub.email).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), optIns: OPT_INS, stripeAccounts: accounts, subscribers }, null, 2));
  console.error(`Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
