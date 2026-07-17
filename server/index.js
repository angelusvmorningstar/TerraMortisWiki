// Terra Mortis Wiki — thin Express API (Story 1.4: netlify-render-split).
//
// This service is a PURE JSON/auth API. It serves NO static files: there is no
// express.static, no /css mount, and no home-page route. The frontend (the login
// page, and later stories' content pages) is a separate static site on Netlify;
// Netlify's redirect proxy forwards /auth/* (and later /api/*) here to Render, so
// from the browser every request is same-origin. See specs/architecture.md →
// "Shape (revised — live reads, not a snapshot)".
//
// RETIRED HERE (intentionally, not a regression): Story 1.1's placeholder
// `homePage()` route + its `server/index.test.js` smoke test, and Story 1.3's
// `/css` static mount + its two static-serving tests. A static home page and CSS
// belong to Netlify now, not this API. Story 1.1's and 1.3's story files remain
// as the historical record of what they built.

import express from 'express';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { connectDb, closeDb } from './db.js';
import authRouter from './routes/auth.js';
import charactersRouter from './routes/characters.js';
import worldRouter from './routes/world.js';
import loreRouter from './routes/lore.js';
import { requireAuth } from './middleware/auth.js';

export function createApp() {
  const app = express();

  // CORS — ported from `../TM Suite/server/index.js`'s manual echo middleware,
  // keyed off config.CORS_ORIGIN. It matters only for LOCAL dev, where the static
  // frontend and this API run on different origins; in production the Netlify
  // proxy makes traffic same-origin, so this is mostly inert there (Story 1.4
  // dev note). In non-production it echoes any Origin back (dev convenience);
  // in production it echoes ONLY an allowlisted origin.
  const allowedOrigins = config.CORS_ORIGIN.split(',').map((o) => o.trim());
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && (allowedOrigins.includes(origin) || config.NODE_ENV !== 'production')) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  // Parse JSON bodies (the OAuth callback POSTs { code, state }) and cookies
  // (the OAuth state CSRF cookie set by GET /auth/discord).
  app.use(express.json());
  app.use(cookieParser());

  // --- Public OAuth surface ----------------------------------------------
  // The two Discord OAuth routes are the ONLY unauthenticated endpoints — they
  // ARE the login flow, so they necessarily can't require a session. There is no
  // anonymous CONTENT tier (PRD; Story 1.3 AC #4): nothing here serves player or
  // world data without login.
  app.use('/auth', authRouter);

  // --- Authentication gate -----------------------------------------------
  // Everything registered BELOW requires a valid session. Future content routers
  // (stories 2-1/2-2/2-3) register after this call.
  app.use(requireAuth);

  // Current-session endpoint — the frontend calls this to learn who is logged in.
  app.get('/api/me', (req, res) => {
    res.json({ user: req.user });
  });

  // Content router (Story 2.1). Mounted AFTER the auth gate: every route it
  // exposes has req.user populated, and the owner-vs-summary projection inside
  // it is the SOLE authorisation boundary for character/dossier data.
  app.use('/api', charactersRouter);

  // World / Court router (Story 2.2). Mounted AFTER the auth gate, alongside the
  // characters router. Office-holding is public knowledge, so it applies NO
  // per-viewer projection beyond the login gate — but it still allowlist-projects
  // every holder object (never a raw-document spread). No new auth logic.
  app.use('/api', worldRouter);

  // Lore router (Story 2.3). Mounted AFTER the auth gate, alongside the characters
  // and world routers. It reads NO Mongo and issues NO writes — its only I/O is
  // read-only fs reads of the committed markdown under server/content/lore/. The
  // login gate is what keeps the lore CONTENT out of anonymous hands (it is served
  // through this API, never baked into un-gated Netlify static HTML). No new auth
  // logic; the route never reads req.user.
  app.use('/api', loreRouter);

  return app;
}

// Connect to Mongo ONCE at boot, then listen. The long-lived process closes the
// connection gracefully on SIGTERM/SIGINT (Render sends SIGTERM on deploys /
// restarts). Tests never reach this path — they inject a fake Db via
// db.setTestDb and never open a real connection.
async function start() {
  await connectDb();
  const port = config.PORT;
  const server = createApp().listen(port, () => {
    console.log(`Terra Mortis Wiki API listening on http://localhost:${port} (${config.NODE_ENV})`);
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use — set PORT to a free port and try again.`);
      process.exit(1);
    }
    throw err;
  });
}

function shutdown(signal) {
  console.log(`\n${signal} received — closing Mongo connection and exiting`);
  closeDb().finally(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Start listening only when run directly (not when imported by a test).
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  start().catch((err) => {
    console.error('Failed to start Terra Mortis Wiki API:', err.message);
    process.exit(1);
  });
}
