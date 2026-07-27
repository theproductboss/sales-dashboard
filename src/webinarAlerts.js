// Posts "who's live right now" alerts to Slack during Demio webinars,
// filtered to the high-revenue registration tiers. Runs hourly (at :50);
// each run claims the sessions — across ALL events on the account —
// scheduled to start in the following hour, then waits and fires an alert
// at each configured minute mark (default: 2 and 15) after each session's
// scheduled start.
require('dotenv').config();

const { DateTime } = require('luxon');
const { requireEnv } = require('./config');
const { postMessage } = require('./slack');
const { getSessionParticipants, findSessionsInWindow, listUpcomingSessions } = require('./demio');

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

function buildMessage(liveByTier, header) {
  const lines = header ? [header, ''] : [];
  let anyone = false;
  const body = ['These attendees are live!'];
  for (const tier of TARGET_TIERS) {
    const people = liveByTier.get(tier) || [];
    if (people.length === 0) continue;
    anyone = true;
    body.push('', `*${tier}*`);
    for (const p of people) {
      body.push(`${displayName(p)}, ${p.email || '(no email)'}`);
    }
  }
  if (!anyone) {
    lines.push('No attendees in the $100K+ revenue tiers are live right now.');
  } else {
    lines.push(...body);
  }
  return lines.join('\n');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendAlert({ auth, session, minutes, slackToken, channel }) {
  const participants = await getSessionParticipants(auth, session.dateId);
  const liveByTier = new Map();
  for (const p of participants) {
    if (!isLive(p)) continue;
    const tier = revenueTier(p);
    if (!tier) continue;
    if (!liveByTier.has(tier)) liveByTier.set(tier, []);
    liveByTier.get(tier).push(p);
  }

  const header = `*${session.eventName}* — ${minutes} minutes in`;
  const text = buildMessage(liveByTier, header);
  console.log(
    `--- ${session.eventName}: ${minutes}-minute alert (${participants.length} participants in report) ---`
  );
  console.log(text);
  if (!DRY_RUN) {
    await postMessage(slackToken, channel, text);
    console.log('Posted to Slack.');
  }
}

// Wait out one session's minute marks and post the alert at each one,
// anchored to the session's scheduled start time.
async function runSessionAlerts({ auth, session, alertMinutes, slackToken, channel }) {
  console.log(
    `Claimed "${session.eventName}" session ${session.dateId}, starts ${session.start.toISO()}.`
  );
  for (const minutes of alertMinutes) {
    const fireAt = session.start.plus({ minutes });
    const waitMs = fireAt.diffNow().as('milliseconds');
    if (waitMs > 0) {
      console.log(
        `[${session.eventName}] waiting ${Math.round(waitMs / 1000)}s until the ${minutes}-minute mark...`
      );
      await sleep(waitMs);
    }
    try {
      await sendAlert({ auth, session, minutes, slackToken, channel });
    } catch (err) {
      // A failed 2-minute alert shouldn't cancel the 15-minute one.
      console.error(`[${session.eventName}] ${minutes}-minute alert failed:`, err.message);
      process.exitCode = 1;
    }
  }
}

async function listEvents(auth, zone) {
  const sessions = await listUpcomingSessions(auth, zone);
  if (sessions.length === 0) {
    console.log('No upcoming sessions found on this Demio account.');
    return;
  }
  console.log('Upcoming Demio sessions:');
  for (const s of sessions) {
    const when = s.start ? s.start.toISO() : '(could not parse start time)';
    console.log(`  event=${s.eventId} date_id=${s.dateId}  ${when}  ${s.eventName}`);
  }
}

// Each hourly run (scheduled at :50) claims the one-hour window that starts
// at the next top of the hour. Computing the window from the *intended* fire
// time — rather than rounding "now" — keeps runs from claiming a neighbor's
// window when GitHub starts them late: a run scheduled for 12:50 that
// actually starts at 13:12 still claims [13:00, 14:00).
function claimWindow(now) {
  const windowStart =
    now.minute >= 50 ? now.startOf('hour').plus({ hours: 1 }) : now.startOf('hour');
  return { windowStart, windowEnd: windowStart.plus({ hours: 1 }) };
}

async function main() {
  const auth = { key: requireEnv('DEMIO_API_KEY'), secret: requireEnv('DEMIO_API_SECRET') };
  // Only needed if Demio returns timezone-naive session times that aren't UTC.
  const zone = process.env.DEMIO_TIMEZONE || 'utc';

  if (process.argv.includes('--list-events')) {
    await listEvents(auth, zone);
    return;
  }

  const slackToken = requireEnv('SLACK_BOT_TOKEN');
  const channel = requireEnv('WEBINAR_ALERTS_CHANNEL');
  const alertMinutes = (process.env.WEBINAR_ALERT_MINUTES || '2,15')
    .split(',')
    .map((m) => Number(m.trim()))
    .filter((m) => Number.isFinite(m) && m >= 0)
    .sort((a, b) => a - b);

  const now = DateTime.utc();
  const { windowStart, windowEnd } = claimWindow(now);
  console.log(`Claiming sessions starting in [${windowStart.toISO()}, ${windowEnd.toISO()}).`);

  const { claimed, all } = await findSessionsInWindow(auth, { windowStart, windowEnd, zone });
  if (claimed.length === 0) {
    // Exit cleanly so quiet hours don't show up as failed workflow runs. The
    // upcoming-session dump makes timezone misparses visible: if a webinar
    // you expected to be claimed shows the wrong time here, set DEMIO_TIMEZONE.
    console.log('No sessions start in this window — nothing to do.');
    const next = all
      .filter((s) => s.start && s.start > now)
      .sort((a, b) => a.start - b.start)
      .slice(0, 5);
    for (const s of next) {
      console.log(`  next: ${s.start.toISO()}  ${s.eventName}`);
    }
    return;
  }

  await Promise.all(
    claimed.map((session) =>
      runSessionAlerts({ auth, session, alertMinutes, slackToken, channel })
    )
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { normalizeTier, revenueTier, isLive, buildMessage, claimWindow, TARGET_TIERS };
