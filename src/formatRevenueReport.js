function moneyCents(cents) {
  const dollars = cents / 100;
  return `$${dollars.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function periodLines(title, totals, categories) {
  const lines = [];
  lines.push(`*${title}*`);
  lines.push(
    `Net revenue: *${moneyCents(totals.netCents)}*  (Stripe ${moneyCents(totals.bySource.stripe)} · PayPal ${moneyCents(
      totals.bySource.paypal
    )}${totals.refundCents ? ` · refunds −${moneyCents(totals.refundCents)}` : ''})`
  );
  categories.forEach((c) => {
    const p = totals.byProduct[c.key];
    if (p.count === 0 && p.cents === 0) return;
    lines.push(`   • ${c.label}: ${p.count} sold — ${moneyCents(p.cents)}`);
  });
  lines.push(`Recurring program payments: ${totals.recurring.count} — ${moneyCents(totals.recurring.cents)}`);
  lines.push(
    `Failed payments: *${totals.failed.count}* (${moneyCents(totals.failed.cents)} missed · Stripe ${totals.failed.stripe} · PayPal ${totals.failed.paypal})`
  );
  return lines;
}

function buildRevenueBlocks({ now, month, year, monthTotals, yearTotals, categories, sourceNotes }) {
  const lines = [];
  lines.push(`*💵 ${now.toFormat('cccc, LLL d, yyyy')} — Revenue Dashboard (Stripe + PayPal)*`);
  lines.push('');
  lines.push(...periodLines(`Month to date (${month.label})`, monthTotals, categories));
  lines.push('');
  lines.push(...periodLines(`Year to date (${year.label})`, yearTotals, categories));

  // Surface product names that didn't match any category's keywords so the
  // keyword lists in src/config.js can be tightened up over time.
  const unmatched = [...yearTotals.unmatchedLabels.entries()]
    .sort((a, b) => b[1].cents - a[1].cents)
    .slice(0, 8);
  if (unmatched.length) {
    lines.push('');
    lines.push('_Unmatched product names (add keywords in src/config.js to categorize):_');
    unmatched.forEach(([label, { count, cents }]) => {
      lines.push(`   · "${label}" — ${count} × ${moneyCents(cents)} total`);
    });
  }

  const skipped = new Set([...monthTotals.skippedCurrencies, ...yearTotals.skippedCurrencies]);
  if (skipped.size) {
    lines.push('');
    lines.push(`_⚠️ Skipped non-USD payments in: ${[...skipped].join(', ')} (not included in totals)._`);
  }
  if (sourceNotes.length) {
    lines.push('');
    sourceNotes.forEach((note) => lines.push(`_⚠️ ${note}_`));
  }

  return [{ type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } }];
}

module.exports = { buildRevenueBlocks };
