const SLACK_BASE = 'https://slack.com/api';

async function slackFetch(token, method, params = {}) {
  const isPost = method.startsWith('chat.') || method.startsWith('conversations.invite');
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json; charset=utf-8',
  };

  let res;
  if (isPost) {
    res = await fetch(`${SLACK_BASE}/${method}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(params),
    });
  } else {
    const url = new URL(`${SLACK_BASE}/${method}`);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    res = await fetch(url, { headers });
  }

  const data = await res.json();
  if (!data.ok) {
    throw new Error(`Slack API error on ${method}: ${data.error}`);
  }
  return data;
}

async function fetchLatestCashReport(token, channelId) {
  const data = await slackFetch(token, 'conversations.history', { channel: channelId, limit: '20' });
  const message = (data.messages || []).find((m) => /DAILY CASH REPORT/i.test(m.text || ''));
  if (!message) {
    throw new Error('No recent "DAILY CASH REPORT" message found in the configured channel.');
  }
  return message.text;
}

async function postMessage(token, channel, text, blocks) {
  return slackFetch(token, 'chat.postMessage', { channel, text, blocks });
}

module.exports = { slackFetch, fetchLatestCashReport, postMessage };
