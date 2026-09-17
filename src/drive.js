const crypto = require('crypto');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const SCOPE = 'https://www.googleapis.com/auth/drive';

const base64url = (input) => Buffer.from(input).toString('base64url');

// Service-account auth: sign a JWT assertion with the account's private key and
// exchange it for an access token. `subject` (optional) turns this into
// domain-wide delegation — the token then acts as that Workspace user, which is
// how you write into a normal My Drive folder instead of a Shared Drive.
async function getAccessToken({ clientEmail, privateKey, subject }) {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: clientEmail,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
    ...(subject ? { sub: subject } : {}),
  };

  const unsigned = `${base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64url(JSON.stringify(claims))}`;
  const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(privateKey).toString('base64url');

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`,
    }),
  });

  if (!res.ok) {
    throw new Error(`Google OAuth failed (${res.status}): ${await res.text()}`);
  }
  return (await res.json()).access_token;
}

// Every uploaded file carries the Zoom recording-file id in appProperties, so
// re-runs can tell "already pulled" from "new" without keeping a state file.
async function findByZoomFileId(token, folderId, zoomFileId) {
  const url = new URL(DRIVE_API);
  url.searchParams.set(
    'q',
    `'${folderId}' in parents and trashed = false and appProperties has { key = 'zoomFileId' and value = '${zoomFileId}' }`
  );
  url.searchParams.set('fields', 'files(id,name)');
  url.searchParams.set('supportsAllDrives', 'true');
  url.searchParams.set('includeItemsFromAllDrives', 'true');

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new Error(`Drive lookup failed (${res.status}): ${await res.text()}`);
  }
  return ((await res.json()).files || [])[0] || null;
}

async function uploadMarkdown(token, { folderId, name, content, zoomFileId }) {
  const boundary = `boundary-${crypto.randomUUID()}`;
  const metadata = {
    name,
    parents: [folderId],
    mimeType: 'text/markdown',
    appProperties: { zoomFileId },
  };

  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    'Content-Type: text/markdown; charset=UTF-8',
    '',
    content,
    `--${boundary}--`,
    '',
  ].join('\r\n');

  const url = new URL(DRIVE_UPLOAD);
  url.searchParams.set('uploadType', 'multipart');
  url.searchParams.set('supportsAllDrives', 'true');
  url.searchParams.set('fields', 'id,name,webViewLink');

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    // The classic service-account trap: no personal storage quota, so an upload
    // that would be *owned* by the service account is rejected.
    if (/storageQuotaExceeded|Service Accounts do not have storage quota/i.test(text)) {
      throw new Error(
        'Drive upload rejected: service accounts have no storage quota of their own. ' +
          'Put TRANSCRIPT_DRIVE_FOLDER_ID on a Shared Drive, or set GOOGLE_IMPERSONATE_SUBJECT ' +
          'to a Workspace user and enable domain-wide delegation. See README.'
      );
    }
    throw new Error(`Drive upload failed (${res.status}): ${text}`);
  }
  return res.json();
}

module.exports = { getAccessToken, findByZoomFileId, uploadMarkdown };
