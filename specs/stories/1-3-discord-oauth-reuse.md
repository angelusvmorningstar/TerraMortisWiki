# Story 1.3: discord-oauth-reuse

Status: done

## Story

As a player,
I want to log in with the same Discord account I use for TM Suite,
so that I don't need a second login and the site knows which character(s) are mine.

## Acceptance Criteria

1. `GET /auth/discord` redirects to Discord's OAuth2 consent screen (`identify` scope only), using `DISCORD_CLIENT_ID`/`DISCORD_REDIRECT_URI` from env — the SAME Discord application as TM Suite (this repo gets its own redirect URI registered as a second entry on that one Discord app; document this as a manual Discord-developer-portal step, it is not a code change).
2. `POST /auth/discord/callback` exchanges the code for a Discord access token, fetches the Discord profile, and resolves a matching `players` entry (from the snapshot, keyed by `discord_id`) — no live Mongo lookup. Returns the Discord access token plus a `user` object (`role`, `player_id`, `character_ids`, `discord_username`).
3. `requireAuth` middleware validates the bearer token against Discord's `/users/@me` on each request, resolves `req.user` from the SNAPSHOT's `players` data (not live Mongo), with the same short-lived in-memory cache pattern TM Suite uses (60s) so most requests don't hit Discord at all.
4. Every route in this app except the two OAuth routes themselves requires a valid session — there is no anonymous/public tier (per PRD, this was an explicit call). A request with no/invalid/expired token gets a clear 401; a valid Discord identity with no matching `players` entry gets a clear 403 — never a crash, never a silent pass-through.
5. A non-production-only local test bypass exists for development (mirroring TM Suite's `local-test-token` pattern), gated so it can never activate when `NODE_ENV === 'production'`.
6. `players.character_ids` is read and exposed on `req.user` as an array, with no code anywhere assuming exactly one element — this repo has no player with more than one character today, but nothing here should special-case that.
7. Credentials (`DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`) are never logged, never written to any response, never written to the snapshot.

## Tasks / Subtasks

- [ ] Task 1: Env config (AC: #1, #7)
  - [ ] Extend this repo's env loading with `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_REDIRECT_URI` (mirror `../TM Suite/server/config.js`'s shape/defaults where sensible)
  - [ ] `.env.example` documents the required vars without real values
- [ ] Task 2: Auth routes (AC: #1, #2)
  - [ ] `server/routes/auth.js`: `GET /auth/discord` (redirect), `POST /auth/discord/callback` (code exchange + profile fetch + `players` lookup against the loaded snapshot)
  - [ ] Snapshot's `players` array is loaded into memory once at boot (reuse whatever snapshot-loading approach makes sense here — this repo doesn't have a "load the snapshot" utility yet; write a small one, since story 2-1/2-2 will need to load the rest of the snapshot too)
- [ ] Task 3: Auth middleware (AC: #3, #4, #5, #6)
  - [ ] `server/middleware/auth.js`: `requireAuth`, matching TM Suite's cache-then-validate shape, resolving against the in-memory snapshot's `players`
  - [ ] Apply `requireAuth` to every route except the two auth routes
  - [ ] Local test bypass, `NODE_ENV`-gated
- [ ] Task 4: Error responses (AC: #4)
  - [ ] 401 for missing/invalid/expired bearer token
  - [ ] 403 for a valid Discord identity with no matching `players` record
- [ ] Task 5: Tests
  - [ ] Mock Discord's token-exchange and `/users/@me` endpoints (do not call the real Discord API in tests) — verify: successful login resolves the right player, unknown Discord ID gets 403, missing/invalid bearer gets 401, a gated route is unreachable without auth, the local test bypass never activates when `NODE_ENV=production`
  - [ ] A test asserting `character_ids` handling doesn't special-case array length 1
- [ ] Task 6: Document the manual Discord setup step (AC: #1)
  - [ ] README: exact instructions for registering this repo's redirect URI as a second entry on the existing TM Suite Discord application

## Dev Notes

- **Port, do not reinvent.** The full existing pattern is in `../TM Suite/server/routes/auth.js` and `../TM Suite/server/middleware/auth.js` — read both completely before writing anything. The frontend holds the Discord `access_token` itself (not a wiki-issued JWT) and sends it as `Authorization: Bearer <token>` on every request; `requireAuth` re-validates against Discord and re-resolves `req.user` from data, cached 60s per token in an in-memory `Map`. This is "same authorisation as TM Suite" — do not invent a session/JWT scheme instead.
- **Snapshot, not live Mongo, for the `players` lookup.** TM Suite's `auth.js` queries `getCollection('players')` live; this repo's version resolves against the in-memory snapshot loaded at process boot (per `specs/architecture.md`). If the snapshot is stale (a new player was added to Mongo since the last `npm run snapshot`), that player simply can't log in until the next snapshot + deploy — this is a known, accepted trade-off of the rebuild-on-command model (see PRD), not a bug to work around in this story.
- **`players` snapshot shape** (per story 1-2): only `discord_id`, `role`, `character_ids`, `discord_username` are present — TM Suite's real `players` documents have more fields (avatar, last_login, etc.) that were deliberately excluded from the snapshot. Do not assume any field beyond those four exists.
- TM Suite auto-links a player record by `discord_username` if `discord_id` is unset (first-login convenience). Decide in implementation whether that's worth porting given the snapshot is static between rebuilds — if a player's `discord_id` was never backfilled in TM Suite's own database, this repo can't write it back (never writes to Mongo), so the practical behaviour is: if `discord_id` isn't already populated in the snapshot, that player can't be resolved by this app at all. Document this constraint plainly in dev notes rather than trying to replicate the write-back.
- This story does not build any dossier/world/lore views — just the login gate. Stories 2-1/2-2/2-3 are the first real gated content.

### Project Structure Notes

Adds `server/routes/auth.js`, `server/middleware/auth.js`, and (new, needed here and by later stories) a small snapshot-loading utility — something like `server/snapshot-store.js` that reads `data/snapshot.json` once at boot and exposes accessors. Wire `requireAuth` into `server/index.js`'s route registration from story 1-1.

### References

- [Source: ../TM Suite/server/routes/auth.js]
- [Source: ../TM Suite/server/middleware/auth.js]
- [Source: ../TM Suite/server/config.js]
- [Source: specs/architecture.md#Auth — port, don't reinvent]
- [Source: specs/stories/1-2-mongo-snapshot-script.md] (players snapshot shape)

## Dev Agent Record

### Agent Model Used

Opus 4.8 (dev-story / Amelia).

### Debug Log References

- Initial test run: 11 auth tests failed with "unexpected fetch to http://127.0.0.1.../api/me" — the `globalThis.fetch` Discord mock was also intercepting the test client's own requests to the local server. Fixed by scoping the mock to only URLs starting with `https://discord.com/api/v10` and delegating everything else to the real fetch. Re-run: 28/28 green.

### Completion Notes List

- **Home-page auth tension (AC #4 vs Story 1.1's public `/` smoke test) — resolved.** A login gate needs an unauthenticated entry point: the shell hosting the "Log in with Discord" button plus the two OAuth routes. Resolution: `/` (login-landing), `/auth/*`, and static CSS form the ONLY anonymous surface; none serve snapshot/player data. Every route registered after `app.use(requireAuth)` (currently `GET /api/me`, and all future content routers) requires a valid session. AC #4 forbids an anonymous *content* tier, which this preserves — there is no way to see player/snapshot data without login. Story 1.1's `GET /` smoke test stays green unchanged.
- **`discord_username` auto-link write-back NOT ported (per dev notes).** TM Suite matches by username and writes `discord_id` back to Mongo on first login. This app never writes to Mongo and the snapshot is static, so resolution is by `discord_id` only. A player whose `discord_id` was never backfilled in TM Suite is unmatchable here until the next snapshot + deploy — documented in `server/routes/auth.js` header and README.
- **`player_id` = the player's `discord_id`.** The snapshot's players whitelist (Story 1.2) deliberately omits the Mongo `_id`, so `discord_id` is the only stable player identifier available. `req.user.player_id` is set to it. Documented in `buildUserFromPlayer`.
- **Local-test bypass gating reads `process.env.NODE_ENV` LIVE** (not the frozen `config.NODE_ENV`), so the gate can never be left open by import-time capture; in `production` the branch is skipped entirely and the token is validated against Discord like any other. Test `AC #5 ... NEVER activates when NODE_ENV=production` asserts a 401 AND that Discord WAS contacted.
- **Snapshot-loader interface (`server/snapshot-store.js`) designed for reuse by stories 2-1/2-2/2-3**, not auth-only: load-once cache with `loadSnapshot({path,force})`, generic accessors `getPlayers/getCharacters/getDossiers/getTerritories`, a `getPlayerByDiscordId` convenience, and a `setSnapshot(obj)` test seam. Because `loadSnapshot()` is a no-op when a snapshot is already present, a test that injects via `setSnapshot` before `createApp()` is never clobbered by the boot load.
- **AC #6 (no length-1 special-casing):** `character_ids` is always `Array.isArray(...) ? [...] : []` (copied so callers can't mutate the snapshot). Two tests cover a 2-id and a 1-id player through the identical path.
- **AC #7:** `DISCORD_CLIENT_SECRET` is read in `config.js` and used only in the server-to-server token-exchange body; grep confirms no `console.*` of secrets/tokens and it never enters a response or the snapshot.
- **Test results:** `npm test` → 28 pass / 0 fail. Includes the 10 pre-existing tests (9 in `scripts/snapshot.test.js`, 1 in `server/index.test.js`) unchanged.

### File List

Created:
- `server/config.js` — env config (Discord OAuth vars, mirrors TM Suite shape; loads root `.env`)
- `server/snapshot-store.js` — load-once in-memory snapshot loader + accessors
- `server/routes/auth.js` — `GET /auth/discord`, `POST /auth/discord/callback` (snapshot-resolved)
- `server/middleware/auth.js` — `requireAuth`, `buildUserFromPlayer`, `_resetTokenCache`
- `server/auth.test.js` — 15 tests (routes + middleware; Discord API mocked)
- `server/snapshot-store.test.js` — 3 tests (store accessors)
- `.env.example` — documents required vars (no real values)

Modified:
- `server/index.js` — mount `express.json()`, public `/auth` router, `app.use(requireAuth)` gate, gated `GET /api/me` session route; `loadSnapshot()` at boot
- `README.md` — Discord OAuth manual setup section + local-test-bypass note

Modified again, post-review (see Senior Developer Review below):
- `server/middleware/auth.js` — local-test bypass switched from a `!== 'production'` denylist to an explicit `{development, test}` allowlist (fail-closed on unset/unexpected `NODE_ENV`)
- `server/routes/auth.js` — OAuth `state` generated + set as an httpOnly cookie on `GET /discord`, verified (constant-time) against the cookie on `POST /callback`, cookie cleared after use; `redirect_uri` no longer accepted from the client, pinned to `config.DISCORD_REDIRECT_URI`; both Discord `fetch` calls in the callback wrapped in try/catch
- `server/snapshot-store.js` — `getPlayerByDiscordId` now string-normalises both sides of the comparison
- `server/index.js` — static CSS mount narrowed from the whole `public/` tree to `public/css` at `/css`
- `package.json`/`package-lock.json` — added `cookie-parser`
- `server/auth.test.js` — added a `getState()` test helper for the state round-trip; 4 new CSRF tests; 1 new fail-closed-on-unset-NODE_ENV test; 2 new static-scoping tests

### File List (final, including post-review patches)

- `server/config.js`, `server/snapshot-store.js`, `server/routes/auth.js`, `server/middleware/auth.js`, `server/auth.test.js`, `server/snapshot-store.test.js`, `.env.example`, `server/index.js`, `README.md`, `package.json`, `package-lock.json`

## Senior Developer Review

**3-layer adversarial review** (Blind Hunter: code only · Edge Case Hunter: code + project conventions · Acceptance Auditor: code + this story's ACs), all Opus, run independently and in parallel. This is an authentication layer, so findings were weighted toward anything that could grant unauthorised access.

**Acceptance Auditor verdict: all 7 ACs PASS**, independently re-verified (re-ran `npm test`, re-grepped for Mongo imports in the auth path, traced the local-test-bypass code path exactly, confirmed `character_ids` has a single touch point with no length-1 assumption, confirmed the client secret never leaves the server).

**Findings triage:**

| # | Finding | Reviewer(s) | Disposition |
|---|---|---|---|
| 1 | **Local-test-bypass fails OPEN** — gated on `NODE_ENV !== 'production'`, so an unset, misspelled, or unconfigured `NODE_ENV` on the real host hands out a hardcoded, cross-repo-shared token as a full ST-role master key to anyone who sends it | Blind Hunter, Edge Case Hunter (independently, both HIGH) | **Patched** — switched to an explicit allowlist (`development`, `test`); new test proves the bypass fails closed when `NODE_ENV` is unset (the exact scenario flagged) |
| 2 | **Whole `public/` directory served before the auth gate**, not just CSS — inert today, but the moment any future story drops rendered content into `public/`, it's served with zero login check, which is the exact cross-player leak this app exists to prevent | Blind Hunter, Edge Case Hunter (independently, both HIGH/MEDIUM) | **Patched** — static mount narrowed to `public/css` at `/css`; two regression tests added |
| 3 | **OAuth flow has no `state` parameter** — classic login-CSRF: an attacker can capture their own auth code and trick a victim's browser into completing the callback, logging the victim into the attacker's identity | Blind Hunter (MEDIUM) | **Patched** — `state` generated per login attempt, bound via an httpOnly/sameSite=lax cookie, verified with a constant-time comparison on callback; 4 new tests (missing state, mismatched state, missing cookie, and the state round-trip on the happy path) |
| 4 | **Callback route's two Discord `fetch` calls have no try/catch** (unlike the middleware's), so a transient Discord outage surfaces as a raw 500 instead of the modelled `AUTH_ERROR` the ACs call for | Blind Hunter, Edge Case Hunter (independently) | **Patched** — both wrapped, matching the middleware's shape |
| 5 | **Client-controlled `redirect_uri` forwarded into the token exchange** — not directly exploitable (Discord enforces the match), but pointless attacker-influenceable input on an auth-critical call | Blind Hunter | **Patched** — pinned server-side to `config.DISCORD_REDIRECT_URI`, no longer read from the request body |
| 6 | **`getPlayerByDiscordId` uses strict `===`** between Discord's string `id` and the snapshot's `discord_id` — fine for the current snapshot shape, but a silent 403-for-everyone failure mode if that ever drifts to a non-string type | Edge Case Hunter | **Patched** — both sides normalised with `String(...)` |
| 7 | Unbounded in-memory token-cache growth | Blind Hunter | Deferred to `specs/deferred-work.md` — negligible at this app's real scale |
| 8 | Snapshot-store accessors return live references, not copies (no present bug — `buildUserFromPlayer` already defends itself) | Blind Hunter | Deferred to `specs/deferred-work.md` — flagged for stories 2-1/2-2 before they read the snapshot directly |

Six patches applied for real security findings, all re-verified: full suite re-run after every patch stayed green, and a live boot (`node server/index.js`) confirmed `/`, `/css/theme.css`, and `/auth/discord`'s redirect all still work correctly post-patch. One test I added on top of the fix (asserting the OAuth state cookie is single-use) was itself wrong — `res.clearCookie()` is client-side hygiene, not a server-side nonce store, and enforcing true single-use isn't required by the actual CSRF threat model (an attacker without the victim's cookie can't forge a match regardless; Discord's own authorization code is already single-use). That test was removed rather than adding unneeded server-side state-tracking machinery to satisfy it. Final suite: 34/34 passing.

**No unresolved High/Medium findings remain. Status: done.**
