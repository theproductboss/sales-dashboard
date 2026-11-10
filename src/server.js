// The Webinar Lead Tracker as a standalone web app (hosted on Render).
//
// - Rebuilds the page from WebinarJam, Slack and Kit at start-up and then
//   hourly from 7am to 7pm Eastern, keeping the last good build in memory.
// - Puts the page behind a team password (TEAM_PASSWORD).
// - Answers the page's "Ask about your leads" questions through the Claude
//   API (ANTHROPIC_API_KEY). The page runs its own tools on its own data, so
//   this server only relays each step of the conversation to Claude.

require('dotenv').config();

const http = require('http');
const crypto = require('crypto');
const { DateTime } = require('luxon');
const Anthropic = require('@anthropic-ai/sdk');
const { buildPayload } = require('./leads/index');
const { renderTracker } = require('./leads/render');

const PORT = Number(process.env.PORT || 3000);
const TIME_ZONE = process.env.REPORT_TIMEZONE || 'America/New_York';
const REFRESH_HOURS = { from: 7, to: 19 }; // inclusive, Eastern
const REFRESH_MINUTE = 7;
const TEAM_PASSWORD = process.env.TEAM_PASSWORD || '';
// Signs login cookies. Without one set, logins last until the next restart.
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_DAYS = 30;
const MODEL = 'claude-opus-5-5';
const DEMO = process.argv.includes('--demo');

const state = { html: null, builtAt: null, summary: null, building: false, lastError: null, lastHourBuilt: null };

// ---------- building the page ----------

async function rebuild(reason) {
  if (state.building) return;
  state.building = true;
  const started = Date.now();
  console.log(`[refresh] starting (${reason})`);
  try {
    const { payload, summary } = await buildPayload({ demo: DEMO });
    state.html = renderTracker(payload, { standalone: true });
    state.builtAt = new Date();
    state.summary = summary;
    state.lastError = null;
    console.log(`[refresh] done in ${Math.round((Date.now() - started) / 1000)}s: ${summary}`);
    payload.warnings.forEach((w) => console.warn(`[refresh] warning: ${w}`));
  } catch (err) {
    // Keep serving the last good page; the error shows on /status.
    state.lastError = `${new Date().toISOString()}: ${err.message}`;
    console.error('[refresh] failed:', err);
  } finally {
    state.building = false;
  }
}

// Checked every minute: run once per hour, at :07, between 7am and 7pm Eastern.
function maybeRefresh() {
  const now = DateTime.now().setZone(TIME_ZONE);
  const hourKey = now.toFormat('yyyy-LL-dd HH');
  if (now.hour < REFRESH_HOURS.from || now.hour > REFRESH_HOURS.to || now.minute < REFRESH_MINUTE) return;
  if (state.lastHourBuilt === hourKey) return;
  state.lastHourBuilt = hourKey;
  rebuild(`hourly ${now.toFormat('h:mm a')} ET`);
}

// ---------- login ----------

function sign(value) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('base64url');
}

function sessionCookie() {
  const expires = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const value = `${expires}.${sign(String(expires))}`;
  return `tpb_session=${value}; Max-Age=${SESSION_DAYS * 24 * 60 * 60}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

function isLoggedIn(req) {
  const match = String(req.headers.cookie || '').match(/(?:^|;\s*)tpb_session=([^;]+)/);
  if (!match) return false;
  const [expires, sig] = match[1].split('.');
  if (!expires || !sig || Number(expires) < Date.now()) return false;
  const expected = sign(expires);
  return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

function passwordMatches(given) {
  const a = crypto.createHash('sha256').update(String(given)).digest();
  const b = crypto.createHash('sha256').update(TEAM_PASSWORD).digest();
  return TEAM_PASSWORD.length > 0 && crypto.timingSafeEqual(a, b);
}

// Slow down password guessing: a short pause per failed attempt, per address.
const failures = new Map();

function loginPage(message = '') {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Webinar Lead Tracker</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Libre+Caslon+Text&family=Montserrat:wght@400;600;700&display=swap">
<style>
  :root { --bg: #f7f5f5; --surface: #fff; --border: #ebe3e5; --text: #161213; --muted: #6b5f63; --accent: #d90f33; --rose: #b8558f; }
  @media (prefers-color-scheme: dark) { :root { --bg: #151112; --surface: #1f191b; --border: #3a2f33; --text: #f3eeef; --muted: #b4a7ab; --accent: #ff5a75; --rose: #e48fc0; color-scheme: dark; } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; background: var(--bg); color: var(--text);
    font: 14px/1.45 Montserrat, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  form { width: 100%; max-width: 360px; background: var(--surface); border: 1px solid var(--border); border-top: 3px solid var(--accent);
    border-radius: 10px; padding: 24px; display: grid; gap: 12px; }
  .eyebrow { margin: 0; font-size: 11px; font-weight: 700; letter-spacing: .22em; text-transform: uppercase; color: var(--accent); }
  .eyebrow i { font-family: "Libre Caslon Text", Georgia, serif; text-transform: none; letter-spacing: 0; color: var(--rose); font-size: 14px; font-weight: 400; }
  h1 { margin: 0; font: 400 26px/1.15 "Libre Caslon Text", Georgia, serif; }
  label { display: grid; gap: 4px; font-size: 11px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: var(--muted); }
  input { font: inherit; font-size: 15px; padding: 9px 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: var(--text); }
  button { font: inherit; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; font-size: 12px; padding: 11px; border: 0; border-radius: 6px;
    background: var(--accent); color: #fff; cursor: pointer; }
  .err { margin: 0; color: var(--accent); min-height: 1.2em; }
</style></head><body>
<form method="post" action="/login">
  <p class="eyebrow"><i>the</i> Product Boss</p>
  <h1>Webinar Lead Tracker</h1>
  <label>Team password <input type="password" name="password" autocomplete="current-password" autofocus required></label>
  <button type="submit">Open the tracker</button>
  <p class="err">${message}</p>
</form></body></html>`;
}

function buildingPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="30"><title>Webinar Lead Tracker</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f7f5f5;color:#161213}
@media (prefers-color-scheme: dark){body{background:#151112;color:#f3eeef}}p{max-width:42ch;text-align:center}</style></head><body>
<p>${state.lastError
    ? 'The first data pull failed. Check the Render logs (and the keys in Environment), then redeploy.'
    : 'Pulling the latest leads from WebinarJam, Slack and Kit. This takes about 6 minutes after a deploy; this page reloads on its own.'}</p></body></html>`;
}

// ---------- asking Claude ----------

const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

// One step of the page's question: the page sends the conversation so far
// (its question, then any tool calls and the results its own tools gave) and
// gets Claude's next message back. Server-side refusal fallback is on, so a
// question the first model declines is retried on a fallback model.
async function askStep(body) {
  const { messages, tools } = body;
  if (!Array.isArray(messages) || !messages.length || !Array.isArray(tools)) {
    const err = new Error('bad request');
    err.status = 400;
    throw err;
  }
  return anthropic.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium' },
    tools: tools.slice(0, 8).map((t) => ({ name: String(t.name), description: String(t.description), input_schema: t.input_schema })),
    messages,
  });
}

// ---------- HTTP ----------

function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('too large'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin', ...headers });
  res.end(body);
}

const sendJson = (res, status, obj) => send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json' });

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/healthz') return send(res, 200, 'ok', { 'Content-Type': 'text/plain' });

  if (url.pathname === '/login' && req.method === 'POST') {
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    const fails = failures.get(ip) || 0;
    if (fails) await new Promise((r) => setTimeout(r, Math.min(fails, 10) * 1000));
    const form = new URLSearchParams(await readBody(req, 10000));
    if (passwordMatches(form.get('password') || '')) {
      failures.delete(ip);
      return send(res, 303, '', { Location: '/', 'Set-Cookie': sessionCookie() });
    }
    failures.set(ip, fails + 1);
    return send(res, 401, loginPage(TEAM_PASSWORD ? 'That password isn\'t right.' : 'No team password is set up yet (TEAM_PASSWORD).'), { 'Content-Type': 'text/html; charset=utf-8' });
  }
  if (url.pathname === '/logout') {
    return send(res, 303, '', { Location: '/login', 'Set-Cookie': 'tpb_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax' });
  }

  if (!isLoggedIn(req)) {
    if (url.pathname.startsWith('/api/')) return sendJson(res, 401, { error: 'not_logged_in' });
    return send(res, url.pathname === '/login' ? 200 : 303, url.pathname === '/login' ? loginPage() : '', {
      'Content-Type': 'text/html; charset=utf-8',
      ...(url.pathname === '/login' ? {} : { Location: '/login' }),
    });
  }

  if (url.pathname === '/login') return send(res, 303, '', { Location: '/' });

  if (url.pathname === '/' && req.method === 'GET') {
    return send(res, 200, state.html || buildingPage(), { 'Content-Type': 'text/html; charset=utf-8' });
  }

  if (url.pathname === '/status') {
    return sendJson(res, 200, {
      builtAt: state.builtAt,
      summary: state.summary,
      building: state.building,
      lastError: state.lastError,
      askEnabled: Boolean(anthropic),
    });
  }

  if (url.pathname === '/api/ask' && req.method === 'POST') {
    if (!anthropic) return sendJson(res, 503, { error: 'ask_not_configured' });
    try {
      const reply = await askStep(JSON.parse(await readBody(req)));
      return sendJson(res, 200, { content: reply.content, stop_reason: reply.stop_reason, stop_details: reply.stop_details || null });
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) return sendJson(res, 429, { error: 'rate_limited' });
      if (err instanceof Anthropic.BadRequestError) {
        console.error('[ask] bad request:', err.message);
        return sendJson(res, 400, { error: 'bad_request' });
      }
      if (err instanceof Anthropic.APIError) {
        console.error(`[ask] API error ${err.status}:`, err.message);
        return sendJson(res, 502, { error: 'claude_unavailable' });
      }
      if (err.status) return sendJson(res, err.status, { error: err.message });
      console.error('[ask] failed:', err);
      return sendJson(res, 500, { error: 'server_error' });
    }
  }

  return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
}

http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error(err);
    if (!res.headersSent) send(res, 500, 'Something went wrong', { 'Content-Type': 'text/plain' });
  });
}).listen(PORT, () => {
  console.log(`Webinar Lead Tracker listening on ${PORT}${TEAM_PASSWORD ? '' : ' (TEAM_PASSWORD is not set: nobody can log in)'}`);
  // The start-up build covers the current hour.
  state.lastHourBuilt = DateTime.now().setZone(TIME_ZONE).toFormat('yyyy-LL-dd HH');
  rebuild('start-up');
  setInterval(maybeRefresh, 60 * 1000);
});
