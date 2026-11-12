// Browser-side adapter: implements the slice of the claude.ai artifact runtime that
// dashboard/closer-tracker.html uses (claude.use("db") / claude.use("user")) on top
// of this server's REST API. Polls /api/state every 15s so everyone sees each
// other's edits; writes go straight to the API and then re-pull.
(() => {
  const POLL_MS = 15000;
  let state = null, etag = null, timer = null, pulling = null;
  const listeners = { calls: [], reviews: [], settings: [] };
  const meta = { fromCache: false, hasPendingWrites: false };

  const snapFor = c => c === "settings"
    ? { exists: !!state.settings, data: () => state.settings, metadata: meta }
    : { docs: state[c].map(d => ({ id: d.id, exists: true, data: () => d, metadata: meta })), size: state[c].length, empty: !state[c].length, docChanges: () => [], metadata: meta };
  const emit = c => { if (!state) return; for (const fn of listeners[c]) { try { fn(snapFor(c)); } catch (e) { console.error(e); } } };

  async function pull(force) {
    if (pulling) return pulling;
    pulling = (async () => {
      try {
        const r = await fetch("/api/state", { headers: force || !etag ? {} : { "If-None-Match": etag }, cache: "no-store" });
        if (r.status === 304) return;
        if (r.status === 401) { location.reload(); return; }
        if (!r.ok) throw new Error("state " + r.status);
        const next = await r.json();
        const changed = !state || next.etag !== etag;
        etag = next.etag; state = next;
        if (changed) { emit("calls"); emit("reviews"); emit("settings"); }
      } catch (e) { console.warn("Closer Tracker: could not refresh", e.message); }
      finally { pulling = null; }
    })();
    return pulling;
  }
  function start() {
    if (timer) return;
    pull();
    timer = setInterval(() => { if (document.visibilityState === "visible") pull(); }, POLL_MS);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") pull(); });
  }
  const sub = (c, fn) => { listeners[c].push(fn); if (state) fn(snapFor(c)); return () => { listeners[c] = listeners[c].filter(f => f !== fn); }; };
  const write = async (method, c, id, body) => {
    const r = await fetch(`/api/${c}/${encodeURIComponent(id)}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 401) { location.reload(); throw { code: "revoked", message: "signed out" }; }
    if (!r.ok) throw { code: r.status === 400 ? "invalid_argument" : "unavailable", message: await r.text() };
    await pull(true);
  };
  const docRef = (c, id) => ({
    id, path: c + "/" + id,
    set: data => write("PUT", c, id, data),
    update: data => { const cur = c === "settings" ? state?.settings : state?.[c].find(d => d.id === id); return write("PUT", c, id, { ...(cur || {}), ...data }); },
    delete: () => write("DELETE", c, id),
    get: async () => { await pull(); const cur = c === "settings" ? state.settings : state[c].find(d => d.id === id); return { id, exists: !!cur, data: () => cur, metadata: meta }; },
    onSnapshot: fn => sub(c, s => fn(c === "settings" ? s : { id, exists: !!state[c].find(d => d.id === id), data: () => state[c].find(d => d.id === id), metadata: meta })),
  });
  const db = {
    collection: c => ({ path: c, doc: id => docRef(c, id || "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)), onSnapshot: fn => sub(c, fn), get: async () => { await pull(); return snapFor(c); }, where() { return this; }, orderBy() { return this; }, limit() { return this; } }),
    doc: p => { const [c, id] = p.split("/"); return docRef(c, id); },
  };
  window.claude = {
    use: async name => {
      if (name === "db") { start(); return db; }
      if (name === "user") return { can: async () => true, canEdit: async () => true, isOwner: async () => false, id: async () => null, me: async () => ({ id: null }), profiles: async () => ({}) };
      return null;
    },
  };
})();
