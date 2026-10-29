require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { requireEnv } = require('../config');
const { fetchAllRegistrations } = require('./webinarjam');
const { fetchBookings, fetchPayments, fetchThreadEmails } = require('./slackActivity');
const { buildNameIndex, matchItems } = require('./matchPeople');
const { buildLeads } = require('./buildLeads');
const { renderTracker } = require('./render');
const { sampleInputs } = require('./sampleData');

const TIME_ZONE = process.env.REPORT_TIMEZONE || 'America/New_York';
const ALIASES_FILE = process.env.LEAD_EMAIL_ALIASES_FILE;
const OUT_DIR = path.resolve(process.env.LEADS_OUT_DIR || 'dist');
const DEMO = process.argv.includes('--demo');

async function loadInputs() {
  if (DEMO) return { ...sampleInputs(), warnings: ['Demo mode: these are made-up leads, not real WebinarJam data.'] };

  const apiKey = requireEnv('WEBINARJAM_API_KEY');
  const slackToken = requireEnv('SLACK_BOT_TOKEN');
  const bookingsChannel = requireEnv('CALLS_BOOKED_CHANNEL_ID');
  const paymentsChannel = process.env.PAYMENTS_CHANNEL_ID;
  const webinarIds = (process.env.WEBINARJAM_WEBINAR_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);

  const nameIncludes = process.env.WEBINARJAM_NAME_INCLUDES ?? 'Collective Webinar';
  const registrations = await fetchAllRegistrations(apiKey, { webinarIds, nameIncludes });
  const earliest = registrations.reduce((min, r) => (r.registeredAt && r.registeredAt < min ? r.registeredAt : min), new Date().toISOString());
  const oldest = new Date(earliest);

  const warnings = [];
  const bookings = await fetchBookings(slackToken, bookingsChannel, oldest);
  let payments = [];
  if (paymentsChannel) {
    try {
      payments = await fetchPayments(slackToken, paymentsChannel, oldest);
    } catch (err) {
      // #payments is private; the most likely failure is the bot not being invited.
      warnings.push(`Couldn't read the payments channel (${err.message}) — "Paid" is blank this sync.`);
    }
  } else {
    warnings.push('PAYMENTS_CHANNEL_ID is not set — "Paid" is blank.');
  }
  // Look in the thread under any payment whose email isn't a lead's, in
  // case a teammate posted the email they registered with.
  const leadEmails = new Set(registrations.map((r) => r.email));
  const threadEmails = new Map();
  for (const p of payments) {
    if (!p.replyCount || leadEmails.has(p.email)) continue;
    try {
      threadEmails.set(p.ts, await fetchThreadEmails(slackToken, paymentsChannel, p.ts));
    } catch (err) {
      warnings.push(`Couldn't read a payment thread (${err.message}); matching by thread was skipped for it.`);
    }
  }
  return { registrations, bookings, payments, warnings, threadEmails };
}

function loadAliases(file) {
  if (!file) return {};
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Object.fromEntries(Object.entries(raw).map(([from, to]) => [from.trim().toLowerCase(), to ? String(to).trim().toLowerCase() : null]));
}

async function main() {
  const { registrations, bookings, payments, warnings, threadEmails } = await loadInputs();

  // Bookings and payments made under a different email than the
  // registration are linked by hand-entered aliases, the payment's Slack
  // thread, or an exact full-name match (see matchPeople.js). The aliases
  // file holds customer emails, so it lives with the private tracker page,
  // never in this repo.
  const context = {
    aliases: loadAliases(ALIASES_FILE),
    leadEmails: new Set(registrations.map((r) => r.email)),
    nameIndex: buildNameIndex(registrations),
  };
  const matchedBookings = matchItems(bookings, context);
  const matchedPayments = matchItems(payments, { ...context, threadEmails });
  const leads = buildLeads(registrations, matchedBookings, matchedPayments);

  const unmatchedPayments = matchedPayments
    .filter((p) => !context.leadEmails.has(p.email))
    .map(({ email, name, paidAt, amount, product }) => ({ email, name, paidAt, amount, product }))
    .sort((a, b) => b.paidAt.localeCompare(a.paidAt));
  const autoMatched = [...matchedBookings, ...matchedPayments].filter((i) => i.matchedBy === 'name' || i.matchedBy === 'thread');

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const payload = { generatedAt: new Date().toISOString(), timeZone: TIME_ZONE, warnings, leads, unmatchedPayments };
  // lead-tracker.html opens straight from disk; artifact.html is what gets
  // published to the team's claude.ai page.
  const outFile = path.join(OUT_DIR, 'lead-tracker.html');
  fs.writeFileSync(outFile, renderTracker(payload, { standalone: true }));
  fs.writeFileSync(path.join(OUT_DIR, 'artifact.html'), renderTracker(payload));

  console.log(
    `${registrations.length} registrations → ${leads.length} leads; ` +
      `${bookings.length} bookings and ${payments.length} payments found in Slack; ` +
      `${autoMatched.length} linked to a lead by name or Slack thread.`
  );
  warnings.forEach((w) => console.warn(`warning: ${w}`));
  console.log(`Wrote ${outFile} and ${path.join(OUT_DIR, 'artifact.html')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
