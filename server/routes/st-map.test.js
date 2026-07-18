// server/routes/st-map.test.js - ST + resident-gated map locations.
// (incident follow-up 2026-07-18; resident carve-out added same day)
//
// THE THIRD ACCESS-CONTROL BOUNDARY in the repo. st_map_locations holds real
// addresses and secret sites for every non-vampire faction plus every PC/NPC
// haven. Two rules, both asserted below: role 'st' sees everything; anyone
// else sees ONLY a haven where they own a listed resident, and NOTHING else
// (no other haven, no werewolf/mage/changeling/ghost/hq location, regardless
// of ownership).
//
// Two boundaries are mocked, neither touches anything live (same seams
// status.test.js / characters.test.js use):
//   1. Discord's /users/@me - MOCKED via a swapped globalThis.fetch.
//   2. The Mongo collections - a fake Db injected via db.setTestDb.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../index.js';
import { setTestDb } from '../db.js';
import { _resetTokenCache } from '../middleware/auth.js';
import { buildStMapView, isSt, LOCATION_FIELDS } from './st-map.js';

const DISCORD_API = 'https://discord.com/api/v10';

// --- Fixtures ---------------------------------------------------------------

const ALLOWED_KEYS = new Set(['_id', ...LOCATION_FIELDS]);
// TM-Suite-internal bookkeeping the imported documents carry that must NEVER
// cross the wire, allowlisted or not. `residents` is the unreliable
// moniker/nickname shorthand field - deliberately not in LOCATION_FIELDS,
// resident_names (canonical characters.name) is what's used for both matching
// and display.
const INTERNAL_FIELDS = ['source_location_id', 'boundary_locked', 'boundary_locked_at', 'boundary_spec', 'updated_at', 'refined', 'source', 'geocoded', 'residents'];

const HAVEN_MANSION = {
  _id: 'locMansion', name: 'The Mansion', faction: 'haven', type: 'haven',
  residents: ['Alice', 'Brandy'], resident_names: ['Alice Vunder', 'Brandy LaRoux'],
  address: 'May Street, St Peters', lat: -33.9, lon: 151.2, dots: 2,
  geocoded: true, source: 'merit', source_location_id: 'orig1',
};
const HAVEN_SANCTUM = {
  _id: 'locSanctum', name: 'The Sanctum', faction: 'haven', type: 'haven',
  residents: ['Carver'], resident_names: ['Carver'],
  address: 'Redfern', lat: -33.89, lon: 151.19, dots: 1,
  geocoded: true, source: 'merit', source_location_id: 'orig2',
};
const LOC_WEREWOLF = {
  _id: 'locWerewolf', name: 'Cumberland Reach', faction: 'werewolf', type: 'zone', layer: 'Werewolves',
  real_place: null, centroid: { lat: -33.7, lon: 150.9 }, polygon: [[150.9, -33.7]],
  color: '#2a5', fill_alpha: 0.2, stroke: '#000', source_location_id: 'orig3', updated_at: '2026-01-01',
  refined: true, boundary_locked: true, boundary_locked_at: '2026-01-01', boundary_spec: { note: 'hand-drawn' },
};

const TEST_LOCATIONS = [HAVEN_MANSION, HAVEN_SANCTUM, LOC_WEREWOLF];

const TEST_CHARACTERS = [
  { _id: 'charAlice', name: 'Alice Vunder' },
  { _id: 'charBrandy', name: 'Brandy LaRoux' },
  { _id: 'charCarver', name: 'Carver' },
  { _id: 'charDoc', name: 'Doc' }, // resident of nothing
];

// Must match access.js SUPERVIEWER_DISCORD_IDS. Only this id + role 'st' sees everything.
const SUPERVIEWER_ID = '694104767298797618';
const TEST_PLAYERS = [
  { discord_id: SUPERVIEWER_ID, role: 'st', character_ids: [], discord_username: 'angelus' }, // head ST / superviewer -> sees all
  { discord_id: '111', role: 'st', character_ids: ['charCarver'], discord_username: 'co_st' }, // co-ST playing a PC -> map-gated like a player
  { discord_id: '222', role: 'player', character_ids: ['charAlice'], discord_username: 'alice_pc' },
  { discord_id: '333', role: 'player', character_ids: ['charCarver'], discord_username: 'carver_pc' },
  { discord_id: '444', role: 'player', character_ids: ['charDoc'], discord_username: 'doc_pc' },
  { discord_id: '555', role: 'dev', character_ids: [], discord_username: 'dev_user' },
];

function makeFakeDb({ players = [], st_map_locations = [], characters = [] } = {}) {
  const data = { players, st_map_locations, characters };
  return {
    collection(name) {
      const docs = data[name] ?? [];
      return { find() { return { toArray: async () => docs.map((d) => ({ ...d })) }; } };
    },
  };
}

function installTestDb(overrides = {}) {
  setTestDb(makeFakeDb({ players: TEST_PLAYERS, st_map_locations: TEST_LOCATIONS, characters: TEST_CHARACTERS, ...overrides }));
}

// --- Discord mock (mirrors status.test.js / characters.test.js) ------------

function fakeRes(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function mockDiscord(profileId) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.startsWith(DISCORD_API)) {
      if (u.includes('/users/@me')) return fakeRes(200, { id: profileId, username: `u${profileId}` });
      throw new Error(`unexpected Discord fetch to ${u}`);
    }
    return original(url, opts);
  };
  return { restore: () => { globalThis.fetch = original; } };
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

async function getAs(base, discordId, path) {
  const m = mockDiscord(discordId);
  try {
    _resetTokenCache();
    const res = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer token-for-${discordId}` } });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { /* leave null */ }
    return { status: res.status, rawBody: text, body };
  } finally {
    m.restore();
  }
}

// ===========================================================================
// PURE FUNCTION UNIT TESTS
// ===========================================================================

test('isSt: exactly role "st" passes, everything else (including dev/coordinator) fails', () => {
  assert.equal(isSt({ role: 'st' }), true);
  assert.equal(isSt({ role: 'player' }), false);
  assert.equal(isSt({ role: 'dev' }), false);
  assert.equal(isSt({ role: 'coordinator' }), false);
  assert.equal(isSt({ role: 'ST' }), false, 'case-sensitive - no accidental widening');
  assert.equal(isSt(undefined), false);
  assert.equal(isSt({}), false);
});

test('buildStMapView: a SUPERVIEWER (role st + allowlisted id) gets EVERY location, allowlist-projected', () => {
  const v = buildStMapView(TEST_LOCATIONS, TEST_CHARACTERS, { role: 'st', id: SUPERVIEWER_ID });
  assert.equal(v.locations.length, 3);
  for (const row of v.locations) {
    for (const k of Object.keys(row)) assert.ok(ALLOWED_KEYS.has(k), `unexpected row key ${k}`);
    for (const f of INTERNAL_FIELDS) assert.ok(!(f in row), `row leaks internal field ${f}`);
  }
});

test('buildStMapView: a NON-superviewer ST (role st, id not on allowlist) is gated like a player', () => {
  // A co-ST who plays a PC: map secrets stay hidden from their character.
  const v = buildStMapView(TEST_LOCATIONS, TEST_CHARACTERS, { role: 'st', id: '111', character_ids: ['charCarver'] });
  assert.deepEqual(v.locations.map((l) => l.name), ['The Sanctum'], 'no ST-wide map sight from role alone');
  // role st with NO id (or wrong id) is not a superviewer either - fail closed.
  assert.deepEqual(buildStMapView(TEST_LOCATIONS, TEST_CHARACTERS, { role: 'st', character_ids: [] }).locations, []);
});

test('buildStMapView [LEAK-GATE]: a resident sees ONLY their own haven, nothing else', () => {
  const v = buildStMapView(TEST_LOCATIONS, TEST_CHARACTERS, { role: 'player', character_ids: ['charAlice'] });
  assert.equal(v.locations.length, 1);
  assert.equal(v.locations[0].name, 'The Mansion');
  assert.deepEqual(v.locations[0].resident_names, ['Alice Vunder', 'Brandy LaRoux'], 'sees co-residents too');
});

test('buildStMapView [LEAK-GATE]: a co-resident owning a DIFFERENT resident of the same haven still sees it', () => {
  const v = buildStMapView(TEST_LOCATIONS, TEST_CHARACTERS, { role: 'player', character_ids: ['charBrandy'] });
  assert.equal(v.locations.length, 1);
  assert.equal(v.locations[0].name, 'The Mansion');
});

test('buildStMapView [LEAK-GATE]: a resident of one haven does NOT see a different haven or any non-haven location', () => {
  const v = buildStMapView(TEST_LOCATIONS, TEST_CHARACTERS, { role: 'player', character_ids: ['charCarver'] });
  assert.deepEqual(v.locations.map((l) => l.name), ['The Sanctum']);
});

test('buildStMapView [LEAK-GATE]: a player who owns no mapped resident gets an empty array, not an error', () => {
  const v = buildStMapView(TEST_LOCATIONS, TEST_CHARACTERS, { role: 'player', character_ids: ['charDoc'] });
  assert.deepEqual(v.locations, []);
});

test('buildStMapView [LEAK-GATE]: dev/coordinator roles get NOTHING unless they also happen to own a resident (no automatic elevation)', () => {
  const vDev = buildStMapView(TEST_LOCATIONS, TEST_CHARACTERS, { role: 'dev', character_ids: [] });
  assert.deepEqual(vDev.locations, []);
  const vDevWithChar = buildStMapView(TEST_LOCATIONS, TEST_CHARACTERS, { role: 'dev', character_ids: ['charAlice'] });
  assert.deepEqual(vDevWithChar.locations.map((l) => l.name), ['The Mansion'], 'the resident rule applies to ANY role, not just player - dev is not special-cased either way');
});

test('buildStMapView: resident resolution is EXACT name match only, no trim/case-fold', () => {
  const chars = [{ _id: 'charX', name: 'alice vunder' }]; // lowercase - does not exactly match "Alice Vunder"
  const v = buildStMapView(TEST_LOCATIONS, chars, { role: 'player', character_ids: ['charX'] });
  assert.deepEqual(v.locations, [], 'a case-mismatched name must NOT resolve - fail closed');
});

test('buildStMapView tolerates empty/absent inputs without crashing', () => {
  assert.deepEqual(buildStMapView([], [], { role: 'st', id: SUPERVIEWER_ID }), { locations: [] });
  assert.deepEqual(buildStMapView(undefined, undefined, undefined), { locations: [] });
});

// --- The discrimination proof (negative control) ---------------------------
test('LEAK-GATE (discrimination): a naive passthrough WOULD leak internal fields; the real buildStMapView does not', () => {
  const passthroughBody = JSON.stringify({ locations: TEST_LOCATIONS.map((l) => ({ ...l })) });
  for (const f of INTERNAL_FIELDS) {
    assert.ok(passthroughBody.includes(`"${f}"`), `passthrough leaks internal field ${f}`);
  }
  const realBody = JSON.stringify(buildStMapView(TEST_LOCATIONS, TEST_CHARACTERS, { role: 'st', id: SUPERVIEWER_ID }));
  for (const f of INTERNAL_FIELDS) {
    assert.ok(!realBody.includes(`"${f}"`), `real assembly must not contain ${f}`);
  }
});

// ===========================================================================
// HTTP-LEVEL [LEAK-GATE] TESTS
// ===========================================================================

test('AC [LEAK-GATE]: a SUPERVIEWER gets 200 with every location including non-haven ones', async () => {
  installTestDb();
  await withServer(async (base) => {
    const { status, rawBody, body } = await getAs(base, SUPERVIEWER_ID, '/api/st-map/locations');
    assert.equal(status, 200);
    assert.equal(body.locations.length, 3);
    assert.ok(body.locations.some((l) => l.name === 'Cumberland Reach'));
    for (const f of INTERNAL_FIELDS) {
      assert.ok(!rawBody.includes(`"${f}"`), `LEAK: internal field ${f} present in st-map body`);
    }
  });
});

test('AC [LEAK-GATE]: a co-ST (role st, NOT on the superviewer allowlist) is map-gated as a player', async () => {
  installTestDb();
  await withServer(async (base) => {
    const { status, body, rawBody } = await getAs(base, '111', '/api/st-map/locations');
    assert.equal(status, 200);
    assert.deepEqual(body.locations.map((l) => l.name), ['The Sanctum'], 'co-ST sees only their own haven');
    assert.ok(!rawBody.includes('Cumberland Reach'), 'LEAK: werewolf zone visible to a non-superviewer ST');
    assert.ok(!rawBody.includes('The Mansion'), 'LEAK: another haven visible to a non-superviewer ST');
  });
});

test('AC [LEAK-GATE]: a resident player gets 200 with ONLY their own haven, no other haven and no ST-only faction data', async () => {
  installTestDb();
  await withServer(async (base) => {
    const { status, body, rawBody } = await getAs(base, '222', '/api/st-map/locations');
    assert.equal(status, 200);
    assert.deepEqual(body.locations.map((l) => l.name), ['The Mansion']);
    assert.ok(!rawBody.includes('The Sanctum'), 'LEAK: a different haven present for a non-resident');
    assert.ok(!rawBody.includes('Cumberland Reach'), 'LEAK: werewolf zone present for a non-ST viewer');
  });
});

test('AC [LEAK-GATE]: a different resident sees their own haven and not the first one', async () => {
  installTestDb();
  await withServer(async (base) => {
    const { body, rawBody } = await getAs(base, '333', '/api/st-map/locations');
    assert.deepEqual(body.locations.map((l) => l.name), ['The Sanctum']);
    assert.ok(!rawBody.includes('The Mansion'), 'LEAK: a different haven present for a non-resident');
  });
});

test('AC: a player who lives nowhere mapped gets 200 with an empty array (not a 403 - the route is legitimately reachable)', async () => {
  installTestDb();
  await withServer(async (base) => {
    const { status, body } = await getAs(base, '444', '/api/st-map/locations');
    assert.equal(status, 200);
    assert.deepEqual(body.locations, []);
  });
});

test('AC: dev role with no resident character gets 200 empty - not automatically ST-wide access', async () => {
  installTestDb();
  await withServer(async (base) => {
    const { status, body } = await getAs(base, '555', '/api/st-map/locations');
    assert.equal(status, 200);
    assert.deepEqual(body.locations, []);
  });
});

test('AC: /api/st-map/locations is behind requireAuth - no bearer token gets 401', async () => {
  installTestDb();
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/st-map/locations`);
    assert.equal(res.status, 401);
  });
});

test('AC: a store failure surfaces as a modelled 503, never a raw 500', async () => {
  setTestDb({
    collection(name) {
      if (name === 'players') return { find() { return { toArray: async () => TEST_PLAYERS.map((d) => ({ ...d })) }; } };
      if (name === 'st_map_locations') return { find() { throw new Error('simulated store failure'); } };
      return { find() { return { toArray: async () => [] }; } };
    },
  });
  await withServer(async (base) => {
    const { status } = await getAs(base, '111', '/api/st-map/locations');
    assert.equal(status, 503);
  });
});
