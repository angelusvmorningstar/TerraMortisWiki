// server/routes/world.js — Story 2.2 (world-tab).
//
// The office-holder view: who holds which territory regency/lieutenancy, and who
// carries which court title. Office-holding is PUBLIC knowledge (per specs/
// epics.md → Story 2-2), so — unlike server/routes/characters.js — there is NO
// per-viewer split here. The login gate (Story 1-3) is the only authorisation
// this page needs; the assembled view is identical for every logged-in viewer.
//
// [PROJECTION] discipline still applies (the lower-severity sibling of Story
// 2-1's LEAK-GATE): getCharacters() / getTerritories() return FULL, unredacted
// documents (every attribute/skill/discipline/merit/tracker value; every internal
// territory field). "Public" scopes WHICH offices appear, NOT WHICH fields. Every
// holder object below is built field-by-field from a named allowlist
// (summariseHolder) — NEVER a `{ ...character }` spread and NEVER a delete off a
// full doc — so a field added to the characters/territories schema upstream can
// never silently leak. Territory labels come from name/slug only. See the story's
// "Projection discipline (why a public page still allowlists)" Dev Notes.
//
// RETIRED sanity check (AC #5): territories.regent_id / lieutenant_id are NOT
// self-cleaning — a regent can retire without their old territory's id being
// nulled. So the join resolves against a NON-retired index only: "id matches only
// a retired character" is treated identically to "id matches no one" — both a
// vacant seat. A retired character with a court honorific likewise forms no group.
//
// READ-ONLY: this router issues ZERO Mongo writes — it only calls the read
// accessors in mongo-store.js.

import express from 'express';
import { getCharacters, getTerritories } from '../mongo-store.js';

// The office-holder display allowlist (AC #6): the three name fields that
// displayName/sortName need, plus `_id` (added alongside, to link each holder to
// their Story 2-1 profile page). NO attribute/skill/discipline/merit/XP/tracker/
// dossier field ever appears on a holder object.
export const HOLDER_FIELDS = Object.freeze(['name', 'honorific', 'moniker']);

// Build a NEW holder object containing ONLY the named allowlist fields present on
// the character, plus `_id`. Allowlist construction (AC #4/#6) — never a spread,
// never a delete. An absent field is simply omitted (honest gap), never fabricated.
export function summariseHolder(character) {
  const holder = { _id: character._id };
  for (const field of HOLDER_FIELDS) {
    if (character[field] !== undefined) holder[field] = character[field];
  }
  return holder;
}

// Case-insensitive sort key: moniker || name (the sortName convention, mirrored
// from server/routes/characters.js / ../TM Suite/public/js/data/helpers.js).
function sortNameKey(character) {
  return String(character.moniker || character.name || '').toLowerCase();
}

// The pure assembly (AC #8): given the territories and characters arrays, return
// the fully-assembled, allowlist-projected office-holder view model — retired
// characters already excluded, vacant seats already marked. The HTTP route is a
// thin wrapper that reads the two collections and calls this.
//
// Shape:
//   {
//     territories: [ { territory: <name|slug>, regent: <holder|null>, lieutenant: <holder|null> }, ... ],
//     titleGroups: [ { honorific: <value>, holders: [<holder>, ...] }, ... ],
//   }
export function buildWorldView(territories, characters) {
  const chars = Array.isArray(characters) ? characters : [];
  const terrs = Array.isArray(territories) ? territories : [];

  // Index of NON-retired characters by String(_id) — the join source. Retired
  // characters are excluded HERE, so neither section can surface them (AC #5).
  const byId = new Map();
  for (const c of chars) {
    if (c && c.retired !== true) byId.set(String(c._id), c);
  }

  // Resolve a stored regent_id / lieutenant_id (['string','null']) to a holder.
  // BOTH sides String()-normalised (mirroring findRegentTerritory in
  // ../TM Suite/public/js/data/helpers.js) so an ObjectId-vs-string shape can
  // neither miss a real holder nor surface a stale one. null/absent/unmatched →
  // null (an honest vacant seat, never a guessed name).
  const resolveHolder = (id) => {
    if (id === null || id === undefined) return null;
    const c = byId.get(String(id));
    return c ? summariseHolder(c) : null;
  };

  // Territory section: label from name || slug only (never a raw territory spread).
  const territorySection = terrs.map((t) => ({
    territory: t.name || t.slug || null,
    regent: resolveHolder(t.regent_id),
    lieutenant: resolveHolder(t.lieutenant_id),
  }));

  // Title section: group NON-retired characters that have a non-empty honorific
  // by that honorific value — derived from whatever the data contains, NEVER a
  // hardcoded enum (AC #3). A character with an empty/absent honorific joins no
  // group (honest gap, not an error).
  const groups = new Map();
  for (const c of chars) {
    if (!c || c.retired === true) continue;
    const honorific = c.honorific;
    if (honorific === null || honorific === undefined || honorific === '') continue;
    if (!groups.has(honorific)) groups.set(honorific, []);
    groups.get(honorific).push(summariseHolder(c));
  }
  const titleGroups = [...groups.entries()]
    .map(([honorific, holders]) => ({
      honorific,
      holders: holders.sort((a, b) => sortNameKey(a).localeCompare(sortNameKey(b))),
    }))
    .sort((a, b) => String(a.honorific).localeCompare(String(b.honorific)));

  return { territories: territorySection, titleGroups };
}

const router = express.Router();

// GET /api/world — the assembled office-holder view, read live from Mongo. No
// per-viewer logic (AC #7): the response is identical for every logged-in viewer.
// A store failure returns a modelled 503 (matching characters.js), never a raw 500.
router.get('/world', async (req, res) => {
  let territories;
  let characters;
  try {
    [territories, characters] = await Promise.all([getTerritories(), getCharacters()]);
  } catch {
    return res.status(503).json({ error: 'STORE_ERROR', message: 'World data temporarily unavailable' });
  }
  res.json(buildWorldView(territories, characters));
});

export default router;
