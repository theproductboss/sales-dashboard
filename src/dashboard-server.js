// Local "ManyChat opt-in journeys" dashboard.
//
//   npm run dashboard   ->  http://localhost:3000
//
// Serves one HTML page plus /api/totals. Both contain totals only; the raw
// export with subscriber PII stays in data/journey-raw.json (gitignored) and
// is never served.

require('dotenv').config();
const fs = require('fs');
const http = require('http');
const path = require('path');
const { runJourneyExport } = require('./journey');
const { buildTotals } = require('./journey-totals');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const MAX_AGE_MS = 6 * 60 * 60 * 1000;
const RETRY_AFTER_MS = 15 * 60 * 1000;
const DATA_DIR = path.join(__dirname, '..', 'data');
const RAW_PATH = path.join(DATA_DIR, 'journey-raw.json');
const CACHE_PATH = path.join(DATA_DIR, 'totals-cache.json');
const PAGE_PATH = path.join(__dirname, 'dashboard.html');

let cache = null; // { updatedAt, totals }
let lastError = null; // { message, at }
let refreshing = null; // the running refresh, if any
let refreshStartedAt = null;
let progress = null;

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function writeFileAtomic(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, contents, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function loadCache() {
  try {
    const saved = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
    if (saved && saved.updatedAt && saved.totals) cache = { updatedAt: saved.updatedAt, totals: saved.totals };
    if (saved && saved.lastError) lastError = saved.lastError;
  } catch (err) {
    if (err.code !== 'ENOENT') log(`Ignoring unreadable cache: ${err.message}`);
  }
  if (cache) return;
  // No cache but an earlier raw export is on disk: rebuild totals from it.
  try {
    const data = JSON.parse(fs.readFileSync(RAW_PATH, 'utf8'));
    cache = { updatedAt: data.generatedAt, totals: buildTotals(data) };
    saveCache();
  } catch (err) {
    if (err.code !== 'ENOENT') log(`Could not rebuild totals from the last export: ${safeErrorMessage(err)}`);
  }
}

function saveCache() {
  writeFileAtomic(CACHE_PATH, JSON.stringify({ ...(cache || {}), lastError }));
}

// API errors quote the request URL, which can hold an email or a Kit
// subscriber ID. Keep the gist, drop anything identifying.
function safeErrorMessage(err) {
  return String((err && err.message) || err)
    .replace(/(https?:\/\/[^\s/?#:]+)[^\s:]*/g, '$1/…')
    .replace(/\S*(?:@|%40)\S*/g, '[removed]')
    .replace(/\d{5,}/g, '…')
    .replace(/\s+/g, ' ')
    .slice(0, 300);
}

// Stale = older than 6 hours. After a failed refresh, wait a while before
// retrying automatically ("Refresh now" always retries straight away).
function isStale() {
  if (lastError && Date.now() - Date.parse(lastError.at) < RETRY_AFTER_MS) return false;
  return !cache || Date.now() - Date.parse(cache.updatedAt) > MAX_AGE_MS;
}

// Only one refresh runs at a time; extra calls join the one in flight.
function refresh(reason) {
  if (refreshing) return refreshing;
  refreshStartedAt = new Date().toISOString();
  progress = 'Reading opt-in subscribers from Kit';
  log(`Refresh started (${reason})`);

  refreshing = (async () => {
    try {
      const data = await runJourneyExport({
        log: (msg) => {
          log(msg);
          progress = msg.startsWith('Kit:') ? 'Looking up purchases in Stripe' : `Looking up purchases in Stripe (${msg.split(':')[0]} done)`;
        },
      });
      writeFileAtomic(RAW_PATH, JSON.stringify(data));
      cache = { updatedAt: data.generatedAt, totals: buildTotals(data) };
      lastError = null;
      saveCache();
      log('Refresh finished');
    } catch (err) {
      console.error(err);
      lastError = { message: safeErrorMessage(err), at: new Date().toISOString() };
      try {
        saveCache();
      } catch (_) { /* keep serving what is in memory */ }
      log(`Refresh failed: ${lastError.message}`);
    } finally {
      refreshing = null;
      refreshStartedAt = null;
      progress = null;
    }
  })();
  return refreshing;
}

function payload() {
  return {
    updatedAt: cache ? cache.updatedAt : null,
    refreshing: Boolean(refreshing),
    refreshStartedAt,
    progress,
    maxAgeHours: MAX_AGE_MS / 3600000,
    lastError,
    totals: cache ? cache.totals : null,
  };
}

function send(res, status, type, body) {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    return fs.readFile(PAGE_PATH, (err, html) => {
      if (err) return send(res, 500, 'text/plain; charset=utf-8', 'Dashboard page is missing.');
      send(res, 200, 'text/html; charset=utf-8', html);
    });
  }
  if (req.method === 'GET' && pathname === '/api/totals') {
    if (isStale()) refresh(cache ? 'cache older than 6 hours' : 'no cache yet');
    return send(res, 200, 'application/json; charset=utf-8', JSON.stringify(payload()));
  }
  if (req.method === 'POST' && pathname === '/api/refresh') {
    refresh('Refresh now');
    return send(res, 202, 'application/json; charset=utf-8', JSON.stringify(payload()));
  }
  send(res, 404, 'text/plain; charset=utf-8', 'Not found');
});

loadCache();
server.listen(PORT, HOST, () => {
  log(`ManyChat opt-in journeys dashboard: http://localhost:${PORT}`);
  if (cache) log(`Serving cached totals from ${cache.updatedAt}`);
  if (isStale()) refresh(cache ? 'cache older than 6 hours' : 'no cache yet');
  // Keep the numbers fresh even when nobody has the page open.
  setInterval(() => {
    if (isStale()) refresh('cache older than 6 hours');
  }, 10 * 60 * 1000).unref();
});
