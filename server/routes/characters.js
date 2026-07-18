// server/routes/characters.js — Story 2.1 (character-dossier-views).
//
// THE SOLE AUTHORISATION BOUNDARY for character/dossier data. `mongo-store.js`
// deliberately returns full, unredacted documents from `getCharacters()` /
// `getDossiers()` (per-viewer redaction can't be a fixed Mongo projection — it
// depends on WHO is asking). That per-viewer decision lives HERE and nowhere
// else. There is no second line of defence: get this wrong and one player's
// private sheet, or another player's ST-only secrets, leak to every logged-in
// player. See the story's "Threat model" Dev Notes.
//
// Two independent secret channels, both gated below and both asserted by
// characters.test.js:
//   1. Owner-only character fields (attributes/skills/disciplines/merits/XP/
//      tracker) — gated by the ownership check (isOwner).
//   2. st_hidden dossier facts — gated by the revealed_to check
//      (filterFactsForViewer).
//
// ALLOWLIST, NOT DENYLIST: the summary tier is built field-by-field from a named
// whitelist (summariseCharacter). It never takes the full document and deletes
// known-secret keys — a delete-based approach silently leaks any field added to
// the characters schema upstream that nobody remembered to strip here, and the
// failure mode is a silent leak, not an error. An allowlist can only ever expose
// what someone named on purpose.
//
// READ-ONLY: this router issues ZERO Mongo writes — it only calls the read
// accessors in mongo-store.js.

import express from 'express';
import { getCharacters, getDossiers } from '../mongo-store.js';
import { isSuperViewer } from '../access.js';

// The seven summary-tier fields, fixed in specs/architecture.md → "Character
// dossier field whitelist". `_id` is always added alongside (needed to link to
// the profile); it is NOT one of these editorial fields.
//
// `bloodline` was REMOVED from this whitelist 2026-07-18 (Angelus's explicit
// call: bloodline is hidden information, not public like clan/covenant). It
// is now owner-only, same as attributes/skills/etc - simply not naming it
// here is the entire enforcement (allowlist, not denylist).
export const SUMMARY_FIELDS = Object.freeze([
  'name',
  'honorific',
  'moniker',
  'clan',
  'covenant',
  'apparent_age',
  'retired',
]);

// Ownership = set membership of this character's _id in the viewer's
// character_ids, string-normalised on BOTH sides (a viewer may own multiple
// characters; character_ids is always an array — never special-case length 1,
// per Story 1-3 AC #6 / architecture.md). A missing/empty character_ids is a
// non-owner (fails closed).
export function isOwner(character, viewer) {
  if (!character || !viewer) return false;
  const cid = String(character._id);
  const ids = Array.isArray(viewer.character_ids) ? viewer.character_ids : [];
  return ids.some((id) => String(id) === cid);
}

// Build a NEW object containing ONLY the named whitelist fields that are present
// on the character, plus `_id`. Allowlist construction (AC #4) — the leak-safety
// guarantee. An absent whitelist field is simply omitted (honest gap, AC #9),
// never fabricated.
export function summariseCharacter(character) {
  const summary = { _id: character._id };
  for (const field of SUMMARY_FIELDS) {
    if (character[field] !== undefined) summary[field] = character[field];
  }
  return summary;
}

// Summary-tier fact visibility (AC #5), enforced server-side:
//   - a fact with st_hidden !== true is always visible;
//   - a fact with st_hidden === true is visible ONLY if one of the viewer's own
//     character ids appears in the fact's revealed_to array;
//   - a missing/null revealed_to means "revealed to no one".
// String-normalised on both sides so an ObjectId-vs-string mismatch can't
// accidentally reveal (or accidentally hide) a fact.
export function filterFactsForViewer(facts, viewer) {
  if (!Array.isArray(facts)) return [];
  const viewerIds = Array.isArray(viewer?.character_ids) ? viewer.character_ids.map(String) : [];
  return facts.filter((fact) => {
    if (fact.st_hidden !== true) return true;
    const revealed = Array.isArray(fact.revealed_to) ? fact.revealed_to.map(String) : [];
    return viewerIds.some((vid) => revealed.includes(vid));
  });
}

// Join a character to its dossier facts by String()-normalised character_id.
// The dossier character_id may be stored as an ObjectId or a string (confirmed
// against ../TM Suite/server/schemas/character_dossier.schema.js: character_id is
// ['string','object']). A character with no dossier document yields an empty
// facts array — an honest gap, not an error.
export function factsForCharacter(dossiers, character) {
  if (!Array.isArray(dossiers)) return [];
  const cid = String(character._id);
  const dossier = dossiers.find((d) => String(d.character_id) === cid);
  return Array.isArray(dossier?.facts) ? dossier.facts : [];
}

// The pure projection (AC #8): given a character document, its facts, and a
// viewer, return the correctly-tiered object. The HTTP route is a thin wrapper.
//   - Owner tier: the full character document plus ALL of its facts, unfiltered
//     (including st_hidden ones — the owner sees all of their own).
//   - Summary tier: only the whitelist fields (allowlist-constructed) plus the
//     subset of facts allowed by filterFactsForViewer.
// `tier` is included so the frontend knows which shape it received (it is not a
// secret and does not widen either channel).
//
// The named-ST superviewer (Story 3.3, access.js) receives the OWNER tier for
// EVERY character — the same full-sight override applied on the owner path, so
// the frontend renders it through the existing owner shape with no new branch.
// The gate is fail-closed (role 'st' AND allowlisted id); every other viewer,
// including another ST, still runs the owner-vs-summary decision below.
export function projectCharacterForViewer(character, facts, viewer) {
  const ownFacts = Array.isArray(facts) ? facts : [];
  if (isSuperViewer(viewer) || isOwner(character, viewer)) {
    return { ...character, tier: 'owner', facts: ownFacts };
  }
  const summary = summariseCharacter(character);
  summary.tier = 'summary';
  summary.facts = filterFactsForViewer(ownFacts, viewer);
  return summary;
}

// Case-insensitive sort key: moniker || name (the sortName convention ported
// from ../TM Suite/public/js/data/helpers.js — pure logic only, no redaction).
function sortNameKey(character) {
  return String(character.moniker || character.name || '').toLowerCase();
}

const router = express.Router();

// GET /api/characters — the active roster, read live from Mongo (no hardcoded
// count). Retired characters are excluded (Angelus's call, 2026-07-17 —
// supersedes this story's original AC #9, which showed them muted rather than
// hidden). Each entry is built through the SAME allowlist path as the summary
// tier — NEVER a raw character-doc spread — so no owner-only field can appear
// on any entry for any viewer. Sorted by sortName.
router.get('/characters', async (req, res) => {
  let characters;
  try {
    characters = await getCharacters();
  } catch {
    return res.status(503).json({ error: 'STORE_ERROR', message: 'Character data temporarily unavailable' });
  }
  // Retired characters are hidden from the roster for normal viewers, but the
  // named-ST superviewer (Story 3.3) sees them too so every character is
  // reachable from the list. Entries stay summary-shaped either way (the full
  // dossier is fetched per-character on the profile route).
  const superviewer = isSuperViewer(req.user);
  const list = characters
    .filter((c) => superviewer || !c.retired)
    .map(summariseCharacter)
    .sort((a, b) => sortNameKey(a).localeCompare(sortNameKey(b)));
  res.json({ characters: list });
});

// GET /api/characters/:id — one character's profile, projected per the viewer
// (owner tier vs summary tier). 404 on an unknown id (never a crash, never an
// empty 200).
router.get('/characters/:id', async (req, res) => {
  let characters;
  let dossiers;
  try {
    [characters, dossiers] = await Promise.all([getCharacters(), getDossiers()]);
  } catch {
    return res.status(503).json({ error: 'STORE_ERROR', message: 'Character data temporarily unavailable' });
  }
  const target = String(req.params.id);
  const character = characters.find((c) => String(c._id) === target);
  if (!character) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Character not found' });
  }
  const facts = factsForCharacter(dossiers, character);
  res.json({ character: projectCharacterForViewer(character, facts, req.user) });
});

export default router;
