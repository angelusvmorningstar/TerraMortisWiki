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

  // Discord OAuth2 — reuse TM Suite's Discord application. `identify` scope only.
  // Secrets are read here and used ONLY in the server-to-server token exchange;
  // they are never logged, never returned in a response, never written anywhere.
  DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID,
  DISCORD_CLIENT_SECRET: process.env.DISCORD_CLIENT_SECRET,
  DISCORD_REDIRECT_URI:
    process.env.DISCORD_REDIRECT_URI || 'http://localhost:3000/auth/discord/callback',
};
