// server/config.js — environment configuration for the Wiki service (Story 1.3).
//
// Mirrors the shape of `../TM Suite/server/config.js` for the Discord OAuth vars
// this app reuses (SAME Discord application as TM Suite — see README "Discord
// OAuth setup"). Loads the repo-root `.env` (gitignored) so `npm start` picks up
// local credentials without them ever entering source control.
//
// NOTE: `NODE_ENV` is intentionally NOT frozen here for the local-test bypass
// gate — that gate reads `process.env.NODE_ENV` LIVE in middleware/auth.js so a
// process (or a test) can toggle it after import. `config.NODE_ENV` below is a
// convenience snapshot for non-security-critical reads only.

import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '..', '.env') });

export const config = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT, 10) || 3000,

  // Live, read-only Mongo connection (Story 1.2). This is the ONLY thing in the
  // deployed service that touches `tm_suite`, and only ever read-only — the
  // read-only guarantee is belt (server/mongo-store.js issues zero write calls,
  // lexically tested) plus braces (the Atlas DB user is provisioned read-only, a
  // manual Atlas-console step — see README). MONGODB_DB defaults to `tm_suite`.
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://localhost:27017/tm_suite',
  MONGODB_DB: process.env.MONGODB_DB || 'tm_suite',

  // CORS — only relevant for LOCAL dev, where the static frontend (e.g. :8080)
  // and this API (:3000) run on different origins. In production the Netlify
  // redirect proxy makes every request same-origin, so this is mostly inert
  // there (Story 1.4 dev note). Comma-separated allowlist.
  CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:8080',

  // Discord OAuth2 — reuse TM Suite's Discord application. `identify` scope only.
  // Secrets are read here and used ONLY in the server-to-server token exchange;
  // they are never logged, never returned in a response, never written anywhere.
  DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID,
  DISCORD_CLIENT_SECRET: process.env.DISCORD_CLIENT_SECRET,
  // Points at the Netlify-hosted login PAGE, never a backend route (Story 1.4):
  // Discord's OAuth redirect is always a browser GET with `?code=&state=`, which
  // can only land on a static page, never a POST-only JSON route. The login page
  // extracts code/state and POSTs them to /auth/discord/callback.
  DISCORD_REDIRECT_URI:
    process.env.DISCORD_REDIRECT_URI || 'http://localhost:8080/login.html',
};
