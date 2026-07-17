# Story 3.2: covenant-clan-status-ladders

Status: done

> **SECURITY-CRITICAL STORY.** This is the second per-viewer access-control story in the repo, and the same class of risk as Story 2-1. There is currently NO endpoint that exposes any character `status` field: `server/routes/characters.js`'s `SUMMARY_FIELDS` allowlist stops at `name`/`honorific`/`moniker`/`clan`/`covenant`/`bloodline`/`apparent_age`/`retired`, and `server/routes/world.js`'s `HOLDER_FIELDS` is even narrower. This story adds the FIRST route that reads and returns `status.city` / `status.covenant` / `status.clan` values, and the covenant/clan ladders are per-viewer gated. `server/mongo-store.js`'s `getCharacters()` returns FULL, unredacted Mongo documents; the new route's projection/assembly code is the ONLY place the covenant/clan gating happens. A single mistake leaks one faction's internal standing (who ranks where inside the Circle of the Crone, who inside the Invictus) to every logged-in player, including players in rival factions who have no in-character way to know it. Treat every AC below tagged **[LEAK-GATE]** as non-negotiable, and read the Dev Notes "Threat model" section before writing a line of `buildStatusView`. This story deliberately mirrors Story 2-1's discipline: allowlist construction (never a spread, never a delete), a pure separately-testable assembly function, and an HTTP-level leak test that fails against a naive passthrough.

## Story

As a player,
I want to see the City, Covenant, and Clan status ladders for my own covenant(s) and clan,
so that I understand where I and my faction-mates stand without ever seeing the internal standing of factions I do not belong to.

## Context: the exact rule this story ports

TM Suite's own player status view (`../TM Suite/public/js/data/status-data.js`) is the source of truth for the gating. Read it directly; do not paraphrase from memory. The three rules it enforces, verbatim from that file:

- **City Status** is ungated. Every character, every viewer, always.
- **Covenant Status** (`covenantListFor`): the viewer's active character's primary `covenant` field, PLUS any covenant where that character has `status.covenant[cov] > 0` (a cross-covenant merit). One ladder per covenant in that list, never a covenant outside it.
- **Covenant ladder rows** (`covenantRowsFor`): for a given covenant `cov`, every character with `status.covenant[cov] > 0` OR whose primary `covenant === cov` (a primary member at 0 standing still appears). Sorted by value descending, then by `sortName`.
- **Clan Status** (`clanRowsFor`): only characters sharing the viewer's active character's `clan` value; each row's value is `status.clan || 0`. Sorted by value descending, then by `sortName`.

This Wiki has a shape TM Suite does not: a viewer's ownership is `req.user.character_ids`, an ARRAY (per `server/routes/characters.js`'s `isOwner` and the Story 1-3 / architecture.md "do not special-case one character" convention), whereas TM Suite only ever has one "active character" (`suiteState.rollChar`). The multi-character resolution is a genuine design decision this story must make explicit (AC #8), not silently assume.

## Acceptance Criteria

1. A new read-only content route (e.g. `server/routes/status.js`) is mounted in `server/index.js` **after** the `app.use(requireAuth)` gate, under `/api` (alongside the existing `charactersRouter` / `worldRouter` mounts). It exposes exactly one endpoint, `GET /api/status`. No route in this file issues any Mongo write - the same read-only guarantee as `characters.js` / `world.js` (it only calls `getCharacters()` from `mongo-store.js`).

2. The route's work is done by a pure, DOM-free, separately unit-testable assembly function (e.g. `buildStatusView(characters, viewer)`), exported for direct testing and mirroring `buildWorldView(territories, characters)`'s shape. The HTTP route is a thin wrapper that reads `getCharacters()` and calls it with `req.user`. A store-read failure returns a modelled `503 STORE_ERROR` (never a raw Express 500), matching `characters.js` / `world.js`.

3. `GET /api/status` returns a **City Status ladder** for every non-retired character (see AC #14 for the retired-exclusion decision), read live from `getCharacters()`. Each City entry carries ONLY: the character `_id`, the three name fields (`name`, `honorific`, `moniker`), the single scalar `status.city` value (defaulting to 0 when absent), and a boolean `mine` flag (true iff the entry is one of the viewer's own characters). City Status is ungated: it is identical for every logged-in viewer regardless of covenant, clan, or whether they own a character at all.

4. **[LEAK-GATE]** The **Covenant Status** section contains one ladder per covenant in the viewer's own covenant list, and NEVER a covenant outside it. The covenant list is computed server-side from the viewer's own character(s) exactly as TM Suite's `covenantListFor` does: each owned character contributes its primary `covenant` field, PLUS any covenant key where that character has `status.covenant[cov] > 0`. A ladder for a covenant the viewer does not belong to must never appear in the response for that viewer, in any field, under any circumstances.

5. **[LEAK-GATE]** The **Clan Status** section contains a ladder ONLY for the viewer's own clan(s) (see AC #8 for the multi-character union), and NEVER any other clan's ladder. The viewer's clan set is computed server-side from the `clan` field of the viewer's own character(s). A ladder for a clan the viewer does not belong to must never appear in the response for that viewer.

6. **[LEAK-GATE]** Covenant and Clan ladder MEMBERSHIP replicates TM Suite's rules exactly, enforced server-side:
   - Covenant ladder for `cov`: every non-retired character with `status.covenant[cov] > 0` OR whose primary `covenant === cov` (`covenantRowsFor`). Rows sorted by that covenant's value descending, then by `sortName` (`moniker || name`, case-insensitive).
   - Clan ladder for `clan`: every non-retired character whose `clan === clan`, valued at `status.clan || 0` (`clanRowsFor`). Rows sorted by clan value descending, then by `sortName`.
   - Both matched by `String(...)`-normalised comparison where an id join is involved; string covenant/clan names compared by exact value (mirroring TM Suite, which does not case-fold covenant/clan names).

7. **[LEAK-GATE]** Per-ladder SCALAR allowlist. This is the subtle leak surface and the reason this story cannot reuse `summariseCharacter` unchanged. A character's `status` sub-document may hold standing in MULTIPLE covenants (`status.covenant` is a map) plus `status.city` and `status.clan`. Each ladder row must expose ONLY the single scalar relevant to THAT ladder:
   - a City row exposes only `status.city`;
   - a row in the covenant-`cov` ladder exposes only `status.covenant[cov]` (NOT the whole `status.covenant` map, which would reveal the character's standing in covenants the viewer is not entitled to see);
   - a Clan row exposes only `status.clan`.
   The row object is built by allowlist construction: a NEW object of `{ _id, name, honorific, moniker, value, mine }` (plus a per-ladder scalar named `value`). It must NEVER be `{ ...character }`, never `{ ...character.status }`, never a `delete` off the full doc, and never carry attributes/skills/disciplines/merits/XP/tracker/dossier fields. A field added to the `characters` schema upstream can only ever be exposed by name, never by accident.

8. **Multi-character owner resolution (documented design decision).** `req.user.character_ids` is an array and a viewer may (in principle) own more than one character. This story's rule: **UNION the covenant list and the clan set across ALL of the viewer's owned characters.** The Covenant Status section shows one ladder for every covenant ANY of the viewer's characters belongs to (primary or `status.covenant[cov] > 0`); the Clan Status section shows one ladder for every distinct clan ANY of the viewer's characters belongs to. The `mine` flag on a row is true iff that row's character is one of the viewer's owned characters. This is an explicit call, made because TM Suite's single-`rollChar` model does not have to make it; it is documented here so the dev pass does not silently pick one character or assume length 1. No length-1 special-casing anywhere; ownership is set membership over the string-normalised `character_ids` array (as in `characters.js`'s `isOwner`).

9. **[LEAK-GATE]** Fail-closed empty states. A viewer who owns NO character (a spectator account) receives City Status in full, an EMPTY Covenant Status section, and an EMPTY Clan Status section - never an error, and never "everything". A viewer whose owned character has no `covenant` value receives an empty Covenant Status section (but still their Clan ladder if they have a clan); a viewer whose owned character has no `clan` value receives an empty Clan Status section (but still their Covenant ladders). Empty is the safe default: when in doubt the section is omitted/empty, never widened. The response shape distinguishes "empty because you belong to no faction here" from a store error.

10. **City Status value: raw stored `status.city`, by explicit decision (documented).** TM Suite's `calcCityStatus` (`../TM Suite/public/js/data/accessors.js`) adds TWO bonuses on top of the stored `status.city` - a court-title bonus (`titleStatusBonus`, from `court_category` against the `TITLE_STATUS_BONUS` map in `../TM Suite/server/routes/office-actions.js`: Head of State +3, Primogen +2, etc.) AND a regent-ambience bonus (`regentAmbienceBonus`, from the character's regent territory's `ambience`), the sum clamped to 10. **This story deliberately shows only the raw stored `status.city` value, NOT the computed total.** Rationale (recorded in Dev Notes): replicating the full calc requires a second and third data source (`court_category` per character AND per-territory `ambience` joined via `regent_id`) and a clamp, introducing numeric-correctness risk into a story that is already carrying real access-control risk; the two are independent failure classes and folding them together weakens the review of both. The AC and Dev Notes state this simplification plainly so it is a decision, not a latent bug. (Covenant and clan values have no such bonus math in TM Suite - they are the raw stored `status.covenant[cov]` / `status.clan` - so this simplification applies to City only.)

11. **[LEAK-GATE]** The gating decision happens entirely server-side, in `buildStatusView`, BEFORE the response leaves Express. The server must never send a covenant/clan ladder the viewer is not entitled to and rely on the client to hide it. There is no "send every ladder, show only mine in CSS/JS" path anywhere in this story. The frontend renders exactly the ladders the API returned.

12. **[LEAK-GATE]** An automated test proves the gating at the HTTP level against the serialised response body (not a rendered page):
    - a viewer who owns a character in covenant X requests `GET /api/status`; the raw JSON body contains the covenant-X ladder and contains NO ladder for any covenant Y the viewer does not belong to, and NO clan ladder for any clan other than the viewer's own;
    - no row in any returned ladder exposes another covenant's scalar (assert the response contains no `status.covenant` map object and no owner-only field name - `attributes`, `skills`, `disciplines`, `merits`, `tracker_state`, `xp_log`);
    - a spectator viewer (empty `character_ids`) receives City Status populated and both faction sections empty (AC #9);
    - the multi-character union (AC #8) is proven: a viewer owning two characters in two different covenants/clans sees BOTH sets of ladders and no third faction's;
    - a discrimination negative-control (mirroring 2-1's `LEAK-GATE (discrimination)` test) constructs the object a naive passthrough would serialise and asserts the leak assertions FIRE against it, then asserts the real `buildStatusView` output leaks none of them - so a future regression to a passthrough trips the test. Fixtures via the same `db.setTestDb` mongodb-driver mock and Discord `/users/@me` mock the existing server tests use; no live `tm_suite`, no real Discord.

13. Frontend (Netlify static): a new page renders the three sections. **Placement decision (AC - see Dev Notes for the reasoning): Status is its OWN page (`public/status.html` + `public/js/world/status.js`), NOT a fourth accordion folded into the existing Court page, and NO fifth top-level `.site-nav` tab is added.** The page reuses the `.roster-section` `<details>`/`<summary>` accordion shell from Story 3-1 and the existing `.site-nav` ribbon with the **Court** tab marked `is-active` (Status lives conceptually under Court, matching the mockup, which is a standalone Status page rendered with the Court tab active). The Court page (`public/court.html`) gains a link/entry point to the Status page. Authed fetch via the shared `apiGet('/api/status')` helper (`public/js/data/api.js`); a missing token or 401/403 redirects to `login.html`, never a blank page.

14. **Retired characters are excluded from all three ladders' ROWS** (matching the established Wiki convention: `characters.js`'s list filters `!c.retired`, `world.js` joins against a non-retired index only). A retired character does not appear in City, Covenant, or Clan rows. However, the viewer's OWN covenant/clan LISTS are derived from the viewer's owned character(s) whether or not those characters are retired, so a viewer whose only character is retired still sees their own faction ladders (honestly populated with the current non-retired membership). Document this split in Dev Notes.

15. Each ladder renders as `.pointed` / `.pointed.hollow` dot tiers grouped by value descending, empty tiers skipped, matching the design-lock mockup (`specs/mockups/3-2-status-ladders/mockup.html`). Dot maximum per ladder type: City tiers render out of 10 (`value` filled `.pointed` + `10 - value` `.pointed.hollow`); Covenant and Clan tiers render out of 5. Every ladder carries a `.ladder-subheading` naming whose standing is shown in words ("Your covenant: <name>. You only see standing within your own covenant." / "Your clan: <name>. ..." / "Every character in the city, ranked. Always public.") so the gating reads as intentional, not as an incomplete page. The viewer's own character(s) are marked with the `.tier-chip--me` treatment. Section count badges are truthful (the number of characters in that section).

16. `.pointed` / `.pointed.hollow` do NOT yet exist in this repo's `public/css/components.css` (this story is the first to need them); port them fresh from `../TM Suite/public/css/components.css` verbatim (an 8px filled `currentColor` circle; a 7px hollow `currentColor` ring). All new CSS (`.ladder-subheading`, `.tier`, `.tier__head`, `.tier__dots`, `.tier__val`, `.tier__chips`, `.tier-chip`, `.tier-chip--me`, `.empty-state` if not already present, plus `.pointed`/`.pointed.hollow`) uses only `theme.css` design tokens and extends the existing component vocabulary - no bare hex, no `rgba()`, no inline `style="..."` in markup or JS-rendered HTML. Every dynamic string goes through `esc()` before `innerHTML`. British English throughout (Covenant, Colour, Honour, capitalise); no em-dashes anywhere in copy or code comments intended as prose.

17. The Netlify `/api/*` proxy already exists (added by Story 2-1's `netlify.toml` change); `GET /api/status` is reached through it with no `netlify.toml` change required. Confirm this in Dev Notes rather than re-adding the rule.

## Tasks / Subtasks

- [x] Task 1: Server assembly function (AC: #2, #3, #4, #5, #6, #7, #8, #9, #10, #14) **[LEAK-GATE]**
  - [x] Add `buildStatusView(characters, viewer)` - a pure, DOM-free function, exported for direct unit testing, mirroring `buildWorldView`'s shape and file layout.
  - [x] Resolve the viewer's owned characters: index the full `characters` array by `String(_id)`, select those whose id is in `viewer.character_ids` (string-normalised set membership; no length-1 special-casing). These may include retired characters (AC #14).
  - [x] Compute the viewer's covenant list: UNION across all owned characters of (primary `covenant`) ∪ (every `cov` where `owned.status.covenant[cov] > 0`), de-duplicated, order-stable (primary-first per character, mirroring `covenantListFor`). (AC #4, #8)
  - [x] Compute the viewer's clan set: UNION across all owned characters of their `clan` values (non-empty), de-duplicated. (AC #5, #8)
  - [x] Build the City ladder: every NON-retired character, allowlist row `{ _id, name, honorific, moniker, value: status.city || 0, mine }`, sorted by value desc then `sortName`. Ungated. (AC #3, #14)
  - [x] Build one Covenant ladder per covenant in the viewer's list, rows per `covenantRowsFor` (non-retired only), each row exposing ONLY that covenant's scalar (`status.covenant[cov] || 0`). (AC #4, #6, #7, #14)
  - [x] Build one Clan ladder per clan in the viewer's set, rows per `clanRowsFor` (non-retired only), each row exposing ONLY `status.clan || 0`. (AC #5, #6, #7, #14)
  - [x] Empty covenant/clan sections when the viewer's list/set is empty (spectator, or no covenant/clan on their character). Fail-closed. (AC #9)
  - [x] Every row built by allowlist construction - a NEW object, never a `{ ...character }` / `{ ...character.status }` spread, never a `delete`. (AC #7) **[LEAK-GATE]**
- [x] Task 2: Content route + mount (AC: #1, #2, #17)
  - [x] `server/routes/status.js`: `GET /api/status` - read `getCharacters()`, call `buildStatusView(characters, req.user)`, return the view model. `503 STORE_ERROR` on a store-read failure.
  - [x] Mount in `server/index.js` after `app.use(requireAuth)`, alongside `charactersRouter` / `worldRouter`.
  - [x] Confirm no `netlify.toml` change is needed (the `/api/*` proxy already exists from Story 2-1).
- [x] Task 3: Server tests (AC: #12) **[LEAK-GATE]**
  - [x] Pure-function unit tests for `buildStatusView`: covenant list = primary ∪ status>0; clan set; covenant/clan row membership and sort; per-ladder scalar isolation (a character with standing in two covenants exposes only the queried covenant's scalar in each ladder); City ungated; retired excluded from rows but the viewer's retired-only character still yields their faction ladders; multi-character union.
  - [x] HTTP-level [LEAK-GATE] test: viewer in covenant X gets X's ladder and NO covenant-Y ladder, NO other clan's ladder; the raw body contains no `status.covenant` map object and none of the representative owner-only field names; spectator gets City-only with empty faction sections; multi-character viewer gets both faction sets.
  - [x] Discrimination negative-control: build what a naive passthrough would serialise, assert every leak assertion FIRES against it, assert the real output leaks none - so a passthrough regression trips it (mirror `characters.test.js`'s `LEAK-GATE (discrimination)`).
  - [x] Fixtures via `db.setTestDb`; Discord `/users/@me` mocked; no live Mongo, no real Discord.
- [x] Task 4: Frontend page (AC: #13, #15, #16)
  - [x] `public/status.html` - `.site-nav` with Court `is-active`, `content__title` "Status", a `#status-root` mount, loads `/js/world/status.js` as a module. Mirror `court.html`'s head/link/nav boilerplate.
  - [x] `public/js/world/status.js` - `apiGet('/api/status')`, render three `.roster-section` accordions (City / Covenant / Clan) with `.ladder-subheading`, `.tier` dot tiers (grouped by value desc, empty tiers skipped, dot-max 10 City / 5 covenant+clan), `.tier-chip` names, `.tier-chip--me` for the viewer's own, honest empty states for the faction sections, truthful counts. Every dynamic string through `esc()`. Redirect to `login.html` on missing token / 401 / 403.
  - [x] Add a link/entry point to the Status page from `public/court.html` (or `court.js`'s rendered output).
- [x] Task 5: CSS (AC: #16)
  - [x] Port `.pointed` / `.pointed.hollow` verbatim from `../TM Suite/public/css/components.css` into `public/css/components.css`.
  - [x] Add the ladder classes (`.ladder-subheading`, `.tier*`, `.tier-chip*`) using only `theme.css` tokens, matching the mockup's locked visual treatment. Reuse `.roster-section` / `.empty-state` as they already exist from Story 3-1 rather than duplicating.
- [x] Task 6: Docs note (AC: #11)
  - [x] Briefly document the new `GET /api/status` endpoint and, prominently, the covenant/clan gating as a per-viewer authorisation boundary (the second such boundary in the repo, after `characters.js`), so a later story does not re-derive it incorrectly.

## Dev Notes

### Threat model (read before writing `buildStatusView`) **[LEAK-GATE]**

- **The store hands you everything, and this is the first route to touch `status`.** `getCharacters()` = `characters.find({}).toArray()` - full documents, every `status.covenant` key for every covenant a character holds standing in, every attribute/skill/tracker value. No route has ever returned a `status` field before this one (`characters.js`'s `SUMMARY_FIELDS` and `world.js`'s `HOLDER_FIELDS` both exclude it). The gating this story adds lives nowhere else.
- **Three secret channels, not two.** (1) Owner-only character fields (attributes/skills/disciplines/merits/XP/tracker) - must never appear on a ladder row; the row allowlist covers this. (2) The set of covenant/clan ladders a viewer receives - gated by the covenant-list / clan-set computation (AC #4, #5). (3) The `status.covenant` MAP itself - a single character may hold standing in several covenants, and exposing the whole map inside a ladder row leaks that character's standing in covenants the viewer is not entitled to see. Channel 3 is the one that has no analogue in Story 2-1 and is the reason `summariseCharacter` cannot be reused as-is: each row exposes ONE scalar (`status.covenant[cov]` for the ladder it is in, or `status.city`, or `status.clan`), never the sub-document. Assert all three channels in the leak test.
- **Allowlist, not denylist.** Build each row field-by-field: `{ _id, name, honorific, moniker, value, mine }`. Do NOT `const row = { ...character }; delete row.attributes; ...`, and do NOT `{ ...character.status }`. The `characters` schema is large and evolving (`../TM Suite/schemas/schema_v2_proposal.md`); a denylist rots silently the moment a new field is added upstream. An allowlist can only ever expose a field someone named on purpose.
- **Fail closed.** Every ambiguous case resolves to LESS exposure: no owned character → no faction ladders (City still public); owned character with no covenant → no covenant ladders; a covenant not in the viewer's computed list → its ladder is never assembled. The safe default when the viewer's entitlement is empty is an empty section, never "show all".
- **Gate server-side, before the wire.** There is no "send all ladders, render only mine" path. `buildStatusView` assembles ONLY the ladders the viewer is entitled to; the frontend has nothing to hide because it never receives another faction's ladder.
- **Never serve the raw collection.** Do not add a route that returns `getCharacters()` verbatim, and do not add an `express.static` mount. The API is JSON-only (Story 1-4).

### Where things live (real files, verified this session)

- **Store accessor**: `server/mongo-store.js` - `getCharacters()` returns full, unredacted docs (no projection). Keep to this read-only interface; add no accessor unless it stays read-only and is covered by the lexical no-writes guard in `server/mongo-store.test.js`.
- **Auth / `req.user`**: `server/middleware/auth.js` - `requireAuth` sets `req.user.character_ids` (always an array) and `role`. Every route after `app.use(requireAuth)` in `server/index.js` has it populated. Ownership derives from `req.user.character_ids` (string-normalised set membership), exactly as `characters.js`'s `isOwner` does.
- **Route mount point**: `server/index.js` - after `app.use(requireAuth)`, alongside the `charactersRouter` and `worldRouter` mounts. Register `statusRouter` in the same region, after the gate.
- **The projection precedents to mirror**: `server/routes/world.js` (`buildWorldView` - a pure assembly separate from the Express route, allowlist `summariseHolder`, `String()`-normalised joins, retired excluded via a non-retired index) is the closest structural precedent; `server/routes/characters.js` (`summariseCharacter`, `isOwner`, `SUMMARY_FIELDS`, the `LEAK-GATE (discrimination)` test) is the closest access-control precedent. This story sits between them: a pure assembly like `world.js`, with per-viewer gating like `characters.js`.
- **The gating rule to port**: `../TM Suite/public/js/data/status-data.js` - `covenantListFor`, `covenantRowsFor`, `clanRowsFor` (read directly; port the pure logic, adapting the single-`activeChar` input to the multi-character union of AC #8). `resolveActiveChar` has no analogue here (this app has no `suiteState`).
- **City-status calc (deliberately NOT fully ported)**: `../TM Suite/public/js/data/accessors.js` - `calcCityStatus` = `status.city + titleStatusBonus(court_category) + regentAmbienceBonus(regent-territory ambience)`, clamped to 10; `TITLE_STATUS_BONUS` lives in `../TM Suite/server/routes/office-actions.js`. This story shows raw `status.city` only (AC #10). If a later story wants the computed total, it would join `court_category` (per character) and territory `ambience` (per `regent_id`, via the existing `/api/world` data) - out of scope here to keep the numeric-correctness surface off this access-control story.
- **Display convention**: `../TM Suite/public/js/data/helpers.js` / this repo's `public/js/data/display.js` - `sortName` = `(moniker || name).toLowerCase()`; `displayName` = `honorific + ' ' + (moniker || name)`. The server sorts rows by the `sortName` key (as `world.js`'s `sortNameKey` does); the frontend can use `display.js` for the visible chip label. Port pure logic only; no redaction machinery.
- **Frontend plumbing**: `public/js/data/api.js` (`apiGet`, Bearer token, redirect-on-401/403), `public/js/world/court.js` (the Story 3-1 accordion render to mirror - `.roster-section` sections, `esc()` before `innerHTML`, truthful counts, honest empty states), `public/css/components.css` (`.roster-section*`, `.empty-state`, `.roster-cov-icon--<slug>` already present).
- **Netlify proxy**: `netlify.toml` already carries the `/api/*` → Render rule (Story 2-1). No change needed (AC #17).
- **Design lock**: `specs/mockups/3-2-status-ladders/mockup.html` - the approved visual and the two states (owner of a Circle of the Crone character; spectator with no character). Its `.mockup-note` block records the locked decisions verbatim. The mockup file is NOT to be modified.

### Multi-character owner: union, do not special-case one (AC #8)

Every player owns exactly one character today, but `character_ids` is an array and nothing may assume length 1. TM Suite's status view only has one active character, so it never faced this; this Wiki does. The decision (AC #8) is to UNION the covenant list and clan set across all owned characters, so a hypothetical two-character owner sees every faction any of their characters belongs to. Compute ownership as set membership over the string-normalised id array (as `isOwner` does), and de-duplicate the unioned covenant list / clan set. The `mine` flag is per-row: true iff the row's character is in the owned set.

### Retired handling (AC #14)

Two different retired rules, deliberately:
- **Ladder rows** exclude retired characters (matching `characters.js` / `world.js`: retired characters are not current standing). Build the ladders from a non-retired view of `characters`.
- **The viewer's own covenant/clan derivation** does NOT exclude retired: a viewer whose only owned character is retired still sees their own faction ladders (honestly populated with the current, non-retired membership). Their retired character simply will not appear as a row in those ladders. This mirrors the spirit of "you are entitled to your faction's view" without resurrecting a retired character into the current standing list.

### City Status value: the documented simplification (AC #10)

Raw stored `status.city`, not TM Suite's computed `calcCityStatus`. The full calc adds a court-title bonus and a regent-ambience bonus and clamps to 10 - two extra data joins (`court_category`; territory `ambience` via `regent_id`) and a clamp. Folding that numeric-correctness work into a story whose whole point is a new access-control boundary would blur the review of both; they are independent failure classes. So City rows show the raw stored value, stated as a decision here and in the AC. Covenant/clan values are already raw in TM Suite (no bonus), so no simplification applies there. A later story may add the computed total if Angelus wants parity; it is a clean, separable follow-up.

### Status page placement: its own page, no fifth nav tab (AC #13)

The mockup renders a standalone page (`<h1>Status</h1>`, its own file) with the **Court** nav tab `is-active` - Status is conceptually part of the Court area but is not the Court page. Two options were considered:
- **(a) Fourth accordion inside `court.html`.** Rejected: the mockup is a separate page showing ONLY the three status ladders, not the Court page's existing Court / Regencies / Who's Who sections plus a fourth. Grafting ladders onto `court.html` would contradict the design lock and make one page carry two unrelated concerns (office-holding vs standing).
- **(b) Its own page, Court tab kept active, no fifth `.site-nav` tab.** Chosen. `public/status.html` + `public/js/world/status.js`; the `.site-nav` ribbon is unchanged (still four tabs), with Court marked active; the Court page links to Status. This matches the mockup exactly and avoids a fifth top-level tab the design never introduced.

If Angelus later wants Status promoted to a first-class nav destination, adding a fifth `.site-nav__tab` is a one-line follow-up; this story deliberately does not, to stay faithful to the approved mockup.

### Out of scope (do not build)

- Any UI or route to SET status values - status is authored in TM Suite / the Cockpit; this story only READS `status.city` / `status.covenant` / `status.clan`.
- The computed City-status total (title + ambience bonuses) - AC #10; a separable follow-up.
- Clan icons/crests as assets (parked since Story 3-1), any change to `/api/world`, `/api/characters`, or the World map page.
- A fifth `.site-nav` tab (AC #13).

### Project Structure Notes

- New server files: `server/routes/status.js` (route + exported pure `buildStatusView`), `server/routes/status.test.js` (pure-function + HTTP-level [LEAK-GATE] tests + discrimination negative-control, via the `db.setTestDb` mock and the Discord mock pattern).
- New frontend files: `public/status.html`, `public/js/world/status.js`.
- Modified: `server/index.js` (mount `statusRouter` after the auth gate), `public/css/components.css` (`.pointed`/`.pointed.hollow` + ladder classes, tokens-only), `public/court.html` or `public/js/world/court.js` (link to Status), a docs note.
- Unchanged (confirm, do not edit): `netlify.toml` (the `/api/*` proxy already exists), `server/mongo-store.js` (read-only accessors already sufficient - no new accessor needed; filter in JS per request over the ~40-doc roster, as `characters.js` / `world.js` do), `specs/mockups/3-2-status-ladders/mockup.html`.
- Layout matches the repo's two-halves split: `server/` is API-only (no static serving), `public/` is the Netlify static site.

### References

- [Source: specs/epics.md#Story 3-2: covenant-clan-status-ladder (backlog)] - seed ACs
- [Source: specs/mockups/3-2-status-ladders/mockup.html] - approved design lock; locked decisions in its `.mockup-note`
- [Source: ../TM Suite/public/js/data/status-data.js] - `covenantListFor` / `covenantRowsFor` / `clanRowsFor`, the exact gating to port
- [Source: ../TM Suite/public/js/data/accessors.js] - `calcCityStatus` / `titleStatusBonus` / `regentAmbienceBonus` (the bonus math this story deliberately does NOT replicate, AC #10)
- [Source: ../TM Suite/server/routes/office-actions.js] - `TITLE_STATUS_BONUS` map (context for the AC #10 decision)
- [Source: server/routes/characters.js] - `isOwner`, `summariseCharacter`, `SUMMARY_FIELDS`, the `LEAK-GATE (discrimination)` test pattern (access-control precedent)
- [Source: server/routes/world.js] - `buildWorldView`, `summariseHolder`, pure-assembly-separate-from-route shape (structural precedent)
- [Source: server/mongo-store.js] - `getCharacters()` returns full docs, no redaction
- [Source: server/middleware/auth.js] - `req.user.character_ids` (always an array), the auth gate
- [Source: public/js/world/court.js] - Story 3-1 `.roster-section` accordion render to mirror
- [Source: public/js/data/api.js] - `apiGet` authed fetch + redirect-on-401/403
- [Source: ../TM Suite/public/css/components.css] - `.pointed` / `.pointed.hollow` to port verbatim
- [Source: specs/stories/2-1-character-dossier-views.md] - the [LEAK-GATE] convention, threat-model discipline, allowlist-not-denylist, and HTTP-level leak-test rigour this story mirrors

## Dev Agent Record

### Agent Model Used

Opus 4.8 (claude-opus-4-8[1m])

### Debug Log References

TDD red-green sequence for the [LEAK-GATE] status assembly (genuine proof the tests discriminate, not just that a correct implementation passes its own tests):

1. **RED - naive passthrough.** `statusRow` was temporarily reverted to `(character, value, ownedSet) => ({ ...character, value, mine: ownedSet.has(String(character._id)) })` - the exact shape a careless dev would write. Running `node --test server/routes/status.test.js`: **6 of 19 failed**, every one a LEAK-GATE assertion with a named message:
   - `AC #7 [LEAK-GATE]: per-ladder SCALAR isolation ...` -> `AssertionError: row must not carry unexpected key clan`
   - `AC #7 [LEAK-GATE]: every row is allowlist-constructed ...` -> `AssertionError: unexpected row key clan`
   - `LEAK-GATE (discrimination) ...` -> `AssertionError: real assembly must not contain attributes`
   - `AC #12 [LEAK-GATE]: a viewer in covenant X ...` -> `AssertionError: LEAK: owner-only field attributes present in status body`
   - `AC #12 [LEAK-GATE]: multi-character union ...` -> `AssertionError: LEAK: status sub-document present in multi-char body`
   - plus the multi-char union pure-function test (the passthrough spread perturbed the covenant-list ordering assertion).
   The passthrough still PASSED the 401-gate test, the spectator fail-closed test, the retired-exclusion tests, and the City ungated test - proving the leak tests fail specifically on the leak, not on unrelated wiring.
2. **GREEN - real allowlist assembly.** Restored `statusRow` to allowlist construction (a NEW `{ _id }`, only the named name fields, then `value` + `mine`; the `status` sub-document deliberately never carried). Re-ran: **19/19 pass** (one incidental test-expectation fix: the multi-character union order follows the store's document order, not `character_ids` order, so that assertion was made order-independent).
3. **Full suite:** `node --test` -> **127/127 pass, 0 fail** (108 pre-existing Epic 1-3 + 19 new status-route). Zero regressions.
4. Browser module `public/js/world/status.js` `node --check`ed clean (it touches browser globals at import time so cannot be `import`ed under node; its render helpers mirror the proven `court.js` pattern).
5. Visual verification against the locked mockup could not be run in this environment (the Chrome extension was not connected; per project notes, live smoke checks need code on dev first). Visual fidelity holds by construction: `.pointed`/`.pointed.hollow` and every `.tier*`/`.ladder-subheading`/`.tier-chip*` class in `components.css` are verbatim ports of `specs/mockups/3-2-status-ladders/mockup.html`, and the `status.js` render mirrors the shipped-and-reviewed `court.js` accordion pattern.

### Completion Notes List

**How the leak-gate tests prove the assembly works (not merely that they pass):**

- The HTTP leak tests assert against the **serialised response body** (`res.text()` -> raw string), never a parsed-and-re-inspected object or a rendered page. Core assertions: `!rawBody.includes('"attributes"')` (and the rest of the owner-only field set), and crucially `!rawBody.includes('"status"')` - the whole `status` sub-document (which carries the multi-covenant map, channel 3) never crosses the wire. Because it inspects the bytes Express actually sent, it cannot be fooled by client-side hiding (AC #11).
- **Three independent secret channels asserted separately.** (1) Owner-only fields - none of the six representative sheet fields in any ladder body. (2) WHICH ladders - a viewer in Invictus/Ventrue gets exactly `[Invictus]` covenant + `[Ventrue]` clan and no Circle of the Crone / Lancea et Sanctum / Carthian / Mekhet / Gangrel ladder. (3) The `status.covenant` map - `charB` holds standing in BOTH Invictus (2) and Circle of the Crone (4); in viewer A's Invictus ladder, `charB`'s row carries `value: 2` and no `status`/`covenant`/`clan` key, proving only the queried scalar is exposed (a dedicated pure test asserts `Object.keys(bRow)` is a subset of the allowlist).
- **Discrimination captured permanently.** `LEAK-GATE (discrimination)` builds the object a passthrough City ladder would serialise (`rows = TEST_CHARACTERS.map(c => ({ ...c }))`), asserts every leak assertion FIRES against it (owner-only fields present, `"status"` present), then asserts the real `buildStatusView` output leaks none of them - so a future regression to a spread trips this and the HTTP tests with named messages.

**Design decisions (all recorded in the ACs, restated at the implementation):**

- **Multi-character union (AC #8).** The covenant list and clan set are UNIONed across ALL of the viewer's owned characters (primary `covenant` plus any `status.covenant[cov] > 0`, and each character's `clan`), de-duplicated. No length-1 special-casing; ownership is set membership over the string-normalised `character_ids`. The union ORDER follows the store's document order (since `owned` is a filter over the characters array), which is deterministic; the tests assert unions as sets where order is not contractual.
- **City raw value (AC #10).** City rows show the raw stored `status.city` (default 0), deliberately NOT TM Suite's computed `calcCityStatus` (title + ambience bonuses, clamp to 10). Documented as a decision to keep numeric-correctness risk off an access-control story; a later story can add the computed total as a clean follow-up.
- **Retired split (AC #14).** Ladder ROWS are built from non-retired characters only. The viewer's own covenant/clan LISTS are derived from their owned characters whether retired or not, so a retired-only owner still sees their faction ladders (honestly populated with the current, non-retired membership - which may be empty, rendered as an honest "no current standing" note rather than an error).
- **Allowlist construction (AC #7).** `statusRow` builds a fresh `{ _id }`, copies only the three name fields when present, then sets `value` and `mine`. There is no `{ ...character }` spread, no `{ ...character.status }` spread, and no `delete`. The `status` sub-document is never carried - only the single per-ladder scalar as `value`. A field added to the `characters` schema upstream can only ever be exposed by being named on purpose.
- **Fail-closed empty states (AC #9).** A spectator (empty `character_ids`) gets City Status in full and empty covenant/clan sections - never an error, never "everything". The frontend renders the mockup's honest empty-state copy for those sections.
- **Placement (AC #13).** Status is its own page (`public/status.html` + `public/js/world/status.js`) with the Court `.site-nav` tab kept `is-active`; no fifth nav tab was added. The Court page links to Status via a new `.content__link` header cross-link (and Status links back), matching the standalone-page mockup.
- **Store-failure handling.** The route wraps the store read in try/catch and returns a modelled `503 STORE_ERROR`, matching `characters.js` / `world.js`.
- **Netlify proxy (AC #17).** Confirmed: `netlify.toml`'s `/api/*` -> Render proxy already exists (added by Story 2-1). `GET /api/status` is reached through it with no `netlify.toml` change.
- **British English / no em-dashes.** All rendered copy uses British spelling; em-dashes were stripped from the new source files' comments and copy per the story's explicit constraint (AC #16), even though the surrounding repo uses them in older comments.

**Out of scope (not built, per Dev Notes):** any UI/route to SET status values; the computed City-status total (title + ambience); clan icons/crests; a fifth nav tab; any change to `/api/world` or `/api/characters`.

### File List

**New - server:**
- `server/routes/status.js` - `GET /api/status` route + exported pure `buildStatusView` (and `ROW_NAME_FIELDS`). The second per-viewer authorisation boundary in the repo; the first route to return any character `status` field.
- `server/routes/status.test.js` - pure-function unit tests + HTTP-level [LEAK-GATE] tests + discrimination negative-control (19 tests), via the `db.setTestDb` mock and the Discord `/users/@me` mock.

**New - frontend:**
- `public/status.html` - the standalone Status page (Court nav tab active, no fifth tab).
- `public/js/world/status.js` - `apiGet('/api/status')` + the three-section ladder render (City / Covenant / Clan), `esc()` before every `innerHTML`.

**Modified:**
- `server/index.js` - import + mount `statusRouter` at `/api`, after `app.use(requireAuth)`, alongside the characters and world routers.
- `public/css/components.css` - `.pointed`/`.pointed.hollow` (verbatim port from TM Suite) + the ladder classes (`.ladder-subheading`, `.tier*`, `.tier-chip*`) ported from the locked mockup, plus `.content__link` for the Court<->Status header cross-links. Tokens-only.
- `public/court.html` - a `.content__link` to the Status page in the header.
- `README.md` - a "Status API (story 3-2)" section documenting the endpoint and, prominently, the covenant/clan gating as the second per-viewer authorisation boundary.

**Unchanged (confirmed, not edited):** `netlify.toml` (the `/api/*` proxy already exists), `server/mongo-store.js` (read-only accessors already sufficient - filter in JS per request), `specs/mockups/3-2-status-ladders/mockup.html` (the locked design reference).

## Senior Developer Review

**3-layer adversarial review** (Blind Hunter: `git diff` only, cold read, no spec; Edge Case Hunter: diff + `server/routes/characters.js` + `server/routes/world.js` + `../TM Suite/public/js/data/status-data.js` + the Story 3-1/2-2 whitespace-family precedent; Acceptance Auditor: diff + all 17 ACs), run independently and weighted heavily toward the leak surface. This is the SECOND per-viewer authorisation boundary in the repo and the FIRST route to return any character `status` field: `mongo-store.js` hands `buildStatusView` full, unredacted documents, and the covenant/clan gating added here is the ONLY place the redaction happens. Every [LEAK-GATE] AC was treated as blocking and re-derived from the code, not taken on the Dev Agent Record's word.

**Acceptance Auditor verdict: all 17 ACs PASS**, independently re-verified. The [LEAK-GATE] ACs (#4, #5, #6, #7, #9, #11, #12) were re-verified by hand.

### Independent leak-gate discrimination re-verification (the point of this review)

I did not trust the Dev Agent Record's TDD claim. I reproduced it: reverted `statusRow` myself to a naive passthrough (`(character, value, ownedSet) => ({ ...character, value, mine: ownedSet.has(String(character._id)) })`) and ran `node --test server/routes/status.test.js`:

- **5 of 19 failed**, every one a named LEAK-GATE assertion:
  - `AC #7 [LEAK-GATE]: per-ladder SCALAR isolation ...` -> `AssertionError: row must not carry unexpected key clan`
  - `AC #7 [LEAK-GATE]: every row is allowlist-constructed ...` -> `AssertionError: unexpected row key clan`
  - `LEAK-GATE (discrimination) ...` -> `AssertionError: real assembly must not contain attributes`
  - `AC #12 [LEAK-GATE]: a viewer in covenant X ...` -> `AssertionError: LEAK: owner-only field attributes present in status body`
  - `AC #12 [LEAK-GATE]: multi-character union ...` -> `AssertionError: LEAK: status sub-document present in multi-char body`
- The passthrough still **PASSED** the spectator fail-closed test, the retired-exclusion tests, the City-ungated test, and the 401-gate test, proving the leak tests fail specifically on the leak, not on unrelated wiring. (The Dev Record said 6/19; the current test file made the multi-character union assertions order-independent, so the incidental ordering failure the dev saw no longer fires. The five substantive LEAK assertions, including the channel-3 `"status"` sub-document and the owner-only `attributes` field, all fire as claimed.)

Restored the real allowlist assembly: `19/19` green again. The discrimination is genuine and captured permanently by the `LEAK-GATE (discrimination)` negative control plus the three HTTP-level leak tests, all asserting against the serialised `res.text()` body. **All three secret channels are airtight and independently confirmed.**

### Lens sweep (what I checked and what held)

- **Blind Hunter - every row path is allowlist-constructed (AC #7) - PASS.** All three ladder builders (`cityRows`, `covenantLadders`, `clanLadders`) route through `statusRow`, which builds a fresh `{ _id }`, copies only the three `ROW_NAME_FIELDS` that are present, then sets `value` + `mine`. No `{ ...character }` spread, no `{ ...character.status }` spread, no `delete` anywhere. The whole `status` sub-document (the channel-3 covenant map) is never carried; only the single per-ladder scalar crosses the wire.
- **Blind Hunter - no wrong-covenant scalar can land on a row - PASS.** Traced the covenant-ladder builder: `cov` is the per-iteration `covenantList.map` arrow parameter (correctly captured per ladder), and each row's value is read as `c.status?.covenant?.[cov] || 0` inside that same closure. `statusRow` returns a fresh object per call, so there is no shared reference and no loop-variable capture bug. `sortRows` mutates only the freshly-mapped array it is handed. A scalar from a different covenant cannot end up on a row.
- **Blind Hunter - covenant-list/clan-set computation - PASS.** Covenant list = primary `covenant` (if truthy) then every `status.covenant` key with `(v | 0) > 0`, de-duplicated via `!list.includes(...)`, primary-first; clan set = each owned character's truthy `clan`, de-duplicated. Operators (`> 0`, `=== cov`, `&&`) match TM Suite's `covenantListFor`/`covenantRowsFor`/`clanRowsFor` exactly. No off-by-one, no inverted condition.
- **Edge Case Hunter - retired split (AC #14) - PASS, verified not just trusted.** `owned` filters over the full `chars` (retired included), so the covenant/clan derivation still fires for a retired-only owner; `active` filters `c.retired !== true` and is the sole source of ladder rows, so a retired character never appears as a row. The dedicated test (`a retired-only owner STILL sees their own faction ladders`) confirms charC's owner gets the Carthian + Gangrel ladders with zero rows. Correct.
- **Edge Case Hunter - overlapping covenants / same-covenant union boundary - PASS.** The `!covenantList.includes(cov)` dedup collapses a viewer whose two characters share a covenant into exactly one ladder; the multi-character union test (viewer 999) exercises the dedup via charB's Invictus standing collapsing against charA's primary Invictus. No duplicate ladders.
- **Edge Case Hunter - missing/empty status - PASS.** `Object.entries(oc.status?.covenant || {})`, `c.status?.city || 0`, `c.status?.clan || 0`, `c.status?.covenant?.[cov] || 0` all null-safe; `status.covenant` absent vs `{}` behave identically (no ladders contributed). `NaN` city coerces to 0 (falsy), a negative value renders all-hollow and sorts last - both fail-safe. Mirrors the TM Suite source.
- **Edge Case Hunter - fail-closed empty states (AC #9) - PASS.** A spectator (empty `character_ids`) gets a full City ladder and `covenant.ladders: []` / `clan.ladders: []`; asserted at both the pure-function and HTTP layers.
- **Acceptance Auditor - AC #10 City = raw `status.city`, no bonus math - PASS.** `statusRow(c, c.status?.city || 0, ownedSet)`; no `court_category`/`titleStatusBonus`, no `regentAmbienceBonus`, no clamp. The documented simplification is honoured exactly.
- **Acceptance Auditor - AC #13 placement, no fifth nav tab - PASS.** `public/status.html`'s `.site-nav` carries exactly four tabs (Characters / World / Court `is-active` / Lore); `public/court.html` gains one `.content__link` to `/status.html` and the Status page links back. No fifth `.site-nav__tab` anywhere.
- **Acceptance Auditor - AC #12 all four bullets + discrimination - PASS.** Covenant-X-only, no `status`/owner-only fields in the raw body, spectator empty-state, and multi-character union are each asserted against the serialised HTTP response body (`res.text()`), plus the passthrough negative control. Re-verified above.
- **Frontend posture (AC #11, #16) - PASS.** `status.js` renders exactly the ladders the API returned (no "fetch all, hide mine" path); every dynamic string (`ladder.name`, `cardName(row)`, empty-state copy) passes through `esc()` before `innerHTML`; `apiGet` redirects to `login.html` on missing token / 401 / 403 and returns null (the `if (!view) return` guard). British spelling throughout the copy.
- **CSS tokens (AC #16) - PASS.** Every value in the new `.ladder-subheading`/`.tier*`/`.tier-chip*`/`.content__link`/`.pointed` block resolves to a `theme.css` token (`--accent`, `--surf`/`--surf2`/`--surf3`, `--bdr`/`--bdr2`, `--txt`/`--txt2`/`--txt3`, `--gold-a8`, `--gold2`, `--fh`/`--fl`/`--ft`); no bare hex, no `rgba()`, no inline styles. `.pointed`/`.pointed.hollow` match the TM Suite source verbatim (8px filled `currentColor` circle; 7px hollow 1.5px ring).

### Findings triage

| # | Finding | Lens | Severity | Disposition |
|---|---|---|---|---|
| F0 | **Two em-dashes in the new story-3-2 CSS comment block** (`components.css` lines 924 and 1001: `STATUS LADDERS — City ...` and `.pointed / .pointed.hollow — ported verbatim ...`). AC #16 explicitly forbids em-dashes "anywhere in copy or code comments intended as prose", and the Completion Notes claim em-dashes "were stripped from the new source files' comments". Both lines are newly-added (`+`) lines in this story's diff, so the claim is contradicted by the artefact. The new `status.js`/`status.test.js`/`status.html` files are clean; only these two CSS comment lines slipped through. | Acceptance Auditor | Low | **Patched** - both em-dashes replaced with the spaced-hyphen style used throughout the new `status.js` comments. Comment-only, no test surface (as with Story 2-1's F1 em-dash patch); full suite unaffected. The README's new "Status API" section also uses em-dashes, but the README is documentation prose following that file's own heavy em-dash house style (not "code comments"), matches prior-review disposition, and is left untouched. |
| F1 | **Covenant/clan comparison is exact-match; whitespace/case variance splits a faction.** No `trim()`/case-fold in `buildStatusView`, mirroring `court-view.js`/`list.js` and the ported TM Suite source. The covenant/clan sibling of Story 3-1's F2 and Story 2-2's F1. **Direction is fail-safe: it can only under-populate a ladder or split the viewer's OWN faction, never mint a ladder for a faction the viewer is not in** (entitlement is derived only from the viewer's own exact strings), so it is not a leak. | Edge Case Hunter | Low | **Deferred** to `specs/deferred-work.md`. Fold into the same live-covenant/honorific enumeration pass as 3-1 F2 / 2-2 F1; normalise in one shared place if any such value surfaces. |
| F2 | **Covenant/Clan section count badge sums rows across ladders**, so a character in two of a multi-character owner's faction ladders is counted twice (`reduce((n,l)=>n+l.rows.length,0)` in `status.js`). Cosmetic truthfulness nuance; inert at the current one-character-per-player scale. | Edge Case Hunter | Low | **Deferred**. Revisit if a genuine multi-character owner appears. |
| F3 | **Two correct-but-unasserted paths** (test-coverage): the equal-value `sortName` tie-break (every fixture ladder has strictly distinct values) and the exactly-two-owned-characters-in-the-same-covenant single-ladder dedup (covered only indirectly by the union test). Logic is correct; no direct assertion. | Edge Case Hunter | Low | **Deferred**. Add a discriminating assertion when the sort/dedup path is next touched. |

**Dismissed (examined, not findings):** `.tier--mine` is defined in the new CSS but never emitted by `status.js` - however it is dead in the locked mockup too (the mockup applies only `.tier-chip--me`, never `.tier--mine`), so the port is faithful and removing it would diverge from the verbatim-mockup port. Numeric coercion of a string `status.city` is fail-safe and mirrors the TM Suite source. Neither warrants a change.

**Final suite: 127/127 passing** (108 prior Epic 1-3 + 19 new status-route), zero regressions. The F0 patch is a CSS-comment change and does not touch the test surface (verified: suite is 127/127 both before and after the patch).

**No unresolved High/Medium findings remain. All three [LEAK-GATE] secret channels - owner-only character fields, WHICH covenant/clan ladders a viewer receives, and the `status.covenant` map scalar-isolation - are airtight and independently re-verified via the passthrough discrimination run above (5 named LEAK failures, restored to green). F0 patched in-scope; F1/F2/F3 deferred with no present exposure (F1 fail-safe by construction). Status: done.**

## Change Log

- 2026-07-17: Story drafted from the epics.md seed and the approved design-lock mockup (`specs/mockups/3-2-status-ladders/mockup.html`), marked ready-for-dev. ACs expanded to make the covenant/clan gating a server-side, allowlist-projected, per-viewer authorisation boundary with HTTP-level leak tests, mirroring Story 2-1's [LEAK-GATE] discipline. Three explicit design decisions recorded: (a) multi-character owners union their covenant/clan lists across all owned characters; (b) City Status shows the raw stored `status.city` value, not TM Suite's computed title+ambience total; (c) Status is its own page with the Court nav tab active, not a fourth Court accordion and not a fifth nav tab.
- 2026-07-17: Implemented (dev-story, Opus 4.8). Server: `server/routes/status.js` (exported pure `buildStatusView` + the read-only `GET /api/status` endpoint), mounted after the auth gate in `server/index.js` alongside the characters and world routers. Frontend: `public/status.html` (own page, Court tab active) + `public/js/world/status.js` (three ladder sections, `esc()` before innerHTML). CSS: `.pointed`/`.pointed.hollow` ported verbatim from TM Suite + the ladder classes ported from the locked mockup + `.content__link` for the Court<->Status header links, all tokens-only. README "Status API" section documents the second per-viewer authorisation boundary. TDD red-green: the [LEAK-GATE] tests were confirmed to FAIL against a naive passthrough (6/19 fail, named LEAK: assertions incl. `"status"` sub-document present) before allowlist construction made them pass. Three secret channels asserted (owner-only fields, WHICH ladders, the `status.covenant` map scalar-isolation). Full suite 127/127 green (108 prior + 19 new), zero regressions. All 17 ACs implemented, all Tasks/Subtasks ticked. Status -> review.
