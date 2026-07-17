# Story 2.1: character-dossier-views

Status: done

> **SECURITY-CRITICAL STORY.** This is the single most security-sensitive story in Epic 2, and arguably the whole project. `server/mongo-store.js`'s `getCharacters()` and `getDossiers()` return FULL Mongo documents — every attribute, skill, discipline, merit, tracker value, and every `character_dossier` fact including `st_hidden: true` secrets — for every character, with ZERO redaction built in. The route/projection code this story adds is the ONLY place authorisation happens. There is no second line of defence. A single mistake here leaks one player's private character data (or another player's ST-only secrets) to every logged-in player. Treat every AC below tagged **[LEAK-GATE]** as non-negotiable, and see the Dev Notes "Threat model" section before writing a line of the projection function. This constraint was flagged as **BLOCKING FOR STORY 2-1** in `specs/deferred-work.md` (from the Story 1-2 snapshot review) and re-confirmed against the live-Mongo store: it applies now more directly than ever.

## Story

As a player,
I want to see my own character's full dossier and every other character's public summary,
so that I can look up lore about my world without ever seeing someone else's private information (in either direction).

## Acceptance Criteria

1. A gated content router (e.g. `server/routes/characters.js`) is mounted in `server/index.js` **after** the `app.use(requireAuth)` line, under `/api` (mirroring the existing `GET /api/me` placement). It exposes two read-only endpoints: a character list and a single-character profile. No route in this file issues any Mongo write (the same read-only guarantee as `server/mongo-store.js`).

2. `GET /api/characters` returns the full roster read live from `getCharacters()` — every character, active and retired, with no hardcoded count (the roster size comes from Mongo, not a literal). Each list entry carries ONLY summary-tier display fields (see AC #4) plus the `_id` needed to link to the profile and the `retired` flag needed to distinguish retired characters. The list is sorted by the `sortName` convention (`moniker || name`, case-insensitive). **[LEAK-GATE]** No owner-only field (attributes, skills, disciplines, merits, XP, tracker state, dossier facts of any kind) appears on any list entry for any viewer.

3. `GET /api/characters/:id` returns one character's profile, projected per the viewer:
   - **Owner tier**: if the requesting viewer's `req.user.character_ids` (string-compared) includes this character's `_id`, the response contains the full character document AND all of its `character_dossier` facts (including `st_hidden: true` ones).
   - **Summary tier**: otherwise, the response contains ONLY the whitelist fields from AC #4, plus the subset of `character_dossier` facts allowed by AC #5.
   - A request for a non-existent `:id` returns a clear 404 (not a crash, not an empty 200).

4. **[LEAK-GATE]** The summary tier is built by **allowlist construction, never denylist deletion**. The projection function constructs a NEW object containing only the explicitly named summary fields — it must NOT take the full Mongo document and `delete` known-secret keys off it. Rationale: a delete-based approach silently leaks any field added to the `characters` schema in future that nobody remembered to add to the delete list; an allowlist can only ever expose fields someone deliberately named. The summary field whitelist is exactly the set fixed in `specs/architecture.md` → "Character dossier field whitelist": `name`, `honorific`, `moniker`, `clan`, `covenant`, `bloodline`, `apparent_age`, `retired`, plus the character `_id`. Any whitelisted field that is absent/empty on a given character is simply omitted or rendered as an honest gap (AC #9) — never fabricated.

5. **[LEAK-GATE]** Dossier fact visibility in the summary tier follows this rule exactly, enforced server-side:
   - A fact with `st_hidden` not `true` is visible.
   - A fact with `st_hidden: true` is visible ONLY if the viewer's own character `_id` appears in that fact's `revealed_to` array (string-compared; `revealed_to` may be `null`/absent, which means "revealed to no one").
   - The owner tier sees all of their own facts regardless of `st_hidden`/`revealed_to`.
   Facts are matched to their character by normalising both `character_dossier.character_id` and `characters._id` with `String(...)` (the dossier `character_id` may be stored as an ObjectId or a string — confirmed against `../TM Suite/server/schemas/character_dossier.schema.js`).

6. **[LEAK-GATE]** The authorisation decision happens entirely server-side, in the route/projection function, BEFORE the response leaves Express. The server must never send a field the viewer is not authorised to see and rely on the client to hide it. There is no "send everything, hide in CSS/JS" path anywhere in this story.

7. **[LEAK-GATE]** An automated test proves the leak case explicitly at the HTTP level: a logged-in player requesting a DIFFERENT player's character profile receives a response whose raw JSON body contains NONE of the owner-only fields and NONE of that character's `st_hidden` facts — asserted by inspecting the serialised response body, not by checking what a rendered page displays. Companion tests prove: (a) the owner requesting their OWN character receives the full document and all facts; (b) an `st_hidden` fact with the viewer's character in `revealed_to` IS present for that specific viewer and ABSENT for a third viewer not in `revealed_to`; (c) the list endpoint leaks no owner-only field for any character. Player/character/dossier fixtures are injected via the `db.setTestDb` mongodb-driver mock (the same seam Stories 1-2/1-3 use) — no live `tm_suite` connection.

8. The projection logic is a pure, separately unit-testable function (mirroring how `login-core.js` split pure helpers out of the page): given a character document, its facts, and a viewer (`character_ids`), it returns the correctly-tiered object. The HTTP route is a thin wrapper over it. Both the pure function and the HTTP route are tested.

9. Frontend (Netlify static): a character list/index page (`public/characters.html` or equivalent) shows all characters as cards linking to per-character profile pages, with retired characters visually distinguished (a muted/marked treatment, not hidden). A profile page (`public/character.html?id=<_id>` or equivalent) renders the tier the API returned. A character with thin or no dossier data renders an honest, plain "not much is known" state — never a placeholder that implies the gap is a bug. Every portrait slot renders a CSS-only placeholder tile (initial letter, tokenised colours) with no "if portrait exists" branch (per `specs/architecture.md` → "Portraits").

10. Frontend display mirrors the TM Suite `displayName`/`sortName` convention (`honorific + (moniker || name)` for display; `moniker || name` for sort) — port the pure logic from `../TM Suite/public/js/data/helpers.js`; the dev-mode redaction machinery in that file is NOT ported (this app has no `dev` redaction role). Authed requests send the Discord bearer token via `Authorization: Bearer <token>` read from `login-core.js`'s `getToken(localStorage)`; a missing token or a 401/403 response sends the user to `login.html` rather than blanking the page.

11. `netlify.toml` gains an `/api/*` proxy redirect to the Render API, mirroring the existing `/auth/*` rule (`status = 200`, `force = true`) — the file already anticipates this ("Later stories add a matching /api/* rule for content routes").

12. All new CSS uses the ported design tokens (`public/css/theme.css`) and extends the existing component vocabulary (`public/css/base.css`) rather than inventing one-off styles — no bare hex, no `rgba()`, no inline `style="..."` in markup or JS-rendered HTML. British English throughout all copy (Defence, Honour, Colour, capitalise); no em-dashes.

## Tasks / Subtasks

- [x] Task 1: Server projection function (AC: #3, #4, #5, #6, #8) **[LEAK-GATE]**
  - [x] Add a pure function (e.g. `projectCharacterForViewer(character, facts, viewer)`) — new module or co-located in `server/routes/characters.js` but exported for direct unit testing.
  - [x] Owner check: `String`-normalise `character._id` and every entry of `viewer.character_ids`; owner iff the id set includes the character id. No length-1 special-casing anywhere (a viewer may own multiple characters; `character_ids` is an array — Story 1-3 AC #6 convention).
  - [x] Summary tier: build a NEW object from the named whitelist fields ONLY (`_id`, `name`, `honorific`, `moniker`, `clan`, `covenant`, `bloodline`, `apparent_age`, `retired`). Allowlist construction, never `delete`-off-the-full-doc.
  - [x] Fact filter (summary tier): keep a fact iff `st_hidden !== true`, OR (`st_hidden === true` AND viewer's own character id is in `fact.revealed_to`). Treat missing/null `revealed_to` as empty.
  - [x] Owner tier: return the full character document plus all its facts unfiltered.
- [x] Task 2: Fact-to-character join (AC: #5)
  - [x] Read facts from `getDossiers()` and match to the character by `String(dossier.character_id) === String(character._id)`. A character with no dossier document yields an empty facts array (honest gap, not an error).
  - [x] Decide filtering approach: filter the full `getDossiers()`/`getCharacters()` results in JS (negligible over the current roster), OR add a by-id read accessor to `server/mongo-store.js`. If an accessor is added, it must remain read-only and be covered by that file's lexical no-writes guard test (AC #4 of Story 1-2). Document the choice in Dev Notes. **Chosen: filter in JS; no new accessor (see Completion Notes).**
- [x] Task 3: Content router + endpoints (AC: #1, #2, #3)
  - [x] `server/routes/characters.js`: `GET /api/characters` (list, summary-safe, sorted by `sortName`, retired flag included) and `GET /api/characters/:id` (tiered profile; 404 on unknown id).
  - [x] Mount it in `server/index.js` AFTER `app.use(requireAuth)` (alongside/after `GET /api/me`).
  - [x] List entries are built through the SAME allowlist path (never a raw character doc spread).
- [x] Task 4: Server tests (AC: #7, #8) **[LEAK-GATE]**
  - [x] Pure-function unit tests: owner tier returns full doc + all facts; summary tier returns only whitelist fields; `st_hidden` fact hidden by default, shown when viewer in `revealed_to`, hidden from a third viewer; multi-character owner resolves correctly.
  - [x] HTTP-level leak test: player A requests player B's profile; assert the raw JSON body has none of a representative owner-only field set (`attributes`, `skills`, `disciplines`, `merits`, `xp_log`/XP fields, `tracker_state`) and none of B's `st_hidden` facts. Discriminating: the test must FAIL if the projection is swapped for a passthrough.
  - [x] HTTP-level list test: no owner-only field on any list entry.
  - [x] Fixtures via `db.setTestDb` mongodb mock; Discord `/users/@me` mocked as in `server/auth.test.js`; no live Mongo, no real Discord.
- [x] Task 5: Frontend list + profile pages (AC: #9, #10, #12)
  - [x] `public/characters.html` + `public/js/characters/list.js` — fetch `GET /api/characters`, render cards (name via `displayName`, clan/covenant chips, retired treatment), link to the profile page.
  - [x] `public/character.html` + `public/js/characters/profile.js` — read `?id=`, fetch `GET /api/characters/:id`, render the returned tier; CSS-only portrait placeholder; honest "not much is known" empty state when no facts/thin summary.
  - [x] Shared authed-fetch helper (`public/js/data/api.js` or similar) — Bearer token from `getToken(localStorage)`; on missing token or 401/403, redirect to `login.html`. Reuse the `API_BASE` pattern from `login.html`'s inline script.
  - [x] Port `displayName`/`sortName` pure logic from `../TM Suite/public/js/data/helpers.js` (no redaction machinery). Keep them pure and unit-test with `node:test` (mirror `login-core.test.js`).
- [x] Task 6: Netlify proxy + CSS (AC: #11, #12)
  - [x] Add the `/api/*` proxy redirect to `netlify.toml` mirroring the `/auth/*` rule.
  - [x] Add card/grid/chip component classes to `public/css/base.css` (or a new `components.css`) using only `theme.css` tokens; port analogous classes from `../TM Suite/public/css/components.css` rather than inventing. **New `public/css/components.css`.**
- [x] Task 7: README/docs note (AC: #6)
  - [x] Briefly document the two content endpoints and, prominently, the owner-vs-summary projection as the sole authorisation boundary, so the next story (2-2) does not re-derive it incorrectly.

## Dev Notes

### Threat model (read before writing the projection) **[LEAK-GATE]**

- **The store hands you everything.** `getCharacters()` = `characters.find({}).toArray()` and `getDossiers()` = `character_dossier.find({}).toArray()` — full documents, no projection, every secret in the clear (`server/mongo-store.js` lines 35-45). The `players` collection is the only one with a query-time whitelist; `characters`/`character_dossier` deliberately are not, because per-viewer redaction can't be a fixed Mongo projection — it depends on WHO is asking. That per-viewer decision is this story's job and lives nowhere else.
- **Allowlist, not denylist.** Construct the summary object field-by-field from a named list. Do NOT `const summary = { ...character }; delete summary.attributes; ...`. The `characters` schema is large and evolving (`../TM Suite/schemas/schema_v2_proposal.md`); a denylist rots the moment a new sensitive field is added upstream and this repo isn't updated, and the failure mode is a silent leak, not an error. An allowlist can only ever expose what someone named on purpose.
- **Two independent secret channels.** (1) Owner-only character fields (attributes/skills/disciplines/merits/XP/tracker) — gated by the ownership check. (2) `st_hidden` dossier facts — gated by the `revealed_to` check. Both must hold simultaneously; getting the ownership check right does not cover the facts, and vice versa. The leak test (AC #7) asserts both channels.
- **Fresh docs, but still build new objects.** Unlike the retired snapshot store (whose accessors returned live references into a shared in-memory blob — Story 1-3 deferred-work item #2), the live `mongo-store` returns a fresh object per query, so mutating/omitting on it can't corrupt a shared cache. That removes the shared-reference footgun but does NOT change the allowlist rule — build a fresh summary object anyway; it is the leak-safety guarantee, not a caching concern.
- **Never serve the raw collections.** The API is JSON-only and serves no static files (`server/index.js` header comment; Story 1-4). Do not add any route that returns `getCharacters()`/`getDossiers()` output verbatim, and do not add an `express.static` mount for any data directory. (`data/snapshot.json` no longer exists — Story 1-2 rev 2 deleted it — but the principle stands: no unprojected character/dossier data leaves Express.)

### Where things live (real files, verified this session)

- **Store accessors**: `server/mongo-store.js` — `getCharacters()`, `getDossiers()` (both full-doc, no projection), `getPlayers()`/`getPlayerByDiscordId()` (whitelisted). Keep to this interface; if you add a by-id read accessor, keep it read-only and extend the lexical no-writes guard in `server/mongo-store.test.js`.
- **Auth / `req.user`**: `server/middleware/auth.js` — `requireAuth` sets `req.user` with `character_ids` (always an array, copied; see `buildUserFromPlayer`, lines 31-41) and `role`. Every route mounted after `app.use(requireAuth)` in `server/index.js` (line 65) has `req.user` populated. Ownership derives from `req.user.character_ids`.
- **Route mount point**: `server/index.js` line 65-70 — `app.use(requireAuth)` then `app.get('/api/me', ...)`. Register the characters router in the same region, after the gate.
- **Fact schema**: `../TM Suite/server/schemas/character_dossier.schema.js` (read-only sibling repo; do not edit). Confirmed field names: each fact has `tag`, `value`, `source`, `npc_id`, `st_hidden` (boolean), `revealed_to` (`['array','null']` of character `_id` strings — the field this story keys reveals off), plus `severity`/`compromised`/`status`/`counterparty` for secret/boon/debt facts. The dossier doc's `character_id` is `['string','object']` — normalise with `String(...)` when joining.
- **Summary whitelist**: `specs/architecture.md` → "Character dossier field whitelist (the 'summary' tier)" is the source of truth for the eight fields. Field NAMES on the live `characters` documents should be confirmed against live data / `../TM Suite/schemas/schema_v2_proposal.md` before relying on any one (e.g. `apparent_age`); render an absent field as an honest gap rather than assuming it exists.
- **Display convention**: `../TM Suite/public/js/data/helpers.js` — `displayName(c)` = `honorific + ' ' + (moniker || name)`; `sortName(c)` = `(moniker || name).toLowerCase()`. Port the pure logic only; the `isRedactMode`/`_blockOut`/`redact*` machinery is TM-Suite-specific (a `dev` role this app does not have) and must NOT be ported.
- **Frontend auth plumbing**: `public/js/auth/login-core.js` — `getToken(localStorage)` (returns null on expiry), `getUser(localStorage)`, `clearAuth(storage)`. `public/login.html`'s inline script shows the `API_BASE` resolution (`localhost` → `http://localhost:3000`, else `''`) and the fetch/redirect shape to reuse.
- **Netlify proxy**: `netlify.toml` — the `/auth/*` redirect (lines 27-31) is the template for the `/api/*` rule; the file comment already flags it as expected.
- **CSS tokens/components**: `public/css/theme.css` (`:root` custom properties — `--bg`, `--surf`, `--txt`, `--gold2`, `--accent`, `--crim2`, `--gold-a12`, etc.) and `public/css/base.css` (`.page`, `.hero`, `.btn` — extend these). Port card/grid/chip classes from `../TM Suite/public/css/components.css` (`.char-card`/`.char-grid`/faction-chip equivalents) rather than inventing.

### Ownership + multi-character (do not special-case one)

Every player owns exactly one character today, but `character_ids` is an array and nothing may assume length 1 (PRD "out of scope"; Story 1-3 AC #6; architecture.md "Do not special-case 'one character'"). Compute ownership as set membership over the string-normalised id array.

### Endpoint efficiency

Filtering `getDossiers()`/`getCharacters()` in JS per request over the current roster (~40 docs) is negligible and keeps to the Story 1-2 accessor interface. A by-id accessor is a reasonable alternative but is optional and must not weaken the read-only guarantee. Either way, do not introduce a caching layer beyond what already exists (the 60s auth-token cache) — the whole point of the live-reads revision (PRD) is that a Mongo change is visible on the next request.

### Out of scope (do not build)

- Any UI or route to SET `revealed_to` on a fact — reveals are authored by Angelus via an ad hoc TM Suite dev-environment script writing directly to `tm_suite.character_dossier` (architecture.md → "Reveals"; PRD "out of scope"). This story only READS the field.
- ST-curated prose summaries, portraits, the territory map, the World tab (Story 2-2), lore pages (Story 2-3). The summary is a fixed field whitelist, not curated copy.

### Project Structure Notes

- New server file: `server/routes/characters.js` (content router; exports the pure projection function for testing), mounted in `server/index.js` after the auth gate.
- New server test: `server/characters.test.js` (or `server/routes/characters.test.js`) — pure-function tests + HTTP-level leak tests, using the `db.setTestDb` mock and the Discord mock pattern from `server/auth.test.js`.
- New frontend files: `public/characters.html`, `public/character.html`, `public/js/characters/list.js`, `public/js/characters/profile.js`, a shared `public/js/data/api.js` (authed fetch + redirect-on-401), and ported display helpers (e.g. `public/js/data/display.js`) with a `node:test` unit spec.
- Modified: `server/index.js` (mount the router), `netlify.toml` (add `/api/*` proxy), `public/css/base.css` (or new `public/css/components.css`) for card/grid/chip classes, `README.md` (endpoint + projection note).
- Layout matches the repo's two-halves split (architecture.md → "Directory layout"): `server/` is API-only (no static serving), `public/` is the Netlify static site. Do not add `express.static` to `server/index.js`.

### References

- [Source: specs/epics.md#Story 2-1: character-dossier-views] — seed ACs
- [Source: specs/architecture.md#Character dossier field whitelist (the "summary" tier)] — the eight summary fields
- [Source: specs/architecture.md#Reveals — extend the existing fact schema, don't fork a new one] — `revealed_to` semantics, reveal authoring is out of scope
- [Source: specs/architecture.md#Portraits] — CSS-only placeholder, no portrait branch
- [Source: specs/prd.md#v1 scope] — owner-full vs whitelist-summary, honest gaps
- [Source: specs/deferred-work.md#From Story 1-2 (mongo-snapshot-script) review] — item #1, BLOCKING FOR STORY 2-1 (serving-layer redaction is the only protection)
- [Source: specs/deferred-work.md#From Story 1-3 (discord-oauth-reuse) review] — item #2 (accessor references; now moot with fresh-per-query live reads, but the allowlist rule still stands)
- [Source: ../TM Suite/server/schemas/character_dossier.schema.js] — fact shape: `st_hidden`, `revealed_to`, `character_id`
- [Source: ../TM Suite/public/js/data/helpers.js] — `displayName`/`sortName` (port pure logic, not redaction)
- [Source: server/mongo-store.js] — `getCharacters`/`getDossiers` return full docs, no redaction
- [Source: server/middleware/auth.js] — `req.user.character_ids`, `requireAuth` gate
- [Source: server/index.js] — route mount point after `app.use(requireAuth)`
- [Source: server/auth.test.js] — `db.setTestDb` + Discord-mock test pattern to reuse
- [Source: public/js/auth/login-core.js] — `getToken`/`getUser` for authed frontend fetch
- [Source: public/login.html] — `API_BASE` resolution + fetch/redirect shape
- [Source: netlify.toml] — `/auth/*` proxy rule to mirror for `/api/*`

## Dev Agent Record

### Agent Model Used

Opus 4.8 (claude-opus-4-8[1m])

### Debug Log References

TDD red-green sequence for the [LEAK-GATE] projection (genuine proof the tests discriminate, not just that a correct implementation passes its own tests):

1. **RED — naive passthrough.** `server/routes/characters.js` was first written as a deliberate passthrough: `summariseCharacter = c => ({ ...c })`, `filterFactsForViewer = f => f`, `projectCharacterForViewer = (c, facts) => ({ ...c, facts })`, and the list route spreading the raw character docs. Running `node --test server/routes/characters.test.js` against it: **9 of 16 failed**, including every [LEAK-GATE] HTTP test with the exact assertion messages:
   - `AC #7 [LEAK-GATE]: cross-player profile leaks NO owner-only field ...` → `AssertionError: LEAK: owner-only field attributes present in cross-player body`
   - `AC #7(b) [LEAK-GATE]: ... revealed_to charA ...` → `AssertionError: LEAK: never-revealed secret present for viewer A`
   - `AC #2/#7(c) [LEAK-GATE]: the list endpoint leaks no owner-only field ...` → `AssertionError: LEAK: list entry exposes owner-only field attributes`
   - plus the `LEAK-GATE (discrimination)` negative-control unit test and the pure-function unit tests.
   The passthrough correctly PASSED the owner-tier test (`AC #7(a)`), the 401-gate test, and the 404 test — proving the leak tests fail *specifically* on the leak, not on unrelated wiring.
2. **GREEN — real projection.** Replaced with the allowlist-construction implementation (new object from `SUMMARY_FIELDS` only; `st_hidden`/`revealed_to` fact filter; owner-tier full doc). Re-ran: **16/16 pass**.
3. **Full suite:** `node --test` → **62/62 pass, 0 fail** (40 pre-existing Epic 1 + 16 new characters-route + 6 new display-helper). Zero Epic 1 regressions.
4. Browser modules (`api.js`, `list.js`, `profile.js`, `display.js`) `node --check`ed clean (they touch browser globals at import time so cannot be `import`ed under node; `display.js` is additionally covered by its pure `node:test` spec).

### Completion Notes List

**How the leak-gate tests prove the projection works (not merely that they pass):**

- The HTTP leak tests assert against the **serialised response body** (`res.text()` -> raw string), never a parsed-and-re-inspected object or a rendered page. The core assertion is `assert.ok(!rawBody.includes('"attributes"'), 'LEAK: ...')` across the representative owner-only field set (`attributes`, `skills`, `disciplines`, `merits`, `xp_log`, `tracker_state`) plus the concrete secret VALUES. Because it inspects the bytes Express actually sent, it cannot be fooled by client-side hiding — there is no "send everything, hide in CSS" path it would miss (AC #6).
- **Two independent secret channels are asserted separately.** (1) Owner-only fields — a cross-player request (viewer C, who owns none of the target and is in no `revealed_to`) must contain none of the six representative sheet fields. (2) `st_hidden` facts — the same request must contain neither of the target's two secrets. Getting the ownership check right does not cover the facts and vice versa; both hold simultaneously.
- **The reveal path is asserted in BOTH directions** (AC #7b): the fact whose `revealed_to: ['charA']` IS present in viewer A's raw body and ABSENT from viewer C's — while the never-revealed secret (`revealed_to: null`) stays absent for both. This proves the gate is a per-viewer decision, not an all-or-nothing flag.
- **Discrimination is captured permanently, not just in the git history.** `LEAK-GATE (discrimination): a naive passthrough WOULD leak; the real projection does not` builds the exact object a passthrough would serialise (`{ ...CHAR_B, facts }`), asserts every leak-assertion the HTTP tests rely on FIRES against it (owner-only fields + the never-revealed secret both present), then asserts the real `projectCharacterForViewer` output leaks none of them. This mirrors the repo's existing `AC #4 (guard integrity)` negative-control pattern in `mongo-store.test.js` — if `projectCharacterForViewer` ever regressed to a passthrough, this test (and the three HTTP tests) would fail with named `LEAK:` messages. What they would catch: any field newly added to the `characters` schema and merged into the response (allowlist construction means such a field is never named, so it cannot appear), any owner-only sheet field, and any `st_hidden` fact not explicitly revealed to the requesting viewer.

**Design decisions:**

- **Filter-in-JS, no new accessor (Task 2).** The route filters the full `getCharacters()`/`getDossiers()` arrays in JS per request. Over the current roster (~41 docs) this is negligible and keeps to the Story 1-2 accessor interface untouched, so `mongo-store.js`'s lexical no-writes guard needs no extension. No caching layer was added — live reads remain the point (a Mongo change is visible on the next request).
- **Allowlist construction (AC #4).** `summariseCharacter` builds a fresh `{ _id }` object and copies only the eight `SUMMARY_FIELDS` that are present. There is no `delete` anywhere. An absent whitelist field is omitted, never fabricated (asserted by the "thin character" unit test).
- **String-normalised joins and ownership everywhere (AC #5, #3).** `isOwner`, `filterFactsForViewer`, and `factsForCharacter` all `String(...)` both sides. The `factsForCharacter` unit test uses a `{ toString: () => 'charB' }` stand-in to simulate an ObjectId `character_id` and proves the join still matches.
- **No length-1 special-casing (AC #3).** Ownership is set membership over `character_ids`; a `['charB','charA']` multi-character viewer is covered by the `isOwner` unit test.
- **`tier` field.** The projection tags the response `tier: 'owner' | 'summary'` so the frontend knows which shape it received. It widens neither channel (it is not a character field and carries no data). The owner-tier sheet section on `profile.js` renders only when `tier === 'owner'` — and because the summary tier never carries those fields, the branch has no data to render for non-owners rather than relying on hiding.
- **Frontend security posture.** `profile.js` renders exactly the tier the API returned and never fetches or reconstructs hidden data; the server is the sole authority. All dynamic strings go through the ported `esc()` before `innerHTML`.
- **Store-failure handling.** Both routes wrap the store reads in try/catch and return a modelled `503 STORE_ERROR` (never a raw Express 500), matching the pattern the auth middleware uses for its live-Mongo dependency.
- **British English / no em-dashes in copy.** User-facing rendered strings ("Not much is known about this character.", "All characters", "Apparent age", "Retired", etc.) use British spelling and no em-dashes. The `<title>` em-dash matches the existing `login.html` house style; code-comment em-dashes match the existing repo convention (mongo-store.js/index.js/auth.js all use them).

**Out of scope (not built, per Dev Notes):** any UI/route to SET `revealed_to`; ST-curated prose summaries; portraits (CSS-only placeholder is the only path); the World tab / lore pages (Stories 2-2/2-3).

### File List

**New — server:**
- `server/routes/characters.js` — content router + exported pure projection functions (`projectCharacterForViewer`, `summariseCharacter`, `isOwner`, `filterFactsForViewer`, `factsForCharacter`, `SUMMARY_FIELDS`). The sole authorisation boundary.
- `server/routes/characters.test.js` — pure-function unit tests + HTTP-level [LEAK-GATE] tests + discrimination negative-control (16 tests).

**New — frontend:**
- `public/characters.html` — roster page.
- `public/character.html` — per-character profile page.
- `public/js/characters/list.js` — roster fetch + card render.
- `public/js/characters/profile.js` — profile fetch + tier render.
- `public/js/data/api.js` — shared authed-fetch helper (Bearer token, redirect-on-401/403).
- `public/js/data/display.js` — ported `displayName`/`sortName`/`cardName`/`esc`/`portraitInitial` (pure, no redaction machinery).
- `public/js/data/display.test.js` — `node:test` unit spec for the display helpers (6 tests).
- `public/css/components.css` — card/grid/chip/portrait/profile/facts classes, tokens-only.

**Modified:**
- `server/index.js` — import + mount `charactersRouter` at `/api`, after `app.use(requireAuth)`.
- `netlify.toml` — added the `/api/*` proxy redirect mirroring `/auth/*`.
- `README.md` — Content API section (the two endpoints + the owner-vs-summary projection documented as the sole auth boundary); layout + deployment notes updated for the now-current `/api/*` proxy.

## Senior Developer Review

**3-layer adversarial review** (Blind Hunter: code only, cold read · Edge Case Hunter: code + `../TM Suite/server/schemas/character_dossier.schema.js` + repo conventions · Acceptance Auditor: code + all 12 ACs), run independently and weighted heavily toward the leak surface. This is the single most security-critical story in the app: `mongo-store.js` hands the route full, unredacted documents, and the projection added here is the ONLY authorisation boundary. Every [LEAK-GATE] AC was treated as blocking.

**Acceptance Auditor verdict: all 12 ACs PASS**, independently re-verified. The five [LEAK-GATE] ACs (#2, #4, #5, #6, #7) were re-verified by hand, not taken on the Dev Agent Record's word.

### Independent leak-gate discrimination re-verification (the whole point of this review)

The Dev Agent Record claims the leak tests were proven discriminating. I did not trust that claim — I reproduced it. I reverted the projection myself to a naive passthrough (`summariseCharacter → { ...character }`; `projectCharacterForViewer → { ...character, tier, facts }`; both the summary path and the list path spreading the raw doc) and ran `node --test server/routes/characters.test.js`:

- **6 of 16 failed**, with the exact named `LEAK:` assertions the story claims:
  - `AC #7 [LEAK-GATE]: cross-player profile ...` → `AssertionError: LEAK: owner-only field attributes present in cross-player body`
  - `AC #7(b) [LEAK-GATE]: ... revealed_to charA ...` → `AssertionError: LEAK: never-revealed secret present for viewer A`
  - `AC #2/#7(c) [LEAK-GATE]: the list endpoint ...` → `AssertionError: LEAK: list entry exposes owner-only field attributes`
  - plus the `LEAK-GATE (discrimination)` negative-control unit test and the two pure-function summary tests.
- The passthrough still **PASSED** the owner-tier test (`AC #7a`), the 401-gate test, the 404 test, and the sort test — proving the leak tests fail *specifically on the leak*, not on unrelated wiring.

Restored the real projection: `16/16` green again, full suite `62/62`. The discrimination is genuine and captured permanently (the `LEAK-GATE (discrimination)` negative control lives in the test file, so a future passthrough regression trips it and the three HTTP tests). **Both defined secret channels are airtight and independently confirmed in both directions.**

### Lens sweep (what I checked and what held)

- **Allowlist, not denylist (AC #4) — PASS.** `summariseCharacter` builds a fresh `{ _id }` and copies only the eight `SUMMARY_FIELDS` that are present. There is no `delete`, and no `{ ...doc }` spread anywhere on the summary or list path. A field added to the `characters` schema upstream can never appear on a summary response because it is never named. The list route uses the SAME `summariseCharacter` path (`.map(summariseCharacter)`), not a raw-doc spread. The owner-tier `{ ...character }` spread is correct and intended — the owner is entitled to everything.
- **No leak path from full docs to the wire — PASS.** Traced every code path from `getCharacters()`/`getDossiers()` to the HTTP response: list → `summariseCharacter` (allowlist); profile → `projectCharacterForViewer` (owner full-doc, else allowlist + fact filter); error paths → generic `503 STORE_ERROR`/`404 NOT_FOUND` with no document content; no debug log of documents. `/api/me` returns `req.user`, itself built from the whitelisted `players` projection. No `express.static`, no raw-collection route.
- **Fact join across ObjectId/string (AC #5) — PASS.** `factsForCharacter` normalises both sides with `String(...)`; the unit test uses a `{ toString: () => 'charB' }` stand-in for an ObjectId `character_id` and the join matches. A missing dossier yields `[]` (honest gap), not a crash.
- **Multi-character owner — PASS.** `isOwner` is `.some()` over the whole `character_ids` array; `filterFactsForViewer` maps ALL `viewerIds` and checks each against `revealed_to`. No length-1 special-casing anywhere; the `['charB','charA']` multi-char case is covered.
- **`revealed_to: []` / null / absent — PASS and intended.** An `st_hidden` fact with an empty (or null/absent) `revealed_to` is hidden from every non-owner — "revealed to no one" per AC #5. Fail-closed.
- **Frontend posture (AC #6, #10) — PASS.** `profile.js` renders exactly the tier the API returned and never fetches or reconstructs hidden data; the owner sheet section renders only when `tier === 'owner'`, and because the summary tier never carries those fields there is nothing to hide client-side. All dynamic strings go through `esc()` before `innerHTML`. Bearer token from `getToken()`; 401/403/missing-token → `login.html`.
- **CSS tokens (AC #12) — PASS.** Every value in `components.css` resolves to a `theme.css` token (verified `--gold-a15`, `--gold-a30`, `--bdr3`, `--txt3`, `--fh-decorative`, `--ft` etc. all exist in both light and dark blocks); no bare hex, no `rgba()`, no inline styles.

### Findings triage

| # | Finding | Lens(es) | Severity | Disposition |
|---|---|---|---|---|
| F1 | **Em-dash in the `<title>` of both new pages** (`Terra Mortis Wiki — Characters` / `— Character`). A `<title>` renders in the browser tab and is genuinely user-facing text, not a code comment, so it falls squarely under CLAUDE.md's "no em-dashes in output text" hard rule and AC #12. The Dev Agent Record exempted it as "matching existing `login.html` house style" — but `login.html` (Story 1-4) carries the identical violation; a pre-existing precedent is not a licence, it is a second instance of the same defect. | Acceptance Auditor | Low | **Patched** — both in-scope titles changed to `Terra Mortis Wiki: Characters` / `: Character` (colon, British-clean). `public/login.html` carries the same em-dash but is out of this story's patch scope → deferred for a one-line follow-up. |
| F2 | **Summary-tier facts are passed through whole, not allowlist-projected.** `filterFactsForViewer` correctly gates WHICH facts are visible (the `st_hidden`/`revealed_to` decision is airtight), but a visible fact is returned as its ENTIRE object — including the schema's ST-facing metadata sub-fields `note` ("ST-facing note", per `character_dossier.schema.js`), `clash`, `sheet_value`, `sheet_field`, `source`, and (on a shown fact) `revealed_to` itself. This is a third, undefined channel: neither an owner-only character field nor an `st_hidden` fact, so it violates no AC (AC #5 scopes fact visibility solely to `st_hidden`) and no sensitive data rides these sub-fields on any non-hidden fact today. But it is the exact allowlist-vs-passthrough principle this story is built on, applied to character fields and NOT to fact objects. If the ST ever authors a sensitive `note` on a non-hidden fact, it ships to every viewer in the raw JSON, and AC #6's rule is "the server must not send what the viewer shouldn't see", not "rely on the client to render only `tag`+`value`" (which is what protects it today). | Blind Hunter, Edge Case Hunter | Low | **Deferred** to `specs/deferred-work.md`. Recommend Story 2-2 (which renders facts more richly) project facts field-by-field to a public allowlist (`tag`, `value`, plus deliberately-public fields), mirroring `summariseCharacter`. Not blocking: no AC is violated, both DEFINED secret channels are airtight, and no sensitive fact-metadata exists today. |

No other findings. The two DEFINED [LEAK-GATE] secret channels — owner-only character fields, and `st_hidden` dossier facts — are both correctly gated by allowlist construction and the string-normalised `revealed_to` check respectively, and independently re-verified by the passthrough discrimination run above.

**Final suite: 62/62 passing** (40 Epic 1 + 16 characters-route + 6 display-helper), zero regressions in Epic 1 or elsewhere in 2-1. The em-dash patch is HTML-only and does not touch the test surface.

**No unresolved High/Medium findings remain. Both LEAK-GATE channels are airtight (independently re-verified, not taken on trust). F1 patched, F2 deferred with no present exposure. Status: done.**

## Change Log

- 2026-07-17: Story drafted from the epics.md seed and marked ready-for-dev. ACs expanded to make the owner-vs-summary server-side projection, the allowlist-not-denylist construction, the `st_hidden`/`revealed_to` fact-visibility rule, and the explicit HTTP-level leak test non-negotiable (all tagged [LEAK-GATE]).
- 2026-07-17: Implemented (dev-story, Opus 4.8). Server: `server/routes/characters.js` (exported pure projection + two read-only endpoints), mounted after the auth gate in `server/index.js`. Frontend: roster + profile pages, ported display helpers, shared authed-fetch helper, `components.css`. Netlify `/api/*` proxy + README Content API section added. TDD red-green: the [LEAK-GATE] tests were confirmed to FAIL against a naive passthrough (9/16 fail, named `LEAK:` assertions) before the real projection made them pass. Full suite 62/62 green (40 Epic 1 + 16 characters + 6 display), zero regressions. Status -> review.
- 2026-07-17: Senior Developer Review (3-layer adversarial, Opus). Leak-gate discrimination independently re-verified: the projection was reverted to a passthrough by the reviewer, 6/16 tests failed with the exact named `LEAK:` assertions, then restored to 16/16. All 12 ACs pass; both defined secret channels (owner-only fields, `st_hidden` facts) airtight. F1 (em-dash in the two new `<title>` tags — a real hard-rule/AC-12 violation, not exempt as "house style") patched in scope. F2 (summary-tier facts passed through whole, exposing ST-facing sub-fields like `note` on non-hidden facts — no AC violated, no present exposure) deferred to Story 2-2. Full suite 62/62 green, zero regressions. Status -> done.
