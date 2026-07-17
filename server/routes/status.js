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
import { getCharacters } from '../mongo-store.js';

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
export function buildStatusView(characters, viewer) {
  const chars = Array.isArray(characters) ? characters : [];
  const ownedSet = ownedIdSet(viewer);

  // The viewer's OWN characters - resolved by string-normalised set membership.
  // These MAY include retired characters (AC #14): a viewer whose only character
  // is retired still sees their own faction ladders. No length-1 special-casing.
  const owned = chars.filter((c) => c && ownedSet.has(String(c._id)));

  // Covenant list (AC #4, #8): UNION across all owned characters of their primary
  // `covenant` field PLUS every covenant key where they hold standing > 0.
  // Primary-first per character, de-duplicated, order-stable - extending TM
  // Suite's covenantListFor from one active char to the multi-character union.
  const covenantList = [];
  for (const oc of owned) {
    if (oc.covenant && !covenantList.includes(oc.covenant)) covenantList.push(oc.covenant);
    for (const [cov, v] of Object.entries(oc.status?.covenant || {})) {
      if ((v | 0) > 0 && !covenantList.includes(cov)) covenantList.push(cov);
    }
  }

  // Clan set (AC #5, #8): UNION across all owned characters of their non-empty
  // `clan` values, de-duplicated, order-stable.
  const clanList = [];
  for (const oc of owned) {
    if (oc.clan && !clanList.includes(oc.clan)) clanList.push(oc.clan);
  }

  // Ladder ROWS are built from NON-retired characters only (AC #14) - a retired
  // character is not current standing, so it appears in no ladder. This is
  // independent of the covenant/clan derivation above, which DID include the
  // viewer's own retired characters.
  const active = chars.filter((c) => c && c.retired !== true);

  // City ladder (AC #3, #10): every non-retired character, valued at the RAW
  // stored status.city (default 0) - deliberately NOT TM Suite's computed
  // calcCityStatus total (title + ambience bonuses), a documented simplification
  // to keep numeric-correctness risk off this access-control story. Ungated:
  // identical for every viewer regardless of covenant/clan/ownership.
  const cityRows = sortRows(active.map((c) => statusRow(c, c.status?.city || 0, ownedSet)));

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
  try {
    characters = await getCharacters();
  } catch {
    return res.status(503).json({ error: 'STORE_ERROR', message: 'Status data temporarily unavailable' });
  }
  res.json(buildStatusView(characters, req.user));
});

export default router;
