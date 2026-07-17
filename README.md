# Terra Mortis Wiki

A read-only, player-facing companion site for the Terra Mortis *Vampire: The Requiem 2e* chronicle. It sits alongside `TM Suite` (the ST-facing character management app, sibling directory `../TM Suite`) and reads live from the same `tm_suite` MongoDB Atlas database — read-only, on every request. It never writes to `tm_suite`.

See `specs/prd.md`, `specs/architecture.md`, and `specs/epics.md` for the full product and architecture decisions, and `CLAUDE.md` for the repo's hard rules.

## Requirements

- Node.js 18+ (uses the built-in `fetch` and `node --test`; developed on Node 24)

## Install

```bash
npm install
```

## Local development

This is two independently-run halves, exactly like TM Suite:

```bash
# API (server/) — needs a local .env, see below
cd server && npm start    # http://localhost:3000

# Static frontend (public/) — separate terminal
npx http-server public -p 8080   # http://localhost:8080
```

Override the API port with `PORT`: `PORT=4000 npm start`.

### `.env` setup

Copy `.env.example` to `.env` in the repo root and fill in:

- `MONGODB_URI` — a **read-only** Atlas connection string (see "Read-only Mongo setup" below).
- `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` / `DISCORD_REDIRECT_URI` — see "Discord OAuth setup" below.

## Test

```bash
npm test
```

Runs the full suite via Node's built-in test runner (`node --test`) — no third-party test framework. Tests never touch the live `tm_suite` connection: `server/db.js` exposes `setTestDb` to inject a fake `Db`, and Discord's API is mocked via a swapped `globalThis.fetch`.

## Live Mongo connection (no snapshot, no rebuild step)

The deployed API (`server/db.js` + `server/mongo-store.js`) holds a live, read-only connection to `tm_suite` and queries it directly on every request — the same collections TM Suite and the Cockpit read. There is no committed data file and no "regenerate the snapshot" step: a change made in Mongo anywhere is visible here on the next page load.

`server/mongo-store.js` is a hard, lexically-tested constraint: it contains no write operations (`updateOne`/`insertOne`/`$out`/`$merge`/etc.) anywhere in its source.

### Read-only Mongo setup (one-time, manual)

In the MongoDB Atlas console, provision a database user for this app with a **read-only** role on `tm_suite` (e.g. Atlas's built-in `read` role). The code itself issues zero write calls, but Atlas IAM is the real enforcement layer — the client cannot enforce read-only from its side. Put that user's connection string in `.env` as `MONGODB_URI`.

## Discord OAuth setup (one-time, manual)

The Wiki reuses TM Suite's **existing Discord application** for login — there is no second Discord app to create. You only need to register this repo's login page as an additional redirect URI on that same app.

**Important**: the redirect URI must point at a **frontend page** (`login.html`), never a backend route. Discord's OAuth redirect is always a browser GET with `?code=&state=` in the query string, which can only ever land on a static page — a POST-only JSON route can never receive it. `public/login.html`'s client JS is what reads `code`/`state` from the URL and POSTs them to the API.

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and select the **same application TM Suite uses**.
2. Go to **OAuth2 → General → Redirects** and click **Add Another**.
3. Add this app's login page URL as a new entry alongside TM Suite's existing one (Discord supports multiple redirect URIs natively):
   - Local: `http://localhost:8080/login.html`
   - Production: `https://<your-netlify-site>.netlify.app/login.html`
4. **Save Changes**.
5. Copy the application's **Client ID** and **Client Secret** into this repo's local `.env` (gitignored) as `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET`, and set `DISCORD_REDIRECT_URI` to match the entry you registered. See `.env.example`.

This is a portal-side configuration step only — it is not a code change. The `identify` scope (the only scope this app requests) needs no special approval.

The whole site is behind Discord login: every route except `GET /auth/discord`, `POST /auth/discord/callback`, and the login page itself requires a valid session. A request with no/invalid token gets `401`; a valid Discord identity with no matching `players` record gets `403`. Player resolution is a live Mongo lookup by `discord_id` — a player added to TM Suite is loginable here immediately, with no rebuild step.

### Local test bypass

For local development only (never when `NODE_ENV=production`), sending `Authorization: Bearer local-test-token` satisfies `requireAuth` without a real Discord round-trip, mirroring TM Suite's `local-test-token` pattern.

## Deployment (Netlify + Render)

Mirrors TM Suite's own split exactly: a static frontend on Netlify, an API on Render, with Netlify proxying `/auth/*` (and later `/api/*`) through to Render so every request is same-origin from the browser's point of view.

**One-time setup, in this order** (the Discord registration needs the Netlify URL to exist first):

1. **Import the Render Blueprint.** In the Render dashboard, "New" → "Blueprint", point it at this repo — it auto-reads `render.yaml` (a single `web` service, `rootDir: server`). Set the secret env vars by hand in the Render dashboard: `MONGODB_URI` (a read-only Atlas user), `DISCORD_CLIENT_SECRET`. `DISCORD_CLIENT_ID` is already set (same public value as TM Suite's). Leave `DISCORD_REDIRECT_URI` and `CORS_ORIGIN` for step 3.
2. **Import the Netlify site.** Point it at this repo with publish directory `public` — no build command. `netlify.toml`'s redirect rule proxies `/auth/*` to the Render service; update the `to` host in `netlify.toml` if the Render service name differs from `terra-mortis-wiki-api`.
3. **Register the Discord redirect URI** (see "Discord OAuth setup" above) using the real Netlify URL, then go back and set `DISCORD_REDIRECT_URI` (and `CORS_ORIGIN`, to the Netlify origin) in the Render dashboard.

## Project layout

```
server/            Express API ONLY (auth, live read-only Mongo reads) — deployed to Render
  db.js             live Mongo connection
  mongo-store.js    live accessors (getPlayers, getCharacters, getDossiers, getTerritories, getPlayerByDiscordId)
  routes/, middleware/
public/             pure static site — deployed to Netlify
  css/              design tokens (theme.css) + base layout, ported from TM Suite
  login.html + js/auth/  the Discord OAuth redirect_uri landing page
netlify.toml        publish=public, /auth proxy redirect to Render, root serves login.html
render.yaml         Render Blueprint: web service, rootDir=server, npm ci / npm start
specs/              PRD, architecture, epics, stories
```

Later stories add `content/lore/` (static lore markdown) and further `public/` pages (character dossiers, world tab) once Epic 2 starts.
