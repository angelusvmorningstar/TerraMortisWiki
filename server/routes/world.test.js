// server/routes/world.test.js — Story 2.2 (world-tab).
//
// A [PROJECTION] test file: office-holding is public knowledge (login-gated, no
// per-viewer split), but `getCharacters()` / `getTerritories()` still hand this
// route FULL, unredacted documents (every attribute/skill/discipline/merit/
// tracker value; every internal territory field). The buildWorldView assembly is
// the thing standing between those full documents and the wire — it MUST
// allowlist-construct every holder object, never spread a raw character or
// territory doc. These tests prove that, prove the retired-character sanity check
// (stale regent_id pointing at a retired character renders VACANT), and prove the
// String()-normalised regent/lieutenant join.
//
// Two boundaries are mocked, neither touches anything live (same seams Stories
// 1-2/1-3/2-1 use):
//   1. Discord's /users/@me — MOCKED via a swapped globalThis.fetch.
//   2. The Mongo collections (players/characters/territories) — a fake Db
//      injected via db.setTestDb. No file, no live tm_suite connection.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../index.js';
import { setTestDb } from '../db.js';
import { _resetTokenCache } from '../middleware/auth.js';
import { buildWorldView, summariseHolder, HOLDER_FIELDS } from './world.js';

const DISCORD_API = 'https://discord.com/api/v10';

// --- Fixtures ---------------------------------------------------------------
// Owner-only representative field set: if ANY of these appears in the response
// body, the projection has leaked a raw document (AC #9). NOTE: the illustrative
// honorific values here (Regent/Primogen/Bishop/Lord/Lady) are NON-authoritative
// test fixtures — the code never hardcodes them; it groups by whatever the data
// contains (AC #3). The real vocabulary is a live-Mongo verification step
// (Angelus/Peter's to run), documented in the story's Dev Notes.
const OWNER_ONLY_FIELDS = ['attributes', 'skills', 'disciplines', 'merits', 'xp_log', 'tracker_state'];

function sheet(extra) {
  // A representative full-sheet payload attached to every character fixture, so a
  // raw-document spread would visibly leak it into the response body.
  return {
    attributes: { intelligence: { dots: 3 } },
    skills: { politics: { dots: 4 } },
    disciplines: { dominate: 3 },
    merits: [{ name: 'Resources', dots: 4 }],
    xp_log: { spent: 42 },
    tracker_state: { vitae: 9, willpower: 6 },
    ...extra,
  };
}

// Active character — Regent of a territory AND a titled court figure.
const CHAR_A = sheet({ _id: 'charA', name: 'Ambrose', honorific: 'Regent', moniker: null, retired: false });
// Active character — a Primogen with a moniker, holds a regency in another territory.
const CHAR_B = sheet({ _id: 'charB', name: 'Béatrice', honorific: 'Primogen', moniker: 'Bea', retired: false });
// Active character — NO honorific (contributes to no title group), serves as a lieutenant.
const CHAR_C = sheet({ _id: 'charC', name: 'Cazimir', honorific: null, moniker: null, retired: false });
// Active character — shares the 'Regent' honorific with A (proves multi-holder grouping).
const CHAR_D = sheet({ _id: 'charD', name: 'Delphine', honorific: 'Regent', moniker: null, retired: false });
// RETIRED character — still named as a territory's regent (stale data) AND carries
// a court honorific. Must surface in NEITHER section (AC #5).
const CHAR_R = sheet({ _id: 'charR', name: 'Renfield', honorific: 'Bishop', moniker: null, retired: true });

const TEST_CHARACTERS = [CHAR_B, CHAR_A, CHAR_D, CHAR_C, CHAR_R]; // deliberately unsorted

// Territories exercise every join outcome:
//   T1 — both seats filled by active characters.
//   T2 — regent_id points at a RETIRED character (stale) → vacant; lieutenant_id null → vacant.
//   T3 — regent_id points at no existing character → vacant; lieutenant_id ABSENT → vacant.
//   T4 — name absent, only a slug label; regent filled, no lieutenant.
const TEST_TERRITORIES = [
  { _id: 't1', slug: 'the-rocks', name: 'The Rocks', regent_id: 'charA', lieutenant_id: 'charC', ambience: 'grim', feeding_rights: 'open' },
  { _id: 't2', slug: 'glebe', name: 'Glebe', regent_id: 'charR', lieutenant_id: null, ambience: 'quiet' },
  { _id: 't3', slug: 'newtown', name: 'Newtown', regent_id: 'ghost-id-000' },
  { _id: 't4', slug: 'darlinghurst', regent_id: 'charB', map_coords: [1, 2] },
];

const TEST_PLAYERS = [
  { discord_id: '111', role: 'player', character_ids: ['charA'], discord_username: 'ambrose_pc' },
];

function makeFakeDb({ players = [], characters = [], territories = [] } = {}) {
  const data = { players, characters, territories };
  return {
    collection(name) {
      const docs = data[name] ?? [];
      return {
        find() {
          return { toArray: async () => docs.map((d) => ({ ...d })) };
        },
      };
    },
  };
}

function installTestDb() {
  setTestDb(makeFakeDb({ players: TEST_PLAYERS, characters: TEST_CHARACTERS, territories: TEST_TERRITORIES }));
}

// --- Discord mock (mirrors server/routes/characters.test.js) ----------------

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

// Find the assembled row for a territory by its label.
function terr(view, label) {
  return view.territories.find((t) => t.territory === label);
}
function group(view, honorific) {
  return view.titleGroups.find((g) => g.honorific === honorific);
}

// ===========================================================================
// PURE FUNCTION UNIT TESTS (AC #8)
// ===========================================================================

test('AC #6/#8: summariseHolder builds a NEW object with ONLY the name allowlist + _id', () => {
  const h = summariseHolder(CHAR_B);
  assert.deepEqual(Object.keys(h).sort(), ['_id', 'honorific', 'moniker', 'name'].sort());
  for (const f of OWNER_ONLY_FIELDS) assert.ok(!(f in h), `holder must not contain ${f}`);
  assert.notEqual(h, CHAR_B); // distinct object, not the same reference
});

test('AC #6: HOLDER_FIELDS is exactly the three name fields', () => {
  assert.deepEqual([...HOLDER_FIELDS].sort(), ['honorific', 'moniker', 'name'].sort());
});

test('AC #2/#8: a territory resolves its regent and lieutenant to allowlisted holders', () => {
  const view = buildWorldView(TEST_TERRITORIES, TEST_CHARACTERS);
  const rocks = terr(view, 'The Rocks');
  assert.equal(rocks.regent._id, 'charA');
  assert.equal(rocks.regent.name, 'Ambrose');
  assert.equal(rocks.lieutenant._id, 'charC');
  // no internal territory field bled onto the row
  assert.ok(!('ambience' in rocks) && !('feeding_rights' in rocks) && !('slug' in rocks));
  // no owner-only field on either holder
  for (const f of OWNER_ONLY_FIELDS) {
    assert.ok(!(f in rocks.regent), `regent leaks ${f}`);
    assert.ok(!(f in rocks.lieutenant), `lieutenant leaks ${f}`);
  }
});

test('AC #2: a null, absent, or unmatched regent/lieutenant id renders an honest vacant seat', () => {
  const view = buildWorldView(TEST_TERRITORIES, TEST_CHARACTERS);
  // T2: lieutenant_id is null → vacant
  assert.equal(terr(view, 'Glebe').lieutenant, null);
  // T3: regent_id points at no existing character → vacant; lieutenant_id ABSENT → vacant
  const newtown = terr(view, 'Newtown');
  assert.equal(newtown.regent, null);
  assert.equal(newtown.lieutenant, null);
});

test('AC #2: a territory with no name falls back to its slug label', () => {
  const view = buildWorldView(TEST_TERRITORIES, TEST_CHARACTERS);
  // T4 has no name, only slug 'darlinghurst'
  const row = terr(view, 'darlinghurst');
  assert.ok(row, 'territory should be labelled by slug when name is absent');
  assert.equal(row.regent._id, 'charB');
});

test('AC #5: a stale regent_id pointing at a RETIRED character renders the seat VACANT', () => {
  const view = buildWorldView(TEST_TERRITORIES, TEST_CHARACTERS);
  // T2's regent_id is 'charR', who is retired: the seat is vacant, NOT Renfield.
  const glebe = terr(view, 'Glebe');
  assert.equal(glebe.regent, null, 'a retired character must never appear as a current regent');
  // and their name is nowhere in the assembled territory section
  const serialised = JSON.stringify(view.territories);
  assert.ok(!serialised.includes('Renfield'), 'retired character name leaked into territory section');
});

test('AC #3/#5: title groups derive from actual honorific values; retired + empty-honorific excluded', () => {
  const view = buildWorldView(TEST_TERRITORIES, TEST_CHARACTERS);
  const honorifics = view.titleGroups.map((g) => g.honorific).sort();
  // 'Regent' (A + D) and 'Primogen' (B) only. 'Bishop' belongs to retired Renfield → excluded.
  // Cazimir has no honorific → in no group.
  assert.deepEqual(honorifics, ['Primogen', 'Regent']);
  assert.ok(!view.titleGroups.some((g) => g.honorific === 'Bishop'), 'retired court honorific must not form a group');
  // the 'Regent' group holds both A and D, sorted by sortName (moniker || name)
  const regents = group(view, 'Regent').holders.map((h) => h._id);
  assert.deepEqual(regents, ['charA', 'charD']); // Ambrose before Delphine
  // Cazimir (no honorific) is in no group
  const allHolderIds = view.titleGroups.flatMap((g) => g.holders.map((h) => h._id));
  assert.ok(!allHolderIds.includes('charC'), 'a character with no honorific must not appear in any title group');
});

test('AC #3: an unanticipated honorific value still gets its own group (no hardcoded enum)', () => {
  const oddball = { _id: 'charX', name: 'Xavier', honorific: 'Nightwarden', retired: false };
  const view = buildWorldView([], [oddball]);
  assert.deepEqual(view.titleGroups.map((g) => g.honorific), ['Nightwarden']);
  assert.equal(view.titleGroups[0].holders[0]._id, 'charX');
});

test('AC #2/#5: the regent/lieutenant join is String()-normalised on BOTH sides', () => {
  // ObjectId-like _id vs string regent_id, and string _id vs ObjectId-like regent_id.
  const objIdChar = { _id: { toString: () => 'charObj' }, name: 'ObjRegent', retired: false };
  const strChar = { _id: 'charStr', name: 'StrLieut', retired: false };
  const territories = [
    { _id: 'tx', name: 'Mixed', regent_id: 'charObj', lieutenant_id: { toString: () => 'charStr' } },
  ];
  const view = buildWorldView(territories, [objIdChar, strChar]);
  const row = terr(view, 'Mixed');
  assert.equal(row.regent.name, 'ObjRegent', 'string regent_id must match an ObjectId-like _id');
  assert.equal(row.lieutenant.name, 'StrLieut', 'ObjectId-like lieutenant_id must match a string _id');
});

test('AC #8: buildWorldView tolerates empty/absent inputs without crashing', () => {
  assert.deepEqual(buildWorldView([], []), { territories: [], titleGroups: [] });
  assert.deepEqual(buildWorldView(undefined, undefined), { territories: [], titleGroups: [] });
});

// --- The discrimination proof (negative control) ---------------------------
// Mirrors characters.test.js's LEAK-GATE control: proves the projection
// assertions have teeth. A raw-document spread WOULD leak every owner-only field;
// the real allowlist projection leaks none.
test('PROJECTION (discrimination): a raw-document spread WOULD leak; the real projection does not', () => {
  const view = buildWorldView(TEST_TERRITORIES, TEST_CHARACTERS);
  const realBody = JSON.stringify(view);
  for (const f of OWNER_ONLY_FIELDS) {
    assert.ok(!realBody.includes(`"${f}"`), `real projection must not contain ${f}`);
  }
  // A spread of a holder WOULD have leaked them:
  const spreadHolder = JSON.stringify({ ...CHAR_A });
  for (const f of OWNER_ONLY_FIELDS) {
    assert.ok(spreadHolder.includes(`"${f}"`), `control: a raw spread leaks ${f}`);
  }
});

// ===========================================================================
// HTTP-LEVEL TESTS (AC #7, #9) — assert the serialised response BODY
// ===========================================================================

test('AC #7/#9 [PROJECTION]: the /api/world body carries NO owner-only field on any holder', async () => {
  installTestDb();
  await withServer(async (base) => {
    const { status, rawBody, body } = await getAs(base, '111', '/api/world');
    assert.equal(status, 200);
    for (const f of OWNER_ONLY_FIELDS) {
      assert.ok(!rawBody.includes(`"${f}"`), `LEAK: owner-only field ${f} present in world body`);
    }
    // concrete owner-only values absent too
    assert.ok(!rawBody.includes('"vitae"'), 'LEAK: tracker_state contents present');
    // and the shape is the assembled model
    assert.ok(Array.isArray(body.territories) && Array.isArray(body.titleGroups));
  });
});

test('AC #5/#9: a retired character named as a regent is NOT surfaced over HTTP', async () => {
  installTestDb();
  await withServer(async (base) => {
    const { rawBody, body } = await getAs(base, '111', '/api/world');
    assert.ok(!rawBody.includes('Renfield'), 'retired character surfaced over HTTP');
    const glebe = body.territories.find((t) => t.territory === 'Glebe');
    assert.equal(glebe.regent, null);
    assert.ok(!body.titleGroups.some((g) => g.honorific === 'Bishop'));
  });
});

test('AC #1/#7: /api/world is behind requireAuth — no bearer token gets 401', async () => {
  installTestDb();
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/world`);
    assert.equal(res.status, 401);
  });
});

test('AC #1: a store failure returns a modelled 503 STORE_ERROR, not a raw 500', async () => {
  // Players resolve (so auth passes) but the content collections throw, driving
  // the route's try/catch → modelled 503 rather than a raw Express 500.
  setTestDb({
    collection(name) {
      if (name === 'players') {
        return { find() { return { toArray: async () => TEST_PLAYERS.map((p) => ({ ...p })) }; } };
      }
      return { find() { throw new Error('mongo down'); } };
    },
  });
  await withServer(async (base) => {
    const { status, body } = await getAs(base, '111', '/api/world');
    assert.equal(status, 503);
    assert.equal(body.error, 'STORE_ERROR');
  });
});
