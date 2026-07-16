// scripts/snapshot.mjs — on-command Mongo → JSON snapshot generator (Story 1.2).
//
// Angelus runs this MANUALLY from the TM Suite dev environment at the close of a
// downtime cycle. It connects to `tm_suite` READ-ONLY, reads four collections,
// and writes a deterministic, diff-friendly `data/snapshot.json` into this repo.
// Angelus then commits and pushes; the deploy picks up the fresh snapshot. The
// deployed Wiki service NEVER holds a Mongo connection — this script is the only
// thing in the whole system that touches the database.
//
// READ-ONLY IS ENFORCED BY DISCIPLINE HERE + IAM IN ATLAS:
//   1. This script issues zero write calls (AC #3, verified lexically by the
//      snapshot.test.js "no write operations" test).
//   2. The Atlas database user this connects as SHOULD be provisioned with a
//      read-only role. That is a MANUAL Atlas-console setup step (see README) —
//      the client cannot enforce it. Belt (this file never writes) plus braces
//      (the credential lacks write privilege). See README "Read-only setup".
//
// This module is import-safe: importing it (as the tests do) runs no I/O. The
// live connection + file write happens only when the file is executed directly.

import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const OUTPUT_PATH = join(REPO_ROOT, 'data', 'snapshot.json');

// -- Pure, side-effect-free helpers (imported and exercised by the tests) -----

// Duck-type a Mongo ObjectId without importing bson: it exposes toHexString().
// Fixtures in tests can therefore stand in a plain string and still round-trip.
function isObjectIdLike(v) {
  return !!v && typeof v === 'object' && typeof v.toHexString === 'function';
}

// Recursively convert a Mongo document into a plain, JSON-stable value:
//   - ObjectId  -> its 24-char hex string
//   - Date      -> ISO-8601 string
//   - objects   -> keys sorted lexicographically (stable across runs)
//   - arrays    -> element-wise (array ORDER is preserved; caller sorts arrays)
// The deployed service can then parse the snapshot with plain JSON.parse and
// never needs the `mongodb` driver to interpret ObjectId/Date BSON types.
export function toPlain(value) {
  if (value === null || value === undefined) return value;
  if (isObjectIdLike(value)) return value.toHexString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toPlain);
  if (typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = toPlain(value[key]);
    }
    return out;
  }
  return value;
}

// Stable stringify: normalise (type-convert + sort keys deeply) then pretty-print
// with a trailing newline. Deterministic — identical input yields byte-identical
// output on every run (AC #2, AC #5).
export function serializeSnapshot(snapshot) {
  return JSON.stringify(toPlain(snapshot), null, 2) + '\n';
}

// Whitelist projection for players: ONLY these four auth-relevant fields ever
// enter the snapshot. Extracted as its own pure function (rather than inlined
// into the Mongo projection alone) so a fixture carrying extra PII fields can
// prove they get stripped, independent of a live database connection.
export function projectPlayer(doc) {
  const { discord_id, role, character_ids, discord_username } = doc;
  return { discord_id, role, character_ids, discord_username };
}

// Sort documents by a stringified key so re-runs order arrays identically
// regardless of Mongo's natural return order.
function sortByKey(docs, keyFn) {
  return [...docs].sort((a, b) => {
    const ka = String(keyFn(a) ?? '');
    const kb = String(keyFn(b) ?? '');
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

// Assemble the four raw collection arrays into the canonical, sorted snapshot
// object. Every document is normalised via toPlain, then each collection array
// is sorted by a stable key. `players` is keyed by discord_id because its _id is
// intentionally NOT projected into the snapshot (auth-field whitelist, AC #1).
export function buildSnapshot({ characters = [], character_dossier = [], players = [], territories = [] }) {
  return {
    characters: sortByKey(characters.map(toPlain), (d) => d._id),
    character_dossier: sortByKey(character_dossier.map(toPlain), (d) => d._id),
    players: sortByKey(players.map(toPlain), (d) => d.discord_id),
    territories: sortByKey(territories.map(toPlain), (d) => d._id),
  };
}

// -- Live read path (executed only when run directly) -------------------------

// Reads the four collections read-only. `players` is projected to the auth-field
// whitelist ONLY — no other player field ever enters the snapshot (AC #1).
// `characters`, `character_dossier`, `territories` are read in full: characters
// and dossiers carry the per-viewer projection data later stories filter, and
// territory docs are world/office data (regent_id/lieutenant_id + display
// fields) that the World tab needs — reading full docs avoids guessing field
// names (Story dev note). Per-viewer redaction happens in the Express layer at
// request time, not here; the snapshot is the raw source those views project.
async function readCollections(db) {
  const [characters, character_dossier, players, territories] = await Promise.all([
    db.collection('characters').find({}).toArray(),
    db.collection('character_dossier').find({}).toArray(),
    db
      .collection('players')
      .find({}, { projection: { _id: 0, discord_id: 1, role: 1, character_ids: 1, discord_username: 1 } })
      .toArray()
      .then((docs) => docs.map(projectPlayer)),
    db.collection('territories').find({}).toArray(),
  ]);
  return { characters, character_dossier, players, territories };
}

async function main() {
  dotenv.config({ path: resolve(REPO_ROOT, '.env') });

  const rawUri = process.env.MONGODB_URI;
  if (!rawUri) {
    console.error('MONGODB_URI is not set. Create a local .env (gitignored) with MONGODB_URI=... and retry.');
    process.exitCode = 1;
    return;
  }

  // Mirror TM Suite server/db.js: strip legacy `ssl=` query param (not accepted
  // by MongoDB driver v7 - installed version is 7.x here) and set tls:true with
  // a 5s server-selection timeout so a bad URI fails fast instead of hanging.
  // Splits on the query string rather than TM Suite's regex, which corrupts the
  // URI when `ssl` is the FIRST query param (its leading `?` gets consumed too).
  const uri = stripSslParam(rawUri);

  const started = Date.now();
  let client;
  try {
    // Client construction (URI parsing) happens INSIDE the try: a malformed URI
    // throws synchronously here, not before main()'s catch, so it's handled by
    // the same graceful failure path as every other error (and never echoes the
    // credentialed URI into an unhandled-rejection stack trace).
    client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000, tls: true });
    await client.connect();
    const db = client.db(process.env.MONGODB_DB || 'tm_suite');
    const raw = await readCollections(db);
    const snapshot = buildSnapshot(raw);

    await mkdir(dirname(OUTPUT_PATH), { recursive: true });
    await writeFile(OUTPUT_PATH, serializeSnapshot(snapshot), 'utf8');

    const secs = ((Date.now() - started) / 1000).toFixed(1);
    console.log(
      `Snapshot written to ${OUTPUT_PATH} in ${secs}s: ` +
        `characters:${snapshot.characters.length} ` +
        `dossiers:${snapshot.character_dossier.length} ` +
        `players:${snapshot.players.length} ` +
        `territories:${snapshot.territories.length}`
    );
  } catch (err) {
    console.error('Snapshot failed:', err.message);
    process.exitCode = 1;
  } finally {
    // Close on BOTH success and failure paths. A close-time error (e.g. a
    // network drop mid-close) must not itself become an unhandled rejection
    // and mask a successful write, or a real error, that already happened.
    try {
      await client?.close();
    } catch (closeErr) {
      console.error('Warning: error closing MongoDB connection:', closeErr.message);
    }
  }
}

// Splits a Mongo connection string's query string and drops any `ssl=` param,
// regardless of its position — unlike a `[&?]ssl=[^&]*` regex, this can't
// consume a leading `?` and corrupt the URI when `ssl` is the first param.
export function stripSslParam(uri) {
  const qIndex = uri.indexOf('?');
  if (qIndex === -1) return uri;
  const base = uri.slice(0, qIndex);
  const params = uri.slice(qIndex + 1).split('&').filter((p) => !/^ssl=/.test(p));
  return params.length ? `${base}?${params.join('&')}` : base;
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    // Should be unreachable — main() has its own try/catch — but guards
    // against any future refactor that adds an await outside the try block.
    console.error('Unhandled snapshot failure:', err.message);
    process.exitCode = 1;
  });
}
