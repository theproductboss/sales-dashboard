const CALENDLY_BASE = 'https://api.calendly.com';

async function calendlyFetch(token, pathOrUrl, params = {}) {
  const url = new URL(pathOrUrl.startsWith('http') ? pathOrUrl : `${CALENDLY_BASE}${pathOrUrl}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) url.searchParams.set(key, value);
  });

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Calendly API error ${res.status} on ${url.pathname}: ${body}`);
  }
  return res.json();
}

// Fetches every scheduled event (paginating through Calendly's cursor) for
// an organization within a start/end window.
async function listScheduledEvents(token, { organization, minStart, maxStart }) {
  const events = [];
  let nextPage = null;

  do {
    const data = nextPage
      ? await calendlyFetch(token, nextPage)
      : await calendlyFetch(token, '/scheduled_events', {
          organization,
          min_start_time: minStart,
          max_start_time: maxStart,
          status: 'active',
          count: 100,
        });

    events.push(...data.collection);
    nextPage = data.pagination && data.pagination.next_page;
  } while (nextPage);

  return events;
}

// Buckets events into the configured categories based on host + event name.
function categorizeEvents(events, categories, ownerUris) {
  const counts = {};
  categories.forEach((category) => {
    counts[category.key] = 0;
  });

  for (const event of events) {
    const host = (event.event_memberships || [])[0];
    const hostUri = host && host.user;
    const ownerEntry = Object.entries(ownerUris).find(([, uri]) => uri === hostUri);
    if (!ownerEntry) continue; // hosted by someone other than Oz/Blake — not tracked

    const [owner] = ownerEntry;
    const nameLower = (event.name || '').toLowerCase();
    const candidates = categories.filter((category) => category.owner === owner);

    const matched =
      candidates.find(
        (category) => category.nameIncludes && category.nameIncludes.some((keyword) => nameLower.includes(keyword))
      ) || candidates.find((category) => category.fallback);

    if (matched) counts[matched.key] += 1;
  }

  return counts;
}

module.exports = { listScheduledEvents, categorizeEvents };
