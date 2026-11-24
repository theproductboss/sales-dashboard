// Where each lead came from, and what revenue level they told us.
//
// Two feeds, the same ones the Webinar Lead Tracker uses:
//   - WebinarJam registrations: email, name, UTMs (which ad), and the
//     "projected revenue" answer on the registration form.
//   - #collective-calls-booked in Slack: every call booked through Calendly,
//     with the email, name and the revenue range picked on the booking form.
//     This includes people who never registered for a webinar.
//
// Every hour the two are pulled, each tracker row is matched to a person
// (by email first, then by name), and the match is written onto the call as
// `attr`. Closers can override the source or revenue level on the row;
// a hand-entered value always wins over the automatic one.
const { DateTime } = require("luxon");

const WEBINARJAM_BASE = "https://api.webinarjam.com/webinarjam";
const SLACK_BASE = "https://slack.com/api";
const LOOKBACK_DAYS = 400;

// ---------- WebinarJam ----------
async function webinarjamFetch(apiKey, endpoint, params = {}) {
  const body = new URLSearchParams({ api_key: apiKey });
  for (const [k, v] of Object.entries(params)) if (v != null) body.set(k, String(v));
  const res = await fetch(`${WEBINARJAM_BASE}/${endpoint}`, { method: "POST", body });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error(`WebinarJam ${res.status} on /${endpoint}: ${text.slice(0, 200)}`); }
  if (!res.ok || data.status === "error") throw new Error(`WebinarJam ${res.status} on /${endpoint}: ${data.message || text.slice(0, 200)}`);
  return data;
}
function parseWjDate(value, zone) {
  if (!value) return null;
  const s = String(value).trim();
  for (const f of ["EEE, d MMM yyyy, hh:mm a", "yyyy-MM-dd HH:mm:ss", "yyyy-MM-dd HH:mm", "yyyy-MM-dd"]) {
    const d = DateTime.fromFormat(s, f, { zone, locale: "en-US" });
    if (d.isValid) return d.toUTC().toISO();
  }
  const d = DateTime.fromISO(s, { zone });
  return d.isValid ? d.toUTC().toISO() : null;
}
function findRevenueLevel(raw) {
  const key = Object.keys(raw).find(k => /revenue/i.test(k) && !/^revenue_(live|replay)$/i.test(k));
  if (key && raw[key]) return String(raw[key]);
  const custom = raw.custom_fields || raw.custom || raw.questions;
  if (Array.isArray(custom)) { const m = custom.find(f => /revenue/i.test(f.name || f.question || f.label || "")); if (m) return String(m.value ?? m.answer ?? ""); }
  return "";
}
async function fetchRegistrations(apiKey, nameIncludes = "Collective Webinar") {
  const needle = nameIncludes.toLowerCase();
  const webinars = ((await webinarjamFetch(apiKey, "webinars")).webinars || []).filter(w => { const n = String(w.name || "").toLowerCase(); return n.includes(needle) && !/\btest\b/.test(n); });
  const regs = [];
  for (const w of webinars) {
    const zone = w.timezone || "America/New_York";
    for (let page = 1; page <= 500; page++) {
      const data = await webinarjamFetch(apiKey, "registrants", { webinar_id: w.webinar_id, page, date_range: 0 });
      const c = data.registrants || data.users || data.user || [];
      const rows = Array.isArray(c) ? c : c.data || [];
      for (const raw of rows) {
        const email = String(raw.email || "").trim().toLowerCase(); if (!email) continue;
        regs.push({ email, name: `${raw.first_name || ""} ${raw.last_name || ""}`.trim(), registeredAt: parseWjDate(raw.signup_date, zone), webinarName: raw.webinar || w.name || "",
          revenueLevel: findRevenueLevel(raw), utm: { source: raw.utm_source || "", medium: raw.utm_medium || "", campaign: raw.utm_campaign || "", content: raw.utm_content || "" } });
      }
      const last = !Array.isArray(c) && c.last_page;
      if (!rows.length || (last && page >= last)) break;
    }
  }
  return regs;
}

// ---------- Slack: #collective-calls-booked ----------
async function slackGet(token, method, params) {
  const url = new URL(`${SLACK_BASE}/${method}`); for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const data = await (await fetch(url, { headers: { Authorization: `Bearer ${token}` } })).json();
  if (!data.ok) throw new Error(`Slack ${method}: ${data.error}`);
  return data;
}
function extractEmail(text) {
  const m = text.match(/mailto:([^|>\s]+)/i) || text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/);
  return m ? (m[1] || m[0]).toLowerCase() : null;
}
// "Jane Doe <mailto:jane@x.com|jane@x.com> booked an Under 50k call!"
// "Jane Doe <mailto:jane@x.com|jane@x.com> booked a call! (estimated revenue $25,000-$50,000)"
function parseBooking(m) {
  const text = m.text || ""; if (!/booked/i.test(text)) return null;
  const email = extractEmail(text); if (!email) return null;
  const rev = text.match(/estimated revenue\s*([^)]+)\)/i) || text.match(/booked an?\s+(.+?)\s+call/i);
  const name = text.match(/^(.*?)\s*<mailto:/i);
  // Only keep a revenue range; some bookings read "booked a The Collective Qualification call", which is a call type.
  const revenue = rev && /\$|under|zero|\dk\b/i.test(rev[1]) ? rev[1].trim() : "";
  return { email, name: name ? name[1].trim() : "", bookedAt: new Date(Number(m.ts) * 1000).toISOString(), revenue };
}
async function fetchBookings(token, channel, oldest) {
  const out = []; let cursor;
  do {
    const p = { channel, limit: "200", oldest: String(Math.floor(oldest.getTime() / 1000)) }; if (cursor) p.cursor = cursor;
    const data = await slackGet(token, "conversations.history", p);
    for (const m of data.messages || []) { const b = parseBooking(m); if (b) out.push(b); }
    cursor = data.response_metadata && data.response_metadata.next_cursor;
  } while (cursor);
  return out;
}

// ---------- classify + match ----------
function sourceOf(utm) {
  const s = (utm.source || "").toLowerCase(), med = (utm.medium || "").toLowerCase();
  if (/^(meta|fb|facebook)$/.test(s) || /paid|cpc|ads?\b/.test(med)) return "Meta ads";
  if (/^(ig|instagram)$/.test(s)) return "Instagram";
  if (/^(kit|convertkit|email|newsletter)$/.test(s)) return "Email list";
  if (s === "website") return "Website";
  if (s === "podcast") return "Podcast";
  if (s === "invite") return "Invite";
  if (!s) return "Instagram (no UTM)";   // the lead tracker's convention: untagged links are the Instagram bio link
  return `Other (${utm.source})`;
}
const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z\s'-]/g, " ").replace(/\s+/g, " ").trim();

function buildIndex(regs, bookings) {
  const people = new Map();
  for (const r of [...regs].sort((a, b) => String(a.registeredAt).localeCompare(String(b.registeredAt)))) {
    const p = people.get(r.email);
    if (!p) people.set(r.email, { email: r.email, name: r.name, registeredAt: r.registeredAt, webinarName: r.webinarName, revenueLevel: r.revenueLevel, source: sourceOf(r.utm), campaign: r.utm.campaign, ad: r.utm.content });
    else { if (!p.name && r.name) p.name = r.name; if (!p.revenueLevel && r.revenueLevel) p.revenueLevel = r.revenueLevel; }
  }
  const byEmail = new Map();
  for (const b of bookings) { (byEmail.get(b.email) || byEmail.set(b.email, []).get(b.email)).push(b); }
  return { people, bookings: bookings.sort((a, b) => a.bookedAt.localeCompare(b.bookedAt)), bookingsByEmail: byEmail };
}

// The booking closest before the call date (or up to 2 days after, for same-day reschedules).
function bookingFor(list, callDate) {
  const hi = callDate + "T23:59:59Z", lo = DateTime.fromISO(callDate).minus({ days: 90 }).toISODate();
  const inWin = list.filter(b => b.bookedAt >= lo && b.bookedAt <= DateTime.fromISO(hi).plus({ days: 2 }).toISO());
  return inWin.sort((a, b) => b.bookedAt.localeCompare(a.bookedAt))[0] || null;
}
function attrFrom(person, booking, matchedBy) {
  const email = (booking && booking.email) || (person && person.email) || "";
  return {
    email, name: (booking && booking.name) || (person && person.name) || "",
    source: person ? person.source : "Booked directly",      // booked a call without a webinar registration on this email
    campaign: person ? person.campaign : "", ad: person ? person.ad : "", webinarName: person ? person.webinarName : "",
    revenueLevel: (person && person.revenueLevel) || (booking && booking.revenue) || "",
    bookingRevenue: booking ? booking.revenue : "", bookedAt: booking ? booking.bookedAt : null,
    matchedBy, at: new Date().toISOString(),
  };
}
function matchCall(call, idx) {
  const email = String(call.email || "").trim().toLowerCase();
  if (email && (idx.people.has(email) || idx.bookingsByEmail.has(email))) {
    return attrFrom(idx.people.get(email) || null, bookingFor(idx.bookingsByEmail.get(email) || [], call.date), "email");
  }
  const lead = norm(call.lead); if (!lead) return null;
  const toks = lead.split(" ");
  // Bookings in the 90 days before the call whose name matches: full name exactly, or the lead's
  // single first name when only one booking in the window has it.
  const win = idx.bookings.filter(b => bookingFor([b], call.date));
  let hits = win.filter(b => norm(b.name) === lead);
  if (!hits.length && toks.length === 1) hits = win.filter(b => norm(b.name).split(" ")[0] === toks[0]);
  if (!hits.length && toks.length >= 2) hits = win.filter(b => { const n = norm(b.name).split(" "); return n[0] === toks[0] && n[n.length - 1] === toks[toks.length - 1]; });
  const uniqEmails = [...new Set(hits.map(h => h.email))];
  if (uniqEmails.length === 1) {
    const b = hits.sort((a, c) => c.bookedAt.localeCompare(a.bookedAt))[0];
    return attrFrom(idx.people.get(b.email) || null, b, toks.length === 1 ? "first name" : "name");
  }
  // No booking: a registrant with the same full name (unique) still tells us the source.
  if (toks.length >= 2) {
    const ppl = [...idx.people.values()].filter(p => norm(p.name) === lead);
    if (ppl.length === 1) return attrFrom(ppl[0], null, "name");
  }
  return null;
}

const same = (a, b) => JSON.stringify(a && { ...a, at: 0 }) === JSON.stringify(b && { ...b, at: 0 });

async function refresh(store, env = process.env) {
  const status = { at: new Date().toISOString(), ok: false };
  try {
    const token = env.SLACK_BOT_TOKEN, key = env.WEBINARJAM_API_KEY, channel = env.CALLS_BOOKED_CHANNEL_ID || "C09UEM5M1V5";
    if (!token || !key) throw new Error("SLACK_BOT_TOKEN and WEBINARJAM_API_KEY are not both set");
    const oldest = new Date(Date.now() - LOOKBACK_DAYS * 86400000);
    const [regs, bookings] = await Promise.all([fetchRegistrations(key, env.WEBINARJAM_NAME_INCLUDES || "Collective Webinar"), fetchBookings(token, channel, oldest)]);
    const idx = buildIndex(regs, bookings);
    const calls = (await store.all()).calls;
    let matched = 0, changed = 0;
    for (const c of calls) {
      const attr = matchCall(c, idx);
      if (attr) matched++;
      if (attr && !same(attr, c.attr)) { changed++; await store.set("calls", c.id, { ...c, attr }); }
    }
    Object.assign(status, { ok: true, registrants: idx.people.size, bookings: bookings.length, calls: calls.length, matched, changed });
    console.log(`Attribution: ${idx.people.size} registrants, ${bookings.length} bookings, ${matched}/${calls.length} calls matched (${changed} updated)`);
  } catch (e) {
    status.error = e.message; console.warn("Attribution refresh failed:", e.message);
  }
  await store.set("attribution", "status", status);
  return status;
}

function schedule(store, env = process.env) {
  if (!env.SLACK_BOT_TOKEN || !env.WEBINARJAM_API_KEY) { console.warn("Attribution is off: SLACK_BOT_TOKEN / WEBINARJAM_API_KEY not set."); return; }
  setTimeout(() => refresh(store, env), 15000);
  setInterval(() => refresh(store, env), 60 * 60 * 1000);
}

module.exports = { refresh, schedule, matchCall, buildIndex, sourceOf, parseBooking };
