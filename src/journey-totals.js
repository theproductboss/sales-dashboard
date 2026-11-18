// Turns the subscriber journey export (src/journey.js, full of PII) into
// totals only: no emails, names, Kit IDs or per-subscriber rows. This is the
// only shape the dashboard page and /api/totals ever see.
//
// Metric definitions live in docs/subscriber-journey.md ("Dashboard metrics").

const { DateTime } = require('luxon');

const DAY_MS = 24 * 60 * 60 * 1000;
const ALL = 'all';
const NO_CHANNEL = 'Main tag only';

const FUNNEL_STEPS = [
  { key: 'webinarRegistered', label: 'Registered for or attended a Collective webinar' },
  { key: 'webinarAttended', label: 'Attended a Collective webinar' },
  { key: 'callBooked', label: 'Booked a Collective call' },
  { key: 'boughtAfter', label: 'Bought after opting in' },
  { key: 'joinedCollective', label: 'Joined the Collective after opting in' },
];

const EMAIL_RE = /[^\s|<>()[\],;:]*@[^\s|<>()[\],;:]*/g;

// --- Product labels ---------------------------------------------------------

// Stripe descriptions are free text written by ClickFunnels / SamCart /
// ThriveCart etc. Some carry the buyer's email or a personalized offer name,
// so reduce each to a plain product name before it leaves the server.
function cleanProductLabel(raw) {
  let label = String(raw || '').trim();
  if (!label) return '(no description)';

  // "someone@x.com | Product: X"  /  "Seller | someone@x.com | Products: X"
  const parts = label.split('|').map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1) {
    const product = parts.find((p) => /^products?\s*:/i.test(p));
    const kept = product ? [product] : parts.filter((p) => !p.includes('@'));
    label = (product ? kept : kept.slice(-1)).join(' ');
  }
  label = label.replace(/^products?\s*:\s*/i, '');

  // Any email left anywhere goes.
  label = label.replace(EMAIL_RE, ' ').replace(/\s+/g, ' ').replace(/ ,/g, ',').trim();

  if (/^invoice\s+[A-Z0-9]+-\d+$/i.test(label)) return 'Invoice installments';

  const thrive = label.match(/^Purchase of (.+) via ThriveCart$/i);
  if (thrive) label = thrive[1].trim();

  // "Shop 1-IN-5 - Order 123" -> "Shop 1-IN-5"
  label = label.replace(/\s+-\s+Order\s+#?\d+$/i, '');

  // Personalized suffixes: " - CHERYL" (a name in capitals) or
  // " - jacqoffer" (a one-off "<name>offer" checkout).
  label = label.replace(/\s+-\s+(?:[A-Z]{3,}|\w*offer)$/, (suffix) => (isKnownSuffix(suffix) ? suffix : ''));

  label = label.replace(/^[\s\-|:,]+|[\s\-|:,]+$/g, '');
  return label || '(no description)';
}

// Capitalized suffixes that are part of a real product name, not a person.
const KEPT_SUFFIXES = new Set(['VIP', 'PIF', 'PBSA', 'USD', 'LIVE', 'PLUS', 'PRO', 'BONUS', 'UPGRADE', 'ANNUAL', 'MONTHLY', 'YEARLY', 'CONTINUATION', 'RENEWAL', 'DEPOSIT', 'PAID']);
function isKnownSuffix(suffix) {
  return KEPT_SUFFIXES.has(suffix.replace(/^\s+-\s+/, ''));
}

// --- Totals -----------------------------------------------------------------

function isWebinarTag(name) {
  return name.includes('[The Collective Webinar]');
}
function isAttended(name) {
  return isWebinarTag(name) && /Attended$/.test(name) && !/(Not|Didn'?t|Did Not) Attended?$/i.test(name);
}
function isRegistered(name) {
  return isWebinarTag(name) && (name.includes('Registered') || isAttended(name));
}
function isCallBooked(name) {
  return name.includes('Call Scheduled');
}

// A Collective product = a cleaned Stripe product name containing "Collective".
function isCollectiveProduct(label) {
  return /collective/i.test(label);
}

function emptyGroup(key, label) {
  return {
    key,
    label,
    optedIn: 0,
    newToList: 0,
    alreadyOnList: 0,
    alreadyCustomers: 0,
    funnel: Object.fromEntries(FUNNEL_STEPS.map((s) => [s.key, 0])),
    firstOptInDate: null,
    lastOptInDate: null,
    products: new Map(),
  };
}

function addToGroup(group, sub, optedInAt, day) {
  const optInMs = Date.parse(optedInAt);
  group.optedIn++;
  if (!group.firstOptInDate || day < group.firstOptInDate) group.firstOptInDate = day;
  if (!group.lastOptInDate || day > group.lastOptInDate) group.lastOptInDate = day;

  if (Date.parse(sub.kitCreatedAt) >= optInMs - DAY_MS) group.newToList++;
  else group.alreadyOnList++;

  const later = (sub.tags || []).filter((t) => Date.parse(t.taggedAt) > optInMs).map((t) => t.name);
  if (later.some(isRegistered)) group.funnel.webinarRegistered++;
  if (later.some(isAttended)) group.funnel.webinarAttended++;
  if (later.some(isCallBooked)) group.funnel.callBooked++;

  let before = false;
  let after = false;
  let collectiveBefore = false;
  let collectiveAfter = false;
  const seen = new Set();
  for (const p of sub.purchases || []) {
    const timing = Date.parse(p.createdAt) < optInMs ? 'before' : 'after';
    if (timing === 'before') before = true;
    else after = true;

    const product = cleanProductLabel(p.product);
    if (isCollectiveProduct(product)) {
      if (timing === 'before') collectiveBefore = true;
      else collectiveAfter = true;
    }
    const currency = (p.currency || 'usd').toLowerCase();
    // Same product spelled with different capitals is one row.
    const rowKey = `${product.toLowerCase()}\u0000${timing}\u0000${currency}`;
    let row = group.products.get(rowKey);
    if (!row) {
      row = { product, timing, currency, buyers: 0, charges: 0, netRevenue: 0 };
      group.products.set(rowKey, row);
    }
    row.charges++;
    row.netRevenue += (p.amount || 0) - (p.amountRefunded || 0);
    if (!seen.has(rowKey)) {
      seen.add(rowKey);
      row.buyers++;
    }
  }
  if (before) group.alreadyCustomers++;
  if (after) group.funnel.boughtAfter++;
  // "Joined" = first Collective charge comes after the opt-in. Members who
  // were already paying for the Collective before opting in do not count.
  if (collectiveAfter && !collectiveBefore) group.funnel.joinedCollective++;
}

function buildTotals(data, { timezone = process.env.REPORT_TIMEZONE || 'America/New_York' } = {}) {
  const optIns = data.optIns || [];
  const dayOf = (iso) => DateTime.fromISO(iso, { zone: 'utc' }).setZone(timezone).toISODate();

  const groups = new Map([[ALL, emptyGroup(ALL, 'All opt-ins')]]);
  for (const o of optIns) groups.set(o.key, emptyGroup(o.key, o.label));
  const daily = new Map();

  for (const sub of data.subscribers || []) {
    const subOptIns = (sub.optIns || []).filter((o) => groups.has(o.key));
    if (subOptIns.length === 0) continue;

    const first = subOptIns.map((o) => o.optedInAt).sort()[0];
    addToGroup(groups.get(ALL), sub, first, dayOf(first));

    for (const o of subOptIns) {
      const day = dayOf(o.optedInAt);
      addToGroup(groups.get(o.key), sub, o.optedInAt, day);

      // One channel per subscriber and opt-in: the channel tag applied first.
      const prefix = optIns.find((x) => x.key === o.key).channelPrefix;
      const firstChannel = (sub.tags || [])
        .filter((t) => t.name.startsWith(prefix))
        .sort((a, b) => a.taggedAt.localeCompare(b.taggedAt))[0];
      const channel = firstChannel ? firstChannel.name.slice(prefix.length).trim() : NO_CHANNEL;
      const key = `${day}\u0000${o.key}\u0000${channel}`;
      const row = daily.get(key) || { date: day, optIn: o.key, channel, count: 0 };
      row.count++;
      daily.set(key, row);
    }
  }

  const totals = {
    generatedAt: data.generatedAt,
    timezone,
    optIns: optIns.map((o) => ({ key: o.key, label: o.label })),
    stripeAccounts: data.stripeAccounts || [],
    funnelSteps: FUNNEL_STEPS,
    noChannelLabel: NO_CHANNEL,
    groups: [...groups.values()].map((g) => ({
      ...g,
      products: [...g.products.values()]
        .map((r) => ({ ...r, netRevenue: Math.round(r.netRevenue * 100) / 100 }))
        .sort((a, b) => b.netRevenue - a.netRevenue),
    })),
    optInsByDay: [...daily.values()].sort((a, b) =>
      a.date.localeCompare(b.date) || a.optIn.localeCompare(b.optIn) || a.channel.localeCompare(b.channel)),
  };

  assertNoPii(totals, data);
  return totals;
}

// Last line of defence: refuse to hand out totals that still contain an "@"
// or anything identifying a subscriber.
function assertNoPii(totals, data) {
  const json = JSON.stringify(totals);
  if (json.includes('@')) throw new Error('Totals still contain an "@" - a product label was not cleaned. Not publishing.');
  const strings = [];
  JSON.stringify(totals, (k, v) => {
    if (typeof v === 'string') strings.push(v);
    return v;
  });
  const text = strings.join('\n');
  for (const sub of data.subscribers || []) {
    if (sub.id != null && String(sub.id).length >= 6 && new RegExp(`(^|\\D)${sub.id}(\\D|$)`).test(text)) {
      throw new Error('Totals contain a Kit subscriber ID. Not publishing.');
    }
  }
}

module.exports = { buildTotals, cleanProductLabel, FUNNEL_STEPS };
