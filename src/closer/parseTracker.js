// Parses a closer's tracker tab out of the raw cell grid returned by the
// Sheets API.
//
// Why parse the raw call rows instead of reading the tab's own summary
// block: the summary formulas on this tracker are wrong. "Completed Calls"
// counts rows where CALL TYPE is filled in — a column reps only reliably
// fill on a win — so show rate collapses to the win rate, offer % comes out
// above 100%, and "Total No-Shows" only counts rows where Sales Status was
// literally typed as "NO-SHOW" rather than reading the NO SHOW? column.
// Everything below is derived from the per-call rows, which are the source
// of truth reps actually fill in.

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

// Header text -> the field we store it as. Matched as a case-insensitive
// "header contains this" so wording tweaks in the sheet don't break it.
const COLUMN_MATCHERS = [
  ['confirmed', 'confirmed'],
  ['lead name', 'lead'],
  ['date of call', 'date'],
  ['offer made', 'offer'],
  ['no show', 'noShow'],
  ['lead cxl', 'leadCxl'],
  ['sales status', 'status'],
  ['deposit', 'deposit'],
  ['revenue', 'revenue'],
  ['cash collected', 'cash'],
  ['call type', 'callType'],
];

const WEEK_BLOCK = /week\s*(\d+)\s*\(([^)]*)\)/i;

function norm(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function upper(value) {
  return norm(value).toUpperCase();
}

function parseMoney(value) {
  const cleaned = norm(value).replace(/[$,]/g, '');
  if (!cleaned) return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

// "9/14-9/20" / "11/1" / "9/01-9/06" -> {start, end} as {month, day}.
// The tracker writes ranges without a year; the caller supplies it.
function parseWeekRange(label, year) {
  const dates = norm(label).match(/(\d{1,2})\s*\/\s*(\d{1,2})/g) || [];
  if (!dates.length) return null;
  const toDate = (token, endOfDay) => {
    const [m, d] = token.split('/').map((part) => Number(part.trim()));
    return new Date(year, m - 1, d, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0);
  };
  const start = toDate(dates[0], false);
  const end = toDate(dates[dates.length - 1], true);
  return { start, end };
}

// The month a tab is tracking, read off its "<MONTH> OVERALL" summary row,
// plus the closer's name (column B of that same row).
function readTabHeader(grid) {
  for (const row of grid.slice(0, 40)) {
    const first = upper(row[0] || '');
    if (!first.endsWith('OVERALL')) continue;
    const monthWord = first.replace(/\s*OVERALL$/, '').toLowerCase();
    const monthIndex = MONTHS.indexOf(monthWord);
    if (monthIndex === -1) continue;
    return { month: monthIndex + 1, monthLabel: MONTHS[monthIndex], name: norm(row[1] || '') };
  }
  return null;
}

// Some tabs leave the name cell blank and instead title each week block
// "ALIYA - WEEK 1 (11/1)". Fall back to that.
function nameFromWeekBlocks(grid) {
  for (const row of grid) {
    for (const cell of row) {
      const text = norm(cell);
      const match = text.match(/^(.+?)\s*[-–]\s*WEEK\s*\d+/i);
      if (match) return match[1].trim();
    }
  }
  return '';
}

function findWeekBlockRow(row) {
  for (const cell of row) {
    const match = norm(cell).match(WEEK_BLOCK);
    if (match) return { week: Number(match[1]), rangeLabel: match[2].trim() };
  }
  return null;
}

function isHeaderRow(row) {
  return row.some((cell) => upper(cell).includes('LEAD NAME'));
}

function mapColumns(headerRow) {
  const columns = {};
  headerRow.forEach((cell, index) => {
    const header = norm(cell).toLowerCase();
    if (!header) return;
    for (const [needle, field] of COLUMN_MATCHERS) {
      if (columns[field] === undefined && header.includes(needle)) {
        columns[field] = index;
        return;
      }
    }
  });
  return columns;
}

function buildCall(row, columns) {
  const get = (field) => (columns[field] === undefined ? '' : norm(row[columns[field]]));
  const lead = get('lead');
  if (!lead) return null;

  const offerRaw = upper(get('offer'));
  const noShowRaw = upper(get('noShow'));
  const leadCxlRaw = upper(get('leadCxl'));
  const status = upper(get('status'));
  const date = get('date');

  // A row with a name but nothing else filled in is a call the rep hasn't
  // logged an outcome for yet — usually still upcoming. It must not drag
  // the show rate down, so it's tracked separately rather than counted as
  // a miss.
  const unlogged = !date && !offerRaw && !noShowRaw && !leadCxlRaw && !status;

  const noShow = noShowRaw === 'YES' || status === 'NO-SHOW' || status === 'NO SHOW';
  const rescheduled = status === 'RESCHEDULED' || status === 'RESCHEDULE';
  const leadCxl = leadCxlRaw === 'YES' || status === 'LEAD CXL' || status === 'CANCELLED' || status === 'CANCELED';
  const held = !unlogged && !noShow && !rescheduled && !leadCxl;

  return {
    lead,
    date,
    status,
    callType: get('callType'),
    offerMade: offerRaw === 'YES',
    offerLogged: offerRaw === 'YES' || offerRaw === 'NO',
    noShow,
    rescheduled,
    leadCxl,
    unlogged,
    held,
    win: held && (status === 'WIN' || status === 'WON' || status === 'CLOSED'),
    outcomeLogged: Boolean(status),
    revenue: parseMoney(get('revenue')),
    cash: parseMoney(get('cash')),
  };
}

// Splits a tab into its WEEK blocks and the call rows under each one.
function parseTrackerTab(grid, { year }) {
  const header = readTabHeader(grid);
  if (!header) return null;

  const name = header.name || nameFromWeekBlocks(grid);
  const weeks = [];
  let current = null;

  for (let i = 0; i < grid.length; i += 1) {
    const row = grid[i] || [];
    const block = findWeekBlockRow(row);

    if (block) {
      current = {
        week: block.week,
        rangeLabel: block.rangeLabel,
        range: parseWeekRange(block.rangeLabel, year),
        columns: null,
        calls: [],
      };
      weeks.push(current);
      continue;
    }

    if (!current) continue;

    if (isHeaderRow(row)) {
      current.columns = mapColumns(row);
      continue;
    }

    if (!current.columns) continue;

    const call = buildCall(row, current.columns);
    if (call) current.calls.push(call);
  }

  return {
    name,
    month: header.month,
    monthLabel: header.monthLabel,
    weeks: weeks.filter((week) => week.columns),
  };
}

module.exports = { parseTrackerTab, parseWeekRange, parseMoney, readTabHeader };
