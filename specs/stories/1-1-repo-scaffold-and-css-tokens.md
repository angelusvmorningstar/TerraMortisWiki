# Story 1.1: repo-scaffold-and-css-tokens

Status: done

## Story

As the developer of this app,
I want an Express app skeleton with TM Suite's design tokens ported in,
so that every later page has a consistent visual language from the start instead of retrofitting it.

## Acceptance Criteria

1. `npm start` runs a minimal Express server (default port via `PORT` env, fallback `3000`) serving a placeholder home page that uses the ported CSS.
2. `public/css/theme.css` in this repo contains only the custom-property tokens actually used by this repo so far (colours, fonts) — ported from the real values in `../TM Suite/public/css/theme.css`, not re-guessed. No bare hex or inline `style="..."` anywhere in the ported CSS or new markup — every colour/font reference in markup and JS-built HTML goes through a token or a class.
3. A basic automated test exists proving the server boots and serves the home page (HTTP 200, contains expected marker text). Keep the test harness minimal — this is the first story in the repo, do not introduce a heavy framework for one smoke test.
4. `.gitignore` includes: `node_modules/`, `.env`, and a portraits directory (e.g. `assets/portraits/`) per the CLAUDE.md hard rule that AI-generated portraits are never committed.
5. `README.md` states how to install and run the server locally (`npm install`, `npm start`, `npm test`).
6. `package.json` declares `"type": "module"` (this repo follows TM Suite's ES-module convention) and pins Express as a dependency.

## Tasks / Subtasks

- [ ] Task 1: Initialise `package.json`, install Express (AC: #1, #6)
  - [ ] `npm init`, set `"type": "module"`, `npm install express`
  - [ ] `npm start` script → `node server/index.js`
- [ ] Task 2: Minimal Express server + placeholder home page (AC: #1)
  - [ ] `server/index.js`: boots an Express app, serves `public/` statically, one route rendering a placeholder home page
  - [ ] Home page markup uses only ported CSS classes/tokens, no inline styles
- [ ] Task 3: Port design tokens (AC: #2)
  - [ ] Read `../TM Suite/public/css/theme.css` in full; copy the `:root` token block verbatim for tokens this repo will plausibly need soon (backgrounds/surfaces, borders, gold/crimson accents, text colours, font stack) into `public/css/theme.css` here — do not invent new token names, do not rename existing ones
  - [ ] Add the same Google Fonts `<link>` pattern TM Suite uses for Cinzel / Cinzel Decorative / Lato / Libre Baskerville (verify the exact families and weights actually linked in `../TM Suite/public/index.html` or `admin.html` — do not assume Lora, the CLAUDE.md doc comment about "Lora for body" does not match the real `--fl`/`--ft` tokens in theme.css; the real file is authoritative)
  - [ ] Add a minimal `public/css/base.css` (or similar) with only the layout this story needs — a page wrapper, not a full component library
- [ ] Task 4: Test harness (AC: #3)
  - [ ] Pick the simplest fit (e.g. Node's built-in test runner + a plain `http` request against a started server, or `supertest` if a assertion-friendly HTTP layer is worth the one dependency) — justify the choice in Dev Agent Record, don't over-engineer
  - [ ] One test: server responds 200 on `/` with expected marker text
- [ ] Task 5: `.gitignore`, `README.md` (AC: #4, #5)

## Dev Notes

- This is the first story in a brand-new repo — there is no existing code to preserve or avoid breaking. The constraint is entirely "match the source of truth," not "don't regress."
- **Token source of truth**: `../TM Suite/public/css/theme.css` (sibling repo, read-only reference — do not modify it). Confirmed real tokens as of this story's writing (read directly, not assumed): `--bg`, `--surf`/`--surf1`/`--surf2`/`--surf3`, `--bdr`/`--bdr2`/`--bdr3`, `--gold`/`--gold2`/`--gdim` (plus alpha variants), `--crim`/`--crim2` (plus alpha variants), `--txt`/`--txt2`/`--txt3`, `--fh` (Cinzel), `--fl` (Lato), `--ft` (Libre Baskerville), `--fh-decorative` (Cinzel Decorative). Dark-theme overrides live under `[data-theme="dark"]` in the same file — port that block too if any dark-theme token differs, so this repo can eventually support both themes the same way TM Suite does. Re-verify against the live file at implementation time in case it has changed since this story was written.
- **CLAUDE.md hard rule reminder**: no portraits committed, ever. This story just needs the `.gitignore` entry — no portrait-rendering logic exists yet (that's story 2-1).
- **CLAUDE.md hard rule reminder**: never push or merge without explicit instruction. This story ends with a local commit only.
- Keep this story's scope to the skeleton. Do not build routes, auth, or the snapshot script here — those are stories 1-2 and 1-3.

### Project Structure Notes

Per `../architecture.md` (this repo's own `specs/architecture.md`), target layout:
```
server/            Express app
public/css/        ported design tokens/components
```
This story only needs `server/index.js` and `public/css/`. Later stories add `scripts/`, `data/`, `content/lore/`.

### References

- [Source: specs/architecture.md#CSS reuse]
- [Source: specs/architecture.md#Directory layout (this repo)]
- [Source: ../TM Suite/public/css/theme.css] (read directly for token values — do not rely on this story's summary above if it has drifted)
- [Source: ../TM Suite/CLAUDE.md#Conventions] (font stack described there as "Cinzel / Cinzel Decorative for headings, Lora for body" — this is stale relative to the actual theme.css tokens above; follow the real file)

## Dev Agent Record

### Agent Model Used

Opus (dev-story implementation), Opus x3 (adversarial code review: Blind Hunter, Edge Case Hunter, Acceptance Auditor)

### Debug Log References

- `npm test` green both pre- and post-patch: 1 test, 1 pass, 0 fail.
- Live boot verified on an ephemeral port: `/` → 200 (marker text present), `/css/theme.css` → 200, `/css/base.css` → 200.

### Completion Notes List

- Test runner: Node's built-in `node:test` + global `fetch`, zero third-party deps — justified for a single boot-and-serve smoke test; `engines.node >=18` added post-review to make the floor enforceable, not just documented.
- Font link deliberately adds `Cinzel+Decorative` beyond what `../TM Suite`'s real `<link>` loads, because the ported `--fh-decorative` token references it and the hero title uses that token — without it the token would silently fall back to plain Cinzel.
- Ported only the token subset this repo plausibly needs soon (backgrounds/surfaces, borders, gold/crimson, text, fonts + dark overrides), not the full TM Suite stylesheet, per the story's own instruction.
- Post-review patches applied: `EADDRINUSE` error handler on `app.listen` (was an unhandled-exception crash on port collision), `engines.node` field added to `package.json`, `npm test` script changed to an explicit glob (`node --test server/**/*.test.js`) to remove test-discovery ambiguity on early Node 18.x.
- Six items intentionally deferred, not fixed — see `specs/deferred-work.md`: the inherited (upstream-shared) `--surf1` dark-theme gap, static-middleware-before-route shadowing risk, absence of a 404/error-handling middleware, Google Fonts CDN hardening (SRI/CSP/local fallback), the fragile `isMain` check, and a cosmetic `PORT=0` logging edge case. None are blocking for a first-story skeleton.

### File List

- `package.json` (new)
- `server/index.js` (new)
- `server/index.test.js` (new)
- `public/css/theme.css` (new)
- `public/css/base.css` (new)
- `.gitignore` (new)
- `README.md` (new)

## Senior Developer Review

**3-layer adversarial review** (Blind Hunter: code only · Edge Case Hunter: code + project conventions · Acceptance Auditor: code + this story's ACs), all Opus, run independently and in parallel.

**Acceptance Auditor verdict: all 6 ACs PASS**, independently re-verified (re-ran `npm test`, re-booted the server, re-curled all three endpoints, re-grepped for bare hex/inline styles) rather than trusting the dev agent's self-report.

**Findings triage:**

| # | Finding | Reviewer | Disposition |
|---|---|---|---|
| 1 | `app.listen` has no `'error'` handler — `EADDRINUSE` crashes with a raw stack trace | Edge Case Hunter | **Patched** |
| 2 | No `engines.node` in `package.json` despite README stating Node 18+ | Edge Case Hunter | **Patched** |
| 3 | Bare `node --test` may not reliably discover the test file on early Node 18.x | Edge Case Hunter | **Patched** (explicit glob) |
| 4 | `--surf1` has no dark-theme override | Blind Hunter | Deferred — inherited faithfully from TM Suite's own upstream gap, currently inert (unused in `base.css`) |
| 5 | `express.static` registered before `/` route — future `public/index.html` would silently shadow the route | Blind Hunter | Deferred — latent, no such file exists yet |
| 6 | No 404/error-handling middleware | Blind Hunter | Deferred — acceptable for a one-route skeleton, revisit when async routes land |
| 7 | Google Fonts CDN: no fallback/SRI/CSP | Blind Hunter | Deferred — production-hardening scope, not this story's |
| 8 | `isMain` check fragile across symlink/extensionless invocation | Blind Hunter | Deferred — fine for the documented invocation |
| 9 | `PORT=0` produces a misleading startup log | Edge Case Hunter | Deferred — cosmetic |

Three patches applied (all one-line-scale, no test asserted the specific pre-patch behaviour so no revert-and-watch-fail cycle was possible for these — verified instead by full regression re-run, which stayed green throughout). Six items carried to `specs/deferred-work.md`, none blocking.

**No unresolved High/Medium findings remain. Status: done.**
