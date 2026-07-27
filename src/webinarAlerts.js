// Posts "who's live right now" alerts to Slack during a Demio webinar,
// filtered to the high-revenue registration tiers. Meant to be started at
// (or just before) the webinar's scheduled start time; it then waits and
// fires an alert at each configured minute mark (default: 2 and 15).
require('dotenv').config();

const { DateTime } = require('luxon');
const { requireEnv } = require('./config');
const { postMessage } = require('./slack');
const { listUpcomingEvents, getSessionParticipants, findCurrentSession } = require('./demio');

const DRY_RUN = String(process.env.DRY_RUN).toLowerCase() === 'true';

// Highest tier first — this is the display order in the Slack message.
const TARGET_TIERS = [
  '$1,000,000 to $5,000,000',
  '$500,000 to $1,000,000',
  '$100,000 to $500,000',
];

// Tier strings are matched loosely: case, whitespace, "$", ",", and the
// "to" vs "-" separator are all ignored, so "$100,000-$500,000" and
// "$100,000 to $500,000" both match. If the dropdown options ever get
// reworded beyond that (e.g. "$100k-$500k"), update TARGET_TIERS.
function normalizeTier(value) {
  return String(value)
    .toLowerCase()
    .replace(/[\s$,.]/g, '')
    .replace(/(?:to|–|—|-)+/g, '-');
}

const TIER_BY_NORMALIZED = new Map(TARGET_TIERS.map((t) => [normalizeTier(t), t]));

// Pull every string the registrant submitted, wherever Demio put it: a
// custom_fields object, a custom_fields array of {label/name, value}, or
// extra top-level keys on the participant itself.
function participantValues(p) {
  const values = [];
  const cf = p.custom_fields ?? p.customFields ?? p.fields;
  if (Array.isArray(cf)) {
    for (const f of cf) {
      if (typeof f === 'string') values.push(f);
      else if (f && typeof f === 'object') values.push(...Object.values(f));
    }
  } else if (cf && typeof cf === 'object') {
    values.push(...Object.values(cf));
  }
  for (const v of Object.values(p)) {
    if (typeof v === 'string') values.push(v);
  }
  return values.filter((v) => typeof v === 'string');
}

function revenueTier(p) {
  for (const value of participantValues(p)) {
    const tier = TIER_BY_NORMALIZED.get(normalizeTier(value));
    if (tier) return tier;
  }
  return null;
}

// "Online" = has joined the session. The participants report flags this as
// `attended`; a handful of alternate shapes are checked in case the report
// schema differs. If a participant has no attendance-shaped field at all we
// assume the endpoint only returned actual attendees.
function isLive(p) {
  for (const key of ['attended', 'attendance', 'in_room', 'joined']) {
    const v = p[key];
    if (v === undefined || v === null || typeof v === 'object') continue;
    return v === true || v === 1 || String(v).toLowerCase() === 'yes' || String(v).toLowerCase() === 'true';
  }
  if (typeof p.status === 'string') return p.status.toLowerCase() === 'attended';
  return true;
}

function displayName(p) {
  const name = p.name || [p.first_name, p.last_name].filter(Boolean).join(' ');
  return name || '(no name)';
}

function buildMessage(liveByTier) {
  const lines = ['These attendees are live!'];
  let anyone = false;
  for (const tier of TARGET_TIERS) {
    const people = liveByTier.get(tier) || [];
    if (people.length === 0) continue;
    anyone = true;
    lines.push('', `*${tier}*`);
    for (const p of people) {
      lines.push(`${displayName(p)}, ${p.email || '(no email)'}`);
    }
  }
  if (!anyone) {
    return 'No attendees in the $100K+ revenue tiers are live right now.';
  }
  return lines.join('\n');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendAlert({ auth, dateId, slackToken, channel, label }) {
  const participants = await getSessionParticipants(auth, dateId);
  const liveByTier = new Map();
  for (const p of participants) {
    if (!isLive(p)) continue;
    const tier = revenueTier(p);
    if (!tier) continue;
    if (!liveByTier.has(tier)) liveByTier.set(tier, []);
    liveByTier.get(tier).push(p);
  }

  const text = buildMessage(liveByTier);
  console.log(`--- ${label} (${participants.length} participants in report) ---`);
  console.log(text);
  if (!DRY_RUN) {
    await postMessage(slackToken, channel, text);
    console.log('Posted to Slack.');
  }
}

async function listEvents(auth) {
  const events = await listUpcomingEvents(auth);
  if (events.length === 0) {
    console.log('No upcoming events found on this Demio account.');
    return;
  }
  console.log('Upcoming Demio events (use the id as DEMIO_EVENT_ID):');
  for (const e of events) {
    console.log(`  id=${e.id}  ${e.name || '(unnamed)'}`);
  }
}

async function main() {
  const auth = { key: requireEnv('DEMIO_API_KEY'), secret: requireEnv('DEMIO_API_SECRET') };

  if (process.argv.includes('--list-events')) {
    await listEvents(auth);
    return;
  }

  const eventId = requireEnv('DEMIO_EVENT_ID');
  const slackToken = requireEnv('SLACK_BOT_TOKEN');
  const channel = requireEnv('WEBINAR_ALERTS_CHANNEL_ID');
  const alertMinutes = (process.env.WEBINAR_ALERT_MINUTES || '2,15')
    .split(',')
    .map((m) => Number(m.trim()))
    .filter((m) => Number.isFinite(m) && m >= 0)
    .sort((a, b) => a - b);

  const jobStart = DateTime.utc();
  const session = await findCurrentSession(auth, eventId, jobStart);
  if (!session) {
    // Exit cleanly so a skipped week (holiday, rescheduled webinar) doesn't
    // show up as a failed workflow run.
    console.log(`No session for event ${eventId} within 3 hours of now — nothing to do.`);
    return;
  }

  // Anchor the minute marks to Demio's scheduled start so a late workflow
  // launch doesn't shift the alerts. Only trust the parsed start if it's
  // within 30 minutes of now — otherwise (unparseable/odd timezone) fall
  // back to "the workflow was started at webinar time".
  let anchor = jobStart;
  if (session.start && Math.abs(session.start.diff(jobStart).as('minutes')) <= 30) {
    anchor = session.start;
  }
  console.log(
    `Session ${session.dateId}: anchoring t=0 at ${anchor.toISO()} (job started ${jobStart.toISO()}).`
  );

  for (const minutes of alertMinutes) {
    const fireAt = anchor.plus({ minutes });
    const waitMs = fireAt.diffNow().as('milliseconds');
    if (waitMs > 0) {
      console.log(`Waiting ${Math.round(waitMs / 1000)}s until the ${minutes}-minute mark...`);
      await sleep(waitMs);
    }
    try {
      await sendAlert({
        auth,
        dateId: session.dateId,
        slackToken,
        channel,
        label: `${minutes}-minute alert`,
      });
    } catch (err) {
      // A failed 2-minute alert shouldn't cancel the 15-minute one.
      console.error(`${minutes}-minute alert failed:`, err.message);
      process.exitCode = 1;
    }
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { normalizeTier, revenueTier, isLive, buildMessage, TARGET_TIERS };
