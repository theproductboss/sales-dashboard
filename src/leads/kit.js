// Kit (ConvertKit) history for webinar registrants: when they joined the
// list, whether they're still getting emails, which TPB programs they've been
// in, and how many Collective webinars they attended before.

const KIT_BASE = 'https://api.kit.com/v4';

// Kit allows about 120 requests a minute per API key, so requests are spaced
// out and a 429 waits and retries.
const MIN_GAP_MS = 550;
let lastRequest = 0;

async function kitFetch(apiKey, path) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const wait = lastRequest + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequest = Date.now();
    const res = await fetch(`${KIT_BASE}${path}`, { headers: { 'X-Kit-Api-Key': apiKey, Accept: 'application/json' } });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 15000 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`Kit API error ${res.status} on ${path.split('?')[0]}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  }
  throw new Error(`Kit API kept rate-limiting ${path.split('?')[0]}`);
}

async function listAll(apiKey, path, key) {
  const items = [];
  let after = '';
  do {
    const sep = path.includes('?') ? '&' : '?';
    const data = await kitFetch(apiKey, `${path}${sep}per_page=1000${after ? `&after=${encodeURIComponent(after)}` : ''}`);
    items.push(...(data[key] || []));
    after = data.pagination && data.pagination.has_next_page ? data.pagination.end_cursor : '';
  } while (after);
  return items;
}

// Which tags mean someone was actually in a program, by tag name. Tags for
// webinars, waitlists, abandoned carts, link clicks and opt-outs are prospects,
// not members, so they don't count.
const PROGRAMS = [
  {
    key: 'collective',
    label: 'Collective',
    include: /collective/i,
    exclude: /webinar|call scheduled|no show|group fitting|maybe|yesform|holiday season planner|abandon|waitlist|clicked|final day/i,
  },
  {
    key: 'msm',
    label: 'MSM',
    include: /\bMSM\b|multi.?stream/i,
    exclude: /clicked|opt.?out|waitlist|webinar|deadline|check-?out fail|abandon|videoask|missed|attended live|didn'?t purchase|interested|sales sequence|backstage pass|pitch|downsell|new since|refund|affiliate|sign ups|flash sale\]|evergreen flash sale|subscribers completed/i,
  },
  {
    key: 'sa',
    label: 'Sales Accelerator',
    include: /sales accelerator|\bPBSA\b|\[SA[\]/]/i,
    exclude: /abandon|waitlist|opt.?in|opt.?out|clicked|downsell|challenge/i,
  },
  {
    key: 'academy',
    label: 'Academy',
    include: /\bPBA\b|academy/i,
    exclude: /workshop|webinar|deadline|downsell|clicked/i,
  },
];

// "[The Collective Webinar] 2026 November 11/09 Attended", also older
// spellings like "[The Collective Webinar] November 17 Attended".
const PAST_WEBINAR_ATTENDED = /^\[The Collective Webinar\].*\battended\b/i;

function classifyTags(tags) {
  const programTags = PROGRAMS.map((p) => ({
    ...p,
    tags: tags.filter((t) => p.include.test(t.name) && !p.exclude.test(t.name)),
  }));
  const attendedTags = tags.filter((t) => PAST_WEBINAR_ATTENDED.test(t.name));
  return { programTags, attendedTags };
}

async function fetchKitHistory(apiKey) {
  const tags = await listAll(apiKey, '/tags', 'tags');
  const { programTags, attendedTags } = classifyTags(tags);

  // email -> { joinedAt, state }
  const subscribers = new Map();
  for (const s of await listAll(apiKey, '/subscribers?status=all', 'subscribers')) {
    subscribers.set(String(s.email_address).toLowerCase(), { joinedAt: s.created_at, state: s.state });
  }

  // email -> { collective: [{ tag, taggedAt }], ... }
  const programs = new Map();
  for (const program of programTags) {
    for (const tag of program.tags) {
      for (const s of await listAll(apiKey, `/tags/${tag.id}/subscribers?status=all`, 'subscribers')) {
        const email = String(s.email_address).toLowerCase();
        if (!programs.has(email)) programs.set(email, {});
        const entry = programs.get(email);
        (entry[program.key] = entry[program.key] || []).push({ tag: tag.name, taggedAt: s.tagged_at });
      }
    }
  }

  // email -> times they were tagged as attending a Collective webinar
  const attended = new Map();
  for (const tag of attendedTags) {
    for (const s of await listAll(apiKey, `/tags/${tag.id}/subscribers?status=all`, 'subscribers')) {
      const email = String(s.email_address).toLowerCase();
      if (!attended.has(email)) attended.set(email, []);
      attended.get(email).push(s.tagged_at);
    }
  }

  return { subscribers, programs, attended, tagCounts: Object.fromEntries(programTags.map((p) => [p.key, p.tags.length])) };
}

// One person's Kit history, all-time. The page compares these dates with
// each webinar registration, so "on the list before" and "attended a past
// webinar" are judged as of that registration.
function kitProfile(history, email) {
  if (!history) return null;
  const sub = history.subscribers.get(email);
  const programs = {};
  for (const p of PROGRAMS) {
    const hits = (history.programs.get(email) || {})[p.key] || [];
    if (hits.length) {
      programs[p.key] = {
        since: hits.map((h) => h.taggedAt).filter(Boolean).sort()[0] || null,
        tags: [...new Set(hits.map((h) => h.tag))].slice(0, 6),
      };
    }
  }
  return {
    joinedAt: sub ? sub.joinedAt : null,
    state: sub ? sub.state : null,
    programs,
    webinarsAttendedAt: (history.attended.get(email) || []).filter(Boolean).sort(),
  };
}

module.exports = { PROGRAMS, classifyTags, fetchKitHistory, kitProfile };
