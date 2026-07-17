// server/auth.test.js — Story 1.3 (Discord OAuth reuse; amended by 1.2 rev 2).
//
// Two boundaries are mocked, neither touches anything live:
//   1. Discord's token-exchange and /users/@me endpoints — MOCKED via a swapped
//      globalThis.fetch; no automated test ever calls the real Discord API.
//   2. The `players` Mongo lookup — a fake `Db` injected via db.setTestDb (the
//      same mongodb-driver-boundary mock Story 1.2 uses), replacing Story 1.3's
//      original snapshot-store.setSnapshot seam. No file and no live Mongo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './index.js';
import { setTestDb } from './db.js';
import { _resetTokenCache } from './middleware/auth.js';

const DISCORD_API = 'https://discord.com/api/v10';

// Injected players: one solo-character player, one multi-character (dual-role)
// player. A minimal fake Db returns them from players.find().toArray(); the
// mongo-store's projection is a superset of these fields, so no stripping is
// needed for the fixtures to be faithful.
const TEST_PLAYERS = [
  { discord_id: '111', role: 'player', character_ids: ['charA'], discord_username: 'solo' },
  { discord_id: '222', role: 'st', character_ids: ['charB', 'charC'], discord_username: 'dual' },
];

function fakePlayersDb(players) {
  return {
    collection(name) {
      const docs = name === 'players' ? players : [];
      return {
        find() {
          return { toArray: async () => docs.map((d) => ({ ...d })) };
        },
      };
    },
  };
}
setTestDb(fakePlayersDb(TEST_PLAYERS));

// --- helpers -----------------------------------------------------------------

function fakeRes(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

// Install a fetch mock that routes by URL to Discord's two endpoints.
// `onProfile` / `onToken` are (url, opts) => fakeRes(...).
function mockDiscord({ token, profile } = {}) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    // Only intercept Discord's API. The test client's own requests to the local
    // server pass through to the real fetch untouched.
    if (u.startsWith(DISCORD_API)) {
      calls.push({ url: u, opts });
      if (u.includes('/oauth2/token')) {
        return token ? token(url, opts) : fakeRes(200, { access_token: 'at1', expires_in: 604800 });
      }
      if (u.includes('/users/@me')) {
        return profile ? profile(url, opts) : fakeRes(200, { id: '111', username: 'solo' });
      }
      throw new Error(`unexpected Discord fetch to ${u}`);
    }
    return original(url, opts);
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

// Perform the real GET /auth/discord step to obtain a valid (state, cookie)
// pair, exactly as a real browser round-trip would produce. Needed because the
// callback now verifies state against a cookie set by this route (login-CSRF
// fix) - tests exercising the callback must go through it rather than
// fabricating a POST in isolation.
async function getState(base) {
  const res = await fetch(`${base}/auth/discord`, { redirect: 'manual' });
  const loc = new URL(res.headers.get('location'));
  const state = loc.searchParams.get('state');
  const setCookie = res.headers.get('set-cookie');
  const cookie = setCookie.split(';')[0]; // "oauth_state=<value>"
  return { state, cookie };
}

async function withServer(fn) {
  const app = createApp();
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(base);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

// --- AC #1: redirect ---------------------------------------------------------

test('AC #1: GET /auth/discord redirects to Discord consent with identify scope + issues the state cookie', async () => {
  _resetTokenCache();
  // No fetch mock — this route only redirects; the request hits our own server.
  await withServer(async (base) => {
    const res = await fetch(`${base}/auth/discord`, { redirect: 'manual' });
    assert.equal(res.status, 302);
    const loc = res.headers.get('location');
    assert.match(loc, /discord\.com\/oauth2\/authorize/);
    assert.match(loc, /response_type=code/);
    assert.match(loc, /scope=identify/);
    assert.doesNotMatch(loc, /scope=identify[^&]*(email|guilds)/); // identify only
    // Story 1.4 AC #6: the CSRF state cookie is still issued (unchanged from 1.3),
    // and the same state value is carried through Discord's redirect URL.
    const setCookie = res.headers.get('set-cookie');
    assert.match(setCookie, /oauth_state=/);
    assert.match(setCookie, /HttpOnly/i);
    const stateInUrl = new URL(loc).searchParams.get('state');
    assert.ok(stateInUrl && stateInUrl.length > 0);
  });
});

// --- AC #2: callback ---------------------------------------------------------

test('AC #2: successful callback resolves the right player and returns token + user', async () => {
  _resetTokenCache();
  const m = mockDiscord({
    token: () => fakeRes(200, { access_token: 'at1', expires_in: 604800 }),
    profile: () => fakeRes(200, { id: '111', username: 'solo', global_name: 'Solo' }),
  });
  try {
    await withServer(async (base) => {
      const { state, cookie } = await getState(base);
      const res = await fetch(`${base}/auth/discord/callback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ code: 'auth-code', state }),
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.access_token, 'at1');
      assert.equal(body.user.role, 'player');
      assert.equal(body.user.player_id, '111'); // discord_id stands in for absent _id
      assert.deepEqual(body.user.character_ids, ['charA']);
      assert.equal(body.user.discord_username, 'solo');
    });
  } finally {
    m.restore();
  }
});

test('AC #2/#4: valid Discord identity with no matching player gets 403', async () => {
  _resetTokenCache();
  const m = mockDiscord({ profile: () => fakeRes(200, { id: '999', username: 'ghost' }) });
  try {
    await withServer(async (base) => {
      const { state, cookie } = await getState(base);
      const res = await fetch(`${base}/auth/discord/callback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ code: 'auth-code', state }),
      });
      assert.equal(res.status, 403);
    });
  } finally {
    m.restore();
  }
});

test('AC #2: callback with no code gets 400', async () => {
  _resetTokenCache();
  await withServer(async (base) => {
    const { state, cookie } = await getState(base);
    const res = await fetch(`${base}/auth/discord/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ state }),
    });
    assert.equal(res.status, 400);
  });
});

test('AC #2: failed token exchange surfaces as 401', async () => {
  _resetTokenCache();
  const m = mockDiscord({ token: () => fakeRes(401, { error_description: 'bad code' }) });
  try {
    await withServer(async (base) => {
      const { state, cookie } = await getState(base);
      const res = await fetch(`${base}/auth/discord/callback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ code: 'bad', state }),
      });
      assert.equal(res.status, 401);
    });
  } finally {
    m.restore();
  }
});

// --- login-CSRF fix: OAuth state must round-trip against the cookie --------

test('CSRF: callback with no state at all (no cookie, no body value) gets 400', async () => {
  _resetTokenCache();
  await withServer(async (base) => {
    const res = await fetch(`${base}/auth/discord/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'auth-code' }),
    });
    assert.equal(res.status, 400);
  });
});

test('CSRF: callback with a state that does NOT match the issued cookie gets 400, never reaches Discord', async () => {
  _resetTokenCache();
  const m = mockDiscord({ profile: () => fakeRes(200, { id: '111', username: 'solo' }) });
  try {
    await withServer(async (base) => {
      const { cookie } = await getState(base);
      const res = await fetch(`${base}/auth/discord/callback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ code: 'auth-code', state: 'attacker-supplied-state' }),
      });
      assert.equal(res.status, 400);
      assert.equal(m.calls.length, 0); // rejected before ever contacting Discord
    });
  } finally {
    m.restore();
  }
});

test('CSRF: callback with the cookie missing (state only in body) gets 400', async () => {
  _resetTokenCache();
  await withServer(async (base) => {
    const { state } = await getState(base);
    const res = await fetch(`${base}/auth/discord/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }, // no Cookie header
      body: JSON.stringify({ code: 'auth-code', state }),
    });
    assert.equal(res.status, 400);
  });
});

// Note: this app does NOT enforce single-use state server-side (that would need
// a server-side consumed-nonce store, which is more machinery than the actual
// threat model calls for). res.clearCookie() is client-hygiene, not a security
// boundary — a compliant browser drops the cookie, but a test/attacker manually
// resending the exact same (state, cookie) pair can still match. That's fine:
// the property this defends is "an attacker without the victim's cookie can't
// forge a matching state" (login CSRF), not "this exact pair can only ever be
// used once" — and Discord's own authorization `code` is already single-use, so
// a genuine replay of the whole flow fails at the token-exchange step regardless.

// --- AC #3/#4: requireAuth gate ---------------------------------------------

test('AC #4: gated route without a bearer token gets 401', async () => {
  _resetTokenCache();
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/me`);
    assert.equal(res.status, 401);
  });
});

test('AC #3/#4: gated route with a valid token resolves req.user (200)', async () => {
  _resetTokenCache();
  const m = mockDiscord({ profile: () => fakeRes(200, { id: '111', username: 'solo' }) });
  try {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/me`, {
        headers: { Authorization: 'Bearer real-discord-token' },
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.user.player_id, '111');
      assert.equal(body.user.role, 'player');
    });
  } finally {
    m.restore();
  }
});

test('AC #4: gated route with an invalid/expired token gets 401', async () => {
  _resetTokenCache();
  const m = mockDiscord({ profile: () => fakeRes(401, {}) });
  try {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/me`, {
        headers: { Authorization: 'Bearer expired-token' },
      });
      assert.equal(res.status, 401);
    });
  } finally {
    m.restore();
  }
});

test('AC #4: gated route, valid Discord identity but unknown player gets 403', async () => {
  _resetTokenCache();
  const m = mockDiscord({ profile: () => fakeRes(200, { id: '999', username: 'ghost' }) });
  try {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/me`, {
        headers: { Authorization: 'Bearer valid-but-unmapped' },
      });
      assert.equal(res.status, 403);
    });
  } finally {
    m.restore();
  }
});

// --- AC #3: 60s cache -------------------------------------------------------

test('AC #3: a repeated request with the same token hits Discord only once (cached)', async () => {
  _resetTokenCache();
  const m = mockDiscord({ profile: () => fakeRes(200, { id: '111', username: 'solo' }) });
  try {
    await withServer(async (base) => {
      const h = { Authorization: 'Bearer cache-me' };
      await fetch(`${base}/api/me`, { headers: h });
      await fetch(`${base}/api/me`, { headers: h });
      const profileCalls = m.calls.filter((c) => c.url.includes('/users/@me'));
      assert.equal(profileCalls.length, 1); // second request served from cache
    });
  } finally {
    m.restore();
  }
});

// --- AC #5: local test bypass, NODE_ENV-gated -------------------------------

test('AC #5: local-test-token bypass works when NODE_ENV=development (explicit allowlist)', async () => {
  _resetTokenCache();
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  // Guard: if the bypass wrongly fell through to Discord, this mock would 401.
  const m = mockDiscord({ profile: () => fakeRes(401, {}) });
  try {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/me`, {
        headers: { Authorization: 'Bearer local-test-token' },
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.user.role, 'st');
      assert.equal(body.user.player_id, null);
      assert.equal(m.calls.length, 0); // never reached Discord
    });
  } finally {
    m.restore();
    process.env.NODE_ENV = prev;
  }
});

test('AC #5: local-test-token bypass NEVER activates when NODE_ENV=production', async () => {
  _resetTokenCache();
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  // In production the token is validated against Discord like any other; mock a
  // rejection so a 401 (not a 200 bypass) proves the gate stayed shut.
  const m = mockDiscord({ profile: () => fakeRes(401, {}) });
  try {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/me`, {
        headers: { Authorization: 'Bearer local-test-token' },
      });
      assert.equal(res.status, 401);
      assert.ok(m.calls.some((c) => c.url.includes('/users/@me'))); // it DID try Discord
    });
  } finally {
    m.restore();
    process.env.NODE_ENV = prev;
  }
});

test('SECURITY FIX: local-test-token bypass fails CLOSED when NODE_ENV is unset (was a fail-open master key)', async () => {
  // This is the exact scenario the review flagged: a real host that doesn't
  // explicitly set NODE_ENV at all. The old `!== 'production'` denylist treated
  // "unset" as "not production" and handed out full ST access to anyone with the
  // hardcoded token. The fix is an allowlist of known dev envs, so "unset" (or
  // any misspelling/unexpected value) must fail the same way production does.
  _resetTokenCache();
  const prev = process.env.NODE_ENV;
  delete process.env.NODE_ENV;
  const m = mockDiscord({ profile: () => fakeRes(401, {}) });
  try {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/me`, {
        headers: { Authorization: 'Bearer local-test-token' },
      });
      assert.equal(res.status, 401);
      assert.ok(m.calls.some((c) => c.url.includes('/users/@me'))); // it DID try Discord, bypass did not fire
    });
  } finally {
    m.restore();
    if (prev === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prev;
  }
});

// --- AC #6: character_ids never special-cases length 1 ----------------------

test('AC #6: multi-character player exposes ALL character_ids (no length-1 assumption)', async () => {
  _resetTokenCache();
  const m = mockDiscord({ profile: () => fakeRes(200, { id: '222', username: 'dual' }) });
  try {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/me`, {
        headers: { Authorization: 'Bearer dual-token' },
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.deepEqual(body.user.character_ids, ['charB', 'charC']);
      assert.equal(body.user.character_ids.length, 2);
    });
  } finally {
    m.restore();
  }
});

test('AC #6: single-character player uses the identical array path (length 1)', async () => {
  _resetTokenCache();
  const m = mockDiscord({ profile: () => fakeRes(200, { id: '111', username: 'solo' }) });
  try {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/me`, {
        headers: { Authorization: 'Bearer solo-token' },
      });
      const body = await res.json();
      assert.ok(Array.isArray(body.user.character_ids));
      assert.deepEqual(body.user.character_ids, ['charA']);
    });
  } finally {
    m.restore();
  }
});

// --- Follow-up review: async live-Mongo swap — DB-failure path --------------
// The player lookup is now a LIVE Mongo query (Story 1.2 rev 2), not the old
// in-memory snapshot .find(). That introduces a failure mode the snapshot never
// had: the query can REJECT (DB down / timeout / connection reset). Every other
// external call in these two files is wrapped in try/catch; this one must be too,
// or the rejection surfaces as a raw Express-default 500 (and, in non-production,
// a stack-trace-bearing body) instead of the modelled error the ACs call for
// (AC #4: never a crash). These two tests inject a players collection whose
// .toArray() rejects, and assert a modelled 503 AUTH_ERROR on both the middleware
// and the callback resolution paths.

function fakeThrowingDb() {
  return {
    collection() {
      return { find() { return { toArray: async () => { throw new Error('mongo connection reset'); } }; } };
    },
  };
}

test('Follow-up: middleware DB-lookup rejection is a modelled 503, never a raw 500', async () => {
  _resetTokenCache();
  const m = mockDiscord({ profile: () => fakeRes(200, { id: '111', username: 'solo' }) });
  setTestDb(fakeThrowingDb());
  try {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/me`, {
        headers: { Authorization: 'Bearer db-outage-token' },
      });
      assert.equal(res.status, 503);
      const body = await res.json();
      assert.equal(body.error, 'AUTH_ERROR');
    });
  } finally {
    m.restore();
    setTestDb(fakePlayersDb(TEST_PLAYERS)); // restore the shared fixture db
  }
});

test('Follow-up: callback DB-lookup rejection is a modelled 503, never a raw 500', async () => {
  _resetTokenCache();
  const m = mockDiscord({
    token: () => fakeRes(200, { access_token: 'at1', expires_in: 604800 }),
    profile: () => fakeRes(200, { id: '111', username: 'solo' }),
  });
  setTestDb(fakeThrowingDb());
  try {
    await withServer(async (base) => {
      const { state, cookie } = await getState(base);
      const res = await fetch(`${base}/auth/discord/callback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ code: 'auth-code', state }),
      });
      assert.equal(res.status, 503);
      const body = await res.json();
      assert.equal(body.error, 'AUTH_ERROR');
    });
  } finally {
    m.restore();
    setTestDb(fakePlayersDb(TEST_PLAYERS)); // restore the shared fixture db
  }
});

// NOTE (Story 1.4): the two "static serving is scoped to /css" tests and the
// "login-landing page (/) stays public" test that lived here are RETIRED. This
// service no longer serves any static files or a home page — CSS and the login
// page are Netlify's job now (see server/index.js header). Their retirement is
// intentional, not a regression; Story 1.1/1.3 story files keep the history. The
// corrected redirect flow is covered by the AC #1 redirect test above plus the
// login-page callback-handling tests in public/js/auth/login-core.test.js.
