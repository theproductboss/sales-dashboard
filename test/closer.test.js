const test = require('node:test');
const assert = require('node:assert');

const { parseTrackerTab } = require('../src/closer/parseTracker');
const { buildCloserMetrics, rollUp } = require('../src/closer/metrics');
const { buildRecap } = require('../src/closer/formatRecap');

const grids = require('./fixtures/september-tracker.json');

// Jill's real September tracker, audited by hand from the call rows. These
// are the numbers the sheet's own formulas get wrong — the assertions below
// are what stops a parser change from quietly reintroducing that.
const jill = parseTrackerTab(grids.Jill, { year: 2026 });
const asOf = new Date(2026, 8, 15, 17, 0); // Tue Sep 15, mid-week 3
const metrics = buildCloserMetrics(jill, asOf);
const byWeek = Object.fromEntries(metrics.weeks.map((week) => [week.number, week]));

test('reads the closer name and month off the summary row', () => {
  assert.strictEqual(jill.name, 'Jill');
  assert.strictEqual(jill.month, 9);
  assert.strictEqual(jill.weeks.length, 5);
});

test('week 1: 17 booked, 8 no-shows, 53% show (sheet claims 0 no-shows / 11.76%)', () => {
  const week = byWeek[1];
  assert.strictEqual(week.booked, 17);
  assert.strictEqual(week.noShows, 8);
  assert.strictEqual(week.held, 9);
  assert.strictEqual(week.offers, 7);
  assert.strictEqual(week.wins, 2);
  assert.strictEqual(week.cash, 19600);
  assert.strictEqual(Math.round(week.showRate * 1000) / 10, 52.9);
  // The sheet reports 350% here because it divides offers by wins.
  assert.strictEqual(Math.round(week.offerRate * 1000) / 10, 77.8);
});

test('week 2: reschedules leave the show-rate denominator', () => {
  const week = byWeek[2];
  assert.strictEqual(week.booked, 16);
  assert.strictEqual(week.rescheduled, 2); // Lauryn Whitman, Anita Schiller
  assert.strictEqual(week.unlogged, 1); // Bailey — name only, nothing filled in
  assert.strictEqual(week.expected, 13);
  assert.strictEqual(week.held, 10);
  assert.strictEqual(week.noShows, 3);
  assert.strictEqual(Math.round(week.showRate * 1000) / 10, 76.9);
  assert.strictEqual(week.offerRate, 1);
  assert.strictEqual(week.wins, 3);
  assert.strictEqual(week.cash, 19300);
});

test('week 3 in progress: unlogged rows are excluded, not counted as misses', () => {
  const week = byWeek[3];
  assert.strictEqual(week.booked, 7);
  assert.deepStrictEqual(week.gaps.unloggedLeads, ['Kelly', 'Shakila']);
  assert.strictEqual(week.expected, 5);
  assert.strictEqual(week.held, 4);
  assert.strictEqual(week.showRate, 0.8);
  // Nobody logged OFFER MADE? on these four — that's a gap, not a zero.
  assert.deepStrictEqual(week.gaps.heldWithoutOffer, ['Amy', 'Sarah', 'Faith', 'Anita']);
  assert.strictEqual(week.offerRate, null);
});

test('month to date reconciles with the totals the sheet does get right', () => {
  const mtd = metrics.monthToDate;
  assert.strictEqual(mtd.offers, 17); // sheet: Total Offers Made 17 ✓
  assert.strictEqual(mtd.wins, 5); // sheet: Total Wins 5 ✓
  assert.strictEqual(mtd.revenue, 75400); // sheet: Revenue Generated ✓
  assert.strictEqual(mtd.cash, 38900); // sheet: Cash Collected ✓
  // ...and diverges exactly where the sheet is broken:
  assert.strictEqual(mtd.noShows, 12); // sheet: 1
  assert.strictEqual(mtd.held, 23); // sheet "Completed Calls": 5
  assert.strictEqual(Math.round(mtd.showRate * 1000) / 10, 65.7); // sheet: 12.20%
  assert.strictEqual(Math.round(mtd.closeRateOnOffers * 1000) / 10, 29.4);
  assert.strictEqual(Math.round(mtd.closeRateOnHeld * 1000) / 10, 21.7); // sheet: 100%
});

test('picks the week block containing today, and the previous one for deltas', () => {
  assert.strictEqual(metrics.week.number, 3);
  assert.strictEqual(metrics.priorWeek.number, 2);
});

test('rates with an empty denominator are null, never NaN or a fake 0%', () => {
  const empty = byWeek[4];
  assert.strictEqual(empty.showRate, null);
  assert.strictEqual(empty.offerRate, null);
  assert.strictEqual(empty.closeRateOnHeld, null);
});

test('builds a Slack payload within Slack section limits', () => {
  const closers = [metrics];
  const recap = buildRecap({
    closers,
    team: rollUp(closers, (closer) => closer.week),
    teamMonth: rollUp(closers, (closer) => closer.monthToDate),
    asOf: require('luxon').DateTime.fromJSDate(asOf),
    mode: 'wrap',
    kpis: { show: 0.7, offer: 0.9, close: null },
    monthLabel: 'September',
    weekLabel: '9/14-9/20',
    sheetUrl: 'https://example.com/sheet',
  });

  assert.ok(recap.blocks.length >= 1);
  recap.blocks.forEach((block) => assert.ok(block.text.text.length <= 3000));
  assert.match(recap.text, /Closer Week Wrap/);
  assert.match(recap.plain, /Kelly, Shakila/);
});

test('ignores tabs from other months and unnamed template tabs', () => {
  const september = Object.entries(grids)
    .map(([title, grid]) => ({ title, tracker: parseTrackerTab(grid, { year: 2026 }) }))
    .filter(({ tracker }) => tracker && tracker.month === 9 && tracker.weeks.length);

  const names = september.map(({ tracker }) => tracker.name);
  assert.ok(names.includes('Jill'));
  assert.ok(!names.includes('Aliya')); // November tab
  assert.ok(!names.includes('Kim')); // October tab
});
