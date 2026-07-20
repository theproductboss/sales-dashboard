function money(amount) {
  if (amount === null || amount === undefined) return 'n/a';
  return `$${amount.toLocaleString('en-US')}`;
}

// Compares actual-so-far against a linear pace toward the target, given how
// far through the period we are (0-1). This is a simple heuristic, not a
// prediction — it just flags whether "on track for a flat pace" holds.
function paceEmoji(actual, target, elapsedFraction) {
  if (!target) return '';
  const expected = target * elapsedFraction;
  if (actual >= expected) return '✅';
  if (actual >= expected * 0.8) return '⚠️';
  return '🔴';
}

function buildReportBlocks({ now, week, month, weekCounts, monthCounts, cash, targets }) {
  const weekFraction = now.weekday / 7; // Mon=1 .. Sun=7
  const monthFraction = now.day / now.daysInMonth;

  const ozWeekTotal = weekCounts.oz_webinar + weekCounts.oz_from_blake + weekCounts.oz_other;
  const blakeWeekTotal = weekCounts.blake_calendar;
  const ozMonthTotal = monthCounts.oz_webinar + monthCounts.oz_from_blake + monthCounts.oz_other;

  const lines = [];
  lines.push(`*📅 ${now.toFormat('cccc, LLL d, yyyy')} — Sales Calls & Cash Dashboard*`);
  lines.push('');

  lines.push('*💰 Revenue (new cash collected)*');
  if (cash) {
    lines.push(
      `Week to date (${week.label}): ${money(cash.weekToDate)} / ${money(targets.weeklyRevenue)} target ${paceEmoji(
        cash.weekToDate ?? 0,
        targets.weeklyRevenue,
        weekFraction
      )}`
    );
    if (cash.lastWeekTotal !== null) {
      lines.push(
        `Last week (${cash.lastWeekRange}): ${money(cash.lastWeekTotal)} ${
          cash.lastWeekTotal >= targets.weeklyRevenue ? '✅' : '🔴'
        }`
      );
    }
    lines.push(
      `Month to date (${month.label}): ${money(cash.monthToDateNew)} / ${money(
        targets.monthlyRevenueFloor
      )} floor ${paceEmoji(cash.monthToDateNew ?? 0, targets.monthlyRevenueFloor, monthFraction)}`
    );
  } else {
    lines.push('_Could not read/parse the Daily Cash Report channel this run — check bot access or report format._');
  }

  lines.push('');
  lines.push('*📞 Calls booked this week*');
  lines.push(
    `Oz — total: *${ozWeekTotal}* / ${targets.ozWeeklyCalls} target ${paceEmoji(
      ozWeekTotal,
      targets.ozWeeklyCalls,
      weekFraction
    )}`
  );
  lines.push(`   • Booked from webinar: ${weekCounts.oz_webinar}`);
  lines.push(`   • Set by Blake: ${weekCounts.oz_from_blake}`);
  lines.push(`   • Other: ${weekCounts.oz_other}`);
  lines.push(
    `Blake — calendar total: *${blakeWeekTotal}* / ${targets.blakeWeeklyCalls} target ${paceEmoji(
      blakeWeekTotal,
      targets.blakeWeeklyCalls,
      weekFraction
    )}`
  );
  lines.push(`Blake — calls set for Oz: ${weekCounts.oz_from_blake}`);

  lines.push('');
  lines.push(`*🗓️ Month to date (${month.label})*`);
  lines.push(
    `Oz total: ${ozMonthTotal}  ·  Blake calendar total: ${monthCounts.blake_calendar}  ·  Blake set for Oz: ${monthCounts.oz_from_blake}`
  );

  return [{ type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } }];
}

module.exports = { buildReportBlocks };
