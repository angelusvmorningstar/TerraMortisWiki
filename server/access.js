// server/access.js - the Storyteller superviewer carve-out (Story 3.3).
//
// A DELIBERATELY NARROW full-sight override. A single named Storyteller sees
// EVERYTHING the wiki holds - every character's full dossier (owner tier + all
// st_hidden facts) and every covenant/clan status ladder - matching the sight
// they already have in TM Suite. This is NOT "all Storytellers" and NOT "all
// elevated roles": it is role === 'st' AND a Discord id on the explicit allowlist
// below. BOTH conditions are required (fail-closed): a downgraded role, or any
// other id (including another genuine ST), gets the normal per-viewer gate.
//
// Consumed by the THREE per-viewer authorisation boundaries (routes/characters.js,
// routes/status.js, routes/st-map.js). st-map originally granted role === 'st'
// full sight (ST-wide), but was moved onto this narrower id gate on 2026-07-18 so
// a co-ST whose character is in play (e.g. Keeper) is map-gated as a player and
// map secrets stay hidden from their character. See specs/architecture.md ->
// "Storyteller superviewer carve-out".
//
// ALLOWLIST, NOT DENYLIST, and the SAME string-normalisation discipline the rest
// of the repo uses on ids: an ObjectId/string/number mismatch can neither
// accidentally grant nor accidentally deny.

export const SUPERVIEWER_DISCORD_IDS = Object.freeze([
  '694104767298797618', // Angelus (a_morningstar) - ST, chronicle owner
]);

const SUPERVIEWER_SET = new Set(SUPERVIEWER_DISCORD_IDS.map(String));

// True ONLY for a viewer that is BOTH role 'st' AND on the id allowlist. Any
// missing field, wrong role, or unlisted id fails closed to false, so callers can
// treat a false return as "apply the normal per-viewer gate".
export function isSuperViewer(viewer) {
  if (!viewer || viewer.role !== 'st') return false;
  return SUPERVIEWER_SET.has(String(viewer.id));
}
