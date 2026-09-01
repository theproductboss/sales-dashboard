// Generates the Closer Dashboard HTML from live FGFunnels (LeadConnector) data.
//
// Usage:
//   FGF_API_TOKEN=pit-... FGF_LOCATION_ID=... node closer-dashboard/generate.mjs
//
// Optional env:
//   PERIOD=2026-08          calendar month to report (default: current month, MTD)
//   REPORT_TIMEZONE=America/New_York
//   OUT=closer-dashboard/index.html
//
// Behind the Claude Code remote proxy, also set:
//   NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt
//
// Missing API scopes degrade gracefully: the affected tiles render an
// "needs scope" note instead of fake numbers.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOKEN = process.env.FGF_API_TOKEN || process.env.FGF_TOKEN;
const LOC = process.env.FGF_LOCATION_ID || process.env.FGF_LOCATION;
if (!TOKEN || !LOC) {
  console.error('Set FGF_API_TOKEN and FGF_LOCATION_ID');
  process.exit(1);
}
const TZ = process.env.REPORT_TIMEZONE || 'America/New_York';
const BASE = 'https://services.leadconnectorhq.com';
const HEADERS = { Authorization: `Bearer ${TOKEN}`, Version: '2021-07-28', Accept: 'application/json' };

// ---------- period ----------
function tzOffsetString(date, tz) {
  // Returns e.g. "-04:00" for the given instant in tz.
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' });
  const part = dtf.formatToParts(date).find(p => p.type === 'timeZoneName').value; // "GMT-04:00"
  return part.replace('GMT', '') || '+00:00';
}
function monthRange(period, tz) {
  // period: "YYYY-MM"; returns { startMs, endMs, label }
  const [y, m] = period.split('-').map(Number);
  const approxStart = new Date(Date.UTC(y, m - 1, 1, 12));
  const approxEnd = new Date(Date.UTC(m === 12 ? y + 1 : y, m % 12, 1, 12));
  const startMs = Date.parse(`${period}-01T00:00:00${tzOffsetString(approxStart, tz)}`);
  const endPeriod = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  const endMs = Date.parse(`${endPeriod}-01T00:00:00${tzOffsetString(approxEnd, tz)}`);
  const monthName = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 15)));
  return { startMs, endMs, label: `${monthName} ${y}` };
}
const now = new Date();
const nowParts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit' }).format(now); // "2026-09"
const period = process.env.PERIOD || nowParts;
const { startMs, endMs: monthEndMs, label: periodLabel } = monthRange(period, TZ);
const endMs = Math.min(monthEndMs, Date.now());
// cash is always the *current* calendar month, per team definition
const cashRange = monthRange(nowParts, TZ);

// previous month, for the revenue delta
const [py, pm] = period.split('-').map(Number);
const prevPeriod = pm === 1 ? `${py - 1}-12` : `${py}-${String(pm - 1).padStart(2, '0')}`;
const prev = monthRange(prevPeriod, TZ);

// ---------- fetch helpers ----------
const missingScopes = [];
async function get(pathname, scopeLabel) {
  const r = await fetch(BASE + pathname, { headers: HEADERS });
  if (r.status === 401) {
    if (scopeLabel && !missingScopes.includes(scopeLabel)) missingScopes.push(scopeLabel);
    return null;
  }
  if (!r.ok) {
    console.error(`GET ${pathname} -> ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return null;
  }
  return r.json();
}

// ---------- appointments ----------
const calsResp = await get(`/calendars/?locationId=${LOC}`, 'Calendars (read)');
const calendars = (calsResp?.calendars || []).map(c => ({ id: c.id, name: c.name }));

let events = null; // null = scope missing
if (calendars.length) {
  for (const c of calendars) {
    const ev = await get(`/calendars/events?locationId=${LOC}&calendarId=${c.id}&startTime=${startMs}&endTime=${monthEndMs}`, 'Calendar Events (read)');
    if (ev === null) { events = null; break; }
    events = events || [];
    for (const e of ev.events || []) {
      events.push({ cal: c.name, status: e.appointmentStatus, start: Date.parse(e.startTime), assigned: e.assignedUserId });
    }
  }
}

// ---------- opportunities ----------
let opps = [];
let oppsOk = true;
for (let page = 1; page <= 50; page++) {
  const o = await get(`/opportunities/search?location_id=${LOC}&limit=100&page=${page}`, 'Opportunities (read)');
  if (o === null) { oppsOk = false; break; }
  const batch = o.opportunities || [];
  opps.push(...batch);
  if (batch.length < 100) break;
}

// ---------- users (for closer names) ----------
const usersResp = await get(`/users/?locationId=${LOC}`, 'Users (read)');
const userName = {};
for (const u of usersResp?.users || []) userName[u.id] = u.name || [u.firstName, u.lastName].filter(Boolean).join(' ');

// ---------- payments ----------
let cash = null;
const tx = await get(`/payments/transactions?altId=${LOC}&altType=location&limit=100&startAt=${new Date(cashRange.startMs).toISOString()}&endAt=${new Date(Math.min(cashRange.endMs, Date.now())).toISOString()}`, 'Payments (read)');
if (tx) {
  cash = 0;
  for (const t of tx.data || tx.transactions || []) {
    const ok = !t.status || ['succeeded', 'success', 'paid', 'completed'].includes(String(t.status).toLowerCase());
    if (ok) cash += Number(t.amount) || 0;
  }
}

// ---------- metrics ----------
const inWindow = (ms, a, b) => ms >= a && ms < b;
const statusOf = s => (s || '').toLowerCase();

let appt = null;
if (events) {
  const valid = events.filter(e => statusOf(e.status) !== 'invalid');
  const count = st => valid.filter(e => statusOf(e.status) === st).length;
  const booked = valid.length;
  const cancelled = count('cancelled');
  const noshow = count('noshow') + count('no-show');
  const showed = count('showed');
  const confirmed = count('confirmed') + showed + noshow; // confirmed-then-resolved calls were confirmed too
  const dueToRun = booked - cancelled;
  appt = { booked, confirmed, cancelled, noshow, showed, dueToRun };
}

const oppTime = o => Date.parse(o.lastStatusChangeAt || o.updatedAt || o.createdAt);
const wonInPeriod = opps.filter(o => o.status === 'won' && inWindow(oppTime(o), startMs, monthEndMs));
const wonPrev = opps.filter(o => o.status === 'won' && inWindow(oppTime(o), prev.startMs, prev.endMs));
const revenue = wonInPeriod.reduce((s, o) => s + (Number(o.monetaryValue) || 0), 0);
const revenuePrev = wonPrev.reduce((s, o) => s + (Number(o.monetaryValue) || 0), 0);
const deals = wonInPeriod.length;
const zeroValueDeals = wonInPeriod.filter(o => !Number(o.monetaryValue)).length;

// per-closer: held calls by assigned user + won opps by assigned user
const closers = {};
const bump = (id, key, n = 1) => {
  const k = id || 'unassigned';
  closers[k] = closers[k] || { held: 0, noshow: 0, closes: 0, value: 0 };
  closers[k][key] += n;
};
if (events) for (const e of events) {
  const st = statusOf(e.status);
  if (st === 'showed') bump(e.assigned, 'held');
  if (st === 'noshow' || st === 'no-show') bump(e.assigned, 'noshow');
}
for (const o of wonInPeriod) { bump(o.assignedTo, 'closes'); bump(o.assignedTo, 'value', Number(o.monetaryValue) || 0); }

// ---------- formatting ----------
const fmtMoney = n => '$' + Math.round(n).toLocaleString('en-US');
const fmtPct = n => (Math.round(n * 10) / 10).toLocaleString('en-US') + '%';
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const generatedAt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' }).format(new Date());

function rateTile(label, pct, note, targetNote, good) {
  if (pct === null) return scopeTile(label, 'Calendar Events (read)');
  const chip = good === null ? '' : `<span class="chip ${good ? 'ok' : 'warn'}">${good ? '●' : '▲'} ${targetNote}</span>`;
  return `<div class="tile"><div class="label">${label}</div><div class="value">${fmtPct(pct)}</div>
  <div class="meter"><i style="width:${Math.min(100, Math.max(0, pct))}%"></i></div>${chip}<div class="note">${note}</div></div>`;
}
function countTile(label, value, note) {
  return `<div class="tile"><div class="label">${label}</div><div class="value">${value}</div><div class="note">${note}</div></div>`;
}
function scopeTile(label, scope) {
  return `<div class="tile"><div class="label">${label}</div><div class="value" style="color:var(--ink-muted)">—</div><div class="note">needs API scope: ${scope}</div></div>`;
}

let apptRow, ratesRow, funnelPanel, closerRows;
if (appt) {
  const { booked, confirmed, cancelled, noshow, showed, dueToRun } = appt;
  const pct = (a, b) => (b > 0 ? (a / b) * 100 : 0);
  apptRow = [
    countTile('Booked', booked, 'all statuses, in period'),
    countTile('Confirmed', confirmed, `${Math.round(pct(confirmed, booked))}% of booked`),
    countTile('Cancelled', cancelled, `${Math.round(pct(cancelled, booked))}% of booked`),
    countTile('No-shows', noshow, `of ${dueToRun} due to run`),
  ].join('\n');
  const showRate = pct(showed, dueToRun), noshowRate = pct(noshow, dueToRun),
    cancelRate = pct(cancelled, booked), closeRate = pct(deals, showed || 1);
  ratesRow = [
    rateTile('Show-up rate', showRate, `${showed} showed of ${dueToRun} due to run`, showRate >= 75 ? 'above 75% target' : 'below 75% target', showRate >= 75),
    rateTile('No-show rate', noshowRate, `${noshow} no-shows of ${dueToRun} due to run`, noshowRate <= 15 ? 'within 15% target' : 'above 15% target', noshowRate <= 15),
    rateTile('Cancellation rate', cancelRate, `${cancelled} cancelled of ${booked} booked`, cancelRate <= 10 ? 'within 10% target' : 'above 10% target', cancelRate <= 10),
    rateTile('Closer close rate', showed ? closeRate : null, `${deals} closed of ${showed} held calls`, closeRate >= 30 ? 'above 30% target' : 'below 30% target', closeRate >= 30),
  ].join('\n');
  const stages = [
    ['Booked', booked, 'var(--funnel-1)'], ['Confirmed', confirmed, 'var(--funnel-2)'],
    ['Showed', showed, 'var(--funnel-3)'], ['Closed won', deals, 'var(--funnel-4)'],
  ];
  funnelPanel = stages.map(([name, n, color]) => {
    const p = booked ? (n / booked) * 100 : 0;
    return `<div class="funnel-stage"><div class="fs-head"><span class="name">${name}</span><span class="nums"><b>${n}</b> · ${Math.round(p)}%</span></div>
    <div class="fs-bar"><i style="width:${Math.max(1, p)}%; background:${color};"></i></div></div>`;
  }).join('\n');
} else {
  apptRow = ['Booked', 'Confirmed', 'Cancelled', 'No-shows'].map(l => scopeTile(l, 'Calendar Events (read)')).join('\n');
  ratesRow = ['Show-up rate', 'No-show rate', 'Cancellation rate', 'Closer close rate'].map(l => scopeTile(l, 'Calendar Events (read)')).join('\n');
  funnelPanel = `<p class="sub">Add the <b>Calendar Events (read)</b> scope to the private integration to populate the funnel.</p>`;
}

const closerIds = Object.keys(closers).filter(k => closers[k].held || closers[k].closes);
closerRows = closerIds.map(id => {
  const c = closers[id];
  const name = userName[id] || (id === 'unassigned' ? 'Unassigned' : `User ${id.slice(0, 6)}…`);
  const cr = c.held ? (c.closes / c.held) * 100 : 0;
  return `<tr><td><span class="closer">${esc(name)}</span></td><td>${c.held}</td><td>${c.noshow}</td><td>${c.closes}</td><td>${c.held ? fmtPct(cr) : '—'}</td><td>${fmtMoney(c.value)}</td></tr>`;
}).join('\n') || `<tr><td colspan="6" style="text-align:left;color:var(--ink-muted)">No held calls or closed deals attributed to closers in this period.</td></tr>`;
const teamHeld = Object.values(closers).reduce((s, c) => s + c.held, 0);
const teamNoshow = Object.values(closers).reduce((s, c) => s + c.noshow, 0);
const teamCloseRate = teamHeld ? (deals / teamHeld) * 100 : 0;

const delta = revenuePrev > 0 ? ((revenue - revenuePrev) / revenuePrev) * 100 : null;
const deltaHtml = delta === null ? '' :
  `<div class="delta ${delta >= 0 ? 'up' : 'down'}">${delta >= 0 ? '▲' : '▼'} ${fmtPct(Math.abs(delta))} <span class="vs">vs. ${prevPeriod}</span></div>`;

const cashHtml = cash === null
  ? `<div class="co-value" style="color:var(--ink-muted)">—</div><div class="hero-sub">needs API scope: Payments (read)</div>`
  : `<div class="co-value">${fmtMoney(cash)}</div><div class="hero-sub">payments actually received this month</div>`;

const warnings = [];
if (zeroValueDeals) warnings.push(`${zeroValueDeals} of ${deals} won opportunit${deals === 1 ? 'y' : 'ies'} in this period ha${zeroValueDeals === 1 ? 's' : 've'} no monetary value set — revenue is understated. Enter the full contracted amount on each opportunity at close.`);
if (missingScopes.length) warnings.push(`Missing API scopes on the private integration: ${missingScopes.join(', ')}. Edit the integration in FGFunnels Settings → Private Integrations and re-run.`);
const warningsHtml = warnings.length
  ? `<div class="callout" style="border-left-color:#ec835a">${warnings.map(w => `<p style="margin:4px 0">⚠ ${w}</p>`).join('')}</div>`
  : '';

// ---------- render ----------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const template = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf8');
const html = template
  .replaceAll('{{PERIOD_LABEL}}', esc(periodLabel))
  .replaceAll('{{GENERATED_AT}}', esc(`${generatedAt} (${TZ})`))
  .replaceAll('{{REVENUE}}', fmtMoney(revenue))
  .replaceAll('{{REVENUE_DELTA}}', deltaHtml)
  .replaceAll('{{CASH_BLOCK}}', cashHtml)
  .replaceAll('{{CASH_MONTH}}', esc(cashRange.label))
  .replaceAll('{{DEALS}}', String(deals))
  .replaceAll('{{DEALS_NOTE}}', appt ? `from ${appt.showed} held calls` : 'held calls need events scope')
  .replaceAll('{{AVG_DEAL}}', deals ? fmtMoney(revenue / deals) : '—')
  .replaceAll('{{APPT_ROW}}', apptRow)
  .replaceAll('{{RATES_ROW}}', ratesRow)
  .replaceAll('{{FUNNEL}}', funnelPanel)
  .replaceAll('{{CLOSER_ROWS}}', closerRows)
  .replaceAll('{{TEAM_HELD}}', String(teamHeld))
  .replaceAll('{{TEAM_NOSHOW}}', String(teamNoshow))
  .replaceAll('{{TEAM_CLOSES}}', String(deals))
  .replaceAll('{{TEAM_CLOSE_RATE}}', teamHeld ? fmtPct(teamCloseRate) : '—')
  .replaceAll('{{TEAM_VALUE}}', fmtMoney(revenue))
  .replaceAll('{{WARNINGS}}', warningsHtml);

const out = process.env.OUT || path.join(__dirname, 'index.html');
fs.writeFileSync(out, html);
console.log(`Wrote ${out}`);
console.log(JSON.stringify({ period, revenue, deals, cash, appt, missingScopes }, null, 1));
