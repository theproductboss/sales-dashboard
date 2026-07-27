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
// millis, ISO strings, SQL-style strings). Parse whatever shows up; `zone`
// only applies to strings that carry no timezone of their own (epoch numbers
// and offset-bearing strings are unambiguous). Returns a luxon DateTime or
// null.
function parseSessionStart(value, zone = 'utc') {
  if (value == null) return null;
  if (typeof value === 'number') {
    const dt = DateTime.fromSeconds(value > 1e12 ? value / 1000 : value);
    return dt.isValid ? dt : null;
  }
  if (typeof value === 'string') {
    if (/^\d+$/.test(value.trim())) return parseSessionStart(Number(value.trim()));
    for (const parse of [
      () => DateTime.fromISO(value, { zone, setZone: true }),
      () => DateTime.fromSQL(value, { zone, setZone: true }),
      () => DateTime.fromRFC2822(value),
    ]) {
      const dt = parse();
      if (dt.isValid) return dt;
    }
  }
  return null;
}

// Epoch fields are preferred over formatted strings because they can't be
// misread in the wrong timezone.
function normalizeDates(event, zone) {
  const raw = event.dates || event.event?.dates || [];
  return raw
    .map((d) => ({
      dateId: d.date_id ?? d.datetime_id ?? d.id,
      start: parseSessionStart(d.timestamp ?? d.datetime ?? d.date, zone),
      status: String(d.status || '').toLowerCase(),
    }))
    .filter((d) => d.dateId != null);
}

// Every upcoming session across ALL events on the account, with parsed start
// times. The events listing sometimes includes each event's dates inline;
// when it doesn't, fall back to fetching the event individually.
async function listUpcomingSessions(auth, zone) {
  const events = await listUpcomingEvents(auth);
  const sessions = [];
  for (const e of events.slice(0, 50)) {
    let dates = normalizeDates(e, zone);
    if (dates.length === 0 && e.id != null) {
      try {
        dates = normalizeDates(await getEvent(auth, e.id), zone);
      } catch (err) {
        console.error(`Could not fetch dates for event ${e.id}: ${err.message}`);
      }
    }
    for (const d of dates) {
      sessions.push({
        eventId: e.id,
        eventName: e.name || `(event ${e.id})`,
        dateId: d.dateId,
        start: d.start,
        status: d.status,
      });
    }
  }
  return sessions;
}

// Sessions (across all events) scheduled to start within [windowStart,
// windowEnd). Sessions whose start time can't be parsed are logged so a
// timezone/format problem is visible instead of silently skipping webinars.
async function findSessionsInWindow(auth, { windowStart, windowEnd, zone }) {
  const sessions = await listUpcomingSessions(auth, zone);
  const claimed = [];
  for (const s of sessions) {
    if (!s.start) {
      console.error(
        `Warning: could not parse start time for "${s.eventName}" session ${s.dateId} — skipping it.`
      );
      continue;
    }
    if (s.start >= windowStart && s.start < windowEnd) claimed.push(s);
  }
  return { claimed, all: sessions };
}

module.exports = {
  demioFetch,
  listUpcomingEvents,
  getEvent,
  getSessionParticipants,
  parseSessionStart,
  listUpcomingSessions,
  findSessionsInWindow,
};
