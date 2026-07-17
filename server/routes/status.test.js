// server/routes/status.test.js - Story 3.2 (covenant-clan-status-ladders).
//
// THE SECURITY-CRITICAL TEST FILE for the SECOND per-viewer authorisation
// boundary in the repo. This story adds the FIRST route to read and return any
// character `status` field: mongo-store.js hands buildStatusView full, unredacted
// documents (every status.covenant key for every covenant a character holds
// standing in, plus every attribute/skill/tracker value). The gating exercised
// here is the sole thing standing between a logged-in player and every other
// faction's internal standing.
//
// Three secret channels, all asserted below:
//   1. Owner-only character fields - never on a ladder row.
//   2. WHICH covenant/clan ladders a viewer receives - gated by the covenant
//      list / clan set (a faction the viewer is not in is never assembled).
//   3. The status.covenant MAP - each row exposes ONE scalar (`value`), never the
//      sub-document, so a character's standing in covenants the viewer is not
//      entitled to see never crosses the wire.
//
// Two boundaries are mocked, neither touches anything live (same seams
// characters.test.js uses):
//   1. Discord's /users/@me - MOCKED via a swapped globalThis.fetch.
//   2. The Mongo collections - a fake Db injected via db.setTestDb.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../index.js';
import { setTestDb } from '../db.js';
import { _resetTokenCache } from '../middleware/auth.js';
import { buildStatusView, ROW_NAME_FIELDS } from './status.js';

const DISCORD_API = 'https://discord.com/api/v10';

// --- Fixtures ---------------------------------------------------------------
// Owner-only representative field set: if ANY appears in a ladder response body,
// the row allowlist has leaked (channel 1).
const OWNER_ONLY_FIELDS = ['attributes', 'skills', 'disciplines', 'merits', 'xp_log', 'tracker_state'];

// The exact keys a row is allowed to carry (channel 1 + channel 3 at the object
// level): name fields, _id, the single per-ladder scalar, the mine flag.
const ROW_ALLOWED_KEYS = new Set(['_id', ...ROW_NAME_FIELDS, 'value', 'mine']);

const sheet = () => ({
  attributes: { intelligence: { dots: 3 } },
  skills: { politics: { dots: 4 } },
  disciplines: { dominate: 3 },
  merits: [{ name: 'Resources', dots: 4 }],
  xp_log: { spent: 42 },
  tracker_state: { vitae: 9, willpower: 6 },
});

// A - owner 111. Invictus / Ventrue. City 6.
const CHAR_A = {
  _id: 'charA', name: 'Ambrose', honorific: 'Lord', moniker: null,
  clan: 'Ventrue', covenant: 'Invictus', retired: false,
  status: { city: 6, covenant: { Invictus: 5 }, clan: 2 },
  ...sheet(),
};
// B - owner 222. Circle of the Crone / Mekhet, BUT ALSO holds standing 2 in
// Invictus (cross-covenant) - the channel-3 probe: when viewer A sees the Invictus
// ladder, B appears at its Invictus scalar (2) and B's Circle-of-the-Crone
// standing (4) must NEVER ride along.
const CHAR_B = {
  _id: 'charB', name: 'Beatrice', honorific: null, moniker: 'Bea',
  clan: 'Mekhet', covenant: 'Circle of the Crone', retired: false,
  status: { city: 4, covenant: { 'Circle of the Crone': 4, Invictus: 2 }, clan: 3 },
  ...sheet(),
};
// D - owner 444. Lancea et Sanctum / Ventrue (SAME clan as A). City 3. The
// covenant A never belongs to (Lancea et Sanctum) must never appear for viewer A.
const CHAR_D = {
  _id: 'charD', name: 'Doc', honorific: null, moniker: null,
  clan: 'Ventrue', covenant: 'Lancea et Sanctum', retired: false,
  status: { city: 3, covenant: { 'Lancea et Sanctum': 3 }, clan: 1 },
  ...sheet(),
};
// C - owner 333, RETIRED. Must be excluded from every ladder's ROWS, but its
// owner still sees the (current, non-retired) Carthian ladder.
const CHAR_C = {
  _id: 'charC', name: 'Cazimir', honorific: null, moniker: null,
  clan: 'Gangrel', covenant: 'Carthian Movement', retired: true,
  status: { city: 9, covenant: { 'Carthian Movement': 5 }, clan: 4 },
  ...sheet(),
};

const TEST_PLAYERS = [
  { discord_id: '111', role: 'player', character_ids: ['charA'], discord_username: 'ambrose_pc' },
  { discord_id: '222', role: 'player', character_ids: ['charB'], discord_username: 'bea_pc' },
  { discord_id: '333', role: 'player', character_ids: ['charC'], discord_username: 'caz_pc' },
  { discord_id: '444', role: 'player', character_ids: ['charD'], discord_username: 'doc_pc' },
  { discord_id: '999', role: 'player', character_ids: ['charA', 'charB'], discord_username: 'multi_pc' },
  { discord_id: '000', role: 'player', character_ids: [], discord_username: 'spectator_pc' },
];
const TEST_CHARACTERS = [CHAR_B, CHAR_A, CHAR_D, CHAR_C]; // deliberately unsorted

function makeFakeDb({ players = [], characters = [] } = {}) {
  const data = { players, characters };
  return {
    collection(name) {
      const docs = data[name] ?? [];
      return { find() { return { toArray: async () => docs.map((d) => ({ ...d })) }; } };
    },
  };
}

function installTestDb() {
  setTestDb(makeFakeDb({ players: TEST_PLAYERS, characters: TEST_CHARACTERS }));
}

// --- Discord mock (mirrors characters.test.js) ------------------------------

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

// Collect every row across City + all covenant + all clan ladders.
function allRows(view) {
  return [
    ...view.city.rows,
    ...view.covenant.ladders.flatMap((l) => l.rows),
    ...view.clan.ladders.flatMap((l) => l.rows),
  ];
}

// ===========================================================================
// PURE FUNCTION UNIT TESTS (AC #3-#10, #14)
// ===========================================================================

test('AC #4/#8: covenant list = primary UNION status>0, primary-first, de-duplicated', () => {
  // A single-covenant owner (charA): just Invictus.
  const vA = buildStatusView(TEST_CHARACTERS, { character_ids: ['charA'] });
  assert.deepEqual(vA.covenant.ladders.map((l) => l.name), ['Invictus']);
  // B holds primary Circle of the Crone PLUS standing 2 in Invictus -> both, primary first.
  const vB = buildStatusView(TEST_CHARACTERS, { character_ids: ['charB'] });
  assert.deepEqual(vB.covenant.ladders.map((l) => l.name), ['Circle of the Crone', 'Invictus']);
});

test('AC #5/#8: clan set = the owned characters clan values, de-duplicated', () => {
  const vA = buildStatusView(TEST_CHARACTERS, { character_ids: ['charA'] });
  assert.deepEqual(vA.clan.ladders.map((l) => l.name), ['Ventrue']);
});

test('AC #8: multi-character owner UNIONs covenant list and clan set (no length-1 special-casing)', () => {
  // owns A (Invictus/Ventrue) and B (Circle of the Crone/Mekhet, +Invictus standing).
  const v = buildStatusView(TEST_CHARACTERS, { character_ids: ['charA', 'charB'] });
  // covenant union across both owned characters (order follows the store, so
  // assert as a set): A's primary Invictus + B's primary Circle of the Crone
  // (B's Invictus standing de-duplicates against A's primary).
  assert.deepEqual(v.covenant.ladders.map((l) => l.name).sort(), ['Circle of the Crone', 'Invictus']);
  // clan union: two distinct clans.
  assert.deepEqual(v.clan.ladders.map((l) => l.name).sort(), ['Mekhet', 'Ventrue']);
  // and NO third faction's ladder (Lancea et Sanctum, Carthian) anywhere.
  assert.ok(!v.covenant.ladders.some((l) => l.name === 'Lancea et Sanctum'));
});

test('AC #6: covenant ladder membership = standing>0 OR primary; sorted value desc then sortName', () => {
  const v = buildStatusView(TEST_CHARACTERS, { character_ids: ['charA'] });
  const invictus = v.covenant.ladders.find((l) => l.name === 'Invictus');
  // charA (primary Invictus, value 5) and charB (Invictus standing 2) - sorted desc.
  assert.deepEqual(invictus.rows.map((r) => r._id), ['charA', 'charB']);
  assert.deepEqual(invictus.rows.map((r) => r.value), [5, 2]);
});

test('AC #6: clan ladder membership = same clan; value = status.clan||0; sorted value desc', () => {
  const v = buildStatusView(TEST_CHARACTERS, { character_ids: ['charA'] });
  const ventrue = v.clan.ladders.find((l) => l.name === 'Ventrue');
  // charA (clan status 2) and charD (clan status 1) - same clan Ventrue.
  assert.deepEqual(ventrue.rows.map((r) => r._id), ['charA', 'charD']);
  assert.deepEqual(ventrue.rows.map((r) => r.value), [2, 1]);
});

test('AC #7 [LEAK-GATE]: per-ladder SCALAR isolation - a multi-covenant character exposes ONLY the queried covenant scalar', () => {
  // Viewer A sees the Invictus ladder. B holds standing in BOTH Invictus (2) and
  // Circle of the Crone (4). In A's Invictus ladder, B's row must carry value 2
  // and NOTHING that reveals the Circle-of-the-Crone standing.
  const v = buildStatusView(TEST_CHARACTERS, { character_ids: ['charA'] });
  const invictus = v.covenant.ladders.find((l) => l.name === 'Invictus');
  const bRow = invictus.rows.find((r) => r._id === 'charB');
  assert.equal(bRow.value, 2, 'B exposes ONLY its Invictus scalar in the Invictus ladder');
  // the row carries no status sub-document and no other covenant/clan/city scalar
  for (const k of Object.keys(bRow)) {
    assert.ok(ROW_ALLOWED_KEYS.has(k), `row must not carry unexpected key ${k}`);
  }
  assert.ok(!('status' in bRow) && !('covenant' in bRow) && !('clan' in bRow));
});

test('AC #7 [LEAK-GATE]: every row is allowlist-constructed - no owner-only field, no status sub-document', () => {
  const v = buildStatusView(TEST_CHARACTERS, { character_ids: ['charA', 'charB'] });
  for (const row of allRows(v)) {
    for (const k of Object.keys(row)) assert.ok(ROW_ALLOWED_KEYS.has(k), `unexpected row key ${k}`);
    for (const f of OWNER_ONLY_FIELDS) assert.ok(!(f in row), `row leaks owner-only field ${f}`);
    assert.ok(!('status' in row), 'row leaks the status sub-document');
  }
});

test('AC #3/#10: City ladder is ungated (identical for every viewer) and shows RAW status.city', () => {
  const vA = buildStatusView(TEST_CHARACTERS, { character_ids: ['charA'] });
  const vSpectator = buildStatusView(TEST_CHARACTERS, { character_ids: [] });
  // same rows, same order, same raw city values regardless of who is asking.
  assert.deepEqual(vA.city.rows.map((r) => r._id), vSpectator.city.rows.map((r) => r._id));
  assert.deepEqual(vA.city.rows.map((r) => r.value), vSpectator.city.rows.map((r) => r.value));
  // raw stored status.city, sorted desc: A(6), B(4), D(3); retired C(9) excluded.
  assert.deepEqual(vA.city.rows.map((r) => r._id), ['charA', 'charB', 'charD']);
  assert.deepEqual(vA.city.rows.map((r) => r.value), [6, 4, 3]);
});

test('AC #14: retired characters are excluded from ALL ladder rows', () => {
  const v = buildStatusView(TEST_CHARACTERS, { character_ids: ['charA', 'charB'] });
  for (const row of allRows(v)) assert.notEqual(row._id, 'charC', 'retired charC must never be a row');
});

test('AC #14: a retired-only owner STILL sees their own faction ladders (populated with non-retired members)', () => {
  // charC is retired and is player 333's only character. They still get the
  // Carthian Movement + Gangrel ladders derived from C, even though C itself is
  // excluded from the rows (so those ladders are honestly empty here).
  const v = buildStatusView(TEST_CHARACTERS, { character_ids: ['charC'] });
  assert.deepEqual(v.covenant.ladders.map((l) => l.name), ['Carthian Movement']);
  assert.deepEqual(v.clan.ladders.map((l) => l.name), ['Gangrel']);
  // and C itself is not a row in them (retired excluded)
  assert.equal(v.covenant.ladders[0].rows.length, 0);
  assert.equal(v.clan.ladders[0].rows.length, 0);
});

test('AC #9: fail-closed - a spectator (no character) gets City only, empty covenant + clan sections', () => {
  const v = buildStatusView(TEST_CHARACTERS, { character_ids: [] });
  assert.ok(v.city.rows.length > 0, 'City is still fully public for a spectator');
  assert.deepEqual(v.covenant.ladders, []);
  assert.deepEqual(v.clan.ladders, []);
});

test('AC #8: the mine flag is per-row, true iff the row character is one of the viewer owned', () => {
  const v = buildStatusView(TEST_CHARACTERS, { character_ids: ['charA'] });
  const aCity = v.city.rows.find((r) => r._id === 'charA');
  const bCity = v.city.rows.find((r) => r._id === 'charB');
  assert.equal(aCity.mine, true);
  assert.equal(bCity.mine, false);
});

// --- The discrimination proof (negative control) ---------------------------
// Mirrors characters.test.js's LEAK-GATE (discrimination): proves the leak
// assertions have teeth by showing a NAIVE PASSTHROUGH would trip every one of
// them, while the real assembly does not. If someone regressed statusRow to a
// `{ ...character }` spread, THIS (and the HTTP tests below) is what would catch it.
test('LEAK-GATE (discrimination): a naive passthrough WOULD leak; the real buildStatusView does not', () => {
  // What a passthrough City ladder would serialise (rows = raw character docs):
  const passthroughBody = JSON.stringify({ city: { rows: TEST_CHARACTERS.map((c) => ({ ...c })) } });
  // Every leak assertion the HTTP tests make WOULD FIRE against this:
  for (const f of OWNER_ONLY_FIELDS) {
    assert.ok(passthroughBody.includes(`"${f}"`), `passthrough leaks owner-only field ${f}`);
  }
  assert.ok(passthroughBody.includes('"status"'), 'passthrough leaks the status sub-document (covenant map channel 3)');

  // The real assembly for the same viewer leaks NONE of them:
  const realBody = JSON.stringify(buildStatusView(TEST_CHARACTERS, { character_ids: ['charA'] }));
  for (const f of OWNER_ONLY_FIELDS) {
    assert.ok(!realBody.includes(`"${f}"`), `real assembly must not contain ${f}`);
  }
  assert.ok(!realBody.includes('"status"'), 'real assembly must not contain the status sub-document');
});

test('AC #8: buildStatusView tolerates empty/absent inputs without crashing', () => {
  assert.deepEqual(buildStatusView([], { character_ids: ['charA'] }), { city: { rows: [] }, covenant: { ladders: [] }, clan: { ladders: [] } });
  assert.deepEqual(buildStatusView(undefined, undefined), { city: { rows: [] }, covenant: { ladders: [] }, clan: { ladders: [] } });
});

// ===========================================================================
// HTTP-LEVEL [LEAK-GATE] TESTS (AC #12) - assert the serialised response BODY
// ===========================================================================

test('AC #12 [LEAK-GATE]: a viewer in covenant X gets X ladder, NO other covenant ladder, NO other clan ladder', async () => {
  installTestDb();
  await withServer(async (base) => {
    // viewer A (111/charA) - Invictus / Ventrue only.
    const { status, rawBody, body } = await getAs(base, '111', '/api/status');
    assert.equal(status, 200);

    const covNames = body.covenant.ladders.map((l) => l.name);
    const clanNames = body.clan.ladders.map((l) => l.name);
    // sees own covenant + clan
    assert.deepEqual(covNames, ['Invictus']);
    assert.deepEqual(clanNames, ['Ventrue']);
    // NEVER a faction the viewer is not in
    for (const forbidden of ['Circle of the Crone', 'Lancea et Sanctum', 'Carthian Movement']) {
      assert.ok(!covNames.includes(forbidden), `LEAK: covenant ladder ${forbidden} present for a non-member`);
    }
    for (const forbidden of ['Mekhet', 'Gangrel']) {
      assert.ok(!clanNames.includes(forbidden), `LEAK: clan ladder ${forbidden} present for a non-member`);
    }

    // channel 1 + channel 3: no owner-only field, no status sub-document anywhere in the raw body
    for (const f of OWNER_ONLY_FIELDS) {
      assert.ok(!rawBody.includes(`"${f}"`), `LEAK: owner-only field ${f} present in status body`);
    }
    assert.ok(!rawBody.includes('"status"'), 'LEAK: status sub-document (covenant map) present in body');
    assert.ok(!rawBody.includes('"vitae"'), 'LEAK: tracker_state contents present');
  });
});

test('AC #12 [LEAK-GATE]: multi-character union - a viewer owning two factions sees BOTH sets and no third', async () => {
  installTestDb();
  await withServer(async (base) => {
    // player 999 owns charA (Invictus/Ventrue) and charB (Circle of the Crone/Mekhet).
    const { status, rawBody, body } = await getAs(base, '999', '/api/status');
    assert.equal(status, 200);
    const covNames = body.covenant.ladders.map((l) => l.name);
    const clanNames = body.clan.ladders.map((l) => l.name).sort();
    assert.deepEqual(covNames.sort(), ['Circle of the Crone', 'Invictus']);
    assert.deepEqual(clanNames, ['Mekhet', 'Ventrue']);
    // the third faction (Lancea et Sanctum / Carthian / Gangrel) is absent
    assert.ok(!covNames.includes('Lancea et Sanctum') && !covNames.includes('Carthian Movement'));
    assert.ok(!clanNames.includes('Gangrel'));
    assert.ok(!rawBody.includes('"status"'), 'LEAK: status sub-document present in multi-char body');
  });
});

test('AC #12 [LEAK-GATE]: a spectator (empty character_ids) gets City populated, both faction sections empty', async () => {
  installTestDb();
  await withServer(async (base) => {
    const { status, body } = await getAs(base, '000', '/api/status');
    assert.equal(status, 200);
    assert.ok(body.city.rows.length > 0, 'City Status must be populated for a spectator');
    assert.deepEqual(body.covenant.ladders, [], 'covenant section must be empty for a spectator');
    assert.deepEqual(body.clan.ladders, [], 'clan section must be empty for a spectator');
  });
});

test('AC #12: City ladder over HTTP excludes retired and is identical across viewers', async () => {
  installTestDb();
  await withServer(async (base) => {
    const asA = await getAs(base, '111', '/api/status');
    const asSpectator = await getAs(base, '000', '/api/status');
    // retired charC excluded from City rows
    assert.ok(!asA.body.city.rows.some((r) => r._id === 'charC'), 'retired charC must not be a City row');
    // ungated: same City rows for both viewers
    assert.deepEqual(
      asA.body.city.rows.map((r) => r._id),
      asSpectator.body.city.rows.map((r) => r._id),
    );
  });
});

test('AC #1: /api/status is behind requireAuth - no bearer token gets 401', async () => {
  installTestDb();
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/status`);
    assert.equal(res.status, 401);
  });
});
