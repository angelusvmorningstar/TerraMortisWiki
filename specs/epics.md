# Terra Mortis Wiki — Epics &amp; Stories

Source: `prd.md` (product scope) + `architecture.md` (technical shape). Six stories across two epics deliver v1 exactly as scoped — no more, no less. Anything raised in the design roundtable that isn't covered here (the map, reveal-authoring UI, ST-curated summaries) is deliberately deferred; do not fold it into these stories.

---

## Epic 1 — Foundation, Live Data Access &amp; Deploy Topology

**Objective**: stand up the repo skeleton, a live read-only Mongo connection, Discord OAuth (with a correct redirect flow), and the two-service Netlify/Render split, so every later story has real data, a real login, and a real deploy target to build against.

**Revision note**: story 1-2 originally built a snapshot-script pipeline (Mongo → committed JSON file). That approach is retired — see `prd.md` → "Revision: live reads, not a snapshot." Story 1-2 below is the replacement: a live, read-only Mongo connection module. Story 1-3 is amended in place (its ACs changed; its Dev Agent Record documents both the original build and the rework). Story 1-4 is new — the Netlify/Render deploy split was always implied by "same as TM Suite" but never made a concrete story, and doing it surfaced a real bug in 1-3's original OAuth flow (the redirect_uri can't point at a POST-only route).

### Story 1-1: repo-scaffold-and-css-tokens

**As** the developer of this app, **I want** an Express app skeleton with TM Suite's design tokens ported in, **so that** every later page has a consistent visual language from the start instead of retrofitting it.

Acceptance criteria:
- `npm start` runs a minimal Express server serving a placeholder home page using the ported CSS.
- `public/css/` (or equivalent) contains only the tokens/components actually used so far — colour custom properties, font stack (Cinzel/Lora via Google Fonts, matching TM Suite's existing `<link>` pattern), base layout. No bare hex or inline styles anywhere in the ported files or new markup.
- A basic test harness exists (this is the first story in the repo — pick the simplest fit for a small Express app, e.g. a lightweight test runner hitting the server with a request; do not over-engineer).
- `.gitignore` includes a portraits directory and `node_modules`, `.env`.
- README (or CLAUDE.md addendum) states how to run it locally.

Source hints: `../TM Suite/public/css/theme.css`, `../TM Suite/public/css/components.css` (read, don't guess at token names — copy what's really there).

### Story 1-2: mongo-read-client (supersedes the retired mongo-snapshot-script)

**As** the developer of this app, **I want** a live, read-only Mongo connection module with the same accessor shape the retired snapshot-store used, **so that** the API reads `tm_suite` directly and every consumer (TM Suite, the Cockpit, this Wiki) sees the same live truth.

Acceptance criteria:
- `server/db.js` connects to `tm_suite` using `MONGODB_URI` from env (mirrors `../TM Suite/server/db.js`'s connect/getDb/getCollection/close shape).
- `server/mongo-store.js` (replaces `server/snapshot-store.js`) exposes the same accessor names the retired module had — `getPlayers`, `getCharacters`, `getDossiers`, `getTerritories`, `getPlayerByDiscordId` — but each is now `async` and queries Mongo live, per call, instead of reading an in-memory JSON blob. `getPlayers`/`getPlayerByDiscordId` project to the auth-field whitelist (`discord_id`, `role`, `character_ids`, `discord_username`) at query time — nothing else from `players` ever leaves Mongo.
- The module contains **no write operations** anywhere — no `updateOne`/`insertOne`/`$out`/`$merge`/`db.command`/etc. This is a hard, testable constraint (reuse/adapt the lexical guard test from the retired snapshot script).
- Tests use a real ephemeral local MongoDB (in-memory or Dockerised test instance) or a well-scoped mock of the driver — never the live `tm_suite` connection. Whichever approach is chosen, justify it in dev notes.
- `server/snapshot-store.js`, `server/snapshot-store.test.js`, `scripts/snapshot.mjs`, `scripts/snapshot.test.js`, and `data/snapshot.json` are all deleted — nothing in the repo should still reference the snapshot approach.

Source hints: `../TM Suite/server/db.js`, `../TM Suite/server/config.js`, `../TM Suite/server/schemas/character_dossier.schema.js` (now has `revealed_to` — TM Suite's actual schema file, updated directly, not a mirrored copy in this repo).

### Story 1-3: discord-oauth-reuse (amended — live player lookup, redirect_uri bug fixed)

**As** a player, **I want** to log in with the same Discord account I use for TM Suite, **so that** I don't need a second login and the site knows which character(s) are mine.

**What changed from the original build**: player resolution now queries live Mongo (via story 1-2's `mongo-store.js`) instead of an in-memory snapshot — this is a smaller change than it sounds, since the accessor interface stayed the same, just made `async`. Everything else from the original story (the CSRF `state` fix, the `NODE_ENV` allowlist fix, the narrowed static-serving fix) carries forward unchanged; those were real security fixes, not snapshot-related.

Acceptance criteria (revised):
- Routes mirroring `../TM Suite/server/routes/auth.js`, using the **same** `DISCORD_CLIENT_ID`/`DISCORD_CLIENT_SECRET` as TM Suite.
- `requireAuth` middleware resolves `req.user` via a live, `await`-ed `getPlayerByDiscordId` call (story 1-2), 60s in-memory token cache unchanged.
- The whole site (every route except the OAuth routes themselves) requires a valid session — no anonymous tier.
- A player with no matching `players` record gets a clear 403, not a crash.
- Local dev bypass, `NODE_ENV`-allowlisted (`development`/`test` only — NOT a `!== production` denylist, which was the original build's fail-open bug).
- OAuth `state` CSRF protection (httpOnly cookie, constant-time comparison) — unchanged from the original build's post-review fix.

Source hints: `../TM Suite/server/routes/auth.js`, `../TM Suite/server/middleware/auth.js`, this repo's own `specs/stories/1-3-discord-oauth-reuse.md` Dev Agent Record (documents what was already built and reviewed — don't redo work that only needs the data-source swap).

### Story 1-4: netlify-render-split (new)

**As** Angelus, **I want** this repo deployed the same way TM Suite is — a static frontend on Netlify, an API on Render — **so that** the app actually works in production instead of being a single Express app with no real frontend/backend separation.

**Why this is its own story**: doing this surfaced a real bug in story 1-3's original design — Discord's OAuth redirect is always a browser GET, and the original `DISCORD_REDIRECT_URI` pointed at a POST-only backend route, which could never actually receive it. Fixing the deploy topology and fixing that bug are the same piece of work (the redirect_uri must be a frontend page), so they're one story, not two.

Acceptance criteria:
- `netlify.toml` at repo root: `publish = "public"`, no build command, a redirect rule proxying `/auth/*` to the Render API (`status = 200, force = true`, matching `../TM Suite/netlify.toml`'s `/api/*` rule shape).
- `render.yaml` at repo root: a `web` service, `rootDir: server`, `buildCommand: npm ci`, `startCommand: npm start`, env vars for `NODE_ENV`, `MONGODB_URI` (secret), `DISCORD_CLIENT_ID`/`DISCORD_CLIENT_SECRET` (secret), `DISCORD_REDIRECT_URI` (set once the Netlify domain is known — mirrors `../TM Suite/render.yaml`'s `sync: false` pattern for values that depend on the other service's URL).
- `server/index.js` no longer serves `public/` or any static file — it's an API-only Express app. All CSS/static serving moves entirely to Netlify's remit.
- `public/login.html` (or equivalent) + client JS: the actual Discord OAuth `redirect_uri` target. On load, checks the URL for `?code=&state=`; if present, POSTs `{code, state}` to `/auth/discord/callback` (proxied through to Render), stores the returned `access_token`/`user` (mirroring `../TM Suite/public/js/auth/discord.js`'s `saveAuth`/`handleCallback` pattern), and redirects to the (still placeholder, until Epic 2) landing page.
- `DISCORD_REDIRECT_URI` updated to point at this frontend page's Netlify URL, not the backend route.
- A test proving the fixed flow end-to-end at the HTTP level: hitting `GET /auth/discord` still issues the state cookie and redirects to Discord; a simulated "Discord sent the browser back with `?code=&state=`" load of the login page correctly extracts and POSTs them (this can be a lightweight DOM/fetch-mock test, not a full browser E2E, given the scope).
- README documents the manual one-time setup: Render Blueprint import, Netlify site import + publish dir, the Discord redirect URI registration (now pointing at the correct frontend URL), and which env vars are secrets vs values.

Source hints: `../TM Suite/netlify.toml`, `../TM Suite/render.yaml`, `../TM Suite/public/js/auth/discord.js`, `../TM Suite/public/js/data/api.js` (API_BASE resolution pattern — localhost in dev, empty string in prod because the proxy makes it same-origin).

---

## Epic 2 — Player-Facing Views

**Objective**: the actual pages a player opens — their world, their people, their lore — built on top of Epic 1's snapshot and auth.

### Story 2-1: character-dossier-views

**As** a player, **I want** to see my own character's full dossier and every other character's public summary, **so that** I can look up lore without ever seeing someone else's private information.

Acceptance criteria:
- A character list/index page showing all 41 characters (active and retired, retired visually distinguished), each linking to a profile page.
- Profile page: if the viewer's `character_ids` includes this character's `_id`, render the full dossier (all fields, all `character_dossier` facts including `st_hidden` ones). Otherwise render only the whitelist fields from `architecture.md` plus any `character_dossier` facts that are not `st_hidden`, or are `st_hidden` with the viewer's own character present in `revealed_to`.
- This authorization check happens server-side, in the route/projection function — the server must never send a field to the client that viewer isn't authorized to see (no "send everything, hide in CSS/JS").
- A character with little or no dossier data renders an honest, plain "not much is known" state — never a placeholder that implies missing data is a bug.
- Automated test proving the leak case explicitly: a logged-in player requesting another player's character profile never receives owner-only fields in the response, even inspecting raw JSON/HTML, not just what's visually rendered.

Source hints: `../TM Suite/public/js/data/helpers.js` (`displayName`/`sortName` convention to mirror), `../TM Suite/server/schemas/character_dossier.schema.js`.

### Story 2-2: world-tab

**As** a player, **I want** a list of who holds which office, **so that** I know who to approach in character without asking the ST in Discord.

Acceptance criteria:
- A page listing court holders / regents / office-holders, sourced from the snapshot's `territories` (`regent_id`, `lieutenant_id`) joined against `characters` for display names, plus any character `honorific` values that represent a title (Regent, Primogen, Bishop, Preacher, Harpy, etc. — read the actual honorific values present in the snapshot, don't invent a fixed enum that might miss one).
- No owner-vs-summary split needed here — office-holding is public knowledge by nature; this page does not require per-viewer projection logic beyond the login gate itself.
- Retired characters do not appear as current office-holders even if stale data suggests otherwise (the story should sanity-check this against the `retired` flag).

### Story 2-3: lore-pages

**As** a player, **I want** to read the setting primer, game guide, rules, and a friendly errata summary, **so that** I can get oriented without hunting through PDFs.

Acceptance criteria:
- Static pages served from `content/lore/*.md` (or equivalent), rendered with the ported CSS, linked from a lore/nav section.
- The "friendly errata" page is a plain-language rewrite of `../TM Suite/data/reference/` house-rules material — Angelus supplies or approves the actual rewritten text; this story's dev work is the rendering/plumbing, not authoring the copy itself (flag clearly in dev notes if placeholder copy is used pending Angelus's real text).
- These pages require login (whole-site gate) but have no per-character projection logic — same content for every viewer.

---

## Sequencing

Epic 1 must complete before Epic 2 starts (2-1 needs the snapshot's auth-relevant fields and the auth middleware from 1-2/1-3; 2-2 and 2-3 need the snapshot from 1-2). Within Epic 2, 2-1/2-2/2-3 have no ordering dependency on each other.
