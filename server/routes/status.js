// server/routes/status.js - Story 3.2 (covenant-clan-status-ladders).
//
// THE SECOND PER-VIEWER AUTHORISATION BOUNDARY in the repo (after
// server/routes/characters.js), and the FIRST route to read and return any
// character `status` field (`status.city` / `status.covenant` / `status.clan`).
// `mongo-store.js`'s getCharacters() hands this route FULL, unredacted documents:
// every `status.covenant` key for every covenant a character holds standing in,
// plus every attribute/skill/discipline/merit/tracker value. The gating this
// story adds lives HERE and nowhere else. Get it wrong and one faction's internal
// standing (who ranks where inside the Circle of the Crone, who inside the
// Invictus) leaks to every logged-in player, including rival factions who have no
// in-character way to know it. See the story's "Threat model" Dev Notes.
//
// THREE secret channels, not two (this is why summariseCharacter cannot be reused
// as-is), all gated below and all asserted by status.test.js:
//   1. Owner-only character fields (attributes/skills/disciplines/merits/XP/
//      tracker) - never appear on a ladder row; the row allowlist covers this.
//   2. WHICH covenant/clan ladders a viewer receives - gated by the covenant-list
//      / clan-set computation, BEFORE the wire (a ladder for a faction the viewer
//      does not belong to is never assembled).
//   3. The `status.covenant` MAP itself - a single character may hold standing in
//      several covenants; exposing the whole map inside a row would leak that
//      character's standing in covenants the viewer is not entitled to see. Each
//      row exposes ONE scalar (`value`), never the sub-document.
//
// ALLOWLIST, NOT DENYLIST: every row is built field-by-field from a named
// allowlist (statusRow). It never spreads the full document, never spreads
// `character.status`, and never deletes keys off a full doc - a denylist rots
// silently the moment a field is added to the characters schema upstream, and the
// failure mode is a silent leak, not an error.
//
// FAIL CLOSED: every ambiguous case resolves to LESS exposure - no owned
// character means no faction ladders (City still public); an owned character with
// no covenant means no covenant ladders; a covenant not in the viewer's computed
// list means its ladder is never assembled.
//
// READ-ONLY: this router issues ZERO Mongo writes - it only calls getCharacters()
// from mongo-store.js.

import express from 'express';
import { getCharacters, getTerritories } from '../mongo-store.js';
import { isSuperViewer } from '../access.js';

// City Status EFFECTIVE total (reversed 2026-07-18 — Angelus's explicit call,
// after the raw-value-only AC #10 simplification produced a visibly wrong
// ladder: several title-holders showed at their base value instead of the
// tier the rest of the app already puts them at). Ported verbatim from
// ../TM Suite/public/js/data/accessors.js's calcCityStatus/titleStatusBonus/
// regentAmienceBonus and ../TM Suite/public/js/data/constants.js's
// TITLE_STATUS_BONUS - verified against live data (Eve Lockridge 3+3=6
// "Honoured", Yusuf Kalusicj 3+2=5 "Admired", Brandy LaRoux 3+1=4 "Respected"
// all matched TM Suite's own rendered ladder exactly before this shipped).
// Covenant/Clan values have no such bonus math in TM Suite - raw
// status.covenant[cov] / status.clan is correct there and is unchanged.
const TITLE_STATUS_BONUS = Object.freeze({ 'Head of State': 3, Primogen: 2, Socialite: 1, Enforcer: 1, Administrator: 1 });
const REGENT_AMBIENCE_BONUS = Object.freeze({ Curated: 1, Verdant: 1, 'The Rack': 2 });

// A character's regent territory, if any - String()-normalised match on
// regent_id, mirroring world.js's resolveHolder join. Lieutenants
// intentionally receive no ambience bonus (TM Suite issue #13 Q-A,
// 2026-05-05 - regent-only by design).
function regentTerritoryFor(character, territories) {
  const cid = String(character._id);
  return territories.find((t) => t && String(t.regent_id) === cid) ?? null;
}

// (status.city || 0) + title bonus (by court_category) + regent ambience
// bonus (by the regent territory's ambience), clamped to 10 - matching TM
// Suite's system cap on City Status exactly.
function effectiveCityStatus(character, territories) {
  const base = character.status?.city || 0;
  const titleBonus = TITLE_STATUS_BONUS[character.court_category] || 0;
  const regentTerritory = regentTerritoryFor(character, territories);
  const ambienceBonus = REGENT_AMBIENCE_BONUS[regentTerritory?.ambience] || 0;
  return Math.min(base + titleBonus + ambienceBonus, 10);
}

// The row display allowlist: the three name fields displayName/sortName need,
// added alongside `_id`. NO attribute/skill/discipline/merit/XP/tracker field, and
// NO `status` sub-document, ever appears on a row (each row carries only the ONE
// scalar relevant to its ladder, in `value`). Allowlist construction, never a
// spread, never a delete.
export const ROW_NAME_FIELDS = Object.freeze(['name', 'honorific', 'moniker']);

// Ownership = set membership of a character's _id in the viewer's character_ids,
// string-normalised on BOTH sides (a viewer may own multiple characters;
// character_ids is always an array - never special-case length 1, per
// characters.js's isOwner / architecture.md). Returns a Set of owned id strings.
function ownedIdSet(viewer) {
  const ids = Array.isArray(viewer?.character_ids) ? viewer.character_ids : [];
  return new Set(ids.map((id) => String(id)));
}

// Case-insensitive sort key: moniker || name (the sortName convention, mirrored
// from characters.js / world.js / ../TM Suite/public/js/data/helpers.js). Works on
// either a full character or an already-built row (both carry name/moniker).
function sortNameKey(entry) {
  return String(entry.moniker || entry.name || '').toLowerCase();
}

// Build a NEW row object containing ONLY the named name fields present on the
// character, plus `_id`, the single per-ladder scalar `value`, and the per-row
// `mine` boolean. Allowlist construction (AC #7) - the leak-safety guarantee. An
// absent name field is simply omitted (honest gap), never fabricated. The whole
// `status` sub-document is deliberately NOT carried: only `value` crosses the wire.
function statusRow(character, value, ownedSet) {
  const row = { _id: character._id };
  for (const field of ROW_NAME_FIELDS) {
    if (character[field] !== undefined) row[field] = character[field];
  }
  row.value = value;
  row.mine = ownedSet.has(String(character._id));
  return row;
}

// Sort rows by value descending, then by sortName (moniker || name,
// case-insensitive) - the TM Suite covenantRowsFor / clanRowsFor ordering.
function sortRows(rows) {
  return rows.sort((a, b) => b.value - a.value || sortNameKey(a).localeCompare(sortNameKey(b)));
}

// The pure assembly (AC #2): given the full characters array and the viewer,
// return the fully-assembled, allowlist-projected, per-viewer-gated status view
// model, mirroring buildWorldView's pure-function shape. The HTTP route is a thin
// wrapper that reads getCharacters() and calls this with req.user.
//
// Shape:
//   {
//     city:     { rows: [<row>, ...] },                         // ungated, all non-retired
//     covenant: { ladders: [ { name: <cov>, rows: [<row>] } ] }, // one per viewer-owned covenant
//     clan:     { ladders: [ { name: <clan>, rows: [<row>] } ] }, // one per viewer-owned clan
//   }
// where <row> = { _id, name?, honorific?, moniker?, value, mine }.
export function buildStatusView(characters, territories, viewer) {
  const chars = Array.isArray(characters) ? characters : [];
  const terrs = Array.isArray(territories) ? territories : [];
  const ownedSet = ownedIdSet(viewer);

  // The viewer's OWN characters - resolved by string-normalised set membership.
  // These MAY include retired characters (AC #14): a viewer whose only character
  // is retired still sees their own faction ladders. No length-1 special-casing.
  const owned = chars.filter((c) => c && ownedSet.has(String(c._id)));

  // Ladder ROWS are built from NON-retired characters only (AC #14) - a retired
  // character is not current standing, so it appears in no ladder.
  const active = chars.filter((c) => c && c.retired !== true);

  // Which characters drive the covenant/clan LISTS (i.e. WHICH ladders a viewer
  // receives). Normally: the viewer's own characters (so they see only their own
  // factions). For the named-ST superviewer (Story 3.3, access.js), the source is
  // the WHOLE active roster, so they receive every covenant/clan ladder that has
  // a current member - full sight, matching TM Suite. Fail-closed: every other
  // viewer, including another ST, uses `owned`.
  const factionSource = isSuperViewer(viewer) ? active : owned;

  // Covenant list (AC #4, #8): UNION across the source characters of their primary
  // `covenant` field PLUS every covenant key where they hold standing > 0.
  // Primary-first per character, de-duplicated, order-stable - extending TM
  // Suite's covenantListFor from one active char to the multi-character union.
  const covenantList = [];
  for (const oc of factionSource) {
    if (oc.covenant && !covenantList.includes(oc.covenant)) covenantList.push(oc.covenant);
    for (const [cov, v] of Object.entries(oc.status?.covenant || {})) {
      if ((v | 0) > 0 && !covenantList.includes(cov)) covenantList.push(cov);
    }
  }

  // Clan set (AC #5, #8): UNION across the source characters of their non-empty
  // `clan` values, de-duplicated, order-stable.
  const clanList = [];
  for (const oc of factionSource) {
    if (oc.clan && !clanList.includes(oc.clan)) clanList.push(oc.clan);
  }

  // City ladder: every non-retired character, valued at the EFFECTIVE city
  // status (base + title bonus + regent ambience bonus, clamped to 10) -
  // matching TM Suite's own calcCityStatus exactly (see effectiveCityStatus
  // above). Ungated: identical for every viewer regardless of covenant/clan/
  // ownership.
  const cityRows = sortRows(active.map((c) => statusRow(c, effectiveCityStatus(c, terrs), ownedSet)));

  // Covenant ladders (AC #4, #6, #7): one per covenant in the viewer's list, and
  // NEVER a covenant outside it. Membership per covenantRowsFor: standing > 0 in
  // that covenant OR primary member of it (a primary at 0 standing still appears).
  // Each row exposes ONLY that covenant's scalar - never the status.covenant map.
  const covenantLadders = covenantList.map((cov) => {
    const rows = active
      .filter((c) => (c.status?.covenant?.[cov] || 0) > 0 || c.covenant === cov)
      .map((c) => statusRow(c, c.status?.covenant?.[cov] || 0, ownedSet));
    return { name: cov, rows: sortRows(rows) };
  });

  // Clan ladders (AC #5, #6, #7): one per clan in the viewer's set. Membership per
  // clanRowsFor: same clan as the viewer. Each row exposes ONLY status.clan.
  const clanLadders = clanList.map((clan) => {
    const rows = active
      .filter((c) => c.clan && c.clan === clan)
      .map((c) => statusRow(c, c.status?.clan || 0, ownedSet));
    return { name: clan, rows: sortRows(rows) };
  });

  // Fail-closed empty states (AC #9): a viewer who owns no character, or whose
  // character has no covenant/clan, gets EMPTY faction sections - never an error,
  // never "everything". City Status is still populated in full.
  return {
    city: { rows: cityRows },
    covenant: { ladders: covenantLadders },
    clan: { ladders: clanLadders },
  };
}

const router = express.Router();

// GET /api/status - the assembled, per-viewer-gated status view, read live from
// Mongo. The gating happens ENTIRELY server-side in buildStatusView, BEFORE the
// response leaves Express (AC #11): the server never sends a covenant/clan ladder
// the viewer is not entitled to and relies on the client to hide it. A store
// failure returns a modelled 503 (matching characters.js / world.js), never a raw 500.
router.get('/status', async (req, res) => {
  let characters;
  let territories;
  try {
    [characters, territories] = await Promise.all([getCharacters(), getTerritories()]);
  } catch {
    return res.status(503).json({ error: 'STORE_ERROR', message: 'Status data temporarily unavailable' });
  }
  res.json(buildStatusView(characters, territories, req.user));
});

export default router;
