// server/scripts/import-st-locations.mjs — one-off import, 2026-07-18.
//
// Copies the live `tm_suite.locations` collection (39 docs — the canonical
// source; the local ../TM Suite/server/scripts/_locations-local.json fixture
// has diverged and is NOT used here) into a new `st_map_locations` collection,
// EXCLUDING the handful already public on the wiki's World map (the 5 vampire
// territories + the Exclusion Zone — matching public/data/world-map.geojson).
// Everything else — werewolf zones, mage zones, changeling court, ghost sites,
// old covenant HQs, and every PC/NPC haven — is ST-sensitive (real addresses,
// secret locations, family ties) and has no public analogue. The new
// collection exists solely to be served through the new role-gated
// GET /api/st-map/locations route (server/routes/st-map.js), which only role
// 'st' can reach.
//
// Dry run by default.
//   node server/scripts/import-st-locations.mjs           (dry run)
//   node server/scripts/import-st-locations.mjs --write    (apply)

import { MongoClient } from 'mongodb';
import { config } from 'dotenv';
config();

const WRITE = process.argv.includes('--write');

// Matches the wiki's public World map exactly (public/data/world-map.geojson):
// the 5 vampire territories by name, plus the Exclusion Zone.
const PUBLIC_NAMES = new Set([
  'The Second City',
  'The Dockyards',
  'The Academy',
  'The North Shore',
  'The Harbour',
  'Exclusion Zone',
]);

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('tm_suite');

const all = await db.collection('locations').find({}).toArray();
const toImport = all.filter((l) => !PUBLIC_NAMES.has(l.name));

console.log(`${all.length} live locations, ${toImport.length} to import as ST-hidden (${all.length - toImport.length} already public, skipped).`);
const byFaction = {};
for (const l of toImport) byFaction[l.faction ?? 'null'] = (byFaction[l.faction ?? 'null'] ?? 0) + 1;
console.log('By faction:', byFaction);

if (!WRITE) {
  console.log('\nDry run only — no writes made. Re-run with --write to apply.');
  await client.close();
  process.exit(0);
}

console.log('\nApplying...');
const target = db.collection('st_map_locations');
await target.deleteMany({}); // idempotent re-import, not an incremental merge
const docs = toImport.map((l) => {
  const { _id, ...rest } = l;
  return { ...rest, source_location_id: String(_id) };
});
if (docs.length) await target.insertMany(docs);
console.log(`Inserted ${docs.length} documents into st_map_locations.`);
await client.close();
