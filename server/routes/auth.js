// server/routes/auth.js — Discord OAuth routes (Story 1.3).
//
// Ported from `../TM Suite/server/routes/auth.js`. Same Discord application, same
// `identify`-only scope, same "frontend holds the Discord access_token" model.
// The ONE change: the player lookup resolves against the in-memory SNAPSHOT
// (Story 1.2), not live Mongo — the deployed Wiki service holds no DB connection.
//
// Auto-link note: TM Suite's version, when a player has no discord_id yet, falls
// back to matching by discord_username and WRITES the numeric id back to Mongo
// (first-login convenience). This app never writes to Mongo, so that write-back
// cannot be replicated. The snapshot is keyed by discord_id; a player whose
// discord_id was never backfilled in TM Suite is simply unmatchable here until
// the next snapshot + deploy. Matching is therefore by discord_id only.

import { Router } from 'express';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { getPlayerByDiscordId } from '../snapshot-store.js';
import { buildUserFromPlayer } from '../middleware/auth.js';

const router = Router();

const DISCORD_API = 'https://discord.com/api/v10';
const SCOPES = 'identify';
const STATE_COOKIE = 'oauth_state';

// Constant-time string comparison so state verification isn't itself a timing
// side-channel (low-value target here, but it's free and it's the right habit
// for anything gating auth).
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a ?? ''));
  const bufB = Buffer.from(String(b ?? ''));
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

// GET /auth/discord — redirect the user to Discord's OAuth2 consent screen.
//
// Issues a random `state` value, bound to the browser via a short-lived,
// httpOnly cookie AND passed through Discord's redirect. The callback verifies
// the two match (Task/AC follow-up from review: login CSRF - without this, an
// attacker can capture their own auth code and trick a victim's browser into
// completing the callback, logging the victim into the attacker's identity).
router.get('/discord', (req, res) => {
  const state = randomBytes(24).toString('hex');
  res.cookie(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.NODE_ENV === 'production',
    maxAge: 5 * 60 * 1000, // 5 minutes - the login round-trip should be seconds
  });

  const params = new URLSearchParams({
    client_id: config.DISCORD_CLIENT_ID ?? '',
    redirect_uri: config.DISCORD_REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES,
    state,
  });
  res.redirect(`https://discord.com/oauth2/authorize?${params}`);
});

// POST /auth/discord/callback — exchange the authorisation code for a Discord
// access token, fetch the Discord profile, resolve the matching snapshot player.
//
// The frontend must forward the `state` Discord returned in its redirect's
// query string here unchanged - that's what's checked against the cookie set
// above. `redirect_uri` is NOT accepted from the client: Discord requires it to
// match exactly what was used at the authorize step, so pinning it server-side
// removes a pointlessly attacker-influenceable input from an auth-critical call.
router.post('/discord/callback', async (req, res) => {
  const { code, state } = req.body ?? {};
  const cookieState = req.cookies?.[STATE_COOKIE];
  res.clearCookie(STATE_COOKIE); // one-time use, whatever the outcome below

  if (!code) {
    return res.status(400).json({ error: 'AUTH_ERROR', message: 'Missing authorisation code' });
  }
  if (!state || !cookieState || !safeEqual(state, cookieState)) {
    return res.status(400).json({ error: 'AUTH_ERROR', message: 'Missing or invalid OAuth state' });
  }

  let tokenRes;
  try {
    // Exchange code for token with Discord.
    tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.DISCORD_CLIENT_ID ?? '',
        client_secret: config.DISCORD_CLIENT_SECRET ?? '',
        grant_type: 'authorization_code',
        code,
        redirect_uri: config.DISCORD_REDIRECT_URI,
      }),
    });
  } catch {
    return res.status(401).json({ error: 'AUTH_ERROR', message: 'Failed to reach Discord' });
  }

  if (!tokenRes.ok) {
    const err = await tokenRes.json().catch(() => ({}));
    return res.status(401).json({ error: 'AUTH_ERROR', message: err.error_description || 'Token exchange failed' });
  }

  const tokenData = await tokenRes.json();

  let userRes;
  try {
    // Fetch Discord user profile.
    userRes = await fetch(`${DISCORD_API}/users/@me`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
  } catch {
    return res.status(401).json({ error: 'AUTH_ERROR', message: 'Failed to reach Discord' });
  }

  if (!userRes.ok) {
    return res.status(401).json({ error: 'AUTH_ERROR', message: 'Failed to fetch Discord user' });
  }

  const discordUser = await userRes.json();

  // Resolve the player from the snapshot (by discord_id only — see file header).
  const player = getPlayerByDiscordId(discordUser.id);
  if (!player) {
    return res.status(403).json({ error: 'FORBIDDEN', message: 'No player record found — contact an ST' });
  }

  res.json({
    access_token: tokenData.access_token,
    expires_in: tokenData.expires_in,
    user: buildUserFromPlayer(discordUser, player),
  });
});

export default router;
