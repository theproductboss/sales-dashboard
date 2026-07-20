const { DateTime } = require('luxon');

// Monday-start week and calendar month, in the configured timezone.
function getRanges(timeZone) {
  const now = DateTime.now().setZone(timeZone);
  const weekStart = now.startOf('week'); // luxon weeks start Monday (ISO)
  const weekEnd = weekStart.plus({ days: 7 });
  const monthStart = now.startOf('month');
  const monthEnd = monthStart.plus({ months: 1 });

  return {
    now,
    week: {
      start: weekStart,
      end: weekEnd,
      label: `${weekStart.toFormat('LLL d')}–${weekStart.plus({ days: 6 }).toFormat('LLL d')}`,
    },
    month: {
      start: monthStart,
      end: monthEnd,
      label: now.toFormat('LLLL yyyy'),
    },
  };
}

module.exports = { getRanges };
