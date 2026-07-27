const { DateTime } = require('luxon');

const DEMIO_BASE = 'https://my.demio.com/api/v1';

async function demioFetch(auth, path) {
  const res = await fetch(`${DEMIO_BASE}${path}`, {
    headers: {
      'Api-Key': auth.key,
      'Api-Secret': auth.secret,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Demio API error ${res.status} on ${path}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

async function listUpcomingEvents(auth) {
  const data = await demioFetch(auth, '/events?type=upcoming');
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.events)) return data.events;
  return [];
}

async function getEvent(auth, eventId) {
  return demioFetch(auth, `/event/${eventId}`);
}

// The participants report is per-session ("date" in Demio terms), keyed by
// date_id, not by event id.
async function getSessionParticipants(auth, dateId) {
  const data = await demioFetch(auth, `/report/${dateId}/participants`);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.participants)) return data.participants;
  if (Array.isArray(data.data)) return data.data;
  return [];
}

// Demio has returned session timestamps in a few shapes (unix seconds, unix
// millis, ISO strings, SQL-style strings). Parse whatever shows up; return a
// luxon DateTime or null.
function parseSessionStart(value) {
  if (value == null) return null;
  if (typeof value === 'number') {
    const dt = DateTime.fromSeconds(value > 1e12 ? value / 1000 : value);
    return dt.isValid ? dt : null;
  }
  if (typeof value === 'string') {
    for (const parse of [
      () => DateTime.fromISO(value, { zone: 'utc' }),
      () => DateTime.fromSQL(value, { zone: 'utc' }),
      () => DateTime.fromRFC2822(value),
    ]) {
      const dt = parse();
      if (dt.isValid) return dt;
    }
  }
  return null;
}

function normalizeDates(event) {
  const raw = event.dates || event.event?.dates || [];
  return raw
    .map((d) => ({
      dateId: d.date_id ?? d.datetime_id ?? d.id,
      start: parseSessionStart(d.datetime ?? d.timestamp ?? d.date),
      status: String(d.status || '').toLowerCase(),
    }))
    .filter((d) => d.dateId != null);
}

// Pick the session that's running (or about to run) right now: a date whose
// status says it's live wins; otherwise the date scheduled closest to `now`,
// as long as it's within `windowHours`. Returns { dateId, start } or null.
async function findCurrentSession(auth, eventId, now, windowHours = 3) {
  const event = await getEvent(auth, eventId);
  const dates = normalizeDates(event);

  const live = dates.find((d) => ['live', 'started', 'active', 'running'].includes(d.status));
  if (live) return live;

  let best = null;
  for (const d of dates) {
    if (!d.start) continue;
    const distance = Math.abs(d.start.diff(now).as('hours'));
    if (distance <= windowHours && (!best || distance < best.distance)) {
      best = { ...d, distance };
    }
  }
  if (best) return best;

  // Single-session event with no parseable/matching date: if there's exactly
  // one date, it's the only candidate.
  if (dates.length === 1) return dates[0];
  return null;
}

module.exports = {
  demioFetch,
  listUpcomingEvents,
  getEvent,
  getSessionParticipants,
  findCurrentSession,
  parseSessionStart,
};
