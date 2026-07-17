# Story 2.2: world-tab

Status: done

> **Lower authorisation stakes than 2-1, but the SAME projection discipline.** Office-holding is public knowledge by nature (per `specs/epics.md` → Story 2-2), so this page needs no owner-vs-summary per-viewer split beyond the login gate that Story 1-3 already put in front of every route. That makes it far less dangerous than Story 2-1. It does NOT make it exempt from the repo's core rule: `getCharacters()` and `getTerritories()` return FULL Mongo documents (every attribute, skill, discipline, merit, tracker value, and every territory internal field), and any response this route builds MUST be allowlist-constructed from the specific display fields it names, never a spread of a raw character or territory document. This is the exact allowlist-not-denylist discipline Story 2-1 established, applied here at lower severity. ACs tagged **[PROJECTION]** carry that discipline. Read the Dev Notes "Projection discipline (why a public page still allowlists)" section before writing the assembly function.

## Story

As a player,
I want a page listing who holds which office (territory regents, lieutenants, and titled court figures),
so that I know who to approach in character without asking the ST in Discord.

## Acceptance Criteria

1. A gated content route is mounted in `server/index.js` **after** the `app.use(requireAuth)` line, under `/api` (mirroring the existing `GET /api/me` and the Story 2-1 characters router placement). It exposes ONE read-only endpoint returning the assembled office-holder view (e.g. `GET /api/world`). No route in this file issues any Mongo write, matching the read-only guarantee of `server/mongo-store.js` and `server/routes/characters.js`.

2. The territory-office section is assembled server-side from `getTerritories()` joined against `getCharacters()`. For each territory, the response carries the territory's public label fields (`name`, falling back to `slug`) and the resolved **regent** and **lieutenant** as display objects (see AC #6 for the exact field allowlist). The regent/lieutenant join matches `territories.regent_id` / `territories.lieutenant_id` (each `['string','null']`, storing a stringified character `_id`) to `characters._id` by `String(...)`-normalising **both** sides (mirroring `findRegentTerritory` in `../TM Suite/public/js/data/helpers.js`). A territory whose `regent_id`/`lieutenant_id` is null, absent, or points at no existing (or no non-retired, per AC #5) character renders an honest **vacant** seat, never a fabricated or guessed name.

3. The court/titles section groups characters by the **actual distinct `honorific` values present in live data**, never a hardcoded enum. `honorific` is a free-text field on the character document (e.g. Regent, Primogen, Bishop, Preacher, Harpy for court offices; Lord, Lady, Doctor, Sister for personal styles) — TM Suite defines no fixed list of them (confirmed: `../TM Suite/public/js/data/helpers.js` only ever reads `c.honorific` as free text into `displayName`). The set of title groups is derived from whatever honorific values the data actually contains, so a value nobody anticipated is surfaced rather than silently dropped. A character with an empty/absent `honorific` simply contributes to no title group (honest gap, not an error). See Dev Notes "Honorific / office-holder data verification" for the mandatory live-data verification step and the office-vs-personal-style classification approach.

4. **[PROJECTION]** Every character-derived object in the response is built by **allowlist construction, never denylist deletion or a raw-document spread**. The assembly function constructs NEW objects containing only the explicitly named display fields (AC #6) — it must NOT take a full `getCharacters()` document (or a full `getTerritories()` document) and delete/omit known-sensitive keys off it, and must NOT `{ ...character }` / `{ ...territory }` anywhere on the response path. Rationale is identical to Story 2-1 AC #4: a spread or delete-based approach silently leaks any field added upstream that nobody remembered to strip, and the failure mode is a silent leak, not an error. Reuse Story 2-1's `summariseCharacter` discipline (or a small dedicated projector in this file) — the point is that a named allowlist is the only thing that ever reaches the wire.

5. **[PROJECTION]** Retired characters MUST NOT appear as current office-holders, in EITHER section, even when stale territory data still points at them. The character document's `retired === true` flag is authoritative; `territories.regent_id` can be stale (the epic calls this out explicitly). Concretely: (a) a territory whose `regent_id`/`lieutenant_id` resolves to a character with `retired === true` renders that seat as **vacant**, exactly as if the id matched no one; (b) a retired character with a court `honorific` is excluded from its title group. There is no path by which a retired character is presented as holding a current office.

6. **[PROJECTION]** The office-holder display object for any character is exactly this allowlist and no more: `_id`, `name`, `honorific`, `moniker` (the three name fields `displayName`/`sortName` need), plus the contextual office label the section supplies (e.g. the territory name for a regent/lieutenant entry, or the honorific itself for a title group). No attribute, skill, discipline, merit, XP, tracker, or dossier field appears on any office-holder object — asserted by test (AC #9). The `_id` is included so the frontend can link each office-holder to their Story 2-1 profile page (`/character.html?id=<_id>`).

7. The page requires a valid session (Story 1-3's whole-site gate) and applies NO per-viewer projection beyond that: the assembled view is identical for every logged-in viewer, because office-holding is public knowledge (epic Story 2-2). There is no owner tier, no `revealed_to` logic, and no dependence on `req.user.character_ids` anywhere in this story. A missing/invalid/expired token is handled by `requireAuth` (401) before this route runs; the route itself does not re-implement auth.

8. The view-assembly logic is a pure, separately unit-testable function (mirroring how Story 2-1 split `projectCharacterForViewer` out of the route): given the territories array and the characters array, it returns the fully-assembled, allowlist-projected office-holder view model (territory section + title-group section, with retired characters already excluded and vacant seats already marked). The HTTP route is a thin wrapper that reads the two collections and calls it. Both the pure function and the HTTP route are tested.

9. Automated tests (via the `db.setTestDb` mongodb-driver mock and the Discord `/users/@me` mock, same seams Stories 1-2/1-3/2-1 use — no live `tm_suite`, no real Discord) prove:
   - **[PROJECTION]** No office-holder object in the raw JSON response body carries any owner-only field — assert the serialised body contains none of a representative set (`attributes`, `skills`, `disciplines`, `merits`, `xp_log`, `tracker_state`). Discriminating: the test must FAIL if the projection is swapped for a raw-document spread.
   - **[PROJECTION]** A retired character who is still named as a territory's `regent_id` does NOT appear as that territory's regent (the seat is vacant), and a retired character with a court `honorific` does NOT appear in its title group.
   - A territory with a null/absent/unmatched `regent_id` (and likewise `lieutenant_id`) renders an honest vacant seat, not a crash and not an invented holder.
   - The regent/lieutenant join matches when `regent_id` is a string and `characters._id` is an ObjectId-like value (and vice versa) — a `{ toString: () => 'charX' }` stand-in proves the `String(...)` normalisation on both sides (mirror Story 2-1's `factsForCharacter` ObjectId test).
   - The title groups are derived from the fixture's actual honorific values, and a character with no `honorific` contributes to no group.

10. Frontend (Netlify static): a World / Court page (`public/world.html` + `public/js/world/world.js`, or the equivalent under an existing content directory) fetches `GET /api/world` through the shared `apiGet` helper (`public/js/data/api.js` — Bearer token, redirect-to-login on missing token or 401/403) and renders two clearly-labelled sections: territory regents/lieutenants, and court titles grouped by honorific. Each office-holder links to their Story 2-1 profile page. Display names go through the ported `displayName()` (`public/js/data/display.js`); every dynamic string goes through `esc()` before `innerHTML`. A vacant seat and an empty court render honest plain states ("Vacant", "No titled court recorded"), never a placeholder implying a bug. Retired characters need no visual treatment here because they are excluded upstream (AC #5).

11. All new CSS reuses the ported design tokens (`public/css/theme.css`) and extends the existing component vocabulary already in `public/css/components.css` (`.content`, `.content__header`, `.char-grid`, `.char-card`, `.chip`, `.portrait`, `.backlink`, `.empty-state`) rather than inventing one-off styles. Any genuinely new class (e.g. an office-row or title-group heading) is tokens-only: no bare hex, no `rgba()`, no inline `style="..."` in markup or JS-rendered HTML. British English throughout all copy (Regent, Lieutenant, Colour, Honour, capitalise).

12. **No em-dashes anywhere in any user-facing string**, including the page `<title>`. Use a colon, as the two Story 2-1 pages were corrected to do (`Terra Mortis Wiki: World`, matching `Terra Mortis Wiki: Characters`). This is a hard CLAUDE.md rule and was the exact Story 2-1 F1 review finding (an em-dash in a `<title>` is user-facing text, not an exempt code comment); do not reintroduce it. See Dev Notes "British English and no em-dashes".

## Tasks / Subtasks

- [x] Task 1: Pure office-holder assembly function (AC: #2, #3, #4, #5, #6, #8) **[PROJECTION]**
  - [x] Add a pure function (e.g. `buildWorldView(territories, characters)`) — new module `server/routes/world.js` or co-located but exported for direct unit testing (mirror `projectCharacterForViewer`'s export shape in `server/routes/characters.js`).
  - [x] Build an index of NON-retired characters by `String(_id)` for the join (retired characters excluded here so neither section can surface them — AC #5).
  - [x] Territory section: for each territory, resolve `regent_id`/`lieutenant_id` via the non-retired index (both sides `String(...)`-normalised); emit `{ territory: name || slug, regent: <holder|null>, lieutenant: <holder|null> }` where a null holder is an honest vacant seat.
  - [x] Title section: group non-retired characters that have a non-empty `honorific` by that honorific value (derived from the data, never a hardcoded enum — AC #3). Sort holders within a group by `sortName` (`moniker || name`, case-insensitive).
  - [x] Every holder object is allowlist-constructed with ONLY `_id`, `name`, `honorific`, `moniker` (reuse/adapt `summariseCharacter`'s named-field-copy shape; NEVER spread the raw character doc). Territory labels come from the territory's `name`/`slug` only (never a raw territory spread).
- [x] Task 2: Content route + endpoint (AC: #1, #7)
  - [x] `server/routes/world.js`: `GET /api/world` reads `getTerritories()` + `getCharacters()` (both read-only accessors, unchanged), calls `buildWorldView`, returns the assembled model. Wrap the store reads in try/catch returning a modelled `503 STORE_ERROR` (match `server/routes/characters.js`), never a raw Express 500.
  - [x] Mount it in `server/index.js` AFTER `app.use(requireAuth)`, alongside the Story 2-1 characters router. No new auth logic (AC #7).
  - [x] Confirm the router issues ZERO writes (only calls the read accessors).
- [x] Task 3: Server tests (AC: #8, #9) **[PROJECTION]**
  - [x] Pure-function unit tests: territory holder resolved; vacant seat on null/absent/unmatched id; retired character excluded from BOTH sections (including the stale-`regent_id`-points-at-retired case); title groups derived from fixture honorifics; character with no honorific in no group; `String(...)` join proven with an ObjectId-like `{ toString }` stand-in on both `_id` and `regent_id`.
  - [x] HTTP-level projection test: the raw JSON body carries none of the representative owner-only fields (`attributes`, `skills`, `disciplines`, `merits`, `xp_log`, `tracker_state`) on any office-holder object. Discriminating: FAILS against a raw-document-spread implementation.
  - [x] Fixtures via `db.setTestDb`; Discord `/users/@me` mocked as in `server/auth.test.js` / `server/routes/characters.test.js`; no live Mongo, no real Discord.
- [x] Task 4: Frontend World / Court page (AC: #10, #11, #12)
  - [x] `public/world.html` — `<title>Terra Mortis Wiki: World</title>` (colon, no em-dash), same `<head>` link block and `main.content` shell as `public/characters.html`, a `.backlink` to `/characters.html` (or a shared nav), two section containers.
  - [x] `public/js/world/world.js` — fetch `GET /api/world` via `apiGet`; render the territory section and the honorific-grouped title section; each holder links to `/character.html?id=<_id>`; `displayName()`/`esc()`/`portraitInitial()` from `public/js/data/display.js`; honest "Vacant" / "No titled court recorded" empty states.
  - [x] Reuse existing `components.css` classes; add only tokens-only classes for anything genuinely new (office row, title-group heading). No bare hex/`rgba()`/inline styles.
- [x] Task 5: Wiring + docs
  - [x] Add a link to the World page from the characters roster (and/or a small shared nav), so the page is reachable.
  - [x] Brief README note: the `/api/world` endpoint, that it is login-gated public data with NO per-viewer projection, and that it still allowlist-projects (the repo convention), so a later change does not regress it into a raw-document spread.
  - [x] Confirm `netlify.toml`'s `/api/*` proxy (added in Story 2-1) already covers `/api/world` — no new redirect rule needed; note this in Completion Notes rather than adding a duplicate rule.

## Dev Notes

### Projection discipline (why a public page still allowlists) **[PROJECTION]**

- **The store hands you everything.** `getCharacters()` = `characters.find({}).toArray()` and `getTerritories()` = `territories.find({}).toArray()` — full documents, no projection (`server/mongo-store.js`). A character document carries the entire sheet (attributes/skills/disciplines/merits/XP/tracker); a territory document carries internal fields (`ambience`, `ambienceMod`, `feeding_rights`, `map_coords`, `updated_at`). None of that belongs on a "who holds which office" page.
- **Office-holding is public, so there is no per-viewer split — but "public" scopes WHICH characters/offices appear, not WHICH fields.** The login gate (Story 1-3) is the only authorisation this page needs. What it does not do is license spreading a raw character or territory document into the response. Build every holder object field-by-field from the named allowlist (AC #6). This is Story 2-1's allowlist-not-denylist rule applied at lower severity: the stakes are lower (nothing here is secret-by-design), but the mechanism is identical, and the failure mode of a spread — silently shipping a newly-added upstream field — is the same. Reuse `summariseCharacter`'s shape from `server/routes/characters.js` rather than re-deriving it.
- **This is the F2 deferral's discipline, not its fix.** Story 2-1's review deferred F2 ("summary-tier facts passed through whole, not allowlist-projected") with the note "Fix in Story 2-2 (which renders facts more richly)". That routing assumption was mistaken: **Story 2-2 does not render `character_dossier` facts at all** — it reads `territories` and `characters`, never `getDossiers()`. So F2's concrete fix (projecting each visible fact field-by-field) does NOT land in this story, and F2 remains deferred in `specs/deferred-work.md`, to be picked up by whatever future story actually renders facts richly. The caution attached to F2 still stands meanwhile (do not author sensitive content into a non-hidden fact's `note`/`sheet_value`). Flag this reassignment in Completion Notes so the deferral is not mistakenly marked resolved by this story.

### Honorific / office-holder data verification (MANDATORY, do at implementation time) **[PROJECTION]**

The epic is explicit: "read the actual honorific values present in the snapshot, don't invent a fixed enum that might miss one." This is a live-Mongo reader — the authoritative set of title values lives in the live `characters` collection, not in any code file. **This spec was written without a live-Mongo connection, so it deliberately does NOT enumerate the values; that enumeration is an implementation step and must be done against live data.** Concretely:

1. **Enumerate the actual distinct honorific values.** Run a one-off, read-only query against live `tm_suite` (the same read-only Mongo the API uses), e.g.:
   ```
   db.characters.aggregate([
     { $match: { honorific: { $nin: [null, ''] }, retired: { $ne: true } } },
     { $group: { _id: '$honorific', count: { $sum: 1 }, who: { $push: '$name' } } },
     { $sort: { count: -1 } }
   ])
   ```
   (or the simpler `db.characters.distinct('honorific')`). This yields the real, current title vocabulary. Data-touching queries against live Mongo are Angelus/Peter's to run — request the output rather than assuming values.
2. **The render groups by whatever values that query returns** — the code never hardcodes `['Regent', 'Primogen', 'Bishop', ...]`. A value that appears in the data but not in anyone's mental list still gets its own group, so nothing is missed (the epic's whole point).
3. **Office-vs-personal-style classification is DATA-driven confirmation, not a pre-baked enum.** Some honorifics are court offices (Regent, Primogen, Bishop, Preacher, Harpy, and whatever else the query surfaces — Seneschal, Sheriff, Hound, Herald, Whip, Priscus are plausible but must be CONFIRMED against the query, not assumed); others are personal styles (Lord, Lady, Doctor, Sister, Father, Don). If the page separates "court offices" from "personal styles", that split is a small ST-approved classification applied ON TOP of the full derived set, with any unclassified value falling into a visible "Other titles" group rather than being dropped. Confirm the split with Angelus once the real values are in hand. If in doubt, the safe default for v1 is a single "Court and titles" section grouping by the raw honorific value — that misses nothing and invents nothing.
4. **Illustrative values in this spec are non-authoritative.** Every honorific named above comes from `specs/epics.md` and TM Suite's CLAUDE.md schema note ("`honorific` (Lord/Lady/Doctor/Sister)"), NOT from a live query. Do not ship them as the enumerated set.

### Retired flag is authoritative; territory data can be stale (AC #5)

The `retired` flag on the character document is the source of truth for whether someone currently holds office. `territories.regent_id` / `lieutenant_id` are NOT self-cleaning — a regent can retire without their old territory's `regent_id` being nulled. So the join must resolve against a NON-retired character index: build the lookup from `characters.filter(c => c.retired !== true)` and treat "id present but only matches a retired character" identically to "id matches no one" — both are a vacant seat. Test this exact stale case (a `regent_id` pointing at a `retired: true` character), because it is the failure the epic explicitly warns about.

### Where things live (real files, verified this session)

- **Store accessors**: `server/mongo-store.js` — `getCharacters()`, `getTerritories()` (both full-doc, no projection), all read-only. Keep to this interface; no new accessor is needed (filter/join in JS per request over the small roster/territory set, exactly as Story 2-1 did — negligible cost, keeps the Story 1-2 accessor surface and its lexical no-writes guard untouched).
- **Territory shape**: `../TM Suite/server/schemas/territory.schema.js` (read-only sibling repo; do not edit). Canonical fields: `_id`, `slug`, `name`, `ambience`, `ambienceMod`, `regent_id` (`['string','null']`), `lieutenant_id` (`['string','null']`), `feeding_rights`, `updated_at`, optional `type`/`map_coords`. Only `name`/`slug` (label) and `regent_id`/`lieutenant_id` (join keys) are relevant here; the rest must never reach the response.
- **The join pattern to mirror**: `findRegentTerritory` in `../TM Suite/public/js/data/helpers.js` resolves a character to their regent territory by `t.regent_id === String(c._id)`. This story does the inverse (territory → holder) but with the same `String(...)`-normalised comparison; normalise BOTH sides so an ObjectId-vs-string mismatch can neither miss a real holder nor (with the retired filter) surface a stale one.
- **Route mount point**: `server/index.js` — `app.use(requireAuth)` then `app.get('/api/me', ...)` then `app.use('/api', charactersRouter)`. Register the world router in the same region, after the gate.
- **Auth / `req.user`**: `server/middleware/auth.js` — `requireAuth` populates `req.user`. This story does NOT read `req.user` at all (no per-viewer logic, AC #7); it relies only on the gate being present so unauthenticated requests never reach the route.
- **Projection shape to reuse**: `server/routes/characters.js` — `summariseCharacter` (allowlist field-copy, `Object.freeze`d `SUMMARY_FIELDS`), `sortNameKey`, the `503 STORE_ERROR` try/catch, and the `String(...)`-normalised joins are all directly reusable patterns. Prefer reusing/adapting them over re-deriving.
- **Display helpers (frontend)**: `public/js/data/display.js` — `displayName(c)` (`honorific + ' ' + (moniker || name)`), `sortName(c)`, `esc(s)`, `portraitInitial(c)`. Already ported (pure, no redaction machinery). Reuse; do not duplicate. Note `displayName` already prepends the honorific, so a title-group heading of "Bishop" with a holder rendered via `displayName` would read "Bishop Séverin" — decide per the UX whether the group heading or `displayName` carries the title, and avoid doubling it (use `cardName`/`moniker || name` inside a titled group if the heading already states the office).
- **Authed fetch (frontend)**: `public/js/data/api.js` — `apiGet(path)` (Bearer token from `getToken(localStorage)`; redirect to `login.html` on missing token or 401/403; `{ _notFound: true }` on 404; throws on other non-OK). Reuse verbatim, as `list.js`/`profile.js` do.
- **CSS**: `public/css/components.css` already defines `.content`, `.content__header`, `.content__title`, `.content__eyebrow`, `.content__count`, `.backlink`, `.char-grid`, `.char-card`, `.chip`, `.portrait`, `.empty-state`. Reuse these. `public/css/theme.css` holds the tokens (`--gold2`, `--accent`, `--surf`, `--bdr2`, `--txt3`, `--fh`, `--fh-decorative`, `--fl`, `--ft`, etc.). Any new office-row/title-heading class is tokens-only.

### British English and no em-dashes

- British spelling in all copy: Regent, Lieutenant, Colour, Honour, Favour, capitalise, Defence, Armour.
- **No em-dashes in any user-facing string, including the `<title>`.** Story 2-1's F1 finding was precisely an em-dash in the two new pages' `<title>` tags — user-facing browser-tab text, not an exempt code comment — patched to a colon (`Terra Mortis Wiki: Characters` / `: Character`). Follow that: `Terra Mortis Wiki: World`. Code comments may use the repo's existing em-dash style; user-facing strings may not. (Separately, `public/login.html` still carries an unpatched `<title>` em-dash per `specs/deferred-work.md` Story 2-1 item 2 — this story does not touch `login.html`, so leave it; it is a one-line fix for whenever a story next edits that file.)

### Out of scope (do not build)

- The territory map / `map_coords` overlay — v2 (architecture.md → "Reveals ... Territory/map-level reveals are v2"). This story lists office-holders as text, not a map.
- Any per-viewer projection, `revealed_to` logic, or owner tier — office-holding is public (epic Story 2-2); none of that machinery applies here.
- Any write path to SET a regent/lieutenant or honorific — this story only READS. Regency and honorifics are authored in TM Suite, not here.
- `character_dossier` facts — not read by this story at all (see the F2 note above); this page joins `territories` and `characters` only.
- Lore pages (Story 2-3).

### Project Structure Notes

- New server file: `server/routes/world.js` (content router; exports `buildWorldView` for testing), mounted in `server/index.js` after the auth gate.
- New server test: `server/routes/world.test.js` — pure-function tests + the HTTP-level projection/retired tests, using the `db.setTestDb` mock and the Discord mock pattern from `server/routes/characters.test.js`.
- New frontend files: `public/world.html`, `public/js/world/world.js` (or under an existing content directory). Reuse `public/js/data/api.js` and `public/js/data/display.js` unchanged.
- Modified: `server/index.js` (mount the world router), `public/css/components.css` (only if a genuinely new tokens-only class is needed), `README.md` (endpoint note), and the characters roster / a shared nav (link to the World page). `netlify.toml` already proxies `/api/*` (Story 2-1) so `/api/world` needs no new rule.
- Layout matches the repo's two-halves split (architecture.md → "Directory layout"): `server/` is API-only (no static serving), `public/` is the Netlify static site. Do not add `express.static` to `server/index.js`.

### References

- [Source: specs/epics.md#Story 2-2: world-tab] — seed ACs (territory join, honorific-not-a-fixed-enum, retired sanity check, public-so-no-per-viewer-split)
- [Source: specs/stories/2-1-character-dossier-views.md] — the allowlist-construction discipline, `summariseCharacter`, the `String(...)`-normalised join, the `503 STORE_ERROR` pattern, and the F1 em-dash-in-`<title>` finding this story must not repeat
- [Source: specs/deferred-work.md#From Story 2-1 (character-dossier-views) review] — F2 (fact passthrough) was tentatively routed to "Story 2-2"; this story does not render facts, so F2 stays deferred (documented in Dev Notes)
- [Source: specs/architecture.md#Live reads] — `territories` read for `regent_id`/`lieutenant_id` (World tab office data); full-doc reads, projection is the route's job
- [Source: specs/architecture.md#Portraits] — CSS-only placeholder tile, no portrait branch
- [Source: server/routes/characters.js] — `summariseCharacter` (allowlist), `sortNameKey`, `503 STORE_ERROR`, `String(...)` joins to reuse
- [Source: server/mongo-store.js] — `getCharacters`/`getTerritories` return full docs, no redaction; read-only
- [Source: server/index.js] — route mount point after `app.use(requireAuth)`, alongside the characters router
- [Source: server/routes/characters.test.js] — `db.setTestDb` + Discord-mock test pattern, the ObjectId `{ toString }` join stand-in, the owner-only-field representative set
- [Source: ../TM Suite/server/schemas/territory.schema.js] — territory field shape (`regent_id`/`lieutenant_id` are `['string','null']` stringified character ids; `name`/`slug` labels)
- [Source: ../TM Suite/public/js/data/helpers.js] — `findRegentTerritory` (the `String`-normalised territory↔character join to mirror), `displayName`/`sortName`
- [Source: public/js/data/api.js] — `apiGet` authed-fetch + redirect-on-401 to reuse
- [Source: public/js/data/display.js] — `displayName`/`sortName`/`esc`/`portraitInitial` (ported, pure) to reuse
- [Source: public/css/components.css] — existing `.content`/`.char-grid`/`.char-card`/`.chip`/`.portrait`/`.empty-state` vocabulary to extend
- [Source: ../TM Suite/CLAUDE.md] — `honorific` is a free-text name field (Lord/Lady/Doctor/Sister); no fixed enum exists upstream

## Dev Agent Record

### Agent Model Used

Opus 4.8 (claude-opus-4-8[1m])

### Debug Log References

- `node --test server/routes/world.test.js` — 15/15 green (new file).
- `node --test` (full suite) — 77/77 green (62 Epic 1 / Story 2-1 baseline + 15 new). Zero regressions.
- `git diff | grep -P '^\+.*\x{2014}'` on the whole diff, plus a direct em-dash grep across every new/changed file: the only em-dash hits are code comments (CSS/JS block comments, permitted per Dev Notes "British English and no em-dashes") and test-name strings (which the existing `characters.test.js` already uses em-dashes in — 3 there — and which are not user-facing). NO em-dash in any user-facing string: the `<title>` is `Terra Mortis Wiki: World` (colon), and all rendered copy ("World and Court", "Territories", "Court and titles", "Vacant", "No titled court recorded", "No territories recorded", "Regent", "Lieutenant") is clean.
- `node --check` on `public/js/world/world.js` and `server/routes/world.js` — parse OK.

### Completion Notes List

- **Assembly is a pure, separately-tested function.** `buildWorldView(territories, characters)` (exported from `server/routes/world.js`) does all the work; the `GET /api/world` route is a thin wrapper that reads the two accessors and calls it. Both the pure function and the HTTP route are tested (AC #8).
- **Allowlist projection, no spread (AC #4/#6) [PROJECTION].** Every holder is built by `summariseHolder`, copying ONLY `_id` + the frozen `HOLDER_FIELDS` (`name`, `honorific`, `moniker`). No `{ ...character }` / `{ ...territory }` anywhere; territory labels come from `name || slug` only. The discrimination test (`server/routes/world.test.js`) proves a raw-document spread WOULD leak every representative owner-only field and that the real projection leaks none; the HTTP test asserts the same against the serialised body.
- **Retired sanity check (AC #5).** The join index is built from non-retired characters only (`c.retired !== true`), so "id matches only a retired character" is identical to "id matches no one" → a vacant seat. Tested with a stale `regent_id` (`charR`) pointing at a `retired: true` character (Renfield) with a court honorific: he appears in NEITHER section, and his name is absent from the whole serialised response.
- **String-normalised join, both sides (AC #2).** `resolveHolder` compares `String(regent_id/lieutenant_id)` against a `String(_id)`-keyed index. Proven with an ObjectId-like `{ toString }` stand-in on `_id` (string `regent_id` → ObjectId-like `_id`) and on `lieutenant_id` (ObjectId-like `lieutenant_id` → string `_id`) in one test.
- **Honorific groups are data-driven, never a hardcoded enum (AC #3).** Grouping is by whatever distinct `honorific` values the characters carry; an unanticipated value ("Nightwarden" in a test) still forms its own group; empty/absent honorific → no group. Per Dev Notes point 3, this v1 ships the "safe default" single "Court and titles" section grouped by the raw honorific value (misses nothing, invents nothing) rather than a court-office-vs-personal-style split, because that split requires confirmation against live `tm_suite` data. **The live-data honorific enumeration (the MANDATORY Dev Notes verification step) was NOT run by this agent** — per the repo rule that data-touching live-Mongo queries are Angelus/Peter's to run. Test fixtures use realistic-but-illustrative honorifics (Regent/Primogen/Bishop/Lord/Lady) that are explicitly non-authoritative; the code hardcodes none of them. If Angelus later wants the office-vs-personal-style split, it is a small classification layered on top of the already-data-driven grouping.
- **No per-viewer projection (AC #7).** The route never reads `req.user`; the assembled view is identical for every logged-in viewer. Login gating is inherited from `app.use(requireAuth)` (401-tested).
- **F2 deferral reassignment (from Story 2-1 review).** As the story's Dev Notes flagged: Story 2-1's F2 ("summary-tier facts passed through whole, not allowlist-projected") was tentatively routed to "Story 2-2", but **this story does not render `character_dossier` facts at all** — it reads `territories` and `characters` only, never `getDossiers()`. So F2's concrete fix does NOT land here and **F2 remains deferred** in `specs/deferred-work.md`, to be picked up by whatever future story renders facts richly. Do not mark F2 resolved on the back of this story.
- **netlify.toml unchanged.** The Story 2-1 `/api/*` proxy rule already covers `/api/world`; no new redirect rule was added (confirmed by reading `netlify.toml` — the `/api/*` splat forwards `/api/world` to the Render service).
- **Read-only.** `server/routes/world.js` calls only `getTerritories()` / `getCharacters()` (both read-only accessors, unchanged); it issues zero Mongo writes. `server/mongo-store.js` was not modified.

### File List

New:
- `server/routes/world.js` — `buildWorldView` (pure assembly, exported), `summariseHolder`, `HOLDER_FIELDS`, and the `GET /api/world` route.
- `server/routes/world.test.js` — pure-function unit tests + HTTP-level projection/retired tests (`db.setTestDb` + Discord `/users/@me` mock; no live Mongo, no real Discord).
- `public/world.html` — the World / Court page shell (`<title>Terra Mortis Wiki: World</title>`, two section containers, backlink to the roster).
- `public/js/world/world.js` — fetches `GET /api/world` via `apiGet`, renders the territory and honorific-grouped court sections, honest Vacant / empty states, holders link to the Story 2-1 profile page.

Modified:
- `server/index.js` — import + mount `worldRouter` on `/api` after `app.use(requireAuth)`, alongside the characters router.
- `public/css/components.css` — tokens-only World/Court classes (`.office-card`, `.office-seats`, `.office-seat`(+`--vacant`), `.title-group`(+`__heading`)); court holders reuse `.char-grid`/`.char-card`.
- `public/characters.html` — a `.backlink`-styled nav link to `/world.html` so the page is reachable.
- `README.md` — a "World / Court API (story 2-2)" section documenting the endpoint, its login-gated-public / no-per-viewer-projection nature, and that it still allowlist-projects (so a later change does not regress it into a raw-document spread).
- `specs/stories/2-2-world-tab.md` — this record.
- `specs/stories/sprint-status.yaml` — `2-2-world-tab` → `review`.

## Senior Developer Review

**3-layer adversarial review** (Blind Hunter: code only, cold read; Edge Case Hunter: code + `../TM Suite/server/schemas/territory.schema.js` + repo conventions; Acceptance Auditor: code + all 12 ACs), run independently. This is the lower-severity sibling of Story 2-1: office-holding is public, so there is no per-viewer split, but `getCharacters()` / `getTerritories()` still hand the route FULL, unredacted documents, and `buildWorldView` / `summariseHolder` are the only thing between those documents and the wire. Every [PROJECTION] AC was treated as the load-bearing surface.

**Acceptance Auditor verdict: all 12 ACs PASS**, independently re-verified against the code, not taken on the Dev Agent Record's word.

### Independent projection-discrimination re-verification (the point of this review)

I did not trust the Dev Agent Record's claim that the projection tests discriminate. I reproduced it. I reverted `summariseHolder` myself to a raw-document spread (`return { ...character };`) and ran `node --test routes/world.test.js`:

- **4 of 15 failed**, with named, projection-specific assertions (not unrelated crashes):
  - `AC #6/#8: summariseHolder builds a NEW object with ONLY the name allowlist + _id` → deep-equal failure (the spread carried the full sheet).
  - `AC #2/#8: a territory resolves its regent and lieutenant to allowlisted holders` → `AssertionError: regent leaks attributes`.
  - `PROJECTION (discrimination): a raw-document spread WOULD leak ...` → `AssertionError: real projection must not contain attributes`.
  - `AC #7/#9 [PROJECTION]: the /api/world body carries NO owner-only field on any holder` → `AssertionError: LEAK: owner-only field attributes present in world body`.
- The retired-vacancy test, the null/absent/unmatched vacant-seat test, the String()-normalised join test, the honorific-grouping test, the 401-gate test and the 503 STORE_ERROR test all **still PASSED** against the spread, proving the projection tests fail *specifically on the leak*, not on unrelated wiring.

Restored the real allowlist projection (`server/routes/world.js` is now byte-identical to its pre-review state): `15/15` world tests green, full suite `77/77`. The discrimination is genuine and captured permanently by the `PROJECTION (discrimination)` negative control in the test file.

### Lens sweep (what I checked and what held)

- **Allowlist, not denylist / no spread anywhere (AC #4/#6) — PASS.** `summariseHolder` builds a fresh `{ _id }` and copies only the three frozen `HOLDER_FIELDS`. The territory row is field-picked (`territory: name || slug`, `regent`, `lieutenant`) with no `{ ...territory }`; the title group is `{ honorific, holders }`. I traced every path from `getTerritories()` / `getCharacters()` to `res.json` and found no spread or delete: each character field (`_id`, `retired`, `honorific`, `moniker`, `name`) and each territory field (`name`, `slug`, `regent_id`, `lieutenant_id`) is read individually. No internal territory field (`ambience`, `feeding_rights`, `map_coords`, `updated_at`) can reach the wire.
- **Retired-as-stale-regent, and the "id points at no one" sibling (AC #5) — PASS.** The join index (`byId`) is built from `c.retired !== true` only, so a `regent_id` resolving to a retired character (`byId.get` misses) and a `regent_id` pointing at no character at all are the same code path: `resolveHolder` returns `null` (vacant). There is no second path by which a retired name reaches output: `summariseHolder` is called only on entries drawn from `byId` (non-retired) or inside the title loop (which `continue`s on `retired === true`). The HTTP test confirms "Renfield" appears nowhere in the serialised body.
- **regent set / lieutenant absent (and vice versa) — PASS.** Each seat resolves independently; `resolveHolder(null | undefined)` short-circuits to `null`. Fixtures T2 (retired regent + null lieutenant) and T4 (regent set + lieutenant absent) both exercised.
- **ObjectId-vs-string join, genuinely both directions — PASS.** The fixture deliberately does NOT make both sides the same type: it uses an ObjectId-like `{ toString: () => 'charObj' }` `_id` with a string `regent_id`, AND a string `_id` with an ObjectId-like `lieutenant_id`, swapped across the two seats. Both sides are `String(...)`-normalised (`byId` keyed by `String(_id)`; `resolveHolder` looks up `String(id)`), so neither direction can miss a real holder nor surface a stale one. The test would fail if either side dropped the `String(...)`.
- **No per-viewer logic (AC #7) — PASS.** The route never reads `req.user`; the assembled view is identical for every logged-in viewer. 401 gating is inherited from `app.use(requireAuth)` (tested).
- **Frontend posture (AC #10/#11/#12) — PASS.** `world.js` fetches via `apiGet`, renders both sections, links each holder to `/character.html?id=<_id>`, routes every dynamic string through `esc()` before `innerHTML`, and shows honest "Vacant" / "No titled court recorded" / "No territories recorded" states. Court headings carry the honorific and holder cards use `cardName` (moniker || name) to avoid doubling the title. All new CSS classes (`.office-card`, `.office-seat`(+`--vacant`), `.title-group`(+`__heading`)) resolve to real `theme.css` tokens (verified `--surf`, `--surf2`, `--bdr`, `--bdr2`, `--bdr3`, `--gold2`, `--accent`, `--fh`, `--fl`, `--ft`, `--txt3` all exist in both light and dark blocks); no bare hex, no `rgba()`, no inline styles.

### Independent em-dash sweep (AC #12)

I ran my own `grep -nP '\x{2014}'` across every new/modified file in scope (`world.js`, `world.test.js`, `world.html`, `js/world/world.js`, `components.css`, `index.js`, `characters.html`, `README.md`), independently of the dev's claim. The `<title>` is `Terra Mortis Wiki: World` (colon, clean). Every rendered user-facing string ("World and Court", "Territories", "Court and titles", "Regent", "Lieutenant", "Vacant", "No titled court recorded", "No territories recorded", "Unnamed territory", the status-error copy) is em-dash free. The only em-dash hits are in code comments (permitted per Dev Notes / CLAUDE.md's "output text" scope) and in `node:test` test-name strings (not user-facing; `characters.test.js` already uses the same style). AC #12 holds; the Story 2-1 F1 finding was not reintroduced.

### Findings triage

| # | Finding | Lens(es) | Severity | Disposition |
|---|---|---|---|---|
| F1 | **A whitespace-only `honorific` (e.g. `"  "`) forms a phantom title group.** The honorific skip guard is `honorific === null || honorific === undefined || honorific === ''`, which treats only the empty string as "no honorific". A value of pure whitespace is truthy-distinct from `''`, so it becomes its own `Map` key and renders a title group with a blank-looking heading. AC #3's intent is that an "empty/absent honorific simply contributes to no title group". No leak and no crash (the holder is still allowlist-projected), and it mirrors the codebase-wide non-trimming convention (`displayName`/`summariseCharacter` do not trim `honorific` either), so it is cosmetic data-hygiene only. Whether any whitespace honorific exists is unknown: the MANDATORY live-data honorific enumeration was deliberately not run this cycle (it is Angelus/Peter's live-Mongo step). | Edge Case Hunter | Low | **Deferred** to `specs/deferred-work.md`. Not patched: trimming here would diverge from the untrimmed `displayName` convention, and there is no evidence such a value exists in live data. Fold into the same pass that runs the deferred live-honorific enumeration. |

No other findings. The [PROJECTION] channel (owner-only character fields and every internal territory field) is airtight by allowlist construction, independently re-verified by the spread-discrimination run above. Story 2-1's F2 (summary-tier fact passthrough) correctly **remains deferred**: this story reads `territories` and `characters` only and never touches `character_dossier`, so F2's fix does not land here (the Dev Agent Record's reassignment note is accurate).

**Final suite: 77/77 passing** (62 Epic 1 / Story 2-1 baseline + 15 new world tests), zero regressions in Epic 1 or Story 2-1. No file outside this story's scope was modified for the review.

**No unresolved High/Medium findings remain. The [PROJECTION] allowlist is airtight (independently re-verified via a self-authored raw-document-spread revert that produced 4 named leak failures, then restored to green). All 12 ACs pass. F1 deferred with no present exposure. Status: done.**

## Change Log

- 2026-07-17: Story drafted from the epics.md Story 2-2 seed and marked ready-for-dev. ACs expanded to make the office-holder assembly, the allowlist-projection discipline ([PROJECTION], the lower-severity sibling of 2-1's [LEAK-GATE]), the retired-flag sanity check (retired characters never surface as current office-holders even against stale `regent_id` data), the live-data honorific verification (derive title groups from actual distinct values, never a hardcoded enum), and an HTTP-level projection test explicit and implementation-ready. Noted that Story 2-1's F2 deferral was tentatively routed here but does not apply (this story reads territories/characters, not dossier facts), so F2 remains deferred.
- 2026-07-17: Implemented (dev-story, Opus 4.8). Server: `server/routes/world.js` (`buildWorldView` pure assembly + `summariseHolder` allowlist + `GET /api/world`), mounted after the auth gate in `server/index.js` alongside the characters router. Frontend: `public/world.html` + `public/js/world/world.js` (two sections, honest Vacant / empty states, holders link to the profile page), tokens-only `components.css` additions, roster cross-link. Full suite 77/77 green. Status -> review.
- 2026-07-17: Senior Developer Review (3-layer adversarial, Opus). Projection discrimination independently re-verified: `summariseHolder` was reverted to a raw-document spread by the reviewer, 4/15 world tests failed with named leak/allowlist assertions (owner-only fields present in the body; the retired/vacant/join/401/503 tests still passed, proving leak-specificity), then restored to 15/15 (file byte-identical to pre-review). All 12 ACs pass; the [PROJECTION] allowlist is airtight for both channels (owner-only character fields, internal territory fields). Independent em-dash sweep clean (colon `<title>`, all rendered copy em-dash free). F1 (whitespace-only honorific forms a phantom title group; Low, cosmetic, mirrors the untrimmed `displayName` convention) deferred to `specs/deferred-work.md`. Story 2-1's F2 correctly stays deferred (this story never reads `character_dossier`). Full suite 77/77 green, zero regressions. Status -> done.
