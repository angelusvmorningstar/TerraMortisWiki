// server/scripts/hide-untriaged-facts.mjs — incident remediation, 2026-07-17.
//
// Two players reported seeing full dossier history for characters they don't
// own. Root cause: filterFactsForViewer (characters.js) is correct, but 420 of
// 442 character_dossier facts across 15 of 30 characters were never triaged —
// st_hidden was never set, so they default to visible to every logged-in
// player. This script closes that gap the fail-closed way: every fact that
// isn't ALREADY st_hidden === true gets set to st_hidden: true. Nothing is
// deleted, no revealed_to arrays are touched — an ST can selectively re-reveal
// a fact later (revealed_to already exists as the mechanism for that; this
// script never populates it, so a freshly-hidden fact starts revealed to no
// one, matching filterFactsForViewer's existing "missing revealed_to = hidden
// from everyone" rule).
//
// Dry run by default — prints exactly what would change, writes nothing.
//   node server/scripts/hide-untriaged-facts.mjs           (dry run)
//   node server/scripts/hide-untriaged-facts.mjs --write    (apply)

import { MongoClient } from 'mongodb';
import { config } from 'dotenv';
config();

const WRITE = process.argv.includes('--write');

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('tm_suite');
const col = db.collection('character_dossier');

const dossiers = await col.find({}).toArray();

let totalFacts = 0;
let toHide = 0;
const perDossier = [];

for (const d of dossiers) {
  const facts = Array.isArray(d.facts) ? d.facts : [];
  totalFacts += facts.length;
  const hideCount = facts.filter((f) => f.st_hidden !== true).length;
  if (hideCount > 0) {
    toHide += hideCount;
    perDossier.push({ id: d._id, character_id: d.character_id, hideCount, of: facts.length });
  }
}

console.log(`${dossiers.length} dossier documents, ${totalFacts} total facts.`);
console.log(`${toHide} facts across ${perDossier.length} dossiers will be set to st_hidden: true.`);
for (const row of perDossier) {
  console.log(`  - character_id ${row.character_id}: ${row.hideCount}/${row.of} facts`);
}

if (!WRITE) {
  console.log('\nDry run only — no writes made. Re-run with --write to apply.');
  await client.close();
  process.exit(0);
}

console.log('\nApplying...');
let modified = 0;
for (const d of dossiers) {
  const facts = Array.isArray(d.facts) ? d.facts : [];
  let changed = false;
  const nextFacts = facts.map((f) => {
    if (f.st_hidden === true) return f;
    changed = true;
    return { ...f, st_hidden: true };
  });
  if (changed) {
    await col.updateOne({ _id: d._id }, { $set: { facts: nextFacts } });
    modified++;
  }
}
console.log(`Updated ${modified} dossier documents.`);
await client.close();
