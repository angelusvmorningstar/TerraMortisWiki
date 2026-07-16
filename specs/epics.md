# Terra Mortis Wiki — Epics &amp; Stories

Source: `prd.md` (product scope) + `architecture.md` (technical shape). Six stories across two epics deliver v1 exactly as scoped — no more, no less. Anything raised in the design roundtable that isn't covered here (the map, reveal-authoring UI, ST-curated summaries) is deliberately deferred; do not fold it into these stories.

---

## Epic 1 — Foundation &amp; Data Pipeline

**Objective**: stand up the repo skeleton, the read-only snapshot pipeline, and Discord OAuth, so every later story has real data and a real login to build against.

### Story 1-1: repo-scaffold-and-css-tokens

**As** the developer of this app, **I want** an Express app skeleton with TM Suite's design tokens ported in, **so that** every later page has a consistent visual language from the start instead of retrofitting it.

Acceptance criteria:
- `npm start` runs a minimal Express server serving a placeholder home page using the ported CSS.
- `public/css/` (or equivalent) contains only the tokens/components actually used so far — colour custom properties, font stack (Cinzel/Lora via Google Fonts, matching TM Suite's existing `<link>` pattern), base layout. No bare hex or inline styles anywhere in the ported files or new markup.
- A basic test harness exists (this is the first story in the repo — pick the simplest fit for a small Express app, e.g. a lightweight test runner hitting the server with a request; do not over-engineer).
- `.gitignore` includes a portraits directory and `node_modules`, `.env`.
- README (or CLAUDE.md addendum) states how to run it locally.

Source hints: `../TM Suite/public/css/theme.css`, `../TM Suite/public/css/components.css` (read, don't guess at token names — copy what's really there).

### Story 1-2: mongo-snapshot-script

**As** Angelus, **I want** a script I run on command that reads `tm_suite` read-only and writes a committed JSON snapshot, **so that** the site's data reflects reality without ever giving the deployed app live database access.

Acceptance criteria:
- `scripts/snapshot.mjs` connects to `tm_suite` using `MONGODB_URI` from a local `.env` (never committed), reads `characters`, `character_dossier`, `players` (auth fields only — `discord_id`, `role`, `character_ids`, `discord_username`), and `territories` (for `regent_id`/`lieutenant_id`).
- Output written to `data/snapshot.json` (or clearly-named per-collection files under `data/`), deterministic and diff-friendly (stable key ordering) so commits show real changes.
- The script is read-only against Mongo — no `updateOne`/`insertOne`/etc. anywhere in it. This is a hard constraint per `CLAUDE.md`.
- Extend `character_dossier`'s fact shape with the `revealed_to` field as documented in `architecture.md` (schema support only — no authoring UI, no route uses it yet beyond the projection logic in story 2-1 reading it).
- Running the script twice with no Mongo changes produces byte-identical output (proves determinism).
- A short section in this story's dev notes documents exactly how Angelus invokes it (command, expected runtime, what "success" looks like) since this is a manual, recurring operation.

Source hints: `../TM Suite/server/config.js` (Mongo URI env var convention), `../TM Suite/server/schemas/character_dossier.schema.js` (fact shape to extend), `../TM Suite/server/db.js` (connection pattern, read-only user setup is new — don't copy write-capable credentials).

### Story 1-3: discord-oauth-reuse

**As** a player, **I want** to log in with the same Discord account I use for TM Suite, **so that** I don't need a second login and the site knows which character(s) are mine.

Acceptance criteria:
- Routes mirroring `../TM Suite/server/routes/auth.js`: a redirect-to-Discord route and a callback route, using the **same** `DISCORD_CLIENT_ID`/`DISCORD_CLIENT_SECRET` as TM Suite (same Discord application, second registered redirect URI — this is a config/registration step Angelus does in Discord's developer portal, not a code change; document it as a manual setup step in dev notes).
- `requireAuth` middleware mirroring `../TM Suite/server/middleware/auth.js`: validates the bearer token against Discord, resolves `req.user` from the snapshot's `players` data (not live Mongo), 60s in-memory cache.
- The whole site (every route except the OAuth routes themselves) requires a valid session — no anonymous tier.
- A player with no matching `players` record gets a clear 403, not a crash.
- Local dev bypass for testing mirrors the existing pattern's spirit (a non-production-only test path) — do not weaken it to work in production.

Source hints: `../TM Suite/server/routes/auth.js`, `../TM Suite/server/middleware/auth.js` (read both fully before implementing — port the pattern, adapt the collection source to the snapshot).

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
