# Story 1.2 (rev 2): mongo-read-client

Status: done

Supersedes `specs/stories/1-2-mongo-snapshot-script.md` (retired — see `specs/prd.md` → "Revision: live reads, not a snapshot"). That story's file stays in the repo as a historical record; its Senior Developer Review findings that are still relevant (the `ssl=` URI-strip bug, the players-PII-whitelist test-coverage gap, the hardened no-writes lexical guard) apply equally here and must not regress.

## Story

As the developer of this app,
I want a live, read-only Mongo connection module with the same accessor shape the retired snapshot-store used,
so that the API reads `tm_suite` directly and every consumer (TM Suite, the Cockpit, this Wiki) sees the same live truth.

## Acceptance Criteria

1. `server/db.js` connects to `tm_suite` using `MONGODB_URI` from env, mirroring `../TM Suite/server/db.js`'s shape (`connectDb`/`getDb`/`getCollection`/`closeDb`, idempotent connect, the `ssl=`-param handling — use the corrected `stripSslParam`-style split/filter/rejoin from the retired snapshot script's post-review fix, NOT TM Suite's original regex, which has the leading-param bug).
2. `server/mongo-store.js` (replaces `server/snapshot-store.js`, which is deleted) exposes: `getCharacters()`, `getDossiers()`, `getTerritories()`, `getPlayers()`, `getPlayerByDiscordId(discordId)` — all `async`, all querying Mongo live. `getPlayers`/`getPlayerByDiscordId` use a Mongo projection to the auth-field whitelist (`discord_id`, `role`, `character_ids`, `discord_username`) — nothing else from `players` ever leaves the query.
3. `getPlayerByDiscordId` string-normalises both sides of the comparison (the retired module's post-review fix — carry it forward) and returns `null` for no match, never throws.
4. No write operations anywhere in `server/db.js` or `server/mongo-store.js` — the hardened lexical guard test from the retired snapshot script (covering `$out`/`$merge`/`db.command`/`runCommand`/bulk-op-initializers, not just named CRUD methods) is ported and re-applies to these new files.
5. Tests do not touch the live `tm_suite` database. Use a well-scoped mock of the `mongodb` driver (fake `Db`/`Collection` objects returning canned documents) — this keeps the existing test-injection ergonomics (something like the retired module's `setSnapshot` test seam) without needing a real or in-memory Mongo server for this small a test surface.
6. `server/snapshot-store.js`, `server/snapshot-store.test.js`, `scripts/snapshot.mjs`, `scripts/snapshot.test.js`, and `data/snapshot.json` are deleted. `package.json`'s `snapshot` script entry is removed. Nothing in the repo references the snapshot approach except the retired story file itself (kept for history) and `deferred-work.md`'s pointer to it.
7. `server/schemas/character_dossier.schema.js` (the mirrored copy in THIS repo) is deleted — the real schema lives in `../TM Suite/server/schemas/character_dossier.schema.js` (already updated with `revealed_to` directly, this session) and this repo has no need of a local copy once it's not validating a snapshot file against it.

## Dev Notes

- **This module is the ONLY thing in the deployed service that touches Mongo**, and only ever read-only — same trust boundary as the retired snapshot script, just invoked per-request instead of on-command.
- **Read-only enforcement is still: (a) code never issues a write call [tested], (b) the Atlas database user is provisioned read-only [a manual Atlas-console step Angelus does, out of scope for this story's code].** Don't try to enforce (b) in code; document it in README the same way the retired story did.
- **Connection lifecycle**: unlike the on-command script (connect → read → write file → close), this is a long-lived Express process. Connect once at boot (or lazily on first request — pick one, document the choice), keep the connection open for the process lifetime, and close gracefully on `SIGTERM`/`SIGINT` (Render sends `SIGTERM` on deploys/restarts — an ungraceful connection drop isn't fatal here since there's no write-in-flight to worry about, but closing cleanly is good practice and cheap to add).
- **Do not reintroduce the retired script's `ssl=` regex bug.** Port the corrected `stripSslParam` helper (split on `?`, filter out any `ssl=` param, rejoin) rather than TM Suite's original `[&?]ssl=[^&]*` regex, which corrupts the URI when `ssl` is the first query param.
- **Mocking strategy**: the retired snapshot script's tests used fixtures against pure functions (`buildSnapshot`, `toPlain`) with no real Mongo involved at all, because the read-then-transform logic was cleanly separable. This module is different — the accessors ARE the Mongo queries. Mock at the `mongodb` driver boundary (a fake `Collection` with a `.find()`/`.findOne()` that returns canned data) rather than trying to avoid mocking altogether.

## Dev Agent Record

### Agent Model Used

Opus 4.8 (dev-story / Amelia)

### Debug Log References

- `node --test` (full suite): 36 tests, 36 pass, 0 fail. The 8 tests introduced by this story live in `server/mongo-store.test.js` (accessor round-trip, players projection whitelist, `getPlayerByDiscordId` resolve/normalise/null-safe, hardened no-writes lexical guard, `stripSslParam`, frozen `PLAYER_PROJECTION`); the remaining 28 are the pre-existing story 1-1/1-3 suites, all still green (no regressions).
- No live `tm_suite` connection is opened by the suite: every accessor test injects a fake `Db` through `db.setTestDb`, and `connectDb`/`start()` are never reached.

### Completion Notes List

This story's implementation pre-existed in the working tree (uncommitted) when dev-story resumed; the workflow verified it against all seven acceptance criteria, ran the full suite, and completed the story record. The story file carries no Tasks/Subtasks section (it was authored AC-only), so completion is tracked against the ACs below rather than task checkboxes.

- **AC #1 (db.js):** `connectDb`/`getDb`/`getCollection`/`closeDb` mirror `../TM Suite/server/db.js`. `connectDb` is idempotent (`if (db) return db`). The `ssl=` strip is the corrected `stripSslParam` (split on the first `?`, filter any `ssl=` param out of the `&`-separated query, rejoin) — NOT TM Suite's `[&?]ssl=[^&]*` regex, which consumes a leading `?` and corrupts the URI when `ssl` is the first param. `tls: true` and `serverSelectionTimeoutMS: 5000` are carried over. Connects once at boot via `server/index.js` `start()`; `closeDb` is wired to SIGTERM/SIGINT for graceful Render restarts.
- **AC #2 (mongo-store.js):** exposes `getCharacters`/`getDossiers`/`getTerritories`/`getPlayers`/`getPlayerByDiscordId`, all async, all live Mongo reads. `getPlayers`/`getPlayerByDiscordId` apply the frozen `PLAYER_PROJECTION` (`{ _id: 0, discord_id: 1, role: 1, character_ids: 1, discord_username: 1 }`) at the Mongo projection, so nothing outside the auth whitelist ever leaves the query. A test asserts both the projection the code asks Mongo for AND that the returned docs carry only those four keys even when the fixture doc also had `email`/`real_name`/`last_login`.
- **AC #3 (getPlayerByDiscordId):** returns `null` for a null/undefined argument up front, `String()`-normalises both the argument and each stored `discord_id` before comparing, returns `null` on no match, never throws. A test proves numeric drift is tolerated (stored `discord_id: 111` matches both `'111'` and `111`).
- **AC #4 (no writes):** the hardened lexical guard from the retired snapshot story is ported into `mongo-store.test.js` and re-runs against both `db.js` and `mongo-store.js` source. The denylist covers the write-shaped-as-read vectors a plain CRUD list misses: `$out`/`$merge` aggregation stages, `command`/`runCommand`, and the bulk-op initialisers, alongside the named CRUD/index/collection methods.
- **AC #5 (test isolation):** the suite mocks the `mongodb` driver boundary — a fake `Db` exposing `.collection(name)` whose fake `Collection` returns canned docs from `.find().toArray()` (with a projection-honouring helper) — injected via the `setTestDb` seam. This preserves the retired module's `setSnapshot` test ergonomics without any real or in-memory Mongo. Only `.find()` is used by the accessors (`getPlayerByDiscordId` reuses `getPlayers` then filters in JS), so no `.findOne()` mock is required.
- **AC #6 (snapshot removal):** `server/snapshot-store.js`, `server/snapshot-store.test.js`, `scripts/snapshot.mjs`, `scripts/snapshot.test.js`, and `data/snapshot.json` are deleted (the `scripts/` and `data/` directories no longer exist); `package.json`'s `snapshot` script entry is removed. No functional reference to the snapshot approach remains anywhere: no import, no npm script, no data file. The residual `snapshot` mentions in code are explanatory comments documenting the migration; the spec/story docs (architecture.md, prd.md, epics.md, the retired story, deferred-work.md) legitimately describe the supersession.
- **AC #7 (schema copy removal):** the repo-local `server/schemas/character_dossier.schema.js` mirror is deleted (the whole `server/schemas/` directory is gone). The live source of truth, `../TM Suite/server/schemas/character_dossier.schema.js`, was NOT touched (confirmed clean in that repo's git status).
- **Out-of-scope observation (not fixed here):** `server/routes/auth.js:64` (story 1-3's file) still has a stale comment referencing "the matching snapshot player". Behaviour is correct (it calls the live `getPlayerByDiscordId`); only the comment wording is outdated. Left for story 1-3's own review since modifying it is outside this story's file scope.

### File List

New (this story):
- `server/db.js` — live read-only Mongo connection (`connectDb`/`getDb`/`getCollection`/`closeDb`/`isConnected`/`closeDb`), corrected `stripSslParam`, `setTestDb` test seam.
- `server/mongo-store.js` — five async live-read accessors + frozen `PLAYER_PROJECTION` auth whitelist (replaces the deleted `snapshot-store.js`).
- `server/mongo-store.test.js` — accessor, projection, id-normalisation, hardened no-writes guard, and `stripSslParam` tests; mocks the `mongodb` boundary, never hits live Mongo.

Deleted (this story):
- `server/snapshot-store.js`, `server/snapshot-store.test.js`
- `scripts/snapshot.mjs`, `scripts/snapshot.test.js`
- `data/snapshot.json`
- `server/schemas/character_dossier.schema.js` (repo-local mirror only)

Modified (this story's slice of shared files):
- `package.json` — removed the `snapshot` script entry (the `mongodb`/`dotenv` deps stay; they are now used by `db.js`).
- `server/config.js` — added `MONGODB_DB` (defaults to `tm_suite`), consumed by `db.js`.
- `README.md` — replaced the snapshot-operation section with "Live Mongo connection (no snapshot, no rebuild step)" documenting the read-only connection and the manual read-only Atlas user setup.

Note: the working tree co-mingles uncommitted changes from stories 1-3 and 1-4 (auth routes/middleware, netlify.toml, render.yaml, public/js, etc.); those are not part of this story and are excluded from the list above.

## Senior Developer Review

**3-layer adversarial review** (Blind Hunter: code only, no story/context · Edge Case Hunter: code + this repo's conventions from `specs/architecture.md` and `CLAUDE.md` · Acceptance Auditor: code + the seven ACs, independently re-verified), all Opus. This is the ONLY module in the deployed service that touches Mongo, and only ever read-only, so findings were weighted toward: any path that could let a write slip past the no-writes guarantee, any path that could leak a `players` field beyond the auth whitelist (`discord_id`, `role`, `character_ids`, `discord_username`), the `stripSslParam` URI handling, and the test coverage of the no-writes guard and the whitelist projection.

**Acceptance Auditor verdict: all 7 ACs PASS**, independently re-verified against the actual code and a full test run (not the Dev Agent Record's self-report):

- **AC #1** — `connectDb`/`getDb`/`getCollection`/`closeDb` present; `connectDb` idempotent (`if (db) return db`). `stripSslParam` uses split-on-first-`?`/filter/rejoin, NOT the buggy `[&?]ssl=[^&]*` regex. Confirmed against the source it mirrors (`../TM Suite/server/db.js`), which still carries the leading-param bug (`.replace(/[&?]ssl=[^&]*/g, '')`) and the unconditional `tls: true` this file faithfully carries over. Leading-param case is covered by test.
- **AC #2** — five async accessors present; `getPlayers`/`getPlayerByDiscordId` project to the frozen `PLAYER_PROJECTION` whitelist at the Mongo query, not post-fetch. Test asserts both the projection asked of Mongo AND that returned docs carry only the four whitelisted keys even when the fixture doc had `email`/`real_name`/`last_login`.
- **AC #3** — `getPlayerByDiscordId` guards `== null` up front, `String()`-normalises both sides, returns `null` on no match. Tests cover unknown/null/undefined and numeric drift (stored `111` matches `'111'` and `111`).
- **AC #4** — hardened lexical guard ported, covering `$out`/`$merge`/`command`/`runCommand`/bulk-op-initialisers alongside named CRUD; a guard-integrity self-test proves the patterns still fire on real write vectors and do NOT trip on `.find().toArray()`.
- **AC #5** — suite mocks the `mongodb` driver boundary via `setTestDb`; no live `tm_suite` connection is opened by any test.
- **AC #6** — snapshot store/script/data-file deleted; `package.json` has no `snapshot` script; grep confirms the only residual `snapshot-store` mentions are historical explanatory comments (`mongo-store.js`, `auth.test.js`), not a live import.
- **AC #7** — repo-local `server/schemas/character_dossier.schema.js` deleted; the live source of truth in `../TM Suite` was not touched.

**Findings triage:**

| # | Finding | Reviewer(s) | Disposition |
|---|---|---|---|
| 1 | **`stripSslParam` is case-sensitive** (`/^ssl=/`), so a mixed-case `SSL=`/`Ssl=` query param survives the strip. MongoDB connection-string option keys are case-insensitive and driver v7 rejects the `ssl` option whatever its case, so a mixed-case URI would make `connectDb()` throw at boot. Low real-world probability (Atlas emits lowercase; the URI is operator-controlled) but a strictly-more-correct hardening on the exact trust-boundary helper the story flags. | Edge Case Hunter, Acceptance Auditor (LOW) | **Patched** — regex changed to `/^ssl=/i`; test extended with a mixed-case `SSL=`-as-first-param case. Discrimination proven: reverting to `/^ssl=/` fails the test, restoring `/^ssl=/i` passes. `sslmode`-style keys are still not caught (anchored `ssl=`). |
| 2 | **`connectDb` has no in-flight guard** — two concurrent calls before the first `client.connect()` resolves both build a `MongoClient`; the second overwrites `client`, leaking the first (never closed). | Blind Hunter (LOW) | **Deferred** — `connectDb` is called exactly once at boot, serially; latent only. Recorded in `specs/deferred-work.md`; revisit only if a lazy/per-request connect is ever introduced. |
| 3 | **`getPlayerByDiscordId` propagates a rejection if the underlying `find`/connection fails** — the `?? null` covers no-match only, not a DB outage, so "never throws" is not absolute. | Edge Case Hunter | **Dismissed** — working as designed. AC #3 and the code comment scope "never throws" to the comparison itself; a genuine DB outage is meant to surface, and the auth middleware (Story 1-3) wraps the call in try/catch and returns the modelled `AUTH_ERROR`. Swallowing it here would mask outages as 403s. |
| 4 | **`tls: true` is unconditional** — would break a plain non-TLS local Mongo. | Edge Case Hunter | **Dismissed** — AC #1 mandates mirroring `../TM Suite/server/db.js`, which sets `tls: true` unconditionally (verified); production is Atlas (TLS required) and there is no local-Mongo dev path for this repo. Inherited-by-design, not introduced here. |
| 5 | **The lexical no-writes guard scans only `db.js`/`mongo-store.js` source; a caller holding a `getCollection()` handle could still issue a write**, and a sufficiently indirect (dynamically-named) write would evade the scan. | Blind Hunter | **Dismissed (already tracked)** — the guard is a tripwire against accidental writes, never the security boundary; the real enforcement is the read-only Atlas IAM role (Dev Notes; README). Already captured as deferred-work item 3 under the retired `1-2 (mongo-snapshot-script)` heading; no new action. |

One patch applied (finding #1, Low), proven via revert-and-restore. No High or Medium findings surfaced: no write path exists in either file, the `players` whitelist is enforced at the projection for both read paths and asserted on the returned keys, and the previously-known `ssl=`-leading-param corruption is fixed and tested. Full suite re-run after the patch: **38 pass / 0 fail** (zero regressions in the 1-1/1-3/1-4 suites).

**No unresolved High/Medium findings remain. Status: done.**

## Change Log

- 2026-07-17: Story 1.2 (rev 2) verified complete and marked for review. Live read-only Mongo client (`server/db.js` + `server/mongo-store.js`) replaces the retired snapshot approach; snapshot script/store/data-file and the repo-local dossier schema mirror deleted; `snapshot` npm script removed. Full suite green (36/36). All seven ACs verified.
- 2026-07-17: Senior Developer Review (3-layer adversarial) completed. All 7 ACs independently re-verified PASS. One Low finding patched (`stripSslParam` made case-insensitive, `/^ssl=/i`, with a discriminating mixed-case test proven via revert-and-restore); one Low finding deferred (`connectDb` concurrent double-connect); three dismissed. No unresolved High/Medium findings. Full suite 38/38 green. Status: review -> done.
