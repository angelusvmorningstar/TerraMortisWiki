// Story 1.2 tests — validate the snapshot script's LOGIC against fixtures/mocks.
// NEVER hits a live `tm_suite` connection (Dev Note: no CI job touches prod
// Mongo). Covers AC #3 (no write operations) and AC #5 (determinism).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildSnapshot, serializeSnapshot, toPlain, projectPlayer, stripSslParam } from './snapshot.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = join(__dirname, 'snapshot.mjs');

// A fake ObjectId that satisfies the toHexString() duck-type used by toPlain.
function oid(hex) {
  return { toHexString: () => hex, toString: () => hex };
}

// Two logically-identical fixtures whose ARRAY order and OBJECT key order differ,
// to prove the serializer is order-insensitive.
function fixtureA() {
  return {
    characters: [
      { _id: oid('bbbbbbbbbbbbbbbbbbbbbbbb'), name: 'Béatrice', clan: 'Ventrue', retired: false },
      { _id: oid('aaaaaaaaaaaaaaaaaaaaaaaa'), name: 'Ambrose', clan: 'Nosferatu', retired: true },
    ],
    character_dossier: [
      {
        _id: oid('dddddddddddddddddddddddd'),
        character_id: oid('aaaaaaaaaaaaaaaaaaaaaaaa'),
        facts: [
          { tag: 'secret', value: 'owes a boon', st_hidden: true, revealed_to: ['aaaaaaaaaaaaaaaaaaaaaaaa'] },
          { tag: 'birthplace', value: 'Lyon', revealed_to: null },
        ],
      },
    ],
    players: [
      { discord_id: '222', role: 'player', character_ids: ['bbbbbbbbbbbbbbbbbbbbbbbb'], discord_username: 'zed' },
      { discord_id: '111', role: 'st', character_ids: [], discord_username: 'ang' },
    ],
    territories: [
      { _id: oid('ffffffffffffffffffffffff'), name: 'The Rocks', regent_id: 'aaaaaaaaaaaaaaaaaaaaaaaa', lieutenant_id: null },
    ],
  };
}

// Same data, arrays reversed and object keys reordered.
function fixtureB() {
  return {
    territories: [
      { lieutenant_id: null, regent_id: 'aaaaaaaaaaaaaaaaaaaaaaaa', name: 'The Rocks', _id: oid('ffffffffffffffffffffffff') },
    ],
    players: [
      { discord_username: 'ang', character_ids: [], role: 'st', discord_id: '111' },
      { discord_username: 'zed', character_ids: ['bbbbbbbbbbbbbbbbbbbbbbbb'], role: 'player', discord_id: '222' },
    ],
    character_dossier: [
      {
        character_id: oid('aaaaaaaaaaaaaaaaaaaaaaaa'),
        _id: oid('dddddddddddddddddddddddd'),
        facts: [
          { value: 'owes a boon', tag: 'secret', revealed_to: ['aaaaaaaaaaaaaaaaaaaaaaaa'], st_hidden: true },
          { revealed_to: null, value: 'Lyon', tag: 'birthplace' },
        ],
      },
    ],
    characters: [
      { clan: 'Nosferatu', _id: oid('aaaaaaaaaaaaaaaaaaaaaaaa'), retired: true, name: 'Ambrose' },
      { retired: false, clan: 'Ventrue', name: 'Béatrice', _id: oid('bbbbbbbbbbbbbbbbbbbbbbbb') },
    ],
  };
}

test('AC #5: re-running the transform on identical data is byte-identical', () => {
  const first = serializeSnapshot(buildSnapshot(fixtureA()));
  const second = serializeSnapshot(buildSnapshot(fixtureA()));
  assert.equal(first, second);
});

test('AC #5/#2: output is order-insensitive (shuffled arrays + keys serialize identically)', () => {
  const a = serializeSnapshot(buildSnapshot(fixtureA()));
  const b = serializeSnapshot(buildSnapshot(fixtureB()));
  assert.equal(a, b);
});

test('AC #2: arrays are sorted by stable key; ObjectId/Date become plain strings', () => {
  const snap = buildSnapshot(fixtureA());
  // characters sorted by _id string → Ambrose (aaa) before Béatrice (bbb)
  assert.deepEqual(snap.characters.map((c) => c.name), ['Ambrose', 'Béatrice']);
  // players sorted by discord_id (no _id present in the snapshot)
  assert.deepEqual(snap.players.map((p) => p.discord_id), ['111', '222']);
  // ObjectId converted to hex string
  assert.equal(snap.characters[0]._id, 'aaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(typeof snap.characters[0]._id, 'string');
});

test('AC #4: revealed_to on a fact passes through the snapshot untouched', () => {
  const snap = buildSnapshot(fixtureA());
  const facts = snap.character_dossier[0].facts;
  const secret = facts.find((f) => f.tag === 'secret');
  const birthplace = facts.find((f) => f.tag === 'birthplace');
  assert.deepEqual(secret.revealed_to, ['aaaaaaaaaaaaaaaaaaaaaaaa']);
  assert.equal(birthplace.revealed_to, null);
});

test('AC #1: players projection carries only the auth-field whitelist', () => {
  const snap = buildSnapshot(fixtureA());
  for (const p of snap.players) {
    assert.deepEqual(Object.keys(p).sort(), ['character_ids', 'discord_id', 'discord_username', 'role']);
    assert.ok(!('_id' in p), 'players must not carry _id or any non-whitelisted field');
  }
});

test('AC #1: projectPlayer strips PII the Mongo projection was NOT asked to exclude', () => {
  // This exercises the actual enforcement point (readCollections' whitelist),
  // not just fixtures that were already pre-filtered — the gap the review
  // flagged: without this test, widening the live projection to leak a field
  // like real_name/email would pass every other test in this file untouched.
  const dirty = {
    _id: oid('999999999999999999999999'),
    discord_id: '333',
    role: 'player',
    character_ids: [],
    discord_username: 'leaky',
    email: 'leaky@example.com',
    real_name: 'Should Never Appear',
    discord_avatar: 'abc123hash',
  };
  const clean = projectPlayer(dirty);
  assert.deepEqual(Object.keys(clean).sort(), ['character_ids', 'discord_id', 'discord_username', 'role']);
  assert.equal(clean.discord_id, '333');
  assert.ok(!('email' in clean) && !('real_name' in clean) && !('discord_avatar' in clean) && !('_id' in clean));
});

test('stripSslParam removes ssl= wherever it appears, including as the FIRST query param', () => {
  // A [&?]ssl=[^&]* regex (TM Suite's own server/db.js pattern) corrupts the
  // URI in exactly this case: it consumes the leading `?` along with `ssl=true`,
  // leaving no `?` at all before the remaining params.
  assert.equal(
    stripSslParam('mongodb://u:p@host/tm_suite?ssl=true&authSource=admin'),
    'mongodb://u:p@host/tm_suite?authSource=admin'
  );
  // ssl= in the middle/end still works.
  assert.equal(
    stripSslParam('mongodb://u:p@host/tm_suite?authSource=admin&ssl=true'),
    'mongodb://u:p@host/tm_suite?authSource=admin'
  );
  // ssl= as the ONLY param drops the `?` entirely.
  assert.equal(stripSslParam('mongodb://u:p@host/tm_suite?ssl=true'), 'mongodb://u:p@host/tm_suite');
  // No ssl= param, no query string at all: untouched.
  assert.equal(stripSslParam('mongodb://u:p@host/tm_suite'), 'mongodb://u:p@host/tm_suite');
  assert.equal(
    stripSslParam('mongodb://u:p@host/tm_suite?authSource=admin'),
    'mongodb://u:p@host/tm_suite?authSource=admin'
  );
});

test('Date values serialize to ISO strings', () => {
  const out = toPlain({ updated_at: new Date('2026-01-02T03:04:05.000Z') });
  assert.equal(out.updated_at, '2026-01-02T03:04:05.000Z');
});

test('AC #3: the script source contains NO Mongo write operations', async () => {
  const src = await readFile(SCRIPT_PATH, 'utf8');
  // Lexical guard: a dot-invocation of any write-capable driver method, PLUS
  // the write-shaped-as-a-read vectors a plain CRUD-method denylist misses —
  // aggregation pipelines can persist via $out/$merge, and db.command/
  // runCommand can issue an arbitrary write (e.g. {insert: ...}) that never
  // calls a method named "insert*". This is the single safety-critical test
  // in the repo (CLAUDE.md hard rule: never write to tm_suite) — err toward
  // over-matching, not under-matching.
  const writeCall =
    /\.\s*(insertOne|insertMany|updateOne|updateMany|replaceOne|deleteOne|deleteMany|bulkWrite|findOneAndUpdate|findOneAndReplace|findOneAndDelete|renameCollection|createCollection|createIndex|createIndexes|dropIndex|dropIndexes|drop|dropDatabase|findAndModify|initializeOrderedBulkOp|initializeUnorderedBulkOp|command|runCommand)\s*\(/;
  const match = src.match(writeCall);
  assert.equal(match, null, match ? `Found forbidden write call: ${match[0]}` : 'ok');

  // $out and $merge persist an aggregation's results to a collection — a write
  // dressed as a read. Neither belongs in this script under any circumstance.
  assert.ok(!/\$out\b/.test(src), 'aggregation $out stage found — persists results, forbidden');
  assert.ok(!/\$merge\b/.test(src), 'aggregation $merge stage found — persists results, forbidden');
});
