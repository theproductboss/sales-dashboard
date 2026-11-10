require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { requireEnv } = require('../config');
const { fetchAllRegistrations } = require('./webinarjam');
const { fetchBookings, fetchPayments, fetchThreadEmails, fetchPostWebinarStats } = require('./slackActivity');
const { buildWebinarStats } = require('./webinarStats');
const { fetchKitHistory, kitProfile, PROGRAMS } = require('./kit');
const { buildNameIndex, matchItems } = require('./matchPeople');
const { buildLeads } = require('./buildLeads');
const { renderTracker } = require('./render');
const { sampleInputs } = require('./sampleData');

const TIME_ZONE = process.env.REPORT_TIMEZONE || 'America/New_York';
const ALIASES_FILE = process.env.LEAD_EMAIL_ALIASES_FILE;
const WEBINAR_NOTES_FILE = process.env.WEBINAR_NOTES_FILE;
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

  let slackPosts = {};
  const statsChannel = process.env.WEBINAR_STATS_CHANNEL_ID;
  if (statsChannel) {
    try {
      slackPosts = await fetchPostWebinarStats(slackToken, statsChannel, oldest, TIME_ZONE);
    } catch (err) {
      warnings.push(`Couldn't read the post-webinar stats channel (${err.message}); the Slack column is blank this sync.`);
    }
  }

  // Kit list history (join date, programs, past webinars). Optional: without
  // a key the Registrants tab just leaves the Kit columns out.
  let kit = null;
  if (process.env.KIT_API_KEY) {
    try {
      kit = await fetchKitHistory(process.env.KIT_API_KEY);
    } catch (err) {
      warnings.push(`Couldn't read Kit (${err.message}); list history is missing this sync.`);
    }
  }
  return { registrations, bookings, payments, warnings, threadEmails, slackPosts, kit };
}

// What the team learned from each webinar (chat, transcript, what Jacqueline
// did), keyed by webinar day: { "2026-11-09": { "summary": "...", "points": [...] } }.
// It quotes attendees, so like the aliases it lives with the private page.
function loadNotes(file) {
  return file ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
}

function loadAliases(file) {
  if (!file) return {};
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Object.fromEntries(Object.entries(raw).map(([from, to]) => [from.trim().toLowerCase(), to ? String(to).trim().toLowerCase() : null]));
}

async function main() {
  const { registrations, bookings, payments, warnings, threadEmails, slackPosts = {}, kit = null } = await loadInputs();

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
  if (kit) {
    for (const lead of leads) lead.kit = kitProfile(kit, lead.email);
  }

  const webinars = buildWebinarStats(registrations, matchedBookings, {
    slackPosts,
    notes: loadNotes(WEBINAR_NOTES_FILE),
    timeZone: TIME_ZONE,
  });
  const payload = {
    generatedAt: new Date().toISOString(),
    timeZone: TIME_ZONE,
    warnings,
    leads,
    unmatchedPayments,
    webinars,
    kitPrograms: kit ? PROGRAMS.map(({ key, label }) => ({ key, label })) : null,
  };
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
