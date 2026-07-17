// server/middleware/auth.js — requireAuth (Story 1.3; amended by Story 1.2 rev 2).
//
// Ported near-verbatim from `../TM Suite/server/middleware/auth.js`. Player
// resolution now goes through the LIVE, read-only Mongo `players` lookup
// (`server/mongo-store.js`, Story 1.2 rev 2) — this is a straight port of TM
// Suite's real behaviour, replacing the retired snapshot detour. The CSRF state
// fix, the NODE_ENV allowlist bypass gate, and the error-response shapes are
// unchanged from Story 1.3's reviewed build.
//
// Shape (unchanged from TM Suite): the frontend holds the Discord access_token
// itself and sends it as `Authorization: Bearer <token>`. This middleware
// re-validates that token against Discord's `/users/@me` and re-derives req.user
// from the live `players` lookup, caching the (token -> user) result 60s
// in-memory so most requests never hit Discord.

import { getPlayerByDiscordId } from '../mongo-store.js';

const DISCORD_API = 'https://discord.com/api/v10';

// Cache validated tokens briefly to avoid hitting Discord on every request.
// Map<token, { user, expiresAt }>
const tokenCache = new Map();
const CACHE_TTL = 60_000; // 1 minute

// Build the canonical req.user from a Discord profile + a resolved player.
// AC #2/#6: character_ids is always an array (copied so callers can't mutate the
// shared player object), with no assumption anywhere that it has exactly one
// element. `player_id` is the player's discord_id: the auth-field whitelist
// projection deliberately omits the Mongo `_id` (Story 1.2), so discord_id is
// the only stable player identifier available here.
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

  // Resolve the player from the live, read-only Mongo `players` lookup. A valid
  // Discord identity with no matching player record is a clear 403, never a
  // crash and never a silent pass-through (AC #4).
  //
  // The lookup is now a LIVE Mongo query (Story 1.2 rev 2), so unlike the retired
  // in-memory snapshot .find() it can REJECT (DB down / timeout / connection
  // reset). Wrap it exactly as the Discord fetch above is wrapped: a dependency
  // outage must be a modelled response, not a raw Express-default 500 (which in
  // non-production also leaks a stack trace). 503 — not 401 — because the token
  // WAS validated; this is a server-side dependency failure, so we must not tell
  // a legitimately-authenticated client its token is invalid (which would make
  // the frontend discard a good session on a transient blip).
  let player;
  try {
    player = await getPlayerByDiscordId(discordUser.id);
  } catch {
    return res.status(503).json({ error: 'AUTH_ERROR', message: 'Player lookup temporarily unavailable' });
  }
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
