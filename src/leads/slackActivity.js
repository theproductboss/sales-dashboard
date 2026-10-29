const { slackFetch } = require('../slack');

// Pages through a channel's history back to `oldest` (a JS Date).
async function fetchChannelHistory(token, channelId, oldest) {
  const messages = [];
  let cursor;
  do {
    const params = { channel: channelId, limit: '200', oldest: String(Math.floor(oldest.getTime() / 1000)) };
    if (cursor) params.cursor = cursor;
    const data = await slackFetch(token, 'conversations.history', params);
    messages.push(...(data.messages || []));
    cursor = data.response_metadata && data.response_metadata.next_cursor;
  } while (cursor);
  return messages;
}

function slackTsToIso(ts) {
  return new Date(Number(ts) * 1000).toISOString();
}

// Slack encodes emails as <mailto:a@b.com|a@b.com>; plain addresses are
// matched too in case the Zap ever posts them unlinked.
function extractEmail(text) {
  const mailto = text.match(/mailto:([^|>\s]+)/i);
  if (mailto) return mailto[1].toLowerCase();
  const plain = text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/);
  return plain ? plain[0].toLowerCase() : null;
}

// #collective-calls-booked messages from the Calendly Zap look like:
//   "Jane Doe <mailto:jane@x.com|jane@x.com> booked an Under 50k call!"
//   "Jane Doe <mailto:jane@x.com|jane@x.com> booked a call! (estimated revenue $25,000-$50,000)"
function parseBookingMessage(message) {
  const text = message.text || '';
  if (!/booked/i.test(text)) return null;
  const email = extractEmail(text);
  if (!email) return null;

  const revenueMatch = text.match(/estimated revenue\s*([^)]+)\)/i) || text.match(/booked an?\s+(.+?)\s+call/i);
  return {
    email,
    bookedAt: slackTsToIso(message.ts),
    callType: revenueMatch ? revenueMatch[1].trim() : '',
  };
}

// #payments new-payment messages from the checkout Zap look like:
//   "The Product Boss Collective - 1 Year [PIF] - $8000 - jacqoffer - 8000.00 New Payment from Jane (<mailto:...>)"
//   "Emails for E-commerce course with template - $77 New payment from  (<mailto:...>)"
// Recurring "Subscription Payment: 198.00" messages carry no email, so
// they can't be tied to a lead and are skipped.
function parsePaymentMessage(message) {
  const text = message.text || '';
  const match = text.match(/^(.*?)\s*-?\s*\$?([\d,]+(?:\.\d+)?)\s*-?\s*New Payment from/i);
  if (!match) return null;
  const email = extractEmail(text);
  if (!email) return null;

  return {
    email,
    paidAt: slackTsToIso(message.ts),
    amount: Number(match[2].replace(/,/g, '')),
    product: match[1].replace(/\s*-\s*$/, '').trim(),
  };
}

async function fetchBookings(token, channelId, oldest) {
  const messages = await fetchChannelHistory(token, channelId, oldest);
  return messages.map(parseBookingMessage).filter(Boolean);
}

async function fetchPayments(token, channelId, oldest) {
  const messages = await fetchChannelHistory(token, channelId, oldest);
  return messages.map(parsePaymentMessage).filter(Boolean);
}

module.exports = { fetchBookings, fetchPayments, parseBookingMessage, parsePaymentMessage, extractEmail };
