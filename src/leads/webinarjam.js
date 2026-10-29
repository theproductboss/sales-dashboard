const { DateTime } = require('luxon');

const WEBINARJAM_BASE = 'https://api.webinarjam.com/webinarjam';

// WebinarJam's API is POST-only with form-encoded params, and the API key
// travels in the body rather than a header.
async function webinarjamFetch(apiKey, endpoint, params = {}) {
  const body = new URLSearchParams({ api_key: apiKey });
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) body.set(key, String(value));
  });

  const res = await fetch(`${WEBINARJAM_BASE}/${endpoint}`, { method: 'POST', body });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`WebinarJam API error ${res.status} on /${endpoint}: ${text.slice(0, 300)}`);
  }
  if (!res.ok || data.status === 'error') {
    throw new Error(`WebinarJam API error ${res.status} on /${endpoint}: ${data.message || text.slice(0, 300)}`);
  }
  return data;
}

async function listWebinars(apiKey) {
  const data = await webinarjamFetch(apiKey, 'webinars');
  return data.webinars || [];
}

async function getWebinar(apiKey, webinarId) {
  const data = await webinarjamFetch(apiKey, 'webinar', { webinar_id: webinarId });
  return data.webinar;
}

// The docs don't spell out the paginated response shape, so this accepts
// either `registrants: [...]` or a Laravel-style `registrants: { data,
// current_page, last_page }` and stops when a page comes back empty.
async function listRegistrants(apiKey, webinarId) {
  const all = [];
  for (let page = 1; page <= 500; page += 1) {
    const data = await webinarjamFetch(apiKey, 'registrants', { webinar_id: webinarId, page, date_range: 0 });
    const container = data.registrants || data.users || data.user || [];
    const rows = Array.isArray(container) ? container : container.data || [];
    all.push(...rows);

    const lastPage = !Array.isArray(container) && container.last_page;
    if (rows.length === 0 || (lastPage && page >= lastPage)) break;
  }
  return all;
}

function isTruthyFlag(value) {
  if (value === true || value === 1) return true;
  return /^(1|yes|true)$/i.test(String(value ?? '').trim());
}

// WebinarJam returns dates in the webinar's timezone, as "2026-10-28 13:00"
// in webinar schedules and "Wed, 28 Oct 2026, 01:42 PM" on registrants.
function parseWebinarjamDate(value, timeZone) {
  if (!value) return null;
  const str = String(value).trim();
  const formats = ['EEE, d MMM yyyy, hh:mm a', 'yyyy-MM-dd HH:mm:ss', 'yyyy-MM-dd HH:mm', 'yyyy-MM-dd'];
  for (const format of formats) {
    const dt = DateTime.fromFormat(str, format, { zone: timeZone, locale: 'en-US' });
    if (dt.isValid) return dt.toUTC().toISO();
  }
  const iso = DateTime.fromISO(str, { zone: timeZone });
  return iso.isValid ? iso.toUTC().toISO() : null;
}

// Revenue level is a custom registration question (currently "Projected
// Revenue - 2026"), so match any field whose name mentions revenue rather
// than the exact wording, which changes year to year.
function findRevenueLevel(raw) {
  const key = Object.keys(raw).find((k) => /revenue/i.test(k) && !/^revenue_(live|replay)$/i.test(k));
  if (key && raw[key]) return String(raw[key]);
  const custom = raw.custom_fields || raw.custom || raw.questions;
  if (Array.isArray(custom)) {
    const match = custom.find((field) => /revenue/i.test(field.name || field.question || field.label || ''));
    if (match) return String(match.value ?? match.answer ?? '');
  }
  return null;
}

// Turns one raw WebinarJam registrant into the shape the lead tracker uses.
// `scheduleDates` maps API schedule IDs to session dates (from getWebinar);
// the registrant's own `schedule` text is the fallback.
function normalizeRegistrant(raw, webinar, scheduleDates) {
  const timeZone = webinar.timezone || 'America/New_York';
  const webinarDate =
    scheduleDates[String(raw.schedule_id)] ||
    parseWebinarjamDate(raw.schedule, timeZone) ||
    parseWebinarjamDate(raw.date_live, timeZone);
  const optionalPhone = Object.keys(raw).find((k) => /^phone number/i.test(k));

  return {
    email: String(raw.email || '').trim().toLowerCase(),
    firstName: raw.first_name || '',
    lastName: raw.last_name || '',
    phone: [raw.phone_country_code, raw.phone_number || raw.phone].filter(Boolean).join(' ') || (optionalPhone && raw[optionalPhone]) || '',
    registeredAt: parseWebinarjamDate(raw.signup_date, timeZone),
    webinarName: raw.webinar || webinar.name || webinar.title || '',
    webinarDate,
    attendedLive: isTruthyFlag(raw.attended_live),
    timeLive: raw.time_live || null,
    attendedReplay: isTruthyFlag(raw.attended_replay),
    revenueLevel: findRevenueLevel(raw),
    utm: {
      source: raw.utm_source || '',
      medium: raw.utm_medium || '',
      campaign: raw.utm_campaign || '',
      content: raw.utm_content || '',
      term: raw.utm_term || '',
    },
  };
}

// Which webinars count: explicit IDs if given, otherwise every webinar whose
// name contains `nameIncludes` (e.g. "Collective Webinar"), skipping any
// named as a test.
async function fetchAllRegistrations(apiKey, { webinarIds, nameIncludes } = {}) {
  let webinars = await listWebinars(apiKey);
  if (webinarIds && webinarIds.length) {
    webinars = webinars.filter((w) => webinarIds.includes(String(w.webinar_id)));
  } else {
    const needle = (nameIncludes || '').toLowerCase();
    webinars = webinars.filter((w) => {
      const name = String(w.name || '').toLowerCase();
      return name.includes(needle) && !/\btest\b/.test(name);
    });
  }

  const registrations = [];
  for (const summary of webinars) {
    const webinar = (await getWebinar(apiKey, summary.webinar_id)) || summary;
    const timeZone = webinar.timezone || 'America/New_York';
    const scheduleDates = {};
    (webinar.schedules || []).forEach((s) => {
      if (s && typeof s === 'object' && s.schedule) {
        scheduleDates[String(s.schedule)] = parseWebinarjamDate(s.date, timeZone);
      }
    });

    const raws = await listRegistrants(apiKey, summary.webinar_id);
    registrations.push(...raws.map((raw) => normalizeRegistrant(raw, webinar, scheduleDates)));
  }
  return registrations.filter((r) => r.email);
}

module.exports = {
  webinarjamFetch,
  listWebinars,
  getWebinar,
  listRegistrants,
  normalizeRegistrant,
  parseWebinarjamDate,
  fetchAllRegistrations,
};
