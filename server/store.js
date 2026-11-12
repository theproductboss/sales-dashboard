// Document store for the Closer Tracker: one table of JSON documents keyed by
// (collection, id). Backed by Postgres when DATABASE_URL is set (Render), or a
// JSON file under DATA_DIR otherwise (local dev, or a Render persistent disk).
const fs = require("fs");
const path = require("path");

const COLLECTIONS = new Set(["calls", "reviews", "settings"]);

async function createStore() {
  if (process.env.DATABASE_URL) return pgStore(process.env.DATABASE_URL);
  const dir = process.env.DATA_DIR || path.join(__dirname, "..", "data");
  return fileStore(path.join(dir, "closer-tracker.json"));
}

// ---------- Postgres ----------
async function pgStore(url) {
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
  await pool.query(`CREATE TABLE IF NOT EXISTS docs (
    collection TEXT NOT NULL, id TEXT NOT NULL, data JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (collection, id))`);
  return {
    kind: "postgres",
    async all() {
      const { rows } = await pool.query("SELECT collection, id, data, updated_at FROM docs");
      return shape(rows);
    },
    async count() { return +(await pool.query("SELECT count(*) FROM docs")).rows[0].count; },
    async set(collection, id, data) {
      await pool.query(
        `INSERT INTO docs (collection, id, data, updated_at) VALUES ($1, $2, $3, now())
         ON CONFLICT (collection, id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
        [collection, id, data]);
    },
    async remove(collection, id) { await pool.query("DELETE FROM docs WHERE collection = $1 AND id = $2", [collection, id]); },
    async setMany(entries) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const [collection, id, data] of entries) {
          await client.query(
            `INSERT INTO docs (collection, id, data) VALUES ($1, $2, $3)
             ON CONFLICT (collection, id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
            [collection, id, data]);
        }
        await client.query("COMMIT");
      } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
    },
  };
}

// ---------- JSON file ----------
async function fileStore(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let docs = [];
  if (fs.existsSync(file)) { try { docs = JSON.parse(fs.readFileSync(file, "utf8")).docs || []; } catch (e) { console.error("Could not read", file, e.message); } }
  let writing = Promise.resolve();
  const flush = () => (writing = writing.then(() => fs.promises.writeFile(file + ".tmp", JSON.stringify({ docs }, null, 1)).then(() => fs.promises.rename(file + ".tmp", file))));
  const key = (c, i) => c + "/" + i;
  return {
    kind: "file:" + file,
    async all() { return shape(docs); },
    async count() { return docs.length; },
    async set(collection, id, data) {
      const i = docs.findIndex(d => key(d.collection, d.id) === key(collection, id));
      const row = { collection, id, data, updated_at: new Date().toISOString() };
      if (i >= 0) docs[i] = row; else docs.push(row);
      await flush();
    },
    async remove(collection, id) { docs = docs.filter(d => key(d.collection, d.id) !== key(collection, id)); await flush(); },
    async setMany(entries) { for (const [c, i, d] of entries) { const k = docs.findIndex(x => key(x.collection, x.id) === key(c, i)); const row = { collection: c, id: i, data: d, updated_at: new Date().toISOString() }; if (k >= 0) docs[k] = row; else docs.push(row); } await flush(); },
  };
}

// Group rows into {calls:[], reviews:[], settings:{...}} plus an etag for cheap polling.
function shape(rows) {
  const out = { calls: [], reviews: [], settings: null, etag: "" };
  let latest = "";
  for (const r of rows) {
    const d = { ...r.data, id: r.id };
    if (r.collection === "calls") out.calls.push(d);
    else if (r.collection === "reviews") out.reviews.push(d);
    else if (r.collection === "settings" && r.id === "main") out.settings = r.data;
    const u = new Date(r.updated_at).toISOString(); if (u > latest) latest = u;
  }
  out.etag = `"${rows.length}-${latest}"`;
  return out;
}

module.exports = { createStore, COLLECTIONS };
