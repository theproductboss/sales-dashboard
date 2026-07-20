require('dotenv').config();

const { requireEnv, targets, eventCategories } = require('./config');
const { listScheduledEvents, categorizeEvents } = require('./calendly');
const { fetchLatestCashReport, postMessage } = require('./slack');
const { parseCashReport } = require('./cashReport');
const { buildReportBlocks } = require('./formatReport');
const { getRanges } = require('./dateRanges');

const TIME_ZONE = process.env.REPORT_TIMEZONE || 'America/New_York';
const DRY_RUN = String(process.env.DRY_RUN).toLowerCase() === 'true';

async function main() {
  const calendlyToken = requireEnv('CALENDLY_API_TOKEN');
  const orgUri = requireEnv('CALENDLY_ORG_URI');
  const ozUri = requireEnv('CALENDLY_OZ_USER_URI');
  const blakeUri = requireEnv('CALENDLY_BLAKE_USER_URI');
  const slackToken = requireEnv('SLACK_BOT_TOKEN');
  const cashChannel = requireEnv('CASH_REPORT_CHANNEL_ID');
  const dashboardChannel = requireEnv('DASHBOARD_CHANNEL_ID');

  const { now, week, month } = getRanges(TIME_ZONE);

  const [weekEvents, monthEvents] = await Promise.all([
    listScheduledEvents(calendlyToken, {
      organization: orgUri,
      minStart: week.start.toISO(),
      maxStart: week.end.toISO(),
    }),
    listScheduledEvents(calendlyToken, {
      organization: orgUri,
      minStart: month.start.toISO(),
      maxStart: month.end.toISO(),
    }),
  ]);

  const ownerUris = { oz: ozUri, blake: blakeUri };
  const weekCounts = categorizeEvents(weekEvents, eventCategories, ownerUris);
  const monthCounts = categorizeEvents(monthEvents, eventCategories, ownerUris);

  let cash = null;
  try {
    const cashText = await fetchLatestCashReport(slackToken, cashChannel);
    cash = parseCashReport(cashText);
  } catch (err) {
    console.error('Could not read/parse cash report:', err.message);
  }

  const blocks = buildReportBlocks({ now, week, month, weekCounts, monthCounts, cash, targets });

  if (DRY_RUN) {
    console.log(blocks[0].text.text);
    return;
  }

  await postMessage(slackToken, dashboardChannel, 'Daily Sales Calls & Cash Dashboard', blocks);
  console.log('Report posted.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
