const { DateTime } = require('luxon');

// Revenue answers from the registration form, in the order the team reads
// them. Each answer is matched by its numbers rather than its exact wording,
// which varies ("$25,000-$50,000" vs "$25,000 to $50,000").
const REVENUE_RANGES = [
  { key: 'zero', label: 'Zero', test: (s) => /^zero$|^\$?0$/.test(s) },
  { key: 'u5k', label: 'Under $5K', test: (s) => /under\s*\$?5/.test(s) },
  { key: '5-10k', label: '$5K–10K', test: (s) => /5,?000\s*(-|to)\s*\$?10,?000/.test(s) },
  { key: '10-25k', label: '$10K–25K', test: (s) => /10,?000\s*(-|to)\s*\$?25,?000/.test(s) },
  { key: '25-50k', label: '$25K–50K', min25k: true, test: (s) => /25,?000\s*(-|to)\s*\$?50,?000/.test(s) },
  { key: '50-100k', label: '$50K–100K', min25k: true, test: (s) => /50,?000\s*(-|to)\s*\$?100,?000/.test(s) },
  { key: '100-500k', label: '$100K–500K', min25k: true, test: (s) => /100,?000\s*(-|to)\s*\$?500,?000/.test(s) },
  { key: '500k-1m', label: '$500K–1M', min25k: true, test: (s) => /500,?000\s*(-|to)\s*\$?1,?000,?000/.test(s) },
  { key: '1m-5m', label: '$1M–5M', min25k: true, test: (s) => /1,?000,?000\s*(-|to)\s*\$?5,?000,?000/.test(s) },
  { key: '5m+', label: '$5M+', min25k: true, test: (s) => /5,?000,?000\s*\+|over\s*\$?5,?000,?000|5m\+/.test(s) },
];
const UNKNOWN_RANGE = { key: 'unknown', label: 'Not given' };

function revenueRange(answer) {
  const s = String(answer || '').toLowerCase().trim();
  return (s && REVENUE_RANGES.find((r) => r.test(s))) || UNKNOWN_RANGE;
}

// A booking counts for a session when it lands between an hour before the
// webinar starts and two days after, which covers the live booking push and
// the follow-up emails without crediting a later webinar's bookings.
const BOOKING_WINDOW = { beforeMs: 60 * 60 * 1000, afterMs: 2 * 24 * 60 * 60 * 1000 };

// The live attendance curve: how many attendees were in the room at each
// minute, rebuilt from when each one joined and how long they stayed.
function attendanceCurve(attendees) {
  const spans = attendees
    .filter((a) => a.watchedLiveSec > 0)
    .map((a) => [a.enteredLiveSec / 60, (a.enteredLiveSec + a.watchedLiveSec) / 60]);
  if (!spans.length) return [];
  const last = Math.min(240, Math.ceil(Math.max(...spans.map(([, end]) => end))));
  const curve = [];
  for (let m = 0; m <= last; m += 1) curve.push(spans.filter(([start, end]) => start <= m && end > m).length);
  return curve;
}

function curveMoments(curve) {
  if (!curve.length) return null;
  const peak = Math.max(...curve);
  const peakMinute = curve.indexOf(peak);
  // The ten minutes after the peak that lost the most people, ignoring the
  // last 15 minutes (everyone leaving at the end isn't a drop-off), and the
  // first minute after the peak with under three-quarters of the peak there.
  let bigDrop = { from: null, to: null, lost: 0 };
  for (let m = peakMinute; m + 10 <= curve.length - 1 - 15; m += 1) {
    const lost = curve[m] - curve[m + 10];
    if (lost > bigDrop.lost) bigDrop = { from: m, to: m + 10, lost };
  }
  const fallsBelow = curve.findIndex((c, m) => m > peakMinute && c < peak * 0.75);
  const endMinute = curve.length - 1;
  return {
    peak,
    peakMinute,
    bigDrop: bigDrop.lost > 0 ? bigDrop : null,
    below75Minute: fallsBelow === -1 ? null : fallsBelow,
    lengthMinutes: endMinute,
    // Still in the room 10 minutes before the last attendee left.
    nearEnd: curve[Math.max(0, endMinute - 10)],
  };
}

function rate(n, d) {
  return d ? n / d : null;
}

// Per-webinar-session performance: show rate, attendance curve, and who
// booked by revenue range, with the team's Slack post and notes alongside.
function buildWebinarStats(registrations, bookings, { slackPosts = {}, notes = {}, now = new Date(), timeZone = 'America/New_York' } = {}) {
  const sessions = new Map();
  for (const r of registrations) {
    if (!r.webinarDate) continue;
    if (!sessions.has(r.webinarDate)) sessions.set(r.webinarDate, new Map());
    const byEmail = sessions.get(r.webinarDate);
    // Someone registered twice for one session counts once; keep the record
    // that shows them attending.
    const prev = byEmail.get(r.email);
    if (!prev || (!prev.attendedLive && r.attendedLive)) byEmail.set(r.email, r);
  }

  const bookingsByEmail = new Map();
  for (const b of bookings) {
    if (!bookingsByEmail.has(b.email)) bookingsByEmail.set(b.email, []);
    bookingsByEmail.get(b.email).push(new Date(b.bookedAt).getTime());
  }

  const out = [];
  for (const [webinarDate, byEmail] of sessions) {
    const start = new Date(webinarDate).getTime();
    const day = DateTime.fromISO(webinarDate).setZone(timeZone).toISODate();
    const people = [...byEmail.values()];
    const happened = start <= now.getTime();
    const bookedInWindow = (email) =>
      (bookingsByEmail.get(email) || []).some((t) => t >= start - BOOKING_WINDOW.beforeMs && t <= start + BOOKING_WINDOW.afterMs);

    const attendees = people.filter((p) => p.attendedLive);
    const rows = [...REVENUE_RANGES, UNKNOWN_RANGE].map((range) => {
      const reg = people.filter((p) => revenueRange(p.revenueLevel).key === range.key);
      const att = reg.filter((p) => p.attendedLive);
      const booked = att.filter((p) => bookedInWindow(p.email)).length;
      return {
        key: range.key,
        label: range.label,
        min25k: Boolean(range.min25k),
        registered: reg.length,
        attended: att.length,
        showRate: rate(att.length, reg.length),
        booked,
        bookedNotLive: reg.filter((p) => !p.attendedLive && bookedInWindow(p.email)).length,
        bookRate: rate(booked, att.length),
      };
    }).filter((r) => r.registered > 0 || r.key !== 'unknown');

    const sum = (list, field) => list.reduce((s, r) => s + r[field], 0);
    const hi = rows.filter((r) => r.min25k);
    const lo = rows.filter((r) => !r.min25k);
    const booked = sum(rows, 'booked');
    const goalRows = hi.filter((r) => r.attended > 0);
    const curve = happened ? attendanceCurve(attendees) : [];
    // Minute after the start when each live attendee first booked, if they
    // booked while the webinar was still running (marks on the curve).
    const bookingMinutes = attendees
      .map((p) => (bookingsByEmail.get(p.email) || []).map((t) => (t - start) / 60000).filter((m) => m >= 0 && m <= curve.length + 15))
      .filter((times) => times.length)
      .map((times) => Math.round(Math.min(...times)))
      .sort((a, b) => a - b);

    out.push({
      date: day,
      webinarDate,
      name: people[0].webinarName,
      happened,
      registered: people.length,
      attended: attendees.length,
      showRate: happened ? rate(attendees.length, people.length) : null,
      booked,
      bookedNotLive: sum(rows, 'bookedNotLive'),
      bookRate: rate(booked, attendees.length),
      attended25k: sum(hi, 'attended'),
      booked25k: sum(hi, 'booked'),
      bookRate25k: rate(sum(hi, 'booked'), sum(hi, 'attended')),
      attendedUnder25k: sum(lo, 'attended'),
      bookedUnder25k: sum(lo, 'booked'),
      bookRateUnder25k: rate(sum(lo, 'booked'), sum(lo, 'attended')),
      // The goal: over 20% of live attendees in every $25K+ range book a call.
      goal: { met: goalRows.filter((r) => r.bookRate >= 0.2).length, of: goalRows.length },
      avgMinutesWatched: attendees.length
        ? Math.round(attendees.reduce((s, a) => s + a.watchedLiveSec, 0) / attendees.length / 60)
        : null,
      curve,
      bookingMinutes,
      moments: curveMoments(curve),
      ranges: rows,
      // Everyone who registered for this session, with the ad that brought
      // them to it (the page joins these to the lead list by email).
      registrants: people.map((p) => ({
        email: p.email,
        registeredAt: p.registeredAt,
        attendedLive: p.attendedLive,
        minutesWatched: p.attendedLive ? Math.round(p.watchedLiveSec / 60) : 0,
        bookedForThis: bookedInWindow(p.email),
        utm: Object.fromEntries(Object.entries(p.utm || {}).filter(([, v]) => v)),
      })),
      slack: slackPosts[day] || null,
      notes: notes[day] || null,
    });
  }
  return out.sort((a, b) => b.webinarDate.localeCompare(a.webinarDate));
}

// The "Collective Webinar - Post Webinar Stats" form Joelle fills in after
// each webinar posts to #collective-webinars as:
//   *How many attended (in total)?* 36  *How many attended (max at one time)* 31
//   *What was the show up rate?* 19.05%  *How many booked a call? ...* 15 - 48% (7 at 25k+ - 22.5%)
function parsePostWebinarStats(text) {
  if (!/How many attended \(in total\)/i.test(text)) return null;
  const answer = (question) => {
    const m = text.match(new RegExp(`${question}[^*]*\\*\\s*\\n?([^*]+)`, 'i'));
    return m ? m[1].trim() : null;
  };
  const num = (s) => (s && s.match(/[\d.]+/) ? Number(s.match(/[\d.]+/)[0]) : null);
  const total = answer('How many attended \\(in total\\)\\?');
  const max = answer('How many attended \\(max at one time\\)');
  const show = answer('What was the show up rate\\?');
  const booked = answer('How many booked a call\\?');
  return {
    attendedTotal: num(total),
    maxAtOnce: num(max),
    showRate: show && num(show) !== null ? num(show) / 100 : null,
    bookedText: booked ? booked.replace(/\s+/g, ' ') : null,
  };
}

module.exports = { REVENUE_RANGES, revenueRange, attendanceCurve, curveMoments, buildWebinarStats, parsePostWebinarStats };
