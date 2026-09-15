// Turns parsed call rows into the numbers a closer manager actually runs on.
//
// Denominator rules — these are the whole point of this file, because the
// tracker's own formulas get them wrong:
//
//   Show rate  = calls held / calls that were supposed to happen
//                ("supposed to happen" = booked, minus rows the rep hasn't
//                logged yet, minus reschedules, which haven't happened yet
//                rather than having been missed)
//   Offer rate = offers made / calls held  (NOT / wins, which is what makes
//                the sheet report 340%)
//   Close rate = wins / calls held, reported alongside wins / offers made,
//                which is the number that tells a closer whether their
//                pitch converts once they actually get to pitch
//
// A rate whose denominator is zero comes back `null`, not 0 and not NaN, so
// the formatter can print "—" instead of a misleading 0%.

function rate(numerator, denominator) {
  if (!denominator) return null;
  return numerator / denominator;
}

function summarize(calls) {
  const booked = calls.length;
  const unlogged = calls.filter((call) => call.unlogged);
  const rescheduled = calls.filter((call) => call.rescheduled);
  const leadCxls = calls.filter((call) => call.leadCxl && !call.rescheduled);
  const noShows = calls.filter((call) => call.noShow);
  const held = calls.filter((call) => call.held);

  // Calls that had their shot at happening: everything booked except rows
  // with no outcome logged yet and rows pushed to a later date.
  const expected = booked - unlogged.length - rescheduled.length;

  const offerLogged = held.filter((call) => call.offerLogged);
  const offers = held.filter((call) => call.offerMade);
  const wins = held.filter((call) => call.win);

  const revenue = calls.reduce((sum, call) => sum + call.revenue, 0);
  const cash = calls.reduce((sum, call) => sum + call.cash, 0);

  return {
    booked,
    expected,
    held: held.length,
    noShows: noShows.length,
    rescheduled: rescheduled.length,
    leadCxls: leadCxls.length,
    unlogged: unlogged.length,
    offers: offers.length,
    offersLogged: offerLogged.length,
    wins: wins.length,
    revenue,
    cash,
    showRate: rate(held.length, expected),
    offerRate: rate(offers.length, offerLogged.length),
    closeRateOnHeld: rate(wins.length, held.length),
    closeRateOnOffers: rate(wins.length, offers.length),
    closeRateOnBooked: rate(wins.length, expected),
    // Rows that need a human to go fill something in.
    gaps: {
      unloggedLeads: unlogged.map((call) => call.lead),
      heldWithoutOffer: held.filter((call) => !call.offerLogged).map((call) => call.lead),
      heldWithoutOutcome: held.filter((call) => !call.outcomeLogged).map((call) => call.lead),
    },
    winList: wins.map((call) => ({ lead: call.lead, revenue: call.revenue, cash: call.cash })),
  };
}

function pickCurrentWeek(weeks, asOf) {
  const dated = weeks.filter((week) => week.range);
  const containing = dated.find((week) => asOf >= week.range.start && asOf <= week.range.end);
  if (containing) return containing;
  // Before the month starts, or in a gap between blocks: fall back to the
  // most recent week that has already begun, else the first week.
  const started = dated.filter((week) => asOf >= week.range.start);
  if (started.length) return started[started.length - 1];
  return dated[0] || weeks[0] || null;
}

function previousWeek(weeks, current) {
  if (!current) return null;
  const index = weeks.indexOf(current);
  for (let i = index - 1; i >= 0; i -= 1) {
    if (weeks[i].calls.length) return weeks[i];
  }
  return null;
}

// Month to date = every week block that has started, so an empty week 4
// sitting in the template doesn't dilute the month's rates.
function monthToDateCalls(weeks, asOf) {
  return weeks
    .filter((week) => !week.range || week.range.start <= asOf)
    .flatMap((week) => week.calls);
}

function buildCloserMetrics(tracker, asOf) {
  const current = pickCurrentWeek(tracker.weeks, asOf);
  const prior = previousWeek(tracker.weeks, current);

  return {
    name: tracker.name,
    monthLabel: tracker.monthLabel,
    week: current
      ? { label: current.rangeLabel, number: current.week, ...summarize(current.calls) }
      : null,
    priorWeek: prior
      ? { label: prior.rangeLabel, number: prior.week, ...summarize(prior.calls) }
      : null,
    monthToDate: summarize(monthToDateCalls(tracker.weeks, asOf)),
    weeks: tracker.weeks.map((week) => ({
      label: week.rangeLabel,
      number: week.week,
      ...summarize(week.calls),
    })),
  };
}

function rollUp(closerMetrics, selector) {
  const parts = closerMetrics.map(selector).filter(Boolean);
  const sum = (field) => parts.reduce((total, part) => total + part[field], 0);
  const booked = sum('booked');
  const expected = sum('expected');
  const held = sum('held');
  const offers = sum('offers');
  const offersLogged = sum('offersLogged');
  const wins = sum('wins');

  return {
    booked,
    expected,
    held,
    noShows: sum('noShows'),
    rescheduled: sum('rescheduled'),
    leadCxls: sum('leadCxls'),
    unlogged: sum('unlogged'),
    offers,
    offersLogged,
    wins,
    revenue: sum('revenue'),
    cash: sum('cash'),
    showRate: rate(held, expected),
    offerRate: rate(offers, offersLogged),
    closeRateOnHeld: rate(wins, held),
    closeRateOnOffers: rate(wins, offers),
    closeRateOnBooked: rate(wins, expected),
  };
}

module.exports = { summarize, buildCloserMetrics, rollUp, pickCurrentWeek, rate };
