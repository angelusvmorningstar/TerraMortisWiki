# Terra Mortis Wiki — Architecture

Decisions below came out of the design roundtable (Winston/Architect leading, with John/PM narrowing scope and Mary/Analyst pressure-testing edge cases) plus Angelus's direct calls. Cite this document, not the roundtable transcript, for implementation.

## Shape (revised — live reads, not a snapshot)

**Superseded design note**: the original plan here was a script Angelus ran on command to snapshot Mongo into a committed JSON file. That's retired — see `specs/prd.md` → "Revision: live reads, not a snapshot" for why. `scripts/snapshot.mjs`, `data/snapshot.json`, and `server/snapshot-store.js` no longer exist in this repo; anything referencing them is historical.

```
Browser (Netlify static site)  ──/auth/*, /api/*──▶  Netlify redirect proxy  ──▶  Render (Express API)  ──▶  tm_suite (Mongo, read-only)
       public/, no build step         (same-origin              (live, read-only              (same database TM Suite
                                        from the browser's         Mongo connection,             and the Cockpit use)
                                        point of view)             per request)
```

This is the exact two-service split TM Suite itself uses (`../TM Suite/netlify.toml` + `../TM Suite/render.yaml`), not a new pattern:

- **Netlify serves `public/` as a pure static site.** No build command, no server-rendered pages — plain HTML/CSS/JS. `netlify.toml`'s redirect rules proxy `/auth/*` (and later `/api/*`) through to the Render API with `status = 200, force = true`, so from the browser's perspective every request is same-origin against the Netlify domain, even though Render is actually serving it behind the scenes. This is also why CORS barely matters in production — it only matters for local dev, where the frontend and API run on different ports.
- **Render runs the Express API** (`server/`) — the ONLY thing in this whole system that touches Mongo, and only ever read-only. It holds a live `MONGODB_URI` (a dedicated read-only Atlas database user — a manual Atlas-console step, not something either app enforces at the client level) and queries `tm_suite` directly on each request. No committed snapshot, no rebuild ritual — a change in Mongo is visible on the next page load, everywhere (TM Suite, the Cockpit, and this Wiki all read the same live collections).
- **The API never serves static files.** `public/`'s CSS and any future frontend assets are Netlify's job entirely; Render's Express app only exposes JSON/auth routes.

## Auth — port, don't reinvent, and fix the redirect_uri bug from the first pass

TM Suite's existing pattern (`../TM Suite/server/routes/auth.js` + `../TM Suite/server/middleware/auth.js`) is:

1. `GET /api/auth/discord` redirects to Discord's OAuth2 consent screen (`identify` scope only).
2. Discord redirects the user's **browser** back to a `redirect_uri` — critically, **a frontend page** (TM Suite uses `/admin`), via a plain GET with `?code=&state=` in the query string. This is not optional: Discord's redirect is always a browser navigation, never a fetch/POST, so the redirect_uri can never be a POST-only JSON route.
3. The frontend page's JS reads `code` (and `state`, once CSRF protection is added — see below) from the URL and POSTs it to the API's `/api/auth/discord/callback`, which exchanges the code for a Discord access token, fetches the Discord profile, looks up a matching `players` document by `discord_id` (live Mongo query), and returns the Discord `access_token` plus a `user` object.
4. The frontend holds that Discord `access_token` (not a wiki-issued JWT) and sends it as `Authorization: Bearer <token>` on every subsequent request.
5. `requireAuth` middleware validates the bearer token against Discord's `/users/@me` on each request (cached 60s per token, in-memory `Map`), re-derives `req.user` from a live `players` lookup.

**The first implementation pass of this got step 2 wrong** — `DISCORD_REDIRECT_URI` was pointed directly at the backend's POST-only callback route, which Discord's GET redirect could never actually hit in a real browser. Fixed shape: `DISCORD_REDIRECT_URI` points at a frontend page served by Netlify (`public/login.html` or similar), which does the code-extraction-and-POST handoff, exactly like TM Suite's `/admin` does today (see `../TM Suite/public/js/auth/discord.js` for the exact client-side pattern to port: `login()`, `handleCallback()`, token storage).

Player resolution (`getPlayerByDiscordId`) is a live `db.collection('players').findOne({ discord_id })` — not a snapshot lookup. This is actually closer to a straight port of TM Suite's real `auth.js`/`middleware/auth.js` than the snapshot-detour the first pass built.

`players.character_ids` is already an array — multi-character-per-player is already representable even though every player has exactly one today. Do not special-case "one character" anywhere in the ownership logic.

The whole site sits behind this login. There is no anonymous/public tier in v1 (Angelus's explicit call) — except the login page itself and the OAuth routes, which necessarily can't require a session to reach.

## Data model

### Live reads

The API reads (read-only, per request, no caching layer beyond the auth token cache) from `tm_suite`:
- `characters` — full documents, all 41 (including retired).
- `character_dossier` — the existing fact-extraction collection (`facts[]`, see `../TM Suite/server/schemas/character_dossier.schema.js` for the shape already in production — `tag`/`value`/`source`/`st_hidden`/`revealed_to`/etc.).
- `players` — for the `discord_id` ↔ `character_ids` mapping the auth layer needs. The API projects to **only the auth-relevant fields** (`discord_id`, `role`, `character_ids`, `discord_username`) when building `req.user` — nothing else from this collection is ever player-facing, same privacy boundary as before, just enforced at query/projection time instead of snapshot-build time.
- `territories` — for `regent_id` / `lieutenant_id` (World tab office data).
- Lore content (primer/game guide/rules/friendly errata) — see "Lore content" below for where this actually lives.

### Character dossier field whitelist (the "summary" tier)

This is a fixed list, same shape for every character, decided in the roundtable (Option A, not ST-curated prose):
- `name` (legal), `honorific`, `moniker` (i.e. however `displayName()` already resolves it in TM Suite)
- `clan`, `covenant`, `bloodline`
- `apparent_age`
- `retired` flag
- Any `character_dossier.facts[]` entries where `st_hidden` is **not** true AND (see reveals, below) either the fact has no `revealed_to` restriction, or the current viewer's character is in it.

Everything else on the character document (attributes, skills, disciplines, merits, XP, tracker state, secrets) is **owner-only** — visible solely when the viewer's `character_ids` includes this character's `_id`.

### Reveals — extend the existing fact schema, don't fork a new one

`../TM Suite/server/schemas/character_dossier.schema.js` (the real, live-enforced source of truth — not a copy in this repo) now has `revealed_to: { type: ['array', 'null'], items: { type: 'string' } }` alongside `st_hidden`. A fact with `st_hidden: true` and `revealed_to: ['<Rene's character _id>']` is visible in Rene's view of that character's summary, live, on the next request after the fact is written — and no one else's. This is authored by Angelus via an ad hoc script from the TM Suite dev environment (there is no admin UI for this in v1 or v2), writing directly into the live `tm_suite.character_dossier` collection:
- `revealed_to`, when present, must be an array of valid `characters._id` values — the authoring script should verify referential integrity before writing (target character exists, every id in `revealed_to` exists) since nothing else will catch a typo.
- This field is **out of scope to build UI for** in v1. The schema supports it from day one; nothing in this app's routes needs to expose a way to *set* it.

Territory/map-level reveals (the Homebush example is literally a territory, not a character fact) are v2, alongside the map itself — no schema decision needed for v1 beyond not blocking it later.

### Lore content

Primer/game guide/rules/friendly-errata: **static files in this repo** (e.g. `content/lore/*.md`, rendered at build/serve time), not a new Mongo collection. Rationale: this content changes rarely, is authored by Angelus directly as prose (not extracted from play data), and per-request Mongo reads are explicitly out of scope anyway. The project's general "new reference data defaults to Mongo-backed" convention (documented in `../TM Suite/CLAUDE.md`) does not apply here — this is editorial prose content produced and edited directly in this repo, not structured game-rules data managed through an admin surface.

## Portraits

Never committed, never served. `assets/portraits/` (if it exists locally at all, e.g. for Angelus's own reference) is gitignored via `.gitignore`. Every character page and card renders a CSS-only placeholder tile (initial letter, tokenised colours) — there is no "if portrait exists, show it" branch to build; the placeholder is the only path in v1.

## CSS reuse

Port (not fork) the design tokens and components actually needed from `../TM Suite/public/css/theme.css` and `../TM Suite/public/css/components.css` — `:root` custom properties (colours, fonts, spacing), the parchment/gold-accent palette, Cinzel/Lora font stack, and any card/grid/chip component classes that fit this site's needs (e.g. `.char-card`, `.char-grid`, `.char-chip` equivalents). Follow the same rule TM Suite enforces on itself: no bare hex, no inline `style="..."`, reuse or extend a token/class, never invent a one-off.

## Directory layout (this repo, revised)

```
server/            Express API ONLY (auth, live Mongo reads) — deployed to Render, rootDir: server
  db.js             live Mongo connection (mirrors ../TM Suite/server/db.js)
  routes/, middleware/
public/             pure static site — deployed to Netlify, publish dir: public
  css/               ported design tokens/components from TM Suite
  login.html + js    the OAuth redirect_uri landing page (code/state extraction, POSTs to the API)
content/lore/       static lore markdown (primer, game guide, rules, friendly errata) — served by the API or read by the frontend at build/serve time (decided per-story)
netlify.toml        publish=public, /auth (and later /api) proxy redirects to Render
render.yaml         Render Blueprint: web service, rootDir=server, npm ci / npm start
specs/              this PRD, this architecture doc, epics.md, stories/, deferred-work.md
```

`server/` and `public/` are two independently deployed halves of one repo — exactly TM Suite's own layout, not a new pattern. Neither app serves the other's files: Render's Express app never calls `express.static`, and Netlify never runs Node.
