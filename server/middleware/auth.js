// server/middleware/auth.js — requireAuth (Story 1.3).
//
// Ported near-verbatim from `../TM Suite/server/middleware/auth.js`, with ONE
// deliberate change: player resolution reads the in-memory SNAPSHOT (Story 1.2)
// instead of live Mongo — the deployed Wiki service holds no Mongo connection.
//
// Shape (unchanged from TM Suite): the frontend holds the Discord access_token
// itself and sends it as `Authorization: Bearer <token>`. This middleware
// re-validates that token against Discord's `/users/@me` and re-derives req.user
// from snapshot data, caching the (token -> user) result 60s in-memory so most
// requests never hit Discord.

import { getPlayerByDiscordId } from '../snapshot-store.js';

const DISCORD_API = 'https://discord.com/api/v10';

// Cache validated tokens briefly to avoid hitting Discord on every request.
// Map<token, { user, expiresAt }>
const tokenCache = new Map();
const CACHE_TTL = 60_000; // 1 minute

// Build the canonical req.user from a Discord profile + a snapshot player.
// AC #2/#6: character_ids is always an array (copied so callers can't mutate the
// snapshot), with no assumption anywhere that it has exactly one element.
// `player_id` is the player's discord_id: the snapshot deliberately omits the
// Mongo `_id` (auth-field whitelist, Story 1.2), so discord_id is the only
// stable player identifier available here.
export function buildUserFromPlayer(discordUser, player) {
  return {
    id: discordUser.id,
    username: discordUser.username,
    global_name: discordUser.global_name ?? null,
    role: player.role,
    player_id: player.discord_id,
    character_ids: Array.isArray(player.character_ids) ? [...player.character_ids] : [],
    discord_username: player.discord_username ?? null,
  };
}

export async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'AUTH_ERROR', message: 'Authentication required' });
  }

  const token = authHeader.slice(7);

  // Local test bypass — active ONLY on an explicit allowlisted dev env (AC #5).
  // Mirrors TM Suite's 'local-test-token'. Deliberately an ALLOWLIST, not a
  // "!== production" denylist: an unset, misspelled, or unconfigured NODE_ENV on
  // the real host (which happens - Render doesn't guarantee it's set for a plain
  // Node service) must fail CLOSED. A denylist check would instead treat that
  // ambiguity as "not production" and hand out this hardcoded, cross-repo-shared
  // token as a full ST-role master key to anyone who sends it.
  const DEV_ENVS = new Set(['development', 'test']);
  if (DEV_ENVS.has(process.env.NODE_ENV) && token === 'local-test-token') {
    req.user = {
      id: 'local-test',
      username: 'local-test',
      global_name: 'Local Test',
      role: 'st',
      player_id: null,
      character_ids: [],
      discord_username: 'local-test',
    };
    return next();
  }

  // Check cache first.
  const cached = tokenCache.get(token);
  if (cached && cached.expiresAt > Date.now()) {
    req.user = cached.user;
    return next();
  }

  // Validate token against Discord.
  let userRes;
  try {
    userRes = await fetch(`${DISCORD_API}/users/@me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    // Network failure reaching Discord — treat as an unauthenticated request
    // rather than crashing (AC #4: never a crash).
    return res.status(401).json({ error: 'AUTH_ERROR', message: 'Invalid or expired token' });
  }

  if (!userRes.ok) {
    tokenCache.delete(token);
    return res.status(401).json({ error: 'AUTH_ERROR', message: 'Invalid or expired token' });
  }

  const discordUser = await userRes.json();

  // Resolve the player from the SNAPSHOT (not live Mongo). A valid Discord
  // identity with no matching player record is a clear 403, never a crash and
  // never a silent pass-through (AC #4).
  const player = getPlayerByDiscordId(discordUser.id);
  if (!player) {
    return res.status(403).json({ error: 'FORBIDDEN', message: 'No player record found — contact an ST' });
  }

  const userInfo = buildUserFromPlayer(discordUser, player);
  tokenCache.set(token, { user: userInfo, expiresAt: Date.now() + CACHE_TTL });
  req.user = userInfo;
  next();
}

// Test-only: clear the in-memory token cache between test cases so a token used
// in one test can be re-mocked with a different Discord response in the next.
export function _resetTokenCache() {
  tokenCache.clear();
}
