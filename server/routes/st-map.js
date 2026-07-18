// server/routes/st-map.js - ST + resident-gated map locations.
// (incident follow-up 2026-07-18; resident carve-out added same day)
//
// THE THIRD ACCESS-CONTROL BOUNDARY in the repo (after characters.js's
// owner-vs-summary gate and status.js's covenant/clan gate). `st_map_locations`
// (populated by server/scripts/import-st-locations.mjs from the live
// `tm_suite.locations` collection) holds werewolf/mage/changeling/ghost
// territories, old covenant HQs, and every PC/NPC haven - real addresses,
// secret sites, family ties. NONE of it has a public analogue.
//
// TWO visibility rules, evaluated PER LOCATION (this is no longer a single
// all-or-nothing gate for the whole route):
//   1. A SUPERVIEWER (head ST on the access.js allowlist) sees EVERYTHING.
//      Plain role === 'st' is NOT enough: a co-ST whose character is in play
//      (e.g. Keeper) is deliberately gated as a player here, so map secrets stay
//      hidden from their character. Changed 2026-07-18, reversing the earlier
//      ST-wide call.
//   2. Any other authenticated viewer (INCLUDING a non-superviewer ST) sees ONLY
//      a haven where one of their OWNED characters is a resident, plus any
//      location whose revealed_to lists one of their characters - everything else
//      stays hidden regardless of ownership.
// A player who lives nowhere mapped gets a 200 with an empty array, not a
// 403 - the route itself is now legitimately reachable by any player, so a
// blanket "you don't get to know this exists" 403 no longer applies (that
// posture is still correct for the OLD st-only-everything shape; it just
// doesn't fit a route more than one class of viewer can get real data from).
//
// RESIDENT RESOLUTION: a haven's `resident_names` array holds each resident's
// canonical `characters.name` (verified against live data: matches exactly for
// all 16 havens). The sibling `residents` field is NOT used for matching - it
// holds moniker/nickname shorthand ("Cazz", "Etsy", "Yusuf") that does not
// reliably match anything, confirmed by hand-checking every haven with
// diverging residents/resident_names. Resolution is by EXACT name match only
// (no trim/case-fold, matching this repo's other name-matching call sites);
// if a name is ever renamed without updating resident_names, that resident
// silently loses access rather than granting it to the wrong person - fail
// closed, not fail open.
//
// ALLOWLIST, NOT DENYLIST: stMapRow builds a NEW object field-by-field for
// EVERY location, ST or resident. The imported documents carry TM-Suite-
// internal bookkeeping (source_location_id, boundary_locked, boundary_spec,
// updated_at, refined, source, build_script, locked_at, geocoded) that this
// route never exposes - there is no reason a map viewer needs them, and every
// field NOT named in LOCATION_FIELDS is a field that can never leak through
// this route by accident.
//
// READ-ONLY: this router issues ZERO Mongo writes - it only calls
// getStMapLocations() / getCharacters() from mongo-store.js.

import express from 'express';
import { getStMapLocations, getCharacters } from '../mongo-store.js';
import { isSuperViewer } from '../access.js';

// The location display allowlist. Covers BOTH document shapes seen in
// st_map_locations: zone/territory-style (layer/real_place/centroid/polygon/
// color/fill_alpha/stroke) and haven-style (address/lat/lon/dots/
// resident_names). A field absent on a given document is simply omitted
// (honest gap), never fabricated.
export const LOCATION_FIELDS = Object.freeze([
  'name', 'faction', 'type', 'layer', 'real_place', 'centroid', 'polygon', 'color', 'fill_alpha', 'stroke',
  'address', 'lat', 'lon', 'dots', 'resident_names',
]);

// Helper: true iff role is exactly 'st'. NOTE: this is no longer the map's
// full-view gate - the route now gates full sight on isSuperViewer (role 'st'
// AND the access.js id allowlist), so a co-ST playing a PC is player-gated here.
// Kept as an exported helper.
export function isSt(viewer) {
  return viewer?.role === 'st';
}

function stMapRow(location) {
  const row = { _id: location._id };
  for (const field of LOCATION_FIELDS) {
    if (location[field] !== undefined) row[field] = location[field];
  }
  return row;
}

// Set of the viewer's own character ids, string-normalised (mirrors
// characters.js's isOwner / status.js's ownedIdSet - never special-case
// length 1, character_ids is always an array).
function ownedIdSet(viewer) {
  const ids = Array.isArray(viewer?.character_ids) ? viewer.character_ids : [];
  return new Set(ids.map((id) => String(id)));
}

// True iff at least one of the haven's resident_names resolves (via EXACT
// characters.name match) to one of the viewer's owned character ids.
function isResidentOf(location, nameToId, ownedSet) {
  const names = Array.isArray(location.resident_names) ? location.resident_names : [];
  return names.some((n) => {
    const id = nameToId.get(n);
    return id !== undefined && ownedSet.has(id);
  });
}

// True iff the viewer owns a character explicitly listed in this location's `revealed_to`
// array - the ST hand-revealing a specific territory/site to specific characters. String-
// normalised. `revealed_to` is filter-only: it is NOT in LOCATION_FIELDS, so the id list
// never reaches the client, only the fact that the location is visible.
function isRevealedTo(location, ownedSet) {
  const ids = Array.isArray(location.revealed_to) ? location.revealed_to : [];
  return ids.some((id) => ownedSet.has(String(id)));
}

// The pure assembly: given the full st_map_locations array, the full
// characters array (needed only to resolve haven residents by name), and the
// viewer, return the per-location-filtered, allowlist-projected view. Mirrors
// buildStatusView / buildWorldView's pure-function-separate-from-route shape.
export function buildStMapView(locations, characters, viewer) {
  const locs = Array.isArray(locations) ? locations : [];
  const chars = Array.isArray(characters) ? characters : [];
  const st = isSuperViewer(viewer);

  const nameToId = new Map(chars.filter((c) => c && c.name).map((c) => [c.name, String(c._id)]));
  const ownedSet = ownedIdSet(viewer);

  const visible = locs.filter((loc) => {
    if (st) return true;
    if (loc.faction === 'haven' && isResidentOf(loc, nameToId, ownedSet)) return true;
    return isRevealedTo(loc, ownedSet);
  });

  return { locations: visible.map(stMapRow) };
}

const router = express.Router();

// GET /api/st-map/locations - read live from Mongo, filtered per-viewer in
// buildStMapView. Always 200 for an authenticated viewer (empty array is a
// legitimate, honest result for a player who lives nowhere mapped) - the
// route has no separate "is this viewer allowed to hit this endpoint at all"
// gate, because BOTH STs and ordinary players can legitimately get data here
// now. A store failure returns a modelled 503, matching every other route.
router.get('/st-map/locations', async (req, res) => {
  let locations;
  let characters;
  try {
    [locations, characters] = await Promise.all([getStMapLocations(), getCharacters()]);
  } catch {
    return res.status(503).json({ error: 'STORE_ERROR', message: 'Map data temporarily unavailable' });
  }
  const view = buildStMapView(locations, characters, req.user);
  res.json({ locations: view.locations });
});

export default router;
