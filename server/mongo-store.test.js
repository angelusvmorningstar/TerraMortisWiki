// server/mongo-store.test.js — Story 1.2 (live Mongo read client).
//
// The automated suite NEVER touches the live `tm_suite` database. It mocks the
// `mongodb` driver boundary: a fake `Db` (a plain object exposing `.collection`)
// whose fake `Collection` returns canned documents from `.find().toArray()`,
// injected via db.js's `setTestDb` seam. This keeps the retired snapshot store's
// test-injection ergonomics (`setSnapshot`) without a real or in-memory Mongo.
//
// One live verification against the real connection string was run SEPARATELY,
// out-of-band (not in this committed suite) — see the story's completion notes.

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { setTestDb } from './db.js';
import {
  getCharacters,
  getDossiers,
  getTerritories,
  getPlayers,
  getPlayerByDiscordId,
  PLAYER_PROJECTION,
} from './mongo-store.js';
import { stripSslParam } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- No-writes lexical guard patterns (shared so a self-test can prove they
//     still MATCH a real write; see the guard self-test below) ----------------
//
// A dot-invocation of any write-capable driver method, PLUS the write-shaped-as-
// a-read vectors a plain CRUD denylist misses: aggregation pipelines persist via
// $out/$merge, and db.command/runCommand can issue an arbitrary write. This is
// the single safety-critical test class in the repo (CLAUDE.md hard rule: never
// write to tm_suite). Err toward over-matching.
const WRITE_CALL_RE =
  /\.\s*(insertOne|insertMany|updateOne|updateMany|replaceOne|deleteOne|deleteMany|bulkWrite|findOneAndUpdate|findOneAndReplace|findOneAndDelete|renameCollection|createCollection|createIndex|createIndexes|dropIndex|dropIndexes|drop|dropDatabase|findAndModify|initializeOrderedBulkOp|initializeUnorderedBulkOp|command|runCommand)\s*\(/;
const OUT_STAGE_RE = /\$out\b/;
const MERGE_STAGE_RE = /\$merge\b/;

// --- Fake mongodb driver boundary -------------------------------------------

// Apply a Mongo-style inclusion/exclusion projection to a plain doc, so the fake
// honours the whitelist exactly as the real server would (proving that fields
// outside PLAYER_PROJECTION never survive the query, belt-and-braces alongside
// the "find was called with the whitelist" assertion below).
function applyProjection(doc, projection) {
  if (!projection) return { ...doc };
  const includeKeys = Object.keys(projection).filter((k) => projection[k] === 1);
  const out = {};
  if (includeKeys.length) {
    for (const k of includeKeys) if (k in doc) out[k] = doc[k];
  } else {
    // Exclusion-only projection: copy everything except the 0-valued keys.
    for (const k of Object.keys(doc)) if (projection[k] !== 0) out[k] = doc[k];
  }
  // `_id: 0` explicitly drops it even in an inclusion projection.
  if (projection._id === 0) delete out._id;
  return out;
}

// data: { [collectionName]: doc[] }. `calls` records every find() invocation so
// tests can assert the exact projection the code asked Mongo for.
function makeFakeDb(data) {
  const calls = [];
  const db = {
    collection(name) {
      const docs = data[name] ?? [];
      return {
        find(query = {}, opts = {}) {
          calls.push({ name, query, opts });
          return {
            toArray: async () => docs.map((d) => applyProjection(d, opts.projection)),
          };
        },
      };
    },
  };
  return { db, calls };
}

const FIXTURE = {
  characters: [{ _id: 'c1', name: 'Ambrose' }, { _id: 'c2', name: 'Béatrice' }],
  character_dossier: [{ _id: 'd1', character_id: 'c1', facts: [] }],
  territories: [{ _id: 't1', name: 'The Rocks', regent_id: 'c1' }],
  players: [
    {
      _id: 'p1',
      discord_id: '111',
      role: 'player',
      character_ids: ['c1'],
      discord_username: 'solo',
      // fields that MUST be projected away — the PII boundary:
      email: 'solo@example.com',
      real_name: 'Should Never Appear',
      last_login: '2026-07-01',
    },
    {
      _id: 'p2',
      discord_id: '222',
      role: 'st',
      character_ids: ['c2', 'c3'],
      discord_username: 'dual',
    },
  ],
};

afterEach(() => setTestDb(null));

// --- AC #2: accessors query Mongo live and return the canned documents -------

test('AC #2: getCharacters/getDossiers/getTerritories return full docs', async () => {
  setTestDb(makeFakeDb(FIXTURE).db);
  assert.deepEqual((await getCharacters()).map((c) => c.name), ['Ambrose', 'Béatrice']);
  assert.equal((await getDossiers()).length, 1);
  assert.equal((await getTerritories())[0].name, 'The Rocks');
});

test('AC #2: getPlayers projects to the auth-field whitelist ONLY (no PII leaks)', async () => {
  const { db, calls } = makeFakeDb(FIXTURE);
  setTestDb(db);
  const players = await getPlayers();

  // The projection the code ASKED Mongo for is exactly the whitelist.
  const playerFind = calls.find((c) => c.name === 'players');
  assert.deepEqual(playerFind.opts.projection, {
    _id: 0, discord_id: 1, role: 1, character_ids: 1, discord_username: 1,
  });

  // And the returned docs carry ONLY those four fields — email/real_name/_id
  // etc. are stripped even though the fixture doc had them.
  for (const p of players) {
    assert.deepEqual(
      Object.keys(p).sort(),
      ['character_ids', 'discord_id', 'discord_username', 'role'],
    );
    assert.ok(!('email' in p) && !('real_name' in p) && !('last_login' in p) && !('_id' in p));
  }
});

// --- AC #3: getPlayerByDiscordId --------------------------------------------

test('AC #3: getPlayerByDiscordId resolves a known id (through the whitelist)', async () => {
  setTestDb(makeFakeDb(FIXTURE).db);
  const p = await getPlayerByDiscordId('222');
  assert.equal(p.discord_username, 'dual');
  assert.deepEqual(p.character_ids, ['c2', 'c3']);
  assert.ok(!('_id' in p)); // still whitelisted
});

test('AC #3/#2: getPlayerByDiscordId strips PII when resolving a doc that HAS PII', async () => {
  // p1 in the fixture carries email/real_name/last_login. Resolving it by id must
  // return ONLY the whitelisted auth fields — the resolve path (which most auth
  // requests take) is asserted directly here, not merely transitively via
  // getPlayers, so a future change that bypassed the whitelist on this path can't
  // slip a PII leak past the suite.
  setTestDb(makeFakeDb(FIXTURE).db);
  const p = await getPlayerByDiscordId('111');
  assert.deepEqual(
    Object.keys(p).sort(),
    ['character_ids', 'discord_id', 'discord_username', 'role'],
  );
  assert.ok(!('email' in p) && !('real_name' in p) && !('last_login' in p) && !('_id' in p));
});

test('AC #3: getPlayerByDiscordId string-normalises BOTH sides (numeric drift is tolerated)', async () => {
  // Simulate a future shape drift: discord_id stored as a NUMBER, caller passes a
  // string. A strict === would silently 403; String()-on-both matches correctly.
  const drifted = { ...FIXTURE, players: [{ discord_id: 111, role: 'player', character_ids: [], discord_username: 'num' }] };
  setTestDb(makeFakeDb(drifted).db);
  assert.equal((await getPlayerByDiscordId('111')).discord_username, 'num');
  assert.equal((await getPlayerByDiscordId(111)).discord_username, 'num');
});

test('AC #3: returns null for unknown / null / undefined — never throws', async () => {
  setTestDb(makeFakeDb(FIXTURE).db);
  assert.equal(await getPlayerByDiscordId('nope'), null);
  assert.equal(await getPlayerByDiscordId(null), null);
  assert.equal(await getPlayerByDiscordId(undefined), null);
});

// --- AC #4: NO write operations anywhere in db.js or mongo-store.js ----------

test('AC #4: db.js and mongo-store.js source contain NO Mongo write operations', async () => {
  for (const rel of ['db.js', 'mongo-store.js']) {
    const src = await readFile(join(__dirname, rel), 'utf8');
    const match = src.match(WRITE_CALL_RE);
    assert.equal(match, null, match ? `${rel}: forbidden write call ${match[0]}` : 'ok');
    assert.ok(!OUT_STAGE_RE.test(src), `${rel}: aggregation $out stage found — persists results, forbidden`);
    assert.ok(!MERGE_STAGE_RE.test(src), `${rel}: aggregation $merge stage found — persists results, forbidden`);
  }
});

// Negative control for the guard above. Without this, a future edit that
// accidentally breaks WRITE_CALL_RE (e.g. a stray character in the alternation)
// would make the AC #4 test silently pass on ANY source — a broken tripwire that
// still reports green. This proves the patterns actually FIRE on representative
// write calls, so the guard can't rot into a no-op undetected.
test('AC #4 (guard integrity): the no-writes patterns actually match real write vectors', () => {
  const mustMatch = [
    'coll.insertOne({})',
    'coll.updateMany({}, {})',
    'coll.deleteOne({})',
    'coll.bulkWrite([])',
    'db.command({})',
    'db.runCommand({})',
    'coll.initializeUnorderedBulkOp()',
    'coll .drop()',            // whitespace tolerance
  ];
  for (const s of mustMatch) {
    assert.ok(WRITE_CALL_RE.test(s), `WRITE_CALL_RE failed to match a write call: ${s}`);
  }
  // The aggregation-persistence stages must be caught too.
  assert.ok(OUT_STAGE_RE.test('{ $out: "leak" }'), '$out pattern must match');
  assert.ok(MERGE_STAGE_RE.test('{ $merge: "leak" }'), '$merge pattern must match');
  // And a pure read must NOT trip the guard (no false positive that would block
  // the legitimate .find()/.toArray() this module relies on).
  assert.equal(WRITE_CALL_RE.test('coll.find({}).toArray()'), false, 'read-only calls must not match');
});

// --- stripSslParam (carried forward; corrected split/filter/rejoin) ----------

test('stripSslParam removes ssl= wherever it appears, including as the FIRST query param', () => {
  assert.equal(
    stripSslParam('mongodb://u:p@host/tm_suite?ssl=true&authSource=admin'),
    'mongodb://u:p@host/tm_suite?authSource=admin',
  );
  assert.equal(
    stripSslParam('mongodb://u:p@host/tm_suite?authSource=admin&ssl=true'),
    'mongodb://u:p@host/tm_suite?authSource=admin',
  );
  assert.equal(stripSslParam('mongodb://u:p@host/tm_suite?ssl=true'), 'mongodb://u:p@host/tm_suite');
  // Case-insensitive: MongoDB option keys are case-insensitive and the driver
  // rejects the `ssl` option whatever its case, so a mixed-case SSL= must strip
  // too (else connectDb throws at boot). `sslmode`-style keys must NOT be caught.
  assert.equal(
    stripSslParam('mongodb://u:p@host/tm_suite?SSL=true&authSource=admin'),
    'mongodb://u:p@host/tm_suite?authSource=admin',
  );
  assert.equal(stripSslParam('mongodb://u:p@host/tm_suite'), 'mongodb://u:p@host/tm_suite');
  assert.equal(
    stripSslParam('mongodb://u:p@host/tm_suite?authSource=admin'),
    'mongodb://u:p@host/tm_suite?authSource=admin',
  );
});

// PLAYER_PROJECTION is frozen so a caller can't mutate the shared whitelist.
test('PLAYER_PROJECTION is the frozen auth whitelist', () => {
  assert.ok(Object.isFrozen(PLAYER_PROJECTION));
  assert.deepEqual(Object.keys(PLAYER_PROJECTION).sort(), [
    '_id', 'character_ids', 'discord_id', 'discord_username', 'role',
  ]);
});
