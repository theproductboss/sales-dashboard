// Self-hosted Closer Tracker: serves dashboard/closer-tracker.html with a small
// data API behind a shared team password. Run with `npm start`.
//
// Env: PORT (Render sets it), TEAM_PASSWORD (required in production),
//      DATABASE_URL (Postgres) or DATA_DIR (JSON file), SESSION_SECRET (optional).
require("dotenv").config();
const express = require("express");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { createStore, COLLECTIONS } = require("./store");

const ROOT = path.join(__dirname, "..");
const PAGE = path.join(ROOT, "dashboard", "closer-tracker.html");
const PASSWORD = process.env.TEAM_PASSWORD || "";
const SECRET = process.env.SESSION_SECRET || crypto.createHash("sha256").update("closer-tracker|" + PASSWORD).digest("hex");
const COOKIE = "ct_session";
const token = () => crypto.createHmac("sha256", SECRET).update("ok|" + PASSWORD).digest("hex");
const authed = req => !PASSWORD || (req.cookies[COOKIE] && crypto.timingSafeEqual(Buffer.from(req.cookies[COOKIE]), Buffer.from(token())));

async function seedIfEmpty(store) {
  if (await store.count()) return;
  const read = f => JSON.parse(fs.readFileSync(path.join(ROOT, "dashboard", "data", f), "utf8"));
  const entries = [];
  for (const c of read("historical-calls.json")) entries.push(["calls", c.id, c]);
  for (const r of read("call-reviews.json")) entries.push(["reviews", r.id, r]);
  entries.push(["settings", "main", read("settings.json")]);
  await store.setMany(entries);
  console.log(`Seeded ${entries.length} documents from dashboard/data`);
}

const loginPage = (err = "") => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Closer Tracker</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Kameron:wght@700&family=Montserrat:wght@400;600&display=swap">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#fff1e9;font:15px Montserrat,system-ui,sans-serif;color:#1b1212}
form{background:#fffaf7;border:1px solid #f1dcd6;border-radius:12px;padding:28px;width:min(360px,90vw);display:grid;gap:12px}
h1{font:700 26px Kameron,Georgia,serif;color:#ff143c;margin:0}p{margin:0;color:#5d4a4a}
input{font:inherit;padding:10px 12px;border:1px solid #e3bfb9;border-radius:8px}button{font:inherit;font-weight:600;padding:10px;border:0;border-radius:8px;background:#ff143c;color:#fff;cursor:pointer}
.err{color:#c8102e;font-size:13px}</style></head><body>
<form method="post" action="/login"><h1>Closer Tracker</h1><p>Enter the team password to open the tracker.</p>
<input type="password" name="password" placeholder="Team password" autofocus required autocomplete="current-password">${err ? `<div class="err">${err}</div>` : ""}<button type="submit">Open tracker</button></form></body></html>`;

// The page was written for the claude.ai artifact runtime (window.claude.use("db")).
// This small adapter gives it the same interface on top of the REST API below.
const ADAPTER = fs.readFileSync(path.join(__dirname, "adapter.js"), "utf8");
const shell = page => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<style>:root{color-scheme:light}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style></head><body>
<script>${ADAPTER}</script>
${page}
</body></html>`;

(async () => {
  const store = await createStore();
  await seedIfEmpty(store);
  if (!PASSWORD) console.warn("TEAM_PASSWORD is not set: the tracker is open to anyone with the URL.");

  const app = express();
  app.set("trust proxy", 1);
  app.use(cookieParser());
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false }));

  app.get("/healthz", (req, res) => res.json({ ok: true, store: store.kind }));
  app.post("/login", (req, res) => {
    if (PASSWORD && req.body.password !== PASSWORD) return res.status(401).send(loginPage("That password didn't match."));
    res.cookie(COOKIE, token(), { httpOnly: true, sameSite: "lax", secure: req.secure, maxAge: 1000 * 60 * 60 * 24 * 90 });
    res.redirect("/");
  });
  app.post("/logout", (req, res) => { res.clearCookie(COOKIE); res.redirect("/"); });

  const guard = (req, res, next) => authed(req) ? next() : (req.path.startsWith("/api/") ? res.status(401).json({ error: "sign in" }) : res.status(401).send(loginPage()));
  app.use(guard);

  app.get("/", (req, res) => { res.type("html").send(shell(fs.readFileSync(PAGE, "utf8"))); });

  app.get("/api/state", async (req, res) => {
    const state = await store.all();
    if (req.headers["if-none-match"] === state.etag) return res.status(304).end();
    res.set("ETag", state.etag).set("Cache-Control", "no-store").json(state);
  });
  const okCollection = (req, res, next) => COLLECTIONS.has(req.params.collection) && /^[A-Za-z0-9_\-.~:@+]{1,200}$/.test(req.params.id) ? next() : res.status(400).json({ error: "bad path" });
  app.put("/api/:collection/:id", okCollection, async (req, res) => {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) return res.status(400).json({ error: "body must be an object" });
    await store.set(req.params.collection, req.params.id, { ...req.body, id: req.params.id });
    res.json({ ok: true });
  });
  app.delete("/api/:collection/:id", okCollection, async (req, res) => { await store.remove(req.params.collection, req.params.id); res.json({ ok: true }); });

  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Closer Tracker on http://localhost:${port} (${store.kind})`));
})().catch(e => { console.error(e); process.exit(1); });
