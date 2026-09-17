const ZOOM_OAUTH = 'https://zoom.us/oauth/token';
const ZOOM_API = 'https://api.zoom.us/v2';

// Server-to-Server OAuth: account_credentials grant, client_id/client_secret as
// HTTP Basic. Tokens live one hour and there's no refresh token, so we just
// mint one per run.
async function getAccessToken({ accountId, clientId, clientSecret }) {
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const body = new URLSearchParams({ grant_type: 'account_credentials', account_id: accountId });

  const res = await fetch(ZOOM_OAUTH, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!res.ok) {
    throw new Error(`Zoom OAuth failed (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  return data.access_token;
}

async function zoomFetch(token, path, params = {}) {
  const url = new URL(`${ZOOM_API}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  });

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new Error(`Zoom API error ${res.status} on ${url.pathname}: ${await res.text()}`);
  }
  return res.json();
}

// Cursor-paginated GET. Zoom returns next_page_token as '' when it's done.
async function zoomPaginate(token, path, params, collectionKey) {
  const items = [];
  let pageToken;

  do {
    const data = await zoomFetch(token, path, { ...params, page_size: 300, next_page_token: pageToken });
    items.push(...(data[collectionKey] || []));
    pageToken = data.next_page_token || null;
  } while (pageToken);

  return items;
}

// Zoom accepts either a user id or the user's login email as {userId}. Fetching
// the one host we care about needs only `user:read:user:admin`, where listing the
// whole account would need the broader `user:read:list_users:admin`.
async function getUser(token, userIdOrEmail) {
  return zoomFetch(token, `/users/${encodeURIComponent(userIdOrEmail)}`);
}

async function listActiveUsers(token) {
  return zoomPaginate(token, '/users', { status: 'active' }, 'users');
}

// Zoom rejects a from/to range wider than one month, so callers with a longer
// window need to walk it in chunks.
async function listUserRecordings(token, userId, { from, to }) {
  return zoomPaginate(token, `/users/${encodeURIComponent(userId)}/recordings`, { from, to }, 'meetings');
}

// The transcript is a VTT file that appears as its own entry in the meeting's
// recording_files. It shows up well after the MP4 does — Zoom takes roughly
// 2x the meeting length to process, occasionally up to 24 hours — so a meeting
// with no TRANSCRIPT entry yet is normal, not an error.
function findTranscriptFile(meeting) {
  return (meeting.recording_files || []).find(
    (file) => file.file_type === 'TRANSCRIPT' && file.status !== 'processing'
  );
}

async function downloadTranscript(token, downloadUrl) {
  const res = await fetch(downloadUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new Error(`Zoom transcript download failed (${res.status}): ${await res.text()}`);
  }
  return res.text();
}

module.exports = {
  getAccessToken,
  getUser,
  listActiveUsers,
  listUserRecordings,
  findTranscriptFile,
  downloadTranscript,
};
