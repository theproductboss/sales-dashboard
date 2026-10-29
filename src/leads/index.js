require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { requireEnv } = require('../config');
const { fetchAllRegistrations } = require('./webinarjam');
const { fetchBookings, fetchPayments } = require('./slackActivity');
const { buildLeads } = require('./buildLeads');
const { renderTracker } = require('./render');
const { sampleInputs } = require('./sampleData');

const TIME_ZONE = process.env.REPORT_TIMEZONE || 'America/New_York';
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
  return { registrations, bookings, payments, warnings };
}

async function main() {
  const { registrations, bookings, payments, warnings } = await loadInputs();
  const leads = buildLeads(registrations, bookings, payments);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const payload = { generatedAt: new Date().toISOString(), timeZone: TIME_ZONE, warnings, leads };
  // lead-tracker.html opens straight from disk; artifact.html is what gets
  // published to the team's claude.ai page.
  const outFile = path.join(OUT_DIR, 'lead-tracker.html');
  fs.writeFileSync(outFile, renderTracker(payload, { standalone: true }));
  fs.writeFileSync(path.join(OUT_DIR, 'artifact.html'), renderTracker(payload));

  console.log(
    `${registrations.length} registrations → ${leads.length} leads; ` +
      `${bookings.length} bookings and ${payments.length} payments found in Slack.`
  );
  warnings.forEach((w) => console.warn(`warning: ${w}`));
  console.log(`Wrote ${outFile} and ${path.join(OUT_DIR, 'artifact.html')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
