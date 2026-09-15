const test = require('node:test');
const assert = require('node:assert');

const { convert } = require('../scripts/driveExportToGrids');
const { parseTrackerTab } = require('../src/closer/parseTracker');
const { buildCloserMetrics } = require('../src/closer/metrics');

// A miniature stand-in for what the Google Drive connector returns: merged
// cell ranges repeated across columns, escaped punctuation, and an
// alignment row separating each tab's table.
const EXPORT = [
  '|  |  |  |  |  |  |  |',
  '| :-: | :-: | :-: | :-: | :-: | :-: | :-: |',
  '| SEPTEMBER OVERALL | Dana |  | WEEK 1 |  | WEEK 2 |  |',
  '| Total Scheduled  | 3.00 |  | Total Scheduled  | 3.00 | Total Scheduled  | 0.00 |',
  '| Show % (KPI: 70%) | 33.33% |  | Show % (KPI: 70%) | \\#DIV/0\\! |  |  |',
  '| \\[merged\\] WEEK 1 (9/01-9/06) | \\[merged\\] WEEK 1 (9/01-9/06) | \\[merged\\] WEEK 1 (9/01-9/06) |  |  |  |  |',
  '| Confirmed Appt? | LEAD NAME | DATE OF CALL | OFFER MADE? | NO SHOW? | Sales Status | CASH COLLECTED TODAY |',
  '|  | Rae Miller | 9/2/2026 | YES | NO | WIN | $5,000.00 |',
  '|  | Jo Park |  | NO | YES | LOST |  |',
  '|  | Sam Ng | 9/3/2026 | YES | NO | NURTURING |  |',
].join('\n');

test('unwraps the connector JSON envelope', () => {
  const wrapped = JSON.stringify({ fileContent: EXPORT });
  assert.deepStrictEqual(Object.keys(convert(wrapped)), ['Dana']);
});

test('names each tab from the closer in its OVERALL row', () => {
  const grids = convert(EXPORT);
  assert.deepStrictEqual(Object.keys(grids), ['Dana']);
});

test('collapses merged ranges to one cell so columns stay aligned', () => {
  const grid = convert(EXPORT).Dana;
  const weekRow = grid.find((row) => row[0].includes('WEEK 1 (9/01'));
  assert.strictEqual(weekRow[0], 'WEEK 1 (9/01-9/06)');
  assert.strictEqual(weekRow[1], ''); // continuation of the merge, not a repeat
  assert.strictEqual(weekRow[2], '');
});

test('strips markdown escaping from cell values', () => {
  const grid = convert(EXPORT).Dana;
  const showRow = grid.find((row) => row[0].startsWith('Show %'));
  assert.strictEqual(showRow[3], 'Show % (KPI: 70%)');
  assert.strictEqual(showRow[4], '#DIV/0!');
});

test('converted output feeds the normal parser and metrics unchanged', () => {
  const tracker = parseTrackerTab(convert(EXPORT).Dana, { year: 2026 });
  assert.strictEqual(tracker.name, 'Dana');
  assert.strictEqual(tracker.month, 9);

  const week = buildCloserMetrics(tracker, new Date(2026, 8, 3, 12, 0)).week;
  assert.strictEqual(week.booked, 3);
  assert.strictEqual(week.held, 2);
  assert.strictEqual(week.noShows, 1);
  assert.strictEqual(week.wins, 1);
  assert.strictEqual(week.cash, 5000);
  // The tab's own cell claims 33.33%; two of three booked calls were held.
  assert.strictEqual(Math.round(week.showRate * 1000) / 10, 66.7);
});
