const crypto = require('crypto');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

// Signs a service-account JWT and trades it for an access token. Doing this
// by hand keeps googleapis (and its dependency tree) out of the project —
// we only ever need two read-only endpoints.
async function getAccessToken(credentials) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: credentials.client_email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    })
  );

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const signature = base64url(signer.sign(credentials.private_key));
  const assertion = `${header}.${claims}.${signature}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Google token request failed (${res.status}): ${data.error_description || data.error}`);
  }
  return data.access_token;
}

async function sheetsFetch(token, path, params = {}) {
  const url = new URL(`${SHEETS_BASE}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (Array.isArray(value)) value.forEach((v) => url.searchParams.append(key, v));
    else if (value !== undefined && value !== null) url.searchParams.set(key, value);
  });

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  if (!res.ok) {
    const message = (data.error && data.error.message) || res.statusText;
    throw new Error(`Google Sheets API error (${res.status}) on ${url.pathname}: ${message}`);
  }
  return data;
}

async function listTabs(token, spreadsheetId) {
  const data = await sheetsFetch(token, `/${spreadsheetId}`, { fields: 'sheets.properties' });
  return (data.sheets || []).map((sheet) => ({
    title: sheet.properties.title,
    sheetId: sheet.properties.sheetId,
    index: sheet.properties.index,
  }));
}

// Pulls every tab's grid in one batchGet. FORMATTED_VALUE keeps YES/NO and
// dollar strings exactly as a human sees them in the sheet, which is what
// the parser is written against.
async function fetchGrids(token, spreadsheetId, titles) {
  if (!titles.length) return {};
  const data = await sheetsFetch(token, `/${spreadsheetId}/values:batchGet`, {
    ranges: titles.map((title) => `'${title.replace(/'/g, "''")}'`),
    valueRenderOption: 'FORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING',
    majorDimension: 'ROWS',
  });

  const grids = {};
  (data.valueRanges || []).forEach((range, index) => {
    grids[titles[index]] = range.values || [];
  });
  return grids;
}

function loadCredentials(raw) {
  let parsed;
  try {
    // Accepts either raw JSON or base64-encoded JSON, since pasting a
    // multi-line private key into a secret goes wrong often enough.
    const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON (or base64-encoded JSON).');
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing client_email or private_key.');
  }
  parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
  return parsed;
}

module.exports = { getAccessToken, listTabs, fetchGrids, loadCredentials };
