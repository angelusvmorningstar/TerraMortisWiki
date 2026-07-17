// server/routes/characters.test.js — Story 2.1 (character-dossier-views).
//
// THE SECURITY-CRITICAL TEST FILE. This story adds the ONLY authorisation
// boundary for character/dossier data: `mongo-store.js` hands the route full,
// unredacted documents (every attribute/skill/discipline/merit/tracker value and
// every st_hidden fact) for every character. The projection this file exercises
// is the sole thing standing between a logged-in player and every other player's
// private data — in both directions (owner-only sheet fields, and st_hidden
// dossier secrets).
//
// Two boundaries are mocked, neither touches anything live (same seams Stories
// 1-2/1-3 use):
//   1. Discord's /users/@me — MOCKED via a swapped globalThis.fetch.
//   2. The Mongo collections (players/characters/character_dossier) — a fake Db
//      injected via db.setTestDb. No file, no live tm_suite connection.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../index.js';
import { setTestDb } from '../db.js';
import { _resetTokenCache } from '../middleware/auth.js';
import {
  projectCharacterForViewer,
  summariseCharacter,
  isOwner,
  filterFactsForViewer,
  factsForCharacter,
  SUMMARY_FIELDS,
} from './characters.js';

const DISCORD_API = 'https://discord.com/api/v10';

// --- Fixtures ---------------------------------------------------------------
// Owner-only representative field set (AC #7): if ANY of these appears in a
// cross-player response body, the gate has leaked.
const OWNER_ONLY_FIELDS = ['attributes', 'skills', 'disciplines', 'merits', 'xp_log', 'tracker_state'];

// Character A — owned by player 111.
const CHAR_A = {
  _id: 'charA',
  name: 'Ambrose',
  honorific: 'Lord',
  moniker: null,
  clan: 'Ventrue',
  covenant: 'Invictus',
  bloodline: null,
  apparent_age: '40s',
  retired: false,
  // owner-only sheet data
  attributes: { intelligence: { dots: 3 } },
  skills: { politics: { dots: 4 } },
  disciplines: { dominate: 3 },
  merits: [{ name: 'Resources', dots: 4 }],
  xp_log: { spent: 42 },
  tracker_state: { vitae: 9, willpower: 6 },
};

// Character B — owned by player 222. Carries st_hidden secrets used to prove
// the fact-visibility gate.
const B_PUBLIC_FACT = { tag: 'birthplace', value: 'Trondheim in 1710', source: 'history', st_hidden: false };
// Never revealed to anyone — must NEVER appear for any non-owner viewer.
const B_SECRET_HIDDEN = {
  tag: 'secret', value: 'Beatrice diablerised her own sire', source: 'st',
  st_hidden: true, revealed_to: null, severity: 'life_threatening', compromised: false,
};
// Revealed specifically to charA — appears for viewer 111 only.
const B_SECRET_TO_A = {
  tag: 'boon', value: 'Beatrice owes Ambrose a major blood boon', source: 'st',
  st_hidden: true, revealed_to: ['charA'], status: 'outstanding',
};
const CHAR_B = {
  _id: 'charB',
  name: 'Béatrice',
  honorific: null,
  moniker: 'Bea',
  clan: 'Mekhet',
  covenant: 'Circle of the Crone',
  bloodline: 'Norvegi',
  apparent_age: '20s',
  retired: false,
  attributes: { wits: { dots: 4 } },
  skills: { occult: { dots: 5 } },
  disciplines: { auspex: 2 },
  merits: [{ name: 'Haven', dots: 3 }],
  xp_log: { spent: 88 },
  tracker_state: { vitae: 11, willpower: 7 },
};

// Character C — owned by player 333, retired (exercises the retired treatment).
const CHAR_C = {
  _id: 'charC',
  name: 'Cazimir',
  honorific: null,
  moniker: null,
  clan: 'Gangrel',
  covenant: 'Carthian Movement',
  bloodline: null,
  apparent_age: '30s',
  retired: true,
  attributes: { strength: { dots: 3 } },
  skills: { brawl: { dots: 3 } },
  disciplines: { protean: 2 },
  merits: [],
  xp_log: { spent: 20 },
  tracker_state: { vitae: 5, willpower: 4 },
};

const A_PUBLIC_FACT = { tag: 'birthplace', value: 'London in 1650', source: 'history', st_hidden: false };
const A_OWN_SECRET = { tag: 'secret', value: 'Ambrose is a secret Ordo Dracul agent', source: 'st', st_hidden: true, revealed_to: null };

const TEST_PLAYERS = [
  { discord_id: '111', role: 'player', character_ids: ['charA'], discord_username: 'ambrose_pc' },
  { discord_id: '222', role: 'player', character_ids: ['charB'], discord_username: 'bea_pc' },
  { discord_id: '333', role: 'player', character_ids: ['charC'], discord_username: 'caz_pc' },
];
const TEST_CHARACTERS = [CHAR_B, CHAR_A, CHAR_C]; // deliberately unsorted
const TEST_DOSSIERS = [
  { character_id: 'charB', facts: [B_PUBLIC_FACT, B_SECRET_HIDDEN, B_SECRET_TO_A] },
  { character_id: 'charA', facts: [A_PUBLIC_FACT, A_OWN_SECRET] },
];

function makeFakeDb({ players = [], characters = [], character_dossier = [] } = {}) {
  const data = { players, characters, character_dossier };
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
  setTestDb(makeFakeDb({ players: TEST_PLAYERS, characters: TEST_CHARACTERS, character_dossier: TEST_DOSSIERS }));
}

// --- Discord mock (mirrors server/auth.test.js) -----------------------------

function fakeRes(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

// Route /users/@me to a fixed profile id so a given bearer token resolves to a
// known player. The test client's own requests to the local server pass through.
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

// Perform an authed GET as the player behind `discordId`.
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
// PURE FUNCTION UNIT TESTS (AC #8)
// ===========================================================================

test('AC #4/#8: summariseCharacter builds a NEW object with ONLY the whitelist + _id', () => {
  const s = summariseCharacter(CHAR_B);
  // exactly the whitelist fields that are present, plus _id
  assert.deepEqual(
    Object.keys(s).sort(),
    ['_id', 'apparent_age', 'bloodline', 'clan', 'covenant', 'honorific', 'moniker', 'name', 'retired'].sort(),
  );
  // and NONE of the owner-only fields survived
  for (const f of OWNER_ONLY_FIELDS) assert.ok(!(f in s), `summary must not contain ${f}`);
  // it is a distinct object, not the same reference
  assert.notEqual(s, CHAR_B);
});

test('AC #4: SUMMARY_FIELDS is exactly the eight architecture-fixed fields', () => {
  assert.deepEqual(
    [...SUMMARY_FIELDS].sort(),
    ['apparent_age', 'bloodline', 'clan', 'covenant', 'honorific', 'moniker', 'name', 'retired'].sort(),
  );
});

test('AC #4: an absent whitelist field is omitted, never fabricated', () => {
  const thin = { _id: 'x', name: 'Thin', clan: 'Nosferatu' }; // no honorific/bloodline/etc.
  const s = summariseCharacter(thin);
  assert.deepEqual(Object.keys(s).sort(), ['_id', 'clan', 'name']);
  assert.ok(!('bloodline' in s) && !('honorific' in s));
});

test('AC #3/#8: isOwner is set membership over string-normalised ids (multi-character, no length-1 assumption)', () => {
  assert.equal(isOwner(CHAR_A, { character_ids: ['charA'] }), true);
  assert.equal(isOwner(CHAR_A, { character_ids: ['charB', 'charA'] }), true); // multi-char owner
  assert.equal(isOwner(CHAR_A, { character_ids: ['charB'] }), false);
  assert.equal(isOwner(CHAR_A, { character_ids: [] }), false);
  assert.equal(isOwner(CHAR_A, {}), false);
  // string-normalised on both sides
  assert.equal(isOwner({ _id: 42 }, { character_ids: ['42'] }), true);
  assert.equal(isOwner({ _id: 'charA' }, { character_ids: [{ toString: () => 'charA' }] }), true);
});

test('AC #5/#8: filterFactsForViewer hides st_hidden by default, shows when viewer in revealed_to', () => {
  const facts = [B_PUBLIC_FACT, B_SECRET_HIDDEN, B_SECRET_TO_A];
  // viewer A (charA) — sees public + the fact revealed to charA, NOT the never-revealed secret
  const forA = filterFactsForViewer(facts, { character_ids: ['charA'] });
  assert.deepEqual(forA.map((f) => f.value), [B_PUBLIC_FACT.value, B_SECRET_TO_A.value]);
  // viewer C (charC) — sees ONLY the public fact
  const forC = filterFactsForViewer(facts, { character_ids: ['charC'] });
  assert.deepEqual(forC.map((f) => f.value), [B_PUBLIC_FACT.value]);
  // missing/null revealed_to counts as "revealed to no one"
  assert.equal(forC.some((f) => f.value === B_SECRET_HIDDEN.value), false);
});

test('AC #5: factsForCharacter joins by String()-normalised character_id (ObjectId or string)', () => {
  const dossiers = [
    { character_id: { toString: () => 'charB' }, facts: [B_PUBLIC_FACT] }, // simulates an ObjectId
    { character_id: 'charA', facts: [A_PUBLIC_FACT] },
  ];
  assert.deepEqual(factsForCharacter(dossiers, { _id: 'charB' }).map((f) => f.value), [B_PUBLIC_FACT.value]);
  assert.deepEqual(factsForCharacter(dossiers, { _id: 'charA' }).map((f) => f.value), [A_PUBLIC_FACT.value]);
  // no dossier => empty facts, honest gap (not an error)
  assert.deepEqual(factsForCharacter(dossiers, { _id: 'charZ' }), []);
});

test('AC #3/#8: projectCharacterForViewer — owner tier returns full doc + ALL facts (incl st_hidden)', () => {
  const facts = [A_PUBLIC_FACT, A_OWN_SECRET];
  const out = projectCharacterForViewer(CHAR_A, facts, { character_ids: ['charA'] });
  // full sheet present
  for (const f of OWNER_ONLY_FIELDS) assert.ok(f in out, `owner tier must include ${f}`);
  assert.equal(out.tracker_state.vitae, 9);
  // all facts, including the st_hidden own-secret
  assert.deepEqual(out.facts.map((f) => f.value), [A_PUBLIC_FACT.value, A_OWN_SECRET.value]);
});

test('AC #3/#4/#8: projectCharacterForViewer — summary tier strips owner-only fields and filters facts', () => {
  const facts = [B_PUBLIC_FACT, B_SECRET_HIDDEN, B_SECRET_TO_A];
  const out = projectCharacterForViewer(CHAR_B, facts, { character_ids: ['charC'] });
  for (const f of OWNER_ONLY_FIELDS) assert.ok(!(f in out), `summary tier must NOT include ${f}`);
  assert.equal(out.name, 'Béatrice');
  assert.deepEqual(out.facts.map((f) => f.value), [B_PUBLIC_FACT.value]); // only the public fact for C
});

// --- The discrimination proof (negative control) ---------------------------
// Mirrors mongo-store.test.js's "guard integrity" negative control: proves the
// leak assertions have teeth by showing a NAIVE PASSTHROUGH would trip every one
// of them, while the real projection does not. If someone regressed
// projectCharacterForViewer to `(c, facts) => ({ ...c, facts })`, THIS is what
// the HTTP leak tests below would catch.
test('LEAK-GATE (discrimination): a naive passthrough WOULD leak; the real projection does not', () => {
  const facts = [B_PUBLIC_FACT, B_SECRET_HIDDEN, B_SECRET_TO_A];

  // What a passthrough would serialise for a cross-player (viewer C) request:
  const passthroughBody = JSON.stringify({ ...CHAR_B, facts });
  // Every leak assertion the HTTP tests make WOULD FIRE against this:
  for (const f of OWNER_ONLY_FIELDS) {
    assert.ok(passthroughBody.includes(`"${f}"`), `passthrough leaks owner-only field ${f}`);
  }
  assert.ok(passthroughBody.includes(B_SECRET_HIDDEN.value), 'passthrough leaks the never-revealed secret');

  // The real projection for viewer C leaks NONE of them:
  const realBody = JSON.stringify(projectCharacterForViewer(CHAR_B, facts, { character_ids: ['charC'] }));
  for (const f of OWNER_ONLY_FIELDS) {
    assert.ok(!realBody.includes(`"${f}"`), `real projection must not contain ${f}`);
  }
  assert.ok(!realBody.includes(B_SECRET_HIDDEN.value), 'real projection must not leak the never-revealed secret');
});

// ===========================================================================
// HTTP-LEVEL TESTS (AC #7) — assert the serialised response BODY, not any render
// ===========================================================================

test('AC #7(a): owner requesting their OWN character gets the full document + all facts', async () => {
  installTestDb();
  await withServer(async (base) => {
    const { status, body, rawBody } = await getAs(base, '111', '/api/characters/charA');
    assert.equal(status, 200);
    const c = body.character;
    for (const f of OWNER_ONLY_FIELDS) assert.ok(f in c, `owner must see ${f}`);
    assert.equal(c.tracker_state.vitae, 9);
    // all facts including the owner's own st_hidden secret
    assert.ok(rawBody.includes(A_OWN_SECRET.value), 'owner must see their own st_hidden fact');
    assert.deepEqual(c.facts.map((f) => f.value), [A_PUBLIC_FACT.value, A_OWN_SECRET.value]);
  });
});

test('AC #7 [LEAK-GATE]: cross-player profile leaks NO owner-only field and NO st_hidden fact', async () => {
  installTestDb();
  await withServer(async (base) => {
    // viewer C (333/charC) requests B's profile — C is in NO revealed_to on B.
    const { status, rawBody, body } = await getAs(base, '333', '/api/characters/charB');
    assert.equal(status, 200);

    // (1) owner-only channel: none of the representative sheet fields in the raw body
    for (const f of OWNER_ONLY_FIELDS) {
      assert.ok(!rawBody.includes(`"${f}"`), `LEAK: owner-only field ${f} present in cross-player body`);
    }
    // concrete owner-only VALUES must be absent too (belt-and-braces on the serialised body)
    assert.ok(!rawBody.includes('"vitae"'), 'LEAK: tracker_state contents present');

    // (2) st_hidden channel: neither of B's secrets appears for a viewer with no reveal
    assert.ok(!rawBody.includes(B_SECRET_HIDDEN.value), 'LEAK: never-revealed secret present');
    assert.ok(!rawBody.includes(B_SECRET_TO_A.value), 'LEAK: A-only secret present for viewer C');

    // and the summary tier IS what came back (public fact only)
    assert.deepEqual(body.character.facts.map((f) => f.value), [B_PUBLIC_FACT.value]);
    assert.equal(body.character.name, 'Béatrice');
  });
});

test('AC #7(b) [LEAK-GATE]: an st_hidden fact revealed_to charA IS present for viewer A, ABSENT for viewer C', async () => {
  installTestDb();
  await withServer(async (base) => {
    // viewer A (111/charA) IS in B_SECRET_TO_A.revealed_to
    const asA = await getAs(base, '111', '/api/characters/charB');
    assert.equal(asA.status, 200);
    assert.ok(asA.rawBody.includes(B_SECRET_TO_A.value), 'revealed fact must be present for the revealed viewer');
    // but even the revealed viewer must NOT see the never-revealed secret or owner-only fields
    assert.ok(!asA.rawBody.includes(B_SECRET_HIDDEN.value), 'LEAK: never-revealed secret present for viewer A');
    for (const f of OWNER_ONLY_FIELDS) {
      assert.ok(!asA.rawBody.includes(`"${f}"`), `LEAK: owner-only field ${f} present for non-owner viewer A`);
    }
    assert.deepEqual(asA.body.character.facts.map((f) => f.value), [B_PUBLIC_FACT.value, B_SECRET_TO_A.value]);

    // viewer C (333/charC) is NOT in revealed_to — the same fact must be absent
    const asC = await getAs(base, '333', '/api/characters/charB');
    assert.ok(!asC.rawBody.includes(B_SECRET_TO_A.value), 'revealed fact must be ABSENT for a viewer not in revealed_to');
  });
});

test('AC #2/#7(c) [LEAK-GATE]: the list endpoint leaks no owner-only field for any character', async () => {
  installTestDb();
  await withServer(async (base) => {
    const { status, rawBody, body } = await getAs(base, '111', '/api/characters');
    assert.equal(status, 200);
    // roster size comes from Mongo (minus retired), not a literal
    assert.equal(body.characters.length, TEST_CHARACTERS.filter((c) => !c.retired).length);
    // no owner-only field anywhere in the serialised list
    for (const f of OWNER_ONLY_FIELDS) {
      assert.ok(!rawBody.includes(`"${f}"`), `LEAK: list entry exposes owner-only field ${f}`);
    }
    // every entry carries only summary + _id keys
    for (const entry of body.characters) {
      const allowed = new Set(['_id', ...SUMMARY_FIELDS]);
      for (const k of Object.keys(entry)) assert.ok(allowed.has(k), `list entry has unexpected field ${k}`);
    }
  });
});

test('retired characters are excluded from the roster list (charC is retired)', async () => {
  installTestDb();
  await withServer(async (base) => {
    const { body } = await getAs(base, '111', '/api/characters');
    assert.ok(!body.characters.some((c) => c._id === 'charC'), 'retired character charC must not appear in the list');
  });
});

test('AC #2: the list is sorted by sortName (moniker || name), case-insensitive', async () => {
  installTestDb();
  await withServer(async (base) => {
    const { body } = await getAs(base, '111', '/api/characters');
    // Ambrose (A, moniker null -> "ambrose"), Bea (B moniker "Bea" -> "bea")
    // Cazimir (C) is retired and excluded from the list entirely.
    assert.deepEqual(body.characters.map((c) => c._id), ['charA', 'charB']);
  });
});

test('AC #3: a request for a non-existent id returns a clear 404 (not a crash, not an empty 200)', async () => {
  installTestDb();
  await withServer(async (base) => {
    const { status, body } = await getAs(base, '111', '/api/characters/does-not-exist');
    assert.equal(status, 404);
    assert.equal(body.error, 'NOT_FOUND');
  });
});

test('AC #1: the content routes are behind requireAuth — no bearer token gets 401', async () => {
  installTestDb();
  await withServer(async (base) => {
    const listRes = await fetch(`${base}/api/characters`);
    assert.equal(listRes.status, 401);
    const oneRes = await fetch(`${base}/api/characters/charA`);
    assert.equal(oneRes.status, 401);
  });
});
