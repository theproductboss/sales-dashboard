require('dotenv').config();

const { requireEnv, productCategories } = require('./config');
const { fetchStripePayments } = require('./stripe');
const { fetchPaypalPayments } = require('./paypal');
const { aggregate } = require('./revenue');
const { buildRevenueBlocks } = require('./formatRevenueReport');
const { postMessage } = require('./slack');
const { getRanges } = require('./dateRanges');

const TIME_ZONE = process.env.REPORT_TIMEZONE || 'America/New_York';
const DRY_RUN = String(process.env.DRY_RUN).toLowerCase() === 'true';
const CURRENCY = (process.env.REPORT_CURRENCY || 'usd').toLowerCase();

async function main() {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const paypalClientId = process.env.PAYPAL_CLIENT_ID;
  const paypalClientSecret = process.env.PAYPAL_CLIENT_SECRET;
  const paypalEnv = process.env.PAYPAL_ENV || 'live';
  if (!stripeKey && !paypalClientId) {
    throw new Error('Set STRIPE_SECRET_KEY and/or PAYPAL_CLIENT_ID + PAYPAL_CLIENT_SECRET.');
  }

  const { now, month } = getRanges(TIME_ZONE);
  const yearStart = now.startOf('year');
  const year = { start: yearStart, label: now.toFormat('yyyy') };

  // One source failing (expired key, PayPal reporting lag/outage) shouldn't
  // kill the whole report — post what we have and flag the gap.
  const sourceNotes = [];
  const payments = [];

  if (stripeKey) {
    try {
      payments.push(...(await fetchStripePayments(stripeKey, Math.floor(yearStart.toSeconds()))));
    } catch (err) {
      sourceNotes.push(`Stripe data unavailable this run: ${err.message}`);
    }
  } else {
    sourceNotes.push('Stripe is not connected (STRIPE_SECRET_KEY not set) — totals are PayPal-only.');
  }

  if (paypalClientId && paypalClientSecret) {
    try {
      payments.push(...(await fetchPaypalPayments(paypalClientId, paypalClientSecret, paypalEnv, yearStart.toMillis())));
    } catch (err) {
      sourceNotes.push(`PayPal data unavailable this run: ${err.message}`);
    }
  } else {
    sourceNotes.push('PayPal is not connected (PAYPAL_CLIENT_ID/SECRET not set) — totals are Stripe-only.');
  }

  const monthRange = { startMs: month.start.toMillis(), endMs: month.end.toMillis() };
  const yearRange = { startMs: yearStart.toMillis(), endMs: yearStart.plus({ years: 1 }).toMillis() };
  const monthTotals = aggregate(payments, monthRange, productCategories, CURRENCY);
  const yearTotals = aggregate(payments, yearRange, productCategories, CURRENCY);

  const blocks = buildRevenueBlocks({ now, month, year, monthTotals, yearTotals, categories: productCategories, sourceNotes });

  if (DRY_RUN) {
    console.log(blocks[0].text.text);
    return;
  }

  const slackToken = requireEnv('SLACK_BOT_TOKEN');
  const channel = process.env.REVENUE_CHANNEL_ID || requireEnv('DASHBOARD_CHANNEL_ID');
  await postMessage(slackToken, channel, 'Daily Revenue Dashboard', blocks);
  console.log('Revenue report posted.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
