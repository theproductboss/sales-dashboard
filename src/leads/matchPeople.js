// Links a booking or payment made under a different email to the webinar
// lead it belongs to. In order of confidence:
//   1. alias:  a hand-entered pair in email-aliases.json (a null value there
//              means "never auto-match this email")
//   2. thread: a teammate posted the lead's registration email in the Slack
//              thread under the payment
//   3. name:   the first and last name on the payment exactly match one lead,
//              and no other lead has that name
// Matches from 2 and 3 are tagged so the team can see and double-check them.

function normalizeName(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Full names (at least a first and last name) mapped to the registration
// emails that used them. First-name-only registrations are left out: too
// many people share a first name to match on it.
function buildNameIndex(registrations) {
  const index = new Map();
  for (const r of registrations) {
    const name = normalizeName(`${r.firstName} ${r.lastName}`);
    if (name.split(' ').length < 2) continue;
    if (!index.has(name)) index.set(name, new Set());
    index.get(name).add(r.email);
  }
  return index;
}

function matchItems(items, { aliases, leadEmails, nameIndex, threadEmails = new Map() }) {
  return items.map((item) => {
    const original = item.email;
    if (Object.prototype.hasOwnProperty.call(aliases, original)) {
      const to = aliases[original];
      return to ? { ...item, email: to, originalEmail: original, matchedBy: 'alias' } : item;
    }
    if (leadEmails.has(original)) return item;

    const fromThread = (threadEmails.get(item.ts) || []).find((e) => e !== original && leadEmails.has(e));
    if (fromThread) return { ...item, email: fromThread, originalEmail: original, matchedBy: 'thread' };

    const sameName = nameIndex.get(normalizeName(item.name));
    if (sameName && sameName.size === 1) {
      const [email] = sameName;
      return { ...item, email, originalEmail: original, matchedBy: 'name' };
    }
    return item;
  });
}

module.exports = { normalizeName, buildNameIndex, matchItems };
