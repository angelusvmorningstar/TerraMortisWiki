# Story 2.3: lore-pages

Status: done

> **The lowest-stakes story in Epic 2, and deliberately so.** Unlike Story 2-1 (per-viewer dossier projection) and Story 2-2 (office-holder allowlisting), this story touches NO live Mongo document at all. It reads no `characters`, no `character_dossier`, no `territories`, no `players` content; it calls no `getCharacters()`/`getDossiers()`/`getTerritories()`/`getPlayers()`. The lore pages are static, editorial, in-repo markdown (setting primer, game guide, rules, friendly errata), authored by Angelus, identical for every viewer. Because there is no owner tier, no `revealed_to` logic, no secret channel, and no raw-document spread risk, the sibling stories' **[LEAK-GATE]** (2-1) and **[PROJECTION]** (2-2) tags DO NOT apply here and are deliberately NOT invented for this story. See Dev Notes "Why there are no [LEAK-GATE] / [PROJECTION] tags". The two disciplines that DO matter, and that carry the weight the projection tags carried in the siblings, are: (1) the whole-site login gate is honoured by serving lore CONTENT through the gated API, never by baking prose into un-gated Netlify static HTML; and (2) the page `:slug` is allowlist-validated against a fixed manifest before any filesystem read, so no path-traversal can reach a file outside the lore directory. Read Dev Notes "The login gate is the discipline here" and "Slug allowlist / no path traversal" before writing the route.

## Story

As a player,
I want to read the setting primer, game guide, rules, and a friendly errata summary,
so that I can get oriented in the chronicle without hunting through PDFs or re-asking the ST the same lore questions.

## Acceptance Criteria

1. A gated lore router (`server/routes/lore.js`) is mounted in `server/index.js` **after** the `app.use(requireAuth)` line, under `/api`, alongside the Story 2-1 characters router and the Story 2-2 world router. It exposes exactly two read-only endpoints: a lore index (`GET /api/lore`) and a single lore page (`GET /api/lore/:slug`). The router performs NO Mongo access whatsoever (it calls none of the `mongo-store.js` accessors) and issues NO writes of any kind; its only I/O is read-only `fs` reads of the committed markdown files. This is the first content router in the repo that reads from the filesystem rather than from Mongo, so state that read-only-filesystem posture explicitly in a header comment.

2. Lore markdown files live at **`server/content/lore/*.md`**, inside Render's `rootDir: server` so they are deployed with the API service. This is the architecture doc's `content/lore/*.md` "(or equivalent)": the repo-root `content/lore/` sketched in `specs/architecture.md` cannot be read by the Render service (its `rootDir` is `server/`), and the login gate (AC #3) requires the content to be served by the API, not by Netlify, so the files must sit under `server/`. Document this location decision and its two reasons (rootDir + login gate) in Dev Notes.

3. The whole-site login gate (Story 1-3: "the whole site requires a valid session, no anonymous tier") is honoured by routing lore CONTENT through the gated `/api/lore` endpoints, NEVER by baking the prose into a statically-served HTML file. Netlify serves everything in `public/` to any anonymous visitor; the character and world HTML shells are safe only because they are empty until an authed `apiGet` fires. Lore prose IS the content, so it must arrive the same way: the `.html` files this story adds contain ONLY the page shell plus a `<script>`, never any lore prose, and the prose is fetched via `apiGet` (Bearer token, redirect-to-login on missing token or 401). A logged-out request for lore content therefore gets the same login redirect a logged-out character request gets. There is no path by which the lore prose is readable without a session.

4. The page set is defined by a small, ordered manifest (an array of `{ slug, title }`) declared in `server/routes/lore.js`, fixing the four v1 pages and their order and display titles: setting primer, game guide, rules, friendly errata. The manifest is the single source of truth for which slugs are valid and what each page is called; titles are not derived from file contents.

5. `GET /api/lore/:slug` serves a page ONLY if `:slug` is present in the manifest allowlist. Any slug not in the manifest, including a path-traversal payload (for example `../config`, `..%2F..%2Fconfig`, or an absolute path), returns a clean `404 NOT_FOUND` and NEVER reads or returns a file outside the lore directory. The `:slug` value is NEVER concatenated into a filesystem path before it has been confirmed to be a manifest slug. Defence in depth: after resolving the file path, assert the resolved absolute path still sits within the lore directory (a `path.resolve` + containment check) before reading. This is the one genuine security discipline in the story (see the top-of-file note on why the projection tags do not apply).

6. Markdown-to-HTML rendering is a pure, separately unit-testable function (mirroring how Story 2-1 split `projectCharacterForViewer` and Story 2-2 split `buildWorldView` out of their routes). `renderLoreMarkdown(md)` is exported from `server/routes/lore.js` and converts a documented markdown subset to an HTML string: headings, paragraphs, bold and italic, inline code, fenced code blocks, unordered and ordered lists, links, block quotes, and horizontal rules. Raw HTML (including any `<script>`) present in the markdown source is escaped by default and never passed through as live markup; the content is trusted (in-repo, Angelus-authored) so this is defence in depth, not a leak gate, but the renderer must still not emit arbitrary embedded HTML. The HTTP route is a thin wrapper: validate slug, read the file, call `renderLoreMarkdown`, return `{ slug, title, html }`.

7. `GET /api/lore` returns the ordered manifest as `[{ slug, title }]` only, with no file bodies. This feeds the frontend index page (AC #9).

8. Error responses are modelled, never a raw Express 500 with a stack trace or a filesystem path in the body. A manifest slug whose backing file is missing or unreadable on disk returns a modelled content error (for example `500 CONTENT_ERROR`, mirroring the `503 STORE_ERROR` shape in `server/routes/characters.js` and `server/routes/world.js`); an unknown or disallowed slug returns `404 NOT_FOUND`. No response body ever contains an absolute path, an `fs` error string, or a stack trace.

9. Frontend (Netlify static): a lore index page and a lore article page.
   - `public/lore.html` (`<title>Terra Mortis Wiki: Lore</title>`, colon, no em-dash) fetches `GET /api/lore` via `apiGet` (`public/js/data/api.js`) and renders the manifest as a list of links to `public/lore-page.html?slug=<slug>`, reusing the existing `.content` shell and card/grid vocabulary.
   - `public/lore-page.html` (`<title>Terra Mortis Wiki: Lore</title>`) reads `?slug=` from the URL, fetches `GET /api/lore/:slug` via `apiGet`, and injects the returned `data.html` into a `.lore-article` container; after a successful fetch it updates `document.title` to `Terra Mortis Wiki: <page title>` (colon, no em-dash, title taken from the manifest-controlled response, so guaranteed clean).
   - An unknown slug (the `{ _notFound: true }` shape `apiGet` returns on 404) renders an honest "That page was not found." state, and any other fetch failure renders an honest error state via the existing `.hero__status` pattern. Neither ever leaves a blank page.
   - New JS: `public/js/lore/index.js` and `public/js/lore/page.js`.

10. Nav wiring so the lore section is reachable from the rest of the site: add a `.backlink`-styled link to `/lore.html` on both `public/characters.html` and `public/world.html`, matching the existing cross-links already there (`characters.html` links to `/world.html`; `world.html` links to `/characters.html`), and add a backlink from the lore pages back to the roster or the lore index. Match the existing nav pattern exactly rather than inventing a new one; British English copy.

11. All new CSS reuses the ported design tokens (`public/css/theme.css`) and extends the existing component vocabulary in `public/css/components.css` (`.content`, `.content__header`, `.content__title`, `.content__eyebrow`, `.backlink`, `.char-grid`, `.char-card`, `.empty-state`, `.hero__status`). The one genuinely new addition is a tokens-only prose block: `.lore-article` plus styling for the rendered child elements it contains (`h1`, `h2`, `h3`, `p`, `ul`, `ol`, `li`, `a`, `blockquote`, `code`, `pre`, `hr`). No bare hex, no `rgba()`, no inline `style="..."` in markup or in JS-rendered HTML. British English throughout all static copy (Colour, Honour, capitalise, Defence).

12. **No em-dashes anywhere in any user-facing string, and a colon in every `<title>`.** Every `<title>` uses a colon (`Terra Mortis Wiki: Lore`), never an em-dash, and the `document.title` set in JS (AC #9) is likewise colon-formatted. This is the exact F1 review finding raised in the dev pass of BOTH Story 2-1 and Story 2-2 (an em-dash in a `<title>` is user-facing browser-tab text, not an exempt code comment): it has been a real, repeated regression in this repo and must not be reintroduced. See Dev Notes "British English and no em-dashes (known dev-pass failure mode)". The dev-authored placeholder markdown copy must itself be em-dash-free, and `renderLoreMarkdown` must not transform hyphens into em-dashes.

13. Placeholder copy is committed; authoring or approving the REAL copy is out of scope for the dev-story phase and does not block completion. The dev commits four placeholder `server/content/lore/*.md` files, each visibly marked as placeholder (for example a block quote near the top reading "Placeholder copy pending Angelus's approved text."), and each structured to exercise the full supported markdown subset so the renderer is genuinely tested against real files. Writing the actual setting primer, game guide, and rules prose, and in particular the friendly-errata plain-language rewrite of the `../TM Suite/data/reference/` house-rules material, is Angelus's to supply or approve and is explicitly OUT OF SCOPE for this story's dev work. Swapping placeholder copy for real copy later is a content-only edit (edit the `.md`, redeploy the API) that requires no code change. Story completion is defined by the plumbing rendering the placeholder files correctly, and MUST NOT be gated on real copy existing. See Dev Notes "Placeholder copy scoping (do not author the real text)".

14. Automated tests (via the same `db.setTestDb` mongodb-driver mock and the Discord `/users/@me` mock the sibling stories use, so no live `tm_suite` and no real Discord). Note that the mock seam is still needed even though the lore route reads no Mongo, because `requireAuth` sits in front of the route and resolves `req.user` from Mongo, so a test request must still authenticate through the same fixtures Stories 1-3 / 2-1 / 2-2 use. The tests prove:
   - `renderLoreMarkdown` unit tests: each supported construct (headings, paragraphs, bold/italic, inline code, fenced code block, unordered list, ordered list, link, block quote, horizontal rule) renders to the expected HTML; a source containing raw HTML or a `<script>` tag is escaped rather than passed through (the safety case); empty or whitespace-only input yields an honest empty or plain result, not a crash.
   - `GET /api/lore` returns the ordered manifest (the four `{ slug, title }` entries in declared order, no bodies).
   - `GET /api/lore/:slug` returns `{ slug, title, html }` for a valid slug, rendered from the committed placeholder file.
   - **The security test:** an unknown slug AND a path-traversal payload (for example `../config` or an encoded `..%2F`) both return `404 NOT_FOUND` and the response body contains none of the contents of any file outside the lore directory. Discriminating: a naive `fs.readFile(path.join(dir, slug + '.md'))` without the allowlist would either error out or read an unintended file, so this test fails against the un-allowlisted implementation and passes only with the manifest allowlist plus the containment check.
   - A manifest slug whose backing file is absent on disk returns the modelled content error (AC #8), not a raw 500, with no path or stack trace in the body.
   - The 401 gate: a request with no token is rejected by `requireAuth` (401) before the route runs.

## Tasks / Subtasks

- [x] Task 1: Placeholder lore content files (AC: #2, #13)
  - [x] Create `server/content/lore/setting-primer.md`, `game-guide.md`, `rules.md`, `friendly-errata.md`.
  - [x] Each file carries a clearly-marked placeholder banner (a block quote: "Placeholder copy pending Angelus's approved text.") and exercises the full supported markdown subset (headings, paragraphs, bold/italic, a link, an unordered and an ordered list, a block quote, inline code, a fenced code block, a horizontal rule) so the renderer is tested against real files.
  - [x] The `friendly-errata.md` placeholder explicitly states, in its body, that the plain-language errata rewrite of the `../TM Suite/data/reference/` house-rules material is pending Angelus's supplied or approved text and was NOT authored by the dev.
  - [x] All placeholder copy is British English and em-dash-free.
- [x] Task 2: Pure markdown renderer + manifest (AC: #4, #6)
  - [x] `server/routes/lore.js`: declare the ordered manifest (`[{ slug, title }]`) for the four pages.
  - [x] Implement and export `renderLoreMarkdown(md)` covering the documented subset; escape raw HTML in the source (do not pass embedded markup through); do not turn hyphens into em-dashes.
  - [x] Default to a dependency-free renderer (see Dev Notes "Markdown rendering: dependency-free subset by default"). Adding a single small, established markdown dependency (for example `marked`) is an acceptable escape hatch only if the placeholder or real copy needs constructs the subset does not cover; if added, note it in the Dev Agent Record and keep the route wrapper thin. (Dependency-free; no library added.)
- [x] Task 3: Lore router + endpoints (AC: #1, #3, #5, #7, #8)
  - [x] `GET /api/lore`: return the manifest as `[{ slug, title }]` (no bodies).
  - [x] `GET /api/lore/:slug`: validate `:slug` against the manifest allowlist FIRST; on miss return `404 NOT_FOUND`. Only then build the file path, assert it resolves within the lore directory (containment check), read it, render it, and return `{ slug, title, html }`.
  - [x] Wrap the `fs` read in try/catch returning the modelled content error (AC #8); never a raw 500, never a path or stack trace in the body.
  - [x] Mount the router in `server/index.js` after `app.use(requireAuth)`, alongside the characters and world routers. No new auth logic; the route never reads `req.user`.
  - [x] Confirm the router calls zero Mongo accessors and issues zero writes.
- [x] Task 4: Server tests (AC: #14)
  - [x] `server/routes/lore.test.js`: `renderLoreMarkdown` unit tests for every supported construct + the raw-HTML-escaped safety case + empty input.
  - [x] Route tests via `db.setTestDb` + Discord `/users/@me` mock (the seam is for `requireAuth`, not for lore content): index returns the ordered manifest; a valid slug returns `{ slug, title, html }`; the unknown-slug AND path-traversal security test (both 404, no external file contents); a missing backing file returns the modelled error; the 401 gate.
- [x] Task 5: Frontend index + article pages (AC: #9, #11, #12)
  - [x] `public/lore.html` + `public/js/lore/index.js`: fetch `GET /api/lore` via `apiGet`, render the manifest as links to `lore-page.html?slug=<slug>`, honest empty/error states.
  - [x] `public/lore-page.html` + `public/js/lore/page.js`: read `?slug=`, fetch `GET /api/lore/:slug` via `apiGet`, inject `data.html` into `.lore-article`, update `document.title` to `Terra Mortis Wiki: <page title>` (colon), honest `_notFound` and error states.
  - [x] `<title>` uses a colon in both files; no em-dash anywhere in either file; British English.
  - [x] Add tokens-only `.lore-article` prose styling (and child element styles) to `public/css/components.css`; reuse existing classes for the index. No bare hex / `rgba()` / inline styles.
- [x] Task 6: Nav wiring + docs (AC: #10)
  - [x] Add a `.backlink` link to `/lore.html` on `public/characters.html` and `public/world.html`; add a backlink from the lore pages back to the roster or the lore index.
  - [x] Brief README note: the `/api/lore` and `/api/lore/:slug` endpoints, that lore is login-gated in-repo editorial markdown under `server/content/lore/` (NOT Mongo, NOT static Netlify HTML), that the slug is allowlist-validated (no path traversal), and that swapping placeholder for real copy is a content-only edit needing no code change.
  - [x] Confirm `netlify.toml`'s existing `/api/*` proxy (Story 2-1) already covers `/api/lore` and `/api/lore/:slug`; note this in Completion Notes rather than adding a duplicate redirect rule.

## Dev Notes

### Why there are no [LEAK-GATE] / [PROJECTION] tags

Story 2-1 tagged its ACs **[LEAK-GATE]** because `getCharacters()`/`getDossiers()` hand the route full, unredacted documents (including `st_hidden` secrets) and the projection function is the sole authorisation boundary. Story 2-2 tagged its ACs **[PROJECTION]** for the same reason at lower severity: office data is public, but the route still allowlist-builds every holder object off full character and territory documents. Neither risk exists in this story:

- **No Mongo document is read.** The lore router calls none of the `mongo-store.js` accessors. There is no character, dossier, territory, or player content anywhere on the response path, so there is no owner-only field to leak and no secret channel to gate.
- **No per-viewer projection.** Every logged-in viewer receives byte-identical content. There is no owner tier, no `revealed_to`, no dependence on `req.user.character_ids`; the route never reads `req.user` at all.
- **No raw-document spread risk.** The response is `{ slug, title, html }` assembled from a fixed manifest and a rendered file. There is no upstream document whose newly-added field could ride through a spread.

So the projection tags are deliberately NOT applied here, and no new tag is invented to stand in for them: doing so would imply a per-viewer or per-document authorisation surface that this story does not have. What DOES carry weight, and what the reviewer should treat as this story's load-bearing surface, is the two disciplines below.

### The login gate is the discipline here (AC #3)

The one security-adjacent property that matters is that the whole-site login gate (Story 1-3 AC: "the whole site requires a valid session, no anonymous tier") actually covers the lore CONTENT, not just an empty shell. The subtlety, verified against the existing pages:

- Netlify serves everything in `public/` to any anonymous visitor. `public/characters.html` and `public/world.html` are served to a logged-out browser too; they are safe only because they contain an empty shell and their data arrives through an authed `apiGet` that redirects to `login.html` on a missing token or a 401.
- Lore prose IS the content. If it were baked into a statically-served `.html` file (or into a `public/`-hosted `.md`), an anonymous visitor could read all four pages by loading the page or viewing source, with no session. That would recreate exactly the anonymous content tier Story 1-3 forbade.
- Therefore the content must be served by the gated API and fetched via `apiGet`, exactly like character and world data. The `.html` files this story adds hold only the shell and a `<script>`; the prose lives under `server/content/lore/` and is only ever emitted by a route mounted after `app.use(requireAuth)`.

The lore is not secret (it is player-facing reference), so this is not a leak gate; it is about honouring the stated whole-site-login requirement and not opening an anonymous content tier through the static half of the app.

### Slug allowlist / no path traversal (AC #5)

The only user-controlled input on the whole surface is the `:slug` path parameter, and it is used to select a file to read. Treat it as hostile:

- Validate `:slug` against the manifest allowlist BEFORE it touches any filesystem path. A slug not in the manifest returns `404 NOT_FOUND` and no read happens.
- Never build a path from the raw slug first and read second. The order is: is-it-in-the-manifest, then build the path, then containment-check, then read.
- Defence in depth: after `path.resolve`-ing the target, assert it still lives inside the resolved lore directory (a `startsWith` containment check) before reading, so even a manifest bug cannot escape the directory.
- The security test (AC #14) drives an unknown slug and an explicit traversal payload and asserts both return 404 with no external file contents. It is discriminating: an un-allowlisted `fs.readFile(path.join(dir, slug + '.md'))` fails it.

### Markdown location decision (AC #2)

- **Under `server/`, not repo-root.** `render.yaml` sets `rootDir: server`, so the Render API service builds and runs from `server/`; a repo-root `content/lore/` (as sketched in `specs/architecture.md`'s directory diagram) is outside that root and cannot be relied on to be readable by the running service. Combined with the login-gate requirement (content must be API-served, not Netlify-served), the files must sit under `server/`. Use `server/content/lore/`. This is the architecture doc's own "(or equivalent)" and "served by the API or read by the frontend at build/serve time, decided per-story" latitude: the decision, made here, is API-served from under `server/`.
- **Not gitignored.** Unlike `assets/portraits/` (gitignored per `specs/architecture.md` "Portraits"), lore markdown is editorial content that must be committed and deployed. Do not add it to `.gitignore`.

### Markdown rendering: dependency-free subset by default (AC #6)

- The repo runs on four production dependencies (`cookie-parser`, `dotenv`, `express`, `mongodb`) and prizes minimal surface. Default to a dependency-free renderer covering the documented subset; it is small, fully unit-testable, and sufficient for placeholder copy and ordinary reference prose.
- Because the content is trusted (in-repo, single author), the renderer is not an untrusted-input sanitiser, but it must still escape raw HTML in the source rather than pass `<script>` or arbitrary markup through. Escape first, then apply the subset transforms, so emitted HTML contains only the tags the renderer itself produces.
- Do not transform hyphens into em-dashes or apply any "smart punctuation" that would inject an em-dash into rendered copy (AC #12).
- If Angelus's real copy later needs constructs the subset does not cover (tables, footnotes), adding a single small, established markdown library (for example `marked`) is an acceptable, reversible escape hatch. Keep the route wrapper thin either way, and keep `renderLoreMarkdown` the single rendering seam so the choice is swappable without touching the route.

### Placeholder copy scoping (do not author the real text) (AC #13)

This is the crux of the story's scope boundary, and it is explicit in the epic ("this story's dev work is the rendering/plumbing, not authoring the copy itself; flag clearly in dev notes if placeholder copy is used pending Angelus's real text"):

- The dev builds the PLUMBING: the router, the renderer, the pages, the CSS, the tests, and four committed placeholder `.md` files. The dev does NOT write the real setting primer, game guide, rules, or friendly-errata copy.
- The friendly-errata page is the sharpest case. Its real text is a plain-language rewrite of the `../TM Suite/data/reference/` house-rules material (the `Player Guide.pdf`, `Offices.pdf`, the merit-rules JSON dump, and the offices/vitae/influence spreadsheets there), and that rewrite is Angelus's to supply or approve. The dev must NOT attempt it. The placeholder for this page says so in its body.
- Story completion is defined by the plumbing correctly rendering the placeholder files. It MUST NOT be blocked on the real copy being written or approved. Swapping placeholder for real copy is a later content-only edit (edit the `.md`, redeploy the API); it changes no code and reopens no story.
- Record in the Completion Notes that placeholder copy is in place and that the real-copy authoring/approval is the out-of-scope follow-up owned by Angelus.

### British English and no em-dashes (known dev-pass failure mode) (AC #12)

- British spelling in all static copy: Colour, Honour, Favour, capitalise, Defence, Armour.
- **No em-dashes in any user-facing string, including every `<title>` and the JS-set `document.title`.** This is not a hypothetical: it was raised as the F1 finding in the code review of BOTH sibling stories' dev passes. Story 2-1's dev pass shipped `Terra Mortis Wiki - Characters` / `- Character` (em-dashes) in the two new page titles and had to be patched to colons; Story 2-2's dev pass was flagged for the same risk and shipped `Terra Mortis Wiki: World` correctly after the warning. A `<title>` renders in the browser tab and is user-facing text, squarely under CLAUDE.md's "no em-dashes in output text" hard rule; it is NOT an exempt code comment. Ship `Terra Mortis Wiki: Lore` (colon) and set `document.title` to `Terra Mortis Wiki: <page title>` (colon). Code comments may keep the repo's existing em-dash style; user-facing strings may not.
- Note: `public/login.html` still carries an unpatched `<title>` em-dash per `specs/deferred-work.md` (Story 2-1 follow-up). This story does not touch `login.html`, so leave it.

### Where things live (real files, verified this session)

- **Route mount point**: `server/index.js`, after `app.use(requireAuth)` (line 67), where the characters router (line 77) and world router (line 83) are already mounted. Register the lore router in the same region. No new auth logic.
- **Modelled-error pattern to mirror**: `server/routes/world.js` / `server/routes/characters.js` wrap store reads in try/catch and return a modelled `503 STORE_ERROR` rather than a raw Express 500. Mirror that shape for the lore file read (a `500 CONTENT_ERROR` or `503`), with no path or stack trace in the body.
- **Pure-function-plus-thin-route pattern to mirror**: `buildWorldView(territories, characters)` in `server/routes/world.js` and `projectCharacterForViewer(...)` in `server/routes/characters.js` are both exported pure functions with the HTTP route as a thin wrapper. `renderLoreMarkdown(md)` follows the same shape.
- **Auth / `req.user`**: `server/middleware/auth.js` (`requireAuth`) populates `req.user` from a live `getPlayerByDiscordId` lookup. This story does NOT read `req.user`; it relies only on the gate being present so unauthenticated requests never reach the route. The test harness still needs `db.setTestDb` + the Discord mock to get PAST `requireAuth`, even though the lore route itself reads no Mongo.
- **Authed fetch (frontend)**: `public/js/data/api.js` (`apiGet(path)`): Bearer token from `getToken(localStorage)`; redirect to `login.html` on missing token or 401/403; `{ _notFound: true }` on 404; throws on other non-OK. Reuse verbatim as `list.js` / `profile.js` / `world.js` do.
- **Display / escaping helpers (frontend)**: `public/js/data/display.js` exports `esc(s)` among others. The lore index page renders manifest titles, which are dev-controlled, but still route any dynamic string through `esc()` before `innerHTML` for consistency. The article body is the exception by design: `data.html` is server-rendered HTML injected as-is into `.lore-article`; that is the whole point of server-side rendering, and it is safe because `renderLoreMarkdown` escaped the raw source and emits only its own tags.
- **CSS tokens**: `public/css/theme.css` holds `--gold2`, `--accent`, `--surf`, `--surf2`, `--bdr`, `--bdr2`, `--bdr3`, `--txt`, `--txt2`, `--txt3`, `--fh`, `--fh-decorative`, `--fl`, `--ft`, `--gold-a15`, `--gold-a30`, etc. `public/css/components.css` already defines `.content`, `.content__header`, `.content__title`, `.content__eyebrow`, `.backlink`, `.char-grid`, `.char-card`, `.empty-state`, and the World/Court additions. The new `.lore-article` prose block is tokens-only, extending this file.
- **Existing nav pattern**: `public/characters.html` has `<a class="backlink" href="/world.html">World and Court &rarr;</a>`; `public/world.html` has `<a class="backlink" href="/characters.html">&larr; All characters</a>`. Match this shape for the lore link and the lore backlink.
- **Netlify proxy**: `netlify.toml`'s `/api/*` rewrite (Story 2-1) already forwards `/api/lore` and `/api/lore/:slug` to the Render service. No new redirect rule is needed; confirm and note it.

### Out of scope (do not build)

- The real setting/guide/rules/errata copy, and the friendly-errata plain-language rewrite of `../TM Suite/data/reference/` (AC #13): Angelus supplies or approves it; the dev ships placeholder copy only.
- Any admin UI or route to CREATE or EDIT lore pages: lore is edited by committing markdown to the repo, not through an in-app editor.
- Any Mongo-backed lore store: `specs/architecture.md` "Lore content" is explicit that this editorial prose is in-repo static files, and the "new reference data defaults to Mongo-backed" convention does not apply to it.
- Per-viewer projection, `revealed_to`, or an owner tier: lore is identical for every viewer (AC #3 top note).
- The territory map / `map_coords` overlay: v2, unrelated to lore.
- Rich markdown beyond the documented subset (tables, footnotes) unless the real copy needs it, in which case see the `marked` escape hatch in "Markdown rendering".

### Project Structure Notes

- New content: `server/content/lore/setting-primer.md`, `game-guide.md`, `rules.md`, `friendly-errata.md` (placeholder copy).
- New server file: `server/routes/lore.js` (manifest + exported `renderLoreMarkdown` + the two routes), mounted in `server/index.js` after the auth gate.
- New server test: `server/routes/lore.test.js` (renderer unit tests + route tests including the path-traversal security test), using the `db.setTestDb` mock and the Discord mock from `server/routes/characters.test.js` / `world.test.js`.
- New frontend files: `public/lore.html`, `public/lore-page.html`, `public/js/lore/index.js`, `public/js/lore/page.js`. Reuse `public/js/data/api.js` and `public/js/data/display.js` unchanged.
- Modified: `server/index.js` (mount the lore router), `public/css/components.css` (tokens-only `.lore-article` prose block), `public/characters.html` and `public/world.html` (lore nav link), `README.md` (endpoint + content-location note). `netlify.toml` already proxies `/api/*` (Story 2-1) so `/api/lore` needs no new rule.
- Layout matches the repo's two-halves split (`specs/architecture.md` "Directory layout"): `server/` is API-only (no `express.static`), `public/` is the Netlify static site. Reading `server/content/lore/*.md` via `fs` and returning JSON is NOT static serving and does NOT reintroduce `express.static`; do not add one.

### References

- [Source: specs/epics.md#Story 2-3: lore-pages] seed ACs (static pages from `content/lore/*.md`, friendly-errata is a rewrite of `../TM Suite/data/reference/` with dev doing plumbing not authoring, login-gated with no per-viewer projection)
- [Source: specs/architecture.md#Lore content] in-repo static files, not a Mongo collection; "served by the API or read by the frontend at build/serve time (decided per-story)" (decided here: API-served from under `server/`)
- [Source: specs/architecture.md#Directory layout (this repo, revised)] the two-halves split; `content/lore/` sketched at repo root, but `render.yaml`'s `rootDir: server` forces the API-read copy under `server/`
- [Source: specs/prd.md#v1 scope] the three sections (dossier / world / lore); lore is static pages, setting primer + game guide + rules + friendlier house-rules-errata rewrite
- [Source: specs/stories/1-3-discord-oauth-reuse.md] the whole-site login gate: every route except the OAuth routes requires a session, no anonymous tier (the discipline AC #3 honours)
- [Source: specs/stories/2-1-character-dossier-views.md] the pure-function-plus-thin-route pattern, the modelled-error shape, and the F1 em-dash-in-`<title>` finding this story must not repeat
- [Source: specs/stories/2-2-world-tab.md] the same pure-function split (`buildWorldView`), the `503 STORE_ERROR` shape, and the second occurrence of the em-dash-title finding
- [Source: server/index.js] route mount point after `app.use(requireAuth)`, alongside the characters and world routers; API-only, no `express.static`
- [Source: server/routes/world.js] `buildWorldView` pure-function + thin-route pattern and the `503 STORE_ERROR` try/catch to mirror for the file read
- [Source: server/routes/characters.js] the modelled-error and thin-route conventions
- [Source: server/routes/characters.test.js] the `db.setTestDb` + Discord `/users/@me` mock pattern (needed to get past `requireAuth` even for a Mongo-free route)
- [Source: render.yaml] `rootDir: server` (why the lore markdown must live under `server/`)
- [Source: netlify.toml] the `/api/*` proxy (Story 2-1) that already covers `/api/lore`; `publish = "public"` static half serves no gated content
- [Source: public/js/data/api.js] `apiGet` authed-fetch + redirect-on-401 and `{ _notFound: true }` on 404 to reuse
- [Source: public/js/data/display.js] `esc()` for dynamic strings on the index page
- [Source: public/css/components.css] existing `.content` / `.backlink` / `.char-grid` / `.char-card` / `.empty-state` vocabulary to extend with the tokens-only `.lore-article` prose block
- [Source: public/characters.html, public/world.html] the existing `.backlink` cross-link nav pattern to match
- [Source: ../TM Suite/data/reference/] the house-rules source material (Player Guide.pdf, Offices.pdf, merit-rules JSON, offices/vitae/influence spreadsheets) that Angelus rewrites into the friendly-errata copy; the dev reads it only to understand the content shape, never to author the copy

## Dev Agent Record

### Agent Model Used

Opus 4.8 (claude-opus-4-8[1m]).

### Debug Log References

- `node --test server/routes/lore.test.js` — 20/20 pass (renderer subset + safety + edge cases, route index/page, security discrimination, path-traversal, missing-file CONTENT_ERROR, 401 gate).
- `node --test` (full suite) — 97/97 pass, zero regressions across Epic 1 and stories 2-1 / 2-2.
- `node --check server/routes/lore.js` — clean; renderer smoke-tested by hand against a full-subset sample and against the committed placeholder files.
- Em-dash grep over user-facing content (`server/content/lore/*.md`, `public/lore.html`, `public/lore-page.html`, `public/characters.html`, `public/world.html`, lore JS string literals) — CLEAN. The only em-dash hits are in JS/JS-comment prose (lines beginning `//`), which the story explicitly permits; no user-facing string or `<title>` carries one. Both `<title>` tags and the JS-set `document.title` are colon-formatted.
- Null/binary-byte scan over all new files — clean (an editor-inserted U+E000 private-use sentinel in `renderInline` was intentional and verified; it is the code-span placeholder, not stray data).

### Completion Notes List

- **Placeholder copy is deliberate and in place (AC #13).** All four `.md` files are dev-authored PLACEHOLDER scaffolding, each marked with the block-quote banner "Placeholder copy pending Angelus's approved text." and each exercising the full supported markdown subset so the renderer is tested against real files. The friendly-errata placeholder additionally states in its body that the plain-language rewrite of the `../TM Suite/data/reference/` house-rules material is pending Angelus's supplied/approved text and was NOT authored by the dev. **Writing the real setting/guide/rules/errata copy is Angelus's out-of-scope follow-up. Swapping placeholder for real copy is a content-only edit — edit the `.md`, redeploy the API — and requires NO code change and reopens no story.** Completion was defined by the plumbing rendering the placeholder files correctly, and was not gated on real copy.
- **Renderer is dependency-free (AC #6).** `renderLoreMarkdown` covers the documented subset (headings, paragraphs, bold/italic, inline code, fenced code, unordered/ordered lists, links, block quotes, horizontal rules) with no added dependency. Block structure is detected on the RAW line (so a markdown `>` is a real block quote rather than an escaped `&gt;`) and every emitted text segment is HTML-escaped at emit time, so raw HTML / `<script>` in the source is escaped and never passed through as live markup. No smart punctuation; hyphens are never converted to em-dashes.
- **Security discipline (AC #5) is discriminating.** The `:slug` is checked against the manifest allowlist BEFORE any path is built; only an allowlisted slug's path is constructed, and it is then containment-checked (`path.resolve` + `startsWith(LORE_DIR + path.sep)`) before the read. The security test proves teeth two ways: a unit-level discrimination test shows a naive `path.join(LORE_DIR, payload + '.md')` for `../../db` resolves OUTSIDE the lore directory (the real danger) while the payload is not a manifest slug (so the route never builds that path); and HTTP-level tests drive an unknown slug plus three traversal payloads (`..%2F..%2Fdb`, `..%2Fconfig`, `%2Fetc%2Fpasswd`) and assert all return 404 with none of the out-of-lore source (`renderLoreMarkdown`, `connectDb`, passwd-style `root:`) present in the body.
- **Login gate honoured (AC #3).** Lore content is served ONLY through the gated API (router mounted after `app.use(requireAuth)`), never baked into static Netlify HTML. The `.html` shells hold only a page skeleton plus a `<script>`; the prose arrives via `apiGet`. 401 gate test confirms both endpoints reject a token-less request before the route runs.
- **No Mongo, no writes.** The lore router imports only `express`, `node:fs/promises`, `node:path`, `node:url` — no `mongo-store.js` accessor, no write of any kind. Its only I/O is read-only `fs` reads under `server/content/lore/`. This is the first filesystem-reading content router; the read-only-filesystem posture is stated in the file header.
- **Location decision (AC #2).** Markdown lives under `server/content/lore/` (not repo-root `content/lore/`) for the two documented reasons: `render.yaml`'s `rootDir: server` (repo-root content is outside the Render service root) and the login-gate requirement (content must be API-served). Confirmed the files are NOT gitignored (`git check-ignore` returns nothing).
- **Netlify proxy already covers it (Task 6).** `netlify.toml`'s existing `/api/*` rewrite (Story 2-1) already forwards `/api/lore` and `/api/lore/:slug` to Render. No new redirect rule was added.
- **No [LEAK-GATE] / [PROJECTION] tags (deliberate).** No Mongo document is read, every viewer gets byte-identical content, and `req.user` is never read; the sibling projection tags do not apply and were not invented.

### File List

New:
- `server/routes/lore.js` — manifest, exported `renderLoreMarkdown`, and the two read-only routes.
- `server/routes/lore.test.js` — renderer unit tests + route tests (index, valid slug, unknown-slug + path-traversal security, missing-file CONTENT_ERROR, 401 gate).
- `server/content/lore/setting-primer.md` — placeholder.
- `server/content/lore/game-guide.md` — placeholder.
- `server/content/lore/rules.md` — placeholder.
- `server/content/lore/friendly-errata.md` — placeholder (states the errata rewrite is Angelus's out-of-scope follow-up).
- `public/lore.html` — lore index shell.
- `public/lore-page.html` — lore article shell.
- `public/js/lore/index.js` — index page fetch + render.
- `public/js/lore/page.js` — article page fetch + render (sets colon-formatted `document.title`).

Modified:
- `server/index.js` — import and mount the lore router after `app.use(requireAuth)`.
- `public/css/components.css` — tokens-only `.lore-article` prose block + child element styles, `.lore-card` tweak, `.backlink + .backlink` adjacency spacing.
- `public/characters.html` — add a `.backlink` to `/lore.html`.
- `public/world.html` — add a `.backlink` to `/lore.html`.
- `README.md` — Lore API section (endpoints, in-repo login-gated markdown under `server/content/lore/`, slug allowlist / no traversal, placeholder-to-real-copy is a content-only edit); corrected the earlier "later stories add content/lore/" note.
- `specs/stories/sprint-status.yaml` — `2-3-lore-pages` -> `review`.

## Senior Developer Review

**3-layer adversarial review** (Blind Hunter: code only, cold read; Edge Case Hunter: code + repo conventions + live traversal payloads; Acceptance Auditor: code + all 14 ACs), run independently. This is the lowest-stakes story in Epic 2: it reads no Mongo document and applies no per-viewer projection, so the sibling [LEAK-GATE] / [PROJECTION] surfaces do not exist here. The two load-bearing disciplines are the login gate (content served only through the gated API, never baked into un-gated Netlify static HTML) and the slug allowlist / no path traversal (the `:slug` is the only user-controlled input and it selects a file to read). Both were treated as the review's focus, alongside the renderer's HTML-escaping safety posture.

**Acceptance Auditor verdict: all 14 ACs PASS**, independently re-verified against the code, not taken on the Dev Agent Record's word.

### The XSS / HTML-escaping design finding (Blind Hunter)

I formed my own view rather than accepting the dev's framing. The core property AC #6 cares about is airtight: raw HTML in the markdown source is HTML-escaped at every emit point (in `renderInline`, in the fenced-code body, and for every block's text), so a `.md` file containing a raw `<script>` or `<img onerror=...>` is rendered as inert escaped text and never as live markup. I probed this directly: `<script>alert(1)</script>` renders `&lt;script&gt;alert(1)&lt;/script&gt;`, `<img src=x onerror=alert(1)>` renders fully escaped. The renderer emits only its own tags. So the "escape by default even though content is trusted" decision is correctly implemented, and I endorse it: escape-regardless is the right call as defence in depth, not a decision to relax because the author is trusted.

I did, however, find one residual defence-in-depth gap in the SAME spirit. The link transform `[label](url)` escaped the url (so a `"` becomes `&quot;`, closing the attribute-injection vector) and forbids whitespace in the url (closing the ` onclick=`-injection vector), but it did NOT sanitise the URL SCHEME. A `javascript:` / `data:` / `vbscript:` scheme carries no HTML-special characters, so HTML-escaping alone let it survive: `[click me](javascript:alert(1))` rendered `<a href="javascript:alert(1">click me</a>` -- a live, clickable script href. There is no untrusted-input path in this application (the only markdown is the committed, Angelus-authored files; the slug is allowlisted and never rendered), so this was not an exploitable hole today and it did not violate AC #6's literal requirement (no raw markup is passed through -- the renderer emits its own `<a>`). But it is exactly the escape-by-default posture AC #6 states, applied to link elements and not to their href scheme, and AC #6's own framing puts future real copy (which Angelus authors later) in scope. **Patched** (see below): a one-line scheme guard renders a dangerous-scheme link as its plain label text; ordinary relative slugs (`game-guide`) and http/https/mailto links are unaffected.

### Findings triage

| # | Finding | Lens(es) | Severity | Disposition |
|---|---|---|---|---|
| F1 | **A markdown link with a `javascript:` / `data:` / `vbscript:` URL scheme was emitted as a live `href`.** The renderer HTML-escapes the url (neutralising attribute break-out and, via the no-whitespace rule, attribute injection) but did not check the scheme, so a dangerous-scheme link survived as a clickable script href. No present exposure (content is trusted, committed, single-author; the slug never reaches the renderer), so this is defence-in-depth only and violates no AC literally. But it is the exact escape-by-default posture AC #6 states, and AC #6 puts the future real copy Angelus authors in scope. | Blind Hunter / Edge Case Hunter | Low | **Patched** in `server/routes/lore.js` (`UNSAFE_URL_SCHEME` guard in the link transform) with a discriminating test in `server/routes/lore.test.js`. Discrimination proven: with the guard removed the new test fails (and only that test); restored to green. |

No other findings. The renderer's primary safety property (raw HTML / `<script>` escaped, never passed through) is airtight and independently probed; the slug allowlist plus containment check is airtight and independently re-verified below; the login gate sits correctly in front of both endpoints (401-tested).

### Independent path-traversal re-verification (the point of this review)

I did not trust the Dev Agent Record's claim that the allowlist stops traversal. I drove the REAL route with a superset of payloads, including seven the dev did NOT test:

- Dev-tested baseline (re-run): `..%2Fconfig`, `..%2F..%2Fdb`, `%2Fetc%2Fpasswd` -> all `404`, no leak.
- NEW payloads: `..%5C..%5Cconfig` (Windows backslash), `%252e%252e%252fconfig` (double-encoded `../`), `setting-primer%00.md` (null-byte after a valid stem), `setting-primer%2F..%2F..%2Fdb` (valid stem + appended traversal), `SETTING-PRIMER` (case variation -- the allowlist is exact-match), `setting-primer.md` (extension appended), `.%2E%2Fdb` (mixed-encoding dot) -> **all `404`, none leaked any out-of-lore source** (`renderLoreMarkdown`, `connectDb`, `MONGODB_URI`, `root:`, `require(`). The empty-slug `/api/lore/` falls through to the index endpoint (`200`, manifest only -- no file read). The allowlist is exact-match on the manifest, so nothing outside the four slugs ever builds a filesystem path.

Then I proved the security tests have TEETH by weakening the guard myself. I replaced the handler's `MANIFEST_BY_SLUG` allowlist + containment check with a naive `path.join(LORE_DIR, req.params.slug + '.md')` read and ran `node --test routes/lore.test.js`:

- **3 of 20 failed**, with named, security-specific assertions (not unrelated crashes):
  - `AC #5/#14 (SECURITY): an unknown slug returns 404 NOT_FOUND` -> failed (the naive read no longer 404s an unknown slug).
  - `AC #5/#14 (SECURITY): a path-traversal payload returns 404 and reads no file outside the lore dir` -> failed (the payload now reaches a read).
  - `AC #6/#14: GET /api/lore/:slug returns { slug, title, html }` -> failed on the title assertion (the manifest, not the slug, is the source of the title -- proving the allowlist is load-bearing for more than the security check).
- The renderer unit tests, the CONTENT_ERROR missing-file test, and the 401-gate test all **still passed** against the naive read, proving the security tests fail *specifically on the traversal/allowlist regression*, not on unrelated wiring.

Restored the real allowlist + containment check (`server/routes/lore.js` traversal logic byte-identical to its pre-review state, confirmed by `git diff`): the discrimination is genuine and captured permanently by the two `SECURITY` route tests plus the unit-level discrimination test.

### Lens sweep (what I checked and what held)

- **Slug allowlist BEFORE any path is built (AC #5) -- PASS.** `MANIFEST_BY_SLUG.get(req.params.slug)` runs first; a miss returns a clean `404` before any path exists. Only an allowlisted `entry.slug` (never the raw parameter) is concatenated into the path. The `path.resolve` + `startsWith(LORE_DIR + path.sep)` containment check runs before the read as documented defence in depth (effectively belt-and-braces for manifest slugs, which is the intent).
- **Renderer HTML-escaping (AC #6) -- PASS** (see the design finding above). Escape-first, then subset transforms; fenced-code bodies escaped verbatim and never inline-processed; block structure detected on the RAW line so `>` is a real block quote. The `CODE_MARK` code-span sentinel is a genuine U+E000 private-use code point (verified by codepoint inspection -- NOT an empty string, which would have made the restore regex match any digit run), so code spans restore exactly.
- **Login gate (AC #3) -- PASS.** The router is mounted after `app.use(requireAuth)` in `server/index.js`; both `.html` files are shells (page skeleton + a single `<script>`) with no prose; the prose arrives via `apiGet`. The 401 test confirms both endpoints reject a token-less request before the route runs.
- **No Mongo, no writes (AC #1) -- PASS.** `lore.js` imports only `express`, `node:fs/promises`, `node:path`, `node:url`; no `mongo-store.js` accessor, no write. The read-only-filesystem posture is stated in the file header. The route never reads `req.user`.
- **Modelled errors (AC #8) -- PASS.** Unknown/disallowed slug -> `404 NOT_FOUND`; a manifest slug whose backing file is missing -> `500 CONTENT_ERROR`. The missing-file test asserts no filesystem path, no `ENOENT`, and no stack trace (` at `) in the body.
- **Manifest + index (AC #4/#7) -- PASS.** `LORE_MANIFEST` is a frozen ordered array of the four `{ slug, title }` pairs; `GET /api/lore` returns exactly that with no bodies (the index test also asserts no `html` and no file contents ride along); titles come from the manifest, not the file.
- **Malformed / empty content -- PASS.** `renderLoreMarkdown('')`, whitespace-only, `null`, and `undefined` all return `''` (honest empty, no crash); an unclosed fenced block runs to end and still emits a `<pre><code>` honestly.
- **Frontend posture (AC #9/#10/#11/#12) -- PASS.** Both pages fetch via `apiGet`; the article body is the deliberate as-is HTML injection (safe because `renderLoreMarkdown` escaped the source); `_notFound` renders "That page was not found." and other failures render the `.hero__status` error state, never a blank page. `document.title` is set to `Terra Mortis Wiki: <manifest title>` (colon). Nav backlinks are wired both ways (roster/world -> `/lore.html`, and lore pages -> `/lore.html` or the roster). The `.lore-article` prose block and `.lore-card` tweak are tokens-only; I verified every token used (`--ft`, `--fh`, `--fh-decorative`, `--gold2`, `--accent`, `--txt`, `--txt2`, `--surf`, `--bdr`, `--bdr2`, `--gold-a12`, `--gold-a30`) exists in both the light and dark blocks of `theme.css`; no bare hex, no `rgba()`, no inline styles. The reused `.hero__status` / `.empty-state` / `.char-card` classes exist (`.hero__status` in `base.css`, which the pages load; the rest in `components.css`) and are used consistently by the sibling pages.

### Independent em-dash sweep (AC #12)

I ran my own `grep -nP '\x{2014}'` across every in-scope file (`lore.js`, `lore.test.js`, the four `server/content/lore/*.md`, `lore.html`, `lore-page.html`, `js/lore/index.js`, `js/lore/page.js`, `characters.html`, `world.html`, `server/index.js`, and the `components.css` lore block), and did NOT stop at the source. I specifically checked the two `<title>` tags, the JS-set `document.title`, and -- crucially -- the RENDERED output of all four `.md` files (rendering each through `renderLoreMarkdown` and grepping the HTML), because the source being clean does not by itself prove the rendered copy is clean. Result: both `<title>` tags are `Terra Mortis Wiki: Lore` (colon); `document.title` is `Terra Mortis Wiki: ${title}` (colon, title from the manifest so guaranteed clean); all four `.md` sources carry zero em-dashes; all four RENDERED pages are em-dash-free and contain no live `<script>`. The only em-dash hits anywhere in scope are in code comments and `node:test` test-name strings (permitted per the story / CLAUDE.md "output text" scope) and in one test assertion string literal that checks FOR em-dash absence. The repeated F1 em-dash-in-`<title>` failure mode was NOT reintroduced.

**Final suite: 98/98 passing** (97 pre-review baseline across Epic 1 + stories 2-1/2-2/2-3, plus 1 new URL-scheme discrimination test), zero regressions in Epic 1 or stories 2-1/2-2. No file outside this story's scope was modified for the review.

**No unresolved High/Medium findings remain. F1 (dangerous URL scheme in a link, Low, defence-in-depth) was PATCHED in-scope with a discriminating test, not deferred. The slug allowlist + containment check is airtight (independently re-verified via a self-authored naive-read regression that produced 3 named security failures, then restored to green). The renderer's raw-HTML escaping is airtight (independently probed). All 14 ACs pass. Status: done.**

## Change Log

- 2026-07-17: Story drafted from the epics.md Story 2-3 seed and marked ready-for-dev. ACs expanded to make the plumbing implementation-ready: a gated `/api/lore` + `/api/lore/:slug` router serving in-repo editorial markdown (setting primer, game guide, rules, friendly errata) from under `server/` (forced there by `render.yaml`'s `rootDir: server` plus the login-gate requirement), a pure unit-testable `renderLoreMarkdown` subset renderer, a manifest-driven slug allowlist with a path-traversal security test, a login gate honoured by serving content through the API rather than baking prose into un-gated Netlify static HTML, and index + article frontend pages. Explicitly recorded that the [LEAK-GATE] / [PROJECTION] tags do NOT apply (no Mongo document is read, no per-viewer projection) and were deliberately not invented for this story. Scoped placeholder copy as in-scope and the real setting/guide/rules/errata copy (especially the friendly-errata rewrite of `../TM Suite/data/reference/`) as Angelus's out-of-scope follow-up that must not block completion. Flagged the em-dash-in-`<title>` finding as a known repeated dev-pass failure mode in this repo (F1 in both Story 2-1 and Story 2-2).
- 2026-07-17: Senior Developer Review (3-layer adversarial, Opus). All 14 ACs pass. Path-traversal discipline independently re-verified: 11 payloads driven against the real route (including 7 the dev never tested -- backslash, double-encoded, null-byte, valid-stem+appended-traversal, case-variation, extension-appended, mixed-encoding), all 404 with zero external-file leakage; then the allowlist + containment check was reverted by the reviewer to a naive `path.join` read, 3/20 lore tests failed with named security assertions (unknown-slug and traversal no longer 404; the manifest-sourced title assertion also broke), and the renderer/CONTENT_ERROR/401 tests still passed, proving the security tests are leak-specific; restored to green (traversal logic byte-identical to pre-review). Renderer raw-HTML escaping independently probed (raw `<script>` / `<img onerror>` fully escaped). F1 (a `javascript:` / `data:` / `vbscript:` URL scheme in a markdown link was emitted as a live href; Low, defence-in-depth, no present exposure since content is trusted/committed) PATCHED in-scope in `server/routes/lore.js` (a `UNSAFE_URL_SCHEME` guard that renders a dangerous-scheme link as plain label text; relative slugs and http/https/mailto unaffected) with a discriminating test in `server/routes/lore.test.js` (proven: fails without the guard, and only that test, then restored). Independent em-dash sweep clean, checking both `<title>` tags, the JS `document.title`, and the rendered output of all four `.md` files (not just their source). Full suite 98/98 green (97 baseline + 1 new test), zero regressions. Status -> done. Epic 2 complete (2-1, 2-2, 2-3 all done).
