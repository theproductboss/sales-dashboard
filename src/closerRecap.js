require('dotenv').config();

const fs = require('fs');
const { DateTime } = require('luxon');

const { requireEnv } = require('./config');
const { getAccessToken, listTabs, fetchGrids, loadCredentials } = require('./closer/sheets');
const { parseTrackerTab } = require('./closer/parseTracker');
const { buildCloserMetrics, rollUp } = require('./closer/metrics');
const { buildRecap } = require('./closer/formatRecap');
const { postMessage } = require('./slack');

const TIME_ZONE = process.env.REPORT_TIMEZONE || 'America/New_York';
const DRY_RUN = String(process.env.DRY_RUN).toLowerCase() === 'true';

const kpis = {
  show: Number(process.env.SHOW_RATE_KPI || 0.7),
  offer: Number(process.env.OFFER_RATE_KPI || 0.9),
  // No close-rate KPI is stated anywhere in the tracker, so by default the
  // close rate is reported without a ✅/🔴 flag. Set CLOSE_RATE_KPI (e.g.
  // 0.25) once there's an agreed number and it starts getting flagged.
  close: process.env.CLOSE_RATE_KPI ? Number(process.env.CLOSE_RATE_KPI) : null,
};

// "wrap" = the fuller end-of-week writeup (week-over-week deltas + month by
// closer). "pulse" = the shorter mid-week check-in. Defaults to a wrap on
// Friday and a pulse any other day; RECAP_MODE forces one.
function resolveMode(now) {
  const forced = (process.env.RECAP_MODE || '').toLowerCase();
  if (forced === 'wrap' || forced === 'pulse') return forced;
  return now.weekday === 5 ? 'wrap' : 'pulse';
}

// Tabs worth reading: a closer tab is one that parses, names a closer, and
// is tracking the month we're reporting on. That last check is what keeps
// last October's and next November's leftover tabs out of the numbers when
// a fresh tracker gets built each month.
function selectTrackers(grids, { month, year }) {
  const only = (process.env.CLOSER_TABS || '')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  const skip = (process.env.CLOSER_TABS_EXCLUDE || '')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);

  const trackers = [];
  for (const [title, grid] of Object.entries(grids)) {
    if (only.length && !only.includes(title.toLowerCase())) continue;
    if (skip.includes(title.toLowerCase())) continue;

    let tracker;
    try {
      tracker = parseTrackerTab(grid, { year });
    } catch (err) {
      console.error(`Skipping tab "${title}": ${err.message}`);
      continue;
    }

    if (!tracker || !tracker.weeks.length) continue;
    if (!only.length && tracker.month !== month) continue;
    // A tab with no name in the summary row and no name in its week titles
    // is a template, not a person.
    if (!tracker.name || /^\[?name\]?$/i.test(tracker.name)) continue;

    trackers.push({ title, ...tracker });
  }

  // Busiest closer first — the ones with calls this month lead the recap.
  return trackers.sort((a, b) => {
    const count = (tracker) => tracker.weeks.reduce((total, week) => total + week.calls.length, 0);
    return count(b) - count(a);
  });
}

async function loadGrids() {
  // FIXTURE_GRIDS points at a JSON file of {tabName: grid} and skips Google
  // entirely — used by `npm run closer-recap:sample` and the test script.
  if (process.env.FIXTURE_GRIDS) {
    return JSON.parse(fs.readFileSync(process.env.FIXTURE_GRIDS, 'utf8'));
  }

  const credentials = loadCredentials(requireEnv('GOOGLE_SERVICE_ACCOUNT_JSON'));
  const spreadsheetId = requireEnv('CLOSER_TRACKER_SHEET_ID');
  const token = await getAccessToken(credentials);
  const tabs = await listTabs(token, spreadsheetId);
  return fetchGrids(token, spreadsheetId, tabs.map((tab) => tab.title));
}

async function main() {
  const now = DateTime.now().setZone(TIME_ZONE);
  const mode = resolveMode(now);

  const grids = await loadGrids();
  const trackers = selectTrackers(grids, { month: now.month, year: now.year });

  if (!trackers.length) {
    throw new Error(
      `No closer tabs found for ${now.toFormat('LLLL yyyy')}. If this month's tracker uses a different ` +
        'month label in its "<MONTH> OVERALL" row, set CLOSER_TABS to the tab names to read.'
    );
  }

  const asOf = now.toJSDate();
  const closers = trackers.map((tracker) => buildCloserMetrics(tracker, asOf));
  const currentWeek = closers.find((closer) => closer.week);

  const recap = buildRecap({
    closers,
    team: rollUp(closers, (closer) => closer.week),
    teamMonth: rollUp(closers, (closer) => closer.monthToDate),
    asOf: now,
    mode,
    kpis,
    monthLabel: now.toFormat('LLLL'),
    weekLabel: currentWeek ? currentWeek.week.label : now.toFormat('LLL d'),
    sheetUrl: process.env.CLOSER_TRACKER_URL || null,
  });

  if (DRY_RUN) {
    console.log(recap.plain);
    return;
  }

  const channel = requireEnv('CLOSER_RECAP_CHANNEL_ID');
  await postMessage(requireEnv('SLACK_BOT_TOKEN'), channel, recap.text, recap.blocks);
  console.log(`Closer ${mode} posted for ${trackers.length} closer(s).`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
