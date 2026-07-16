# Deferred Work

Real-but-not-now findings from code review, kept here so they aren't lost or silently re-litigated in a later story.

## From Story 1-1 (repo-scaffold-and-css-tokens) review

1. **`--surf1` has no `[data-theme="dark"]` override** in `public/css/theme.css`. Inherited faithfully from `../TM Suite/public/css/theme.css`, which has the same gap upstream — this is not a porting error. Currently inert (`--surf1` is unused in `base.css`). Fix here (and ideally upstream in TM Suite too) the first time a story actually consumes `var(--surf1)` in a dark-mode-visible element.
2. **`express.static` is registered before the `/` route**, so a future `public/index.html` would silently shadow the `homePage()` handler with no error. Latent only — no such file exists yet. Worth a comment or an ordering fix the first time a story adds static HTML under `public/`.
3. **No 404 handler or centralised error-handling middleware.** Acceptable for a one-route skeleton; add when routes with real async I/O (auth, dossier views) land in stories 1-3/2-1, so an unhandled rejection doesn't fall through to Express's default error page.
4. **Google Fonts CDN has no local fallback, SRI, or CSP.** Low severity for a placeholder page; revisit as part of a production-hardening pass (also consider `helmet` for basic security headers) before this is player-facing for real.
5. **The `isMain` check (`process.argv[1] === fileURLToPath(import.meta.url)`) is fragile** across symlinked or extensionless invocations (the `es-main` idiom exists precisely for this). Fine for the documented `npm start` / `node server/index.js` invocation; revisit if the deploy target ever launches the process differently.
6. **`PORT=0` produces a misleading startup log** (`http://localhost:0`) since Node binds a random ephemeral port in that case but the log doesn't reflect it. Cosmetic; not worth a fix unless something starts scripting against the logged URL.
