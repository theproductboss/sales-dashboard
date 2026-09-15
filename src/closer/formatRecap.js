const DASH = '—';

function pct(value, digits = 0) {
  if (value === null || value === undefined) return DASH;
  return `${(value * 100).toFixed(digits)}%`;
}

function money(amount) {
  return `$${Math.round(amount || 0).toLocaleString('en-US')}`;
}

// Below this many calls a single result swings the rate by 20+ points, so
// the rate is still printed but not graded — a 🔴 on a Tuesday with three
// calls in the book tells a closer nothing useful.
const MIN_SAMPLE = 5;

function flag(value, kpi, sample) {
  if (value === null || value === undefined || !kpi) return '';
  if (sample !== undefined && sample < MIN_SAMPLE) return '';
  if (value >= kpi) return ' ✅';
  if (value >= kpi * 0.8) return ' ⚠️';
  return ' 🔴';
}

// "+12 pts" / "-4 pts" against last week, only when both sides exist.
function delta(current, prior) {
  if (current === null || prior === null || current === undefined || prior === undefined) return '';
  const points = Math.round((current - prior) * 100);
  if (points === 0) return ' (flat vs last wk)';
  return ` (${points > 0 ? '+' : ''}${points} pts vs last wk)`;
}

function list(names, limit = 6) {
  if (names.length <= limit) return names.join(', ');
  return `${names.slice(0, limit).join(', ')} +${names.length - limit} more`;
}

function statLine(stats, { kpis, prior = null }) {
  return [
    `booked *${stats.booked}* · held *${stats.held}* · show *${pct(stats.showRate)}*${flag(
      stats.showRate,
      kpis.show,
      stats.expected
    )}${prior ? delta(stats.showRate, prior.showRate) : ''}`,
    `offers *${stats.offers}* · offer rate *${pct(stats.offerRate)}*${flag(
      stats.offerRate,
      kpis.offer,
      stats.offersLogged
    )}`,
    `wins *${stats.wins}* · close *${pct(stats.closeRateOnHeld)}* of held · *${pct(
      stats.closeRateOnOffers
    )}* of offers${flag(stats.closeRateOnHeld, kpis.close, stats.held)}`,
    `cash *${money(stats.cash)}*${stats.revenue !== stats.cash ? ` · contracted ${money(stats.revenue)}` : ''}`,
  ];
}

function missedLine(stats) {
  const parts = [];
  if (stats.noShows) parts.push(`${stats.noShows} no-show${stats.noShows === 1 ? '' : 's'}`);
  if (stats.rescheduled) parts.push(`${stats.rescheduled} rescheduled`);
  if (stats.leadCxls) parts.push(`${stats.leadCxls} lead cxl`);
  if (stats.unlogged) parts.push(`${stats.unlogged} not logged yet`);
  return parts.length ? parts.join(' · ') : 'nothing missed';
}

// Rows a human needs to go fix in the sheet. These are surfaced but never
// folded into the rates — an unlogged row is a data gap, not a lost call.
function gapLines(closers) {
  const lines = [];
  for (const closer of closers) {
    const week = closer.week;
    if (!week) continue;
    const gaps = week.gaps;
    if (gaps.heldWithoutOffer.length) {
      lines.push(
        `• *${closer.name}* — ${gaps.heldWithoutOffer.length} held call${
          gaps.heldWithoutOffer.length === 1 ? '' : 's'
        } with no \`OFFER MADE?\` logged: ${list(gaps.heldWithoutOffer)}`
      );
    }
    if (gaps.heldWithoutOutcome.length) {
      lines.push(
        `• *${closer.name}* — ${gaps.heldWithoutOutcome.length} held call${
          gaps.heldWithoutOutcome.length === 1 ? '' : 's'
        } with no \`Sales Status\`: ${list(gaps.heldWithoutOutcome)}`
      );
    }
    if (gaps.unloggedLeads.length) {
      lines.push(
        `• *${closer.name}* — ${gaps.unloggedLeads.length} booked row${
          gaps.unloggedLeads.length === 1 ? '' : 's'
        } with nothing filled in: ${list(gaps.unloggedLeads)} _(excluded from rates)_`
      );
    }
  }
  return lines;
}

function section(text) {
  return { type: 'section', text: { type: 'mrkdwn', text } };
}

// Slack rejects a section over 3000 chars, so long bodies get split on line
// boundaries rather than truncated.
function sectionsFrom(lines, limit = 2800) {
  const blocks = [];
  let buffer = [];
  let length = 0;
  for (const line of lines) {
    if (length + line.length + 1 > limit && buffer.length) {
      blocks.push(section(buffer.join('\n')));
      buffer = [];
      length = 0;
    }
    buffer.push(line);
    length += line.length + 1;
  }
  if (buffer.length) blocks.push(section(buffer.join('\n')));
  return blocks;
}

function buildRecap({ closers, team, teamMonth, asOf, mode, kpis, monthLabel, weekLabel, sheetUrl }) {
  const isWrap = mode === 'wrap';
  const dateLabel = asOf.toFormat('cccc, LLL d');
  const title = isWrap
    ? `*🏁 Closer Week Wrap — ${dateLabel}*`
    : `*🎯 Closer Pulse — ${dateLabel}*`;

  const head = [title, `_Week of ${weekLabel} · ${monthLabel} tracker_`, ''];

  const teamLines = [
    isWrap ? '*Team — week just closed*' : '*Team — week so far*',
    ...statLine(team, { kpis }).map((line) => `> ${line}`),
    `> ${missedLine(team)}`,
    '',
  ];

  // Closers with nothing on the calendar this week get one shared line
  // instead of a block of dashes each.
  const active = closers.filter((closer) => closer.week && closer.week.booked);
  const idle = closers.filter((closer) => !closer.week || !closer.week.booked);

  const closerLines = ['*By closer*'];
  for (const closer of active) {
    const week = closer.week;
    closerLines.push(`*${closer.name}*`);
    statLine(week, { kpis, prior: isWrap ? closer.priorWeek : null }).forEach((line) =>
      closerLines.push(`   ${line}`)
    );
    closerLines.push(`   _${missedLine(week)}_`);
    if (week.winList.length) {
      closerLines.push(
        `   🏆 ${week.winList.map((win) => `${win.lead} (${money(win.cash)} collected)`).join(' · ')}`
      );
    }
  }
  if (!active.length) closerLines.push('_No calls booked by anyone this week._');
  else if (idle.length) {
    closerLines.push(`_No calls booked this week: ${idle.map((closer) => closer.name).join(', ')}_`);
  }
  closerLines.push('');

  const monthLines = [
    `*${monthLabel} month to date — team*`,
    ...statLine(teamMonth, { kpis }).map((line) => `> ${line}`),
    `> ${missedLine(teamMonth)}`,
  ];

  if (isWrap) {
    monthLines.push('');
    monthLines.push('*Month to date by closer*');
    for (const closer of closers) {
      const m = closer.monthToDate;
      if (!m.booked) continue;
      monthLines.push(
        `   *${closer.name}* — ${m.booked} booked · ${m.held} held · ${pct(m.showRate)} show${flag(
          m.showRate,
          kpis.show,
          m.expected
        )} · ${m.offers} offers · ${m.wins} wins · ${pct(m.closeRateOnHeld)} close of held${flag(
          m.closeRateOnHeld,
          kpis.close,
          m.held
        )} · ${money(m.cash)}`
      );
    }
  }

  const gaps = gapLines(closers);
  const gapSection = gaps.length ? ['', '*📌 Fix in the tracker*', ...gaps] : [];

  const footer = [
    '',
    `_Rates are recomputed from the raw call rows, not the tracker's summary cells. Show % = held ÷ (booked − reschedules − rows not yet logged). Offer % = offers ÷ held. Close % = wins ÷ held and wins ÷ offers._`,
  ];
  if (sheetUrl) footer.push(`_<${sheetUrl}|Open the closer tracker>_`);

  const lines = [...head, ...teamLines, ...closerLines, ...monthLines, ...gapSection, ...footer];

  return {
    text: isWrap
      ? `Closer Week Wrap — ${dateLabel}: ${team.held} held, ${pct(team.showRate)} show, ${team.wins} wins, ${money(
          team.cash
        )} collected`
      : `Closer Pulse — ${dateLabel}: ${team.held} held, ${pct(team.showRate)} show, ${team.wins} wins`,
    blocks: sectionsFrom(lines),
    plain: lines.join('\n'),
  };
}

module.exports = { buildRecap, pct, money };
