# Story 1.2: mongo-snapshot-script

Status: done

## Story

As Angelus,
I want a script I run on command that reads `tm_suite` read-only and writes a committed JSON snapshot,
so that the site's data reflects reality without ever giving the deployed app live database access.

## Acceptance Criteria

1. `scripts/snapshot.mjs` connects to `tm_suite` using `MONGODB_URI` from a local `.env` (never committed — already gitignored by story 1-1), reads `characters`, `character_dossier`, `players` (auth fields only: `discord_id`, `role`, `character_ids`, `discord_username`), and `territories` (`regent_id`/`lieutenant_id` plus display fields needed for story 2-2).
2. Output is written to `data/snapshot.json` — deterministic and diff-friendly: object keys in a stable, consistent order across runs (e.g. sort array items by `_id` string, sort object keys) so a re-run with no underlying Mongo changes produces a byte-identical file.
3. The script contains **no** write operations against Mongo anywhere — no `updateOne`, `insertOne`, `deleteOne`, `bulkWrite`, etc. This is a hard, testable constraint.
4. `character_dossier`'s fact schema gains a `revealed_to` field (array of character `_id` strings, or `null`) per `specs/architecture.md`'s "Reveals" section — this is a schema-support change only; nothing in this story authors or reads it yet beyond passing it through into the snapshot untouched when present.
5. Running the script twice against the same data produces byte-identical `data/snapshot.json` (proves determinism — verify this in a test using a fixture/mock, not by hitting live Mongo in CI).
6. Dev notes/README document exactly how Angelus invokes this (command, required env var, expected runtime, what "success" looks like) since this is a manual, recurring, ST-only operation — not something a test suite runs automatically against production data.

## Tasks / Subtasks

- [ ] Task 1: Mongo connection (read-only) (AC: #1, #3)
  - [ ] Add `mongodb` as a dependency
  - [ ] `scripts/snapshot.mjs` reads `MONGODB_URI` from `.env` via `dotenv`, connects, ensure connection is closed on both success and failure paths
  - [ ] Document (in a code comment and in dev notes) that the Atlas user this connects as SHOULD be provisioned read-only — this script cannot enforce that from the client side, but must not itself issue any write call regardless of the credential's actual privileges
- [ ] Task 2: Read the four collections (AC: #1)
  - [ ] `characters`: full documents, no projection (all 41, including retired)
  - [ ] `character_dossier`: full documents (`facts[]` etc.)
  - [ ] `players`: projected to `{ discord_id, role, character_ids, discord_username }` only — no other player fields ever enter the snapshot
  - [ ] `territories`: `regent_id`, `lieutenant_id`, plus whatever display fields (name, etc.) exist on that collection — read the collection's actual shape first, don't assume field names
- [ ] Task 3: Deterministic serialization (AC: #2, #5)
  - [ ] Sort each collection's array by `_id` (stringified) before writing
  - [ ] Sort object keys recursively (a small stable-stringify helper, or an existing zero-dependency approach — avoid a new dependency if a ~10-line helper suffices)
  - [ ] Convert Mongo `ObjectId`/`Date` values to plain strings in the output (the deployed service must not need the `mongodb` driver to parse the snapshot)
- [ ] Task 4: Extend `character_dossier` schema (AC: #4)
  - [ ] Add `revealed_to: { type: ['array', 'null'], items: { type: 'string' } }` to the fact schema — locate the actual schema source of truth for this repo (there isn't one yet; either mirror `../TM Suite/server/schemas/character_dossier.schema.js`'s shape as a read-only reference in this repo's own `server/schemas/` for documentation/validation purposes, or add a lightweight local validation step in the snapshot script itself — pick whichever is simpler for a schema that only needs to round-trip through a snapshot file, not enforce writes; justify the choice in dev notes)
- [ ] Task 5: Tests (AC: #3, #5)
  - [ ] A test proving no write-method calls exist in the script's source (a static/lexical check is fine — grep-style or AST-based, whichever is simpler for one file)
  - [ ] A test proving determinism using an in-memory fixture (mock Mongo responses, do not require a live database connection for this test to pass) — run the transform/serialize step twice on identical fixture input and assert byte-identical output
- [ ] Task 6: Document the operation (AC: #6)
  - [ ] README addition: exact command (`node scripts/snapshot.mjs`), required `.env` var (`MONGODB_URI`), expected runtime for ~41 characters (should be seconds, not minutes), what a successful run prints, what happens on connection failure

## Dev Notes

- **This is a manual ST tool, not an automated pipeline.** No CI job should run this against production Mongo. Tests must validate its logic (determinism, no-writes, projection correctness) against fixtures/mocks, never against a live `tm_suite` connection.
- **Read-only is enforced by discipline in the code, not by a runtime guard** — there is no Mongo client-side "read-only mode" flag that blocks write calls; the actual enforcement layer is the Atlas database user's IAM role, which is provisioned outside this codebase (Angelus does this in the Atlas console — call this out as a manual setup step in dev notes, mirroring how story 1-3 calls out the Discord redirect URI registration as a manual step). This script's job is to simply never attempt a write, which the AC #3 test verifies lexically.
- **Connection pattern to mirror** (read-only reference, do not modify): `../TM Suite/server/db.js` — note it strips a legacy `ssl=` query param before connecting (a MongoDB driver v7 compatibility fix) and sets `tls: true`, `serverSelectionTimeoutMS: 5000`. Match this shape if this repo also uses driver v7; verify the installed `mongodb` package's major version before assuming the same quirk applies.
- **`character_dossier` fact shape to extend**: `../TM Suite/server/schemas/character_dossier.schema.js` — read it in full. It already has `st_hidden: boolean`, `severity`, `compromised`, etc. per fact. Add `revealed_to` alongside these, not as a top-level document field — it belongs on each individual fact, matching how `st_hidden` already works.
- **Territory office data**: read `../TM Suite/server/routes/territories.js` for the real field names (`regent_id`, `lieutenant_id` confirmed present) rather than guessing the rest of the territory document shape.
- This story does NOT build the Express routes that consume the snapshot (that's story 2-1/2-2) — it only produces `data/snapshot.json`. Do not add route code here.

### Project Structure Notes

Adds `scripts/snapshot.mjs` and `data/snapshot.json` to the layout established in story 1-1. `data/` is a new top-level directory — the snapshot file IS committed (per architecture.md — this is the mechanism by which the deployed app gets fresh data, not a build artifact to gitignore).

### References

- [Source: specs/architecture.md#Data model]
- [Source: specs/architecture.md#Reveals — extend the existing fact schema, don't fork a new one]
- [Source: ../TM Suite/server/db.js]
- [Source: ../TM Suite/server/config.js]
- [Source: ../TM Suite/server/schemas/character_dossier.schema.js]
- [Source: ../TM Suite/server/routes/territories.js]

## Dev Agent Record

### Agent Model Used

Opus 4.8 (dev-story / Amelia)

### Debug Log References

- `npm test` — 8/8 pass (7 new snapshot tests + Story 1-1 smoke test), 0 fail.
- Live verification: `npm run snapshot` against `tm_suite` → `characters:41 dossiers:30 players:40 territories:5` in 0.5s. Two consecutive live runs produced byte-identical `data/snapshot.json` (proves AC #5 against real data too).

### Completion Notes List

- **Task 3 determinism:** a single recursive `toPlain()` does type-conversion (ObjectId→hex via `toHexString()` duck-type, Date→ISO) AND deep key-sort; `serializeSnapshot` = `JSON.stringify(toPlain(x), null, 2) + '\n'`. Arrays are additionally sorted by a stable key (`_id` for characters/dossiers/territories; `discord_id` for players, since players' `_id` is deliberately not in the snapshot). No timestamp/metadata is written, so a no-change re-run is byte-identical. Verified byte-identical both on fixtures (test) and twice against live Mongo.
- **Task 4 schema approach:** mirrored `../TM Suite/server/schemas/character_dossier.schema.js` into this repo at `server/schemas/character_dossier.schema.js` and added `revealed_to: { type: ['array','null'], items: { type: 'string' } }` on the per-fact shape (alongside `st_hidden`, not top-level). Chose the schema-mirror option over wiring runtime AJV validation into the script because `revealed_to` only needs to round-trip through the snapshot in this story — the script reads whole `character_dossier` docs, so a present `revealed_to` passes through untouched with zero special-casing. A fixture test asserts the passthrough (present array + `null` both preserved). Live data currently has 0 facts carrying `revealed_to` (nothing authors it yet — correct for this story).
- **AC #3 (no writes):** the script only calls `.find(...).toArray()` (+ a projection). A lexical test greps the script source for any dot-invocation of write-capable driver methods (insert/update/replace/delete/bulkWrite/findOneAnd*/drop*/createIndex*/renameCollection/createCollection/findAndModify) and asserts none exist.
- **AC #1 players whitelist:** projected `{ _id:0, discord_id:1, role:1, character_ids:1, discord_username:1 }`. Live snapshot confirmed players carry exactly those 4 keys, no `_id`, no extra fields.
- **Driver version:** installed `mongodb@7.5.0` (driver v7) → the legacy `ssl=` query-param strip from TM Suite `server/db.js` applies and is mirrored, with `tls:true` + `serverSelectionTimeoutMS:5000`. Connection closed on both success and failure paths (`finally`).
- **Territories:** read as full docs (not projected) to avoid guessing field names; live shape confirms `regent_id`, `lieutenant_id`, `name`, `slug`, plus `ambience`/`feeding_rights`/`updated_at` — display fields Story 2-2 needs are present.
- **Not committed** (per operator instruction). `data/snapshot.json` generated in the working tree; `.env` written locally and confirmed gitignored.

### File List

- `scripts/snapshot.mjs` (new) — snapshot generator + pure `toPlain`/`serializeSnapshot`/`buildSnapshot` helpers.
- `scripts/snapshot.test.js` (new) — determinism, projection, revealed_to passthrough, and no-writes tests (fixtures/mocks only).
- `server/schemas/character_dossier.schema.js` (new) — mirrored dossier schema extended with per-fact `revealed_to` (AC #4).
- `package.json` (modified) — added `mongodb` + `dotenv` deps; added `snapshot` script; broadened `test` to `node --test` (auto-discovers scripts + server tests).
- `package-lock.json` (modified) — dependency lock for mongodb/dotenv.
- `README.md` (modified) — snapshot operation docs: read-only Atlas setup, command, env var, runtime, success/failure output (Task 6, AC #6).
- `data/snapshot.json` (generated, uncommitted) — real snapshot from the live verification run.
- `scripts/snapshot.mjs` (modified post-review) — `projectPlayer()` extracted as its own exported pure function; `stripSslParam()` replaces the regex-based ssl strip; `MongoClient` construction moved inside the try block; `client.close()` wrapped in its own try/catch; `main()` invocation gains a `.catch()`; em-dash removed from the console success string.
- `scripts/snapshot.test.js` (modified post-review) — added `projectPlayer` PII-stripping test (closes the real coverage gap on the actual enforcement point), added `stripSslParam` tests (including the leading-`ssl=` corruption case), hardened the AC #3 write-guard to also catch `$out`/`$merge`/`db.command`/`runCommand`/bulk-op initializers.

## Senior Developer Review

**3-layer adversarial review** (Blind Hunter: code only · Edge Case Hunter: code + project conventions · Acceptance Auditor: code + this story's ACs), all Opus, run independently and in parallel.

**Acceptance Auditor verdict: all 6 ACs PASS**, independently re-verified (re-ran `npm test`, re-grepped the source for every Mongo write method name, re-serialized the live `data/snapshot.json` and confirmed byte-identical reproduction, confirmed `revealed_to` sits at fact level).

**Findings triage:**

| # | Finding | Reviewer(s) | Disposition |
|---|---|---|---|
| 1 | `ssl=` strip regex corrupts the URI when `ssl` is the FIRST query param (consumes the leading `?`) | Blind Hunter | **Patched** — replaced with `stripSslParam()`, a query-string split/filter/rejoin; both the leading-param case and the normal case now have tests |
| 2 | `new MongoClient(...)` sits outside the try block — a malformed URI throws before the intended catch, risking an unhandled rejection that could echo the credentialed URI into a stack trace | Blind Hunter | **Patched** — construction moved inside `try` |
| 3 | `client.close()` in `finally` can itself reject (unhandled), masking a real success or a real prior error | Blind Hunter | **Patched** — wrapped in its own try/catch; `main()` invocation also gained a `.catch()` as a belt-and-braces guard against any future refactor |
| 4 | The players-PII-whitelist test only exercises `buildSnapshot` against fixtures that were already pre-filtered — the actual enforcement point (`readCollections`' Mongo projection) had zero test coverage; widening the live projection would pass every test | Edge Case Hunter | **Patched** — extracted `projectPlayer()` as a pure function, added a fixture carrying `email`/`real_name`/`discord_avatar` and asserted they're stripped |
| 5 | The AC #3 "no writes" lexical guard misses write-shaped-as-read vectors: `$out`/`$merge` aggregation stages, `db.command`/`runCommand`, bulk-op initializers | Blind Hunter, Edge Case Hunter (independently) | **Patched** — denylist extended to cover all of these; this is the single safety-critical test in the repo, so the guard now errs toward over-matching |
| 6 | Em-dash in the console success message violates CLAUDE.md's "no em-dashes in app-authored strings" | Edge Case Hunter | **Patched** — trivial, changed to a colon |
| 7 | `data/snapshot.json` carries every character/dossier document in full, including `st_hidden` secrets, in the clear — redaction is deferred to a not-yet-built Express layer | Blind Hunter, Edge Case Hunter (independently) | **Not a defect for this story** — this is architecturally correct per `specs/architecture.md` (redaction happens at request time, not at snapshot time). Escalated to `specs/deferred-work.md` as a **blocking requirement for story 2-1's own code review**, not merely deferred — 2-1 must never statically serve `data/`, and its owner/summary projection must be server-side and reviewed with this specifically in mind. |
| 8 | `toPlain()` only special-cases `ObjectId`/`Date`; other BSON types (`Decimal128`, `Long`, `Binary`) would serialize as their internal structure | Blind Hunter | Deferred to `specs/deferred-work.md` — none of the four collections currently store these types (verified against live data); dormant risk, not active |
| 9 | The lexical write-guard, even hardened, cannot catch arbitrarily indirect code; the real enforcement is the Atlas read-only IAM role (a manual step, not code) | Blind Hunter, Acceptance Auditor (both noted) | Deferred to `specs/deferred-work.md` — documented as a tripwire, not the security boundary; the manual Atlas setup step is already called out in the README per AC #6 |

Six patches applied and re-verified: full suite re-run after every patch stayed green (10/10 including story 1-1's test), and one additional live run against real `tm_suite` confirmed the refactored script still connects, still produces byte-identical output, and the new tests pass against real data's shape. Three items carried to `specs/deferred-work.md`, one of them (#7) elevated to a named blocking requirement for the next story rather than a passive note.

**No unresolved High/Medium findings remain. Status: done.**
