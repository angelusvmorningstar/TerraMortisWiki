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

## Content API (story 2-1)

Two read-only endpoints, both behind `requireAuth` (mounted after `app.use(requireAuth)` in `server/index.js`, alongside `GET /api/me`):

- `GET /api/characters` — the full roster (active and retired), read live from Mongo. Every entry carries ONLY the summary whitelist (`_id`, `name`, `honorific`, `moniker`, `clan`, `covenant`, `bloodline`, `apparent_age`, `retired`), sorted by `sortName` (`moniker || name`). No owner-only field ever appears here.
- `GET /api/characters/:id` — one character's profile, projected per the viewer. `404` on an unknown id.

**The owner-vs-summary projection in `server/routes/characters.js` is the SOLE authorisation boundary for character/dossier data — there is no second line of defence.** `getCharacters()` / `getDossiers()` deliberately return full, unredacted documents (per-viewer redaction can't be a fixed Mongo projection — it depends on who is asking), so the route MUST do the redaction before the response leaves Express:

- **Owner tier** (viewer's `character_ids` includes the character `_id`, string-compared): the full character document plus ALL of its `character_dossier` facts, including `st_hidden` ones.
- **Summary tier** (everyone else): built by **allowlist construction, never denylist deletion** — a NEW object from the named whitelist only, so a field added to the `characters` schema upstream can never silently leak. Plus the facts allowed by the visibility rule: a fact is shown iff `st_hidden !== true`, OR the viewer's own character `_id` is in the fact's `revealed_to` array (missing/null = revealed to no one).

Story 2-2 must reuse this projection rather than re-deriving redaction. The HTTP-level leak tests in `server/routes/characters.test.js` assert both secret channels (owner-only fields and `st_hidden` facts) against the serialised response body; a regression to a passthrough is caught there.

## World / Court API (story 2-2)

- `GET /api/world` — the assembled office-holder view, read live from Mongo (behind `requireAuth`, mounted after `app.use(requireAuth)` in `server/index.js` alongside the characters router). Returns `{ territories: [{ territory, regent, lieutenant }], titleGroups: [{ honorific, holders }] }`. Territory seats join `territories.regent_id` / `lieutenant_id` (stringified character ids) against the characters collection, `String()`-normalised on both sides; the court section groups characters by their live `honorific` value (no hardcoded enum). Each holder object carries ONLY `_id`, `name`, `honorific`, `moniker` so the frontend can link to the Story 2-1 profile page.

**Office-holding is public knowledge, so this route applies NO per-viewer projection** — the assembled view is identical for every logged-in viewer (no owner tier, no `revealed_to`, no `req.user` read). It does NOT read `character_dossier` facts. **It still allowlist-projects every holder object** (`buildWorldView` / `summariseHolder` in `server/routes/world.js`), never a raw-document spread: `getCharacters()` / `getTerritories()` hand it full documents, and the repo convention is that a field added upstream must never silently leak. A later change must keep the named allowlist rather than regressing to `{ ...character }`. The HTTP-level projection test in `server/routes/world.test.js` fails against a raw-document spread, and asserts the retired-character sanity check (a stale `regent_id` pointing at a retired character renders the seat vacant, never that character's name).

## Lore API (story 2-3)

- `GET /api/lore` — the ordered lore manifest as `[{ slug, title }]` (setting primer, game guide, rules, friendly errata), no file bodies.
- `GET /api/lore/:slug` — one rendered lore page as `{ slug, title, html }`. `404 NOT_FOUND` for any slug not in the manifest; `500 CONTENT_ERROR` (modelled, no path/stack) if a manifest slug's backing file is missing on disk.

Lore is **login-gated, in-repo editorial markdown** — NOT Mongo-backed, and NOT baked into static Netlify HTML. The `.md` files live under **`server/content/lore/`** (forced there by `render.yaml`'s `rootDir: server` and by the login-gate requirement that content is API-served, not Netlify-served), and this is the first content router that reads from the filesystem rather than Mongo — read-only `fs` reads, zero Mongo, zero writes. The route is behind `requireAuth` (mounted after `app.use(requireAuth)` in `server/index.js`, alongside the characters and world routers), so a logged-out request for lore content gets the same login redirect a logged-out character request gets.

The `:slug` is **allowlist-validated against the manifest before any filesystem read** (no path traversal): a slug not in the manifest returns `404` and reads nothing, and a resolved path is containment-checked against the lore directory as defence in depth. Rendering goes through a pure, unit-tested `renderLoreMarkdown(md)` (dependency-free subset: headings, paragraphs, bold/italic, inline + fenced code, lists, links, block quotes, rules) that escapes raw HTML in the source rather than passing it through.

The four committed `.md` files are **placeholder copy**; swapping in the real setting/guide/rules/errata text (in particular the friendly-errata plain-language rewrite of `../TM Suite/data/reference/`) is a **content-only edit** — edit the `.md`, redeploy the API — that needs **no code change**.

## Deployment (Netlify + Render)

Mirrors TM Suite's own split exactly: a static frontend on Netlify, an API on Render, with Netlify proxying `/auth/*` and `/api/*` through to Render so every request is same-origin from the browser's point of view.

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
  routes/characters.js  content router: GET /api/characters + /:id, owner-vs-summary projection (the sole auth boundary)
public/             pure static site — deployed to Netlify
  css/              design tokens (theme.css) + base layout + components.css, ported from TM Suite
  login.html + js/auth/       the Discord OAuth redirect_uri landing page
  characters.html + character.html + js/characters/  the roster and per-character profile pages
  js/data/          display.js (ported displayName/sortName) + api.js (authed fetch, redirect-on-401)
netlify.toml        publish=public, /auth + /api proxy redirects to Render, root serves login.html
render.yaml         Render Blueprint: web service, rootDir=server, npm ci / npm start
specs/              PRD, architecture, epics, stories
```

Story 2-3 added `server/content/lore/` (static, login-gated lore markdown, served by the API) and the `public/lore.html` + `public/lore-page.html` pages.
