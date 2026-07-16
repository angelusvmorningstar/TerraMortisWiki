// Terra Mortis Wiki — thin Express service (story 1-1 skeleton).
// This story only establishes the app skeleton, static CSS, and a placeholder
// home page. Auth, snapshot loading, and real routes arrive in later stories.

import express from 'express';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import authRouter from './routes/auth.js';
import { requireAuth } from './middleware/auth.js';
import { loadSnapshot } from './snapshot-store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');

// Placeholder home page. All colour/font styling flows through the ported
// design tokens in /css/theme.css and the layout in /css/base.css — no inline
// styles, no bare hex (AC #2).
function homePage() {
  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Terra Mortis Wiki</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=Cinzel+Decorative:wght@400;700&family=Lato:wght@400;600;700;900&family=Libre+Baskerville:wght@400;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/theme.css">
  <link rel="stylesheet" href="/css/base.css">
</head>
<body>
  <main class="page">
    <section class="hero">
      <p class="hero__eyebrow">Vampire: The Requiem 2e</p>
      <h1 class="hero__title">Terra Mortis Wiki</h1>
      <p class="hero__lede">Chronicle companion. This is the placeholder home page for the skeleton build.</p>
    </section>
  </main>
</body>
</html>`;
}

export function createApp() {
  const app = express();

  // Load the snapshot into memory once at boot (Story 1.3). No-op if a snapshot
  // has already been loaded or test-injected via snapshot-store.setSnapshot().
  loadSnapshot();

  // Parse JSON bodies (the OAuth callback POSTs { code, state }) and cookies
  // (the OAuth state CSRF cookie set by GET /auth/discord).
  app.use(express.json());
  app.use(cookieParser());

  // --- Unauthenticated login surface -------------------------------------
  // The whole site sits behind Discord login (PRD; AC #4). But a login gate
  // needs a public entry point — the shell that hosts the "Log in with Discord"
  // button and the OAuth routes that start/finish the flow. These, plus the
  // static CSS the shell needs to render, are the ONLY anonymous surface. None
  // of them serve snapshot/player data, so there is no anonymous CONTENT tier —
  // which is what AC #4 forbids. (See Story 1.3 dev notes for the full
  // resolution of the tension with Story 1.1's public `/` smoke test.)

  // Ported CSS ONLY — public so the logged-out login shell renders. Deliberately
  // scoped to /css rather than the whole public/ tree: mounting express.static on
  // PUBLIC_DIR itself would mean any future story that drops rendered content
  // under public/ (character pages, world-tab data, etc.) is served with ZERO
  // auth check by default — the exact cross-player leak this app exists to
  // prevent. Anything content-bearing must be registered as a route AFTER the
  // requireAuth gate below, never dropped into a statically-served directory.
  app.use('/css', express.static(join(PUBLIC_DIR, 'css')));

  // Placeholder home / login-landing page (Story 1.1, kept public).
  app.get('/', (_req, res) => {
    res.type('html').send(homePage());
  });

  // Discord OAuth routes (public — they ARE the login flow). AC #1/#2.
  app.use('/auth', authRouter);

  // --- Authentication gate -----------------------------------------------
  // Everything registered BELOW this line requires a valid session (AC #4).
  // Future content routers (stories 2-1/2-2/2-3) register after this call.
  app.use(requireAuth);

  // Current-session endpoint — the frontend calls this to learn who is logged
  // in. First gated route; also the concrete route that proves the gate works.
  app.get('/api/me', (req, res) => {
    res.json({ user: req.user });
  });

  return app;
}

// Start listening only when run directly (not when imported by a test).
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const port = process.env.PORT || 3000;
  const app = createApp();
  const server = app.listen(port, () => {
    console.log(`Terra Mortis Wiki listening on http://localhost:${port}`);
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use — set PORT to a free port and try again.`);
      process.exit(1);
    }
    throw err;
  });
}
