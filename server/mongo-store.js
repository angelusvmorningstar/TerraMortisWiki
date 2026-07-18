// server/mongo-store.js — live, read-only accessors over `tm_suite` (Story 1.2).
//
// Replaces the retired `server/snapshot-store.js`. Same accessor NAMES the
// snapshot store exposed (`getCharacters`/`getDossiers`/`getTerritories`/
// `getPlayers`/`getPlayerByDiscordId`) so every consumer's call sites are
// unchanged — but they are now ASYNC and query Mongo live per request instead of
// reading an in-memory snapshot. A change in Mongo is visible on the next page
// load, everywhere (TM Suite, the Cockpit, and this Wiki read the same live
// collections). See specs/architecture.md → "Shape (revised — live reads)".
//
// READ-ONLY: this module issues ZERO write calls (AC #4, lexically verified in
// mongo-store.test.js). The only Mongo methods used are `.find()`/`.toArray()`.
//
// PLAYERS PII BOUNDARY (AC #2): `getPlayers`/`getPlayerByDiscordId` project to
// the auth-field whitelist ONLY — `discord_id`, `role`, `character_ids`,
// `discord_username`. Nothing else from the `players` collection (avatar,
// last_login, real names, etc.) ever leaves the query. The whitelist is enforced
// at the Mongo projection, not post-fetch, so a widened query can't silently
// leak a field.

import { getCollection } from './db.js';

// Auth-field whitelist projection for `players`. `_id: 0` drops the Mongo id
// (the snapshot deliberately omitted it too — discord_id is the stable player
// key the auth layer uses); the four `: 1` fields are the ONLY player data this
// app ever exposes.
export const PLAYER_PROJECTION = Object.freeze({
  _id: 0,
  discord_id: 1,
  role: 1,
  character_ids: 1,
  discord_username: 1,
});

export async function getCharacters() {
  return getCollection('characters').find({}).toArray();
}

export async function getDossiers() {
  return getCollection('character_dossier').find({}).toArray();
}

export async function getStMapLocations() {
  return getCollection('st_map_locations').find({}).toArray();
}

export async function getTerritories() {
  return getCollection('territories').find({}).toArray();
}

export async function getPlayers() {
  return getCollection('players')
    .find({}, { projection: PLAYER_PROJECTION })
    .toArray();
}

// Resolve a player by their Discord numeric id, against the whitelisted player
// projection. Reuses `getPlayers()` so the SAME projection whitelist applies
// (AC #2), then string-normalises BOTH sides of the comparison (AC #3, carried
// forward from the retired module's post-review fix): Discord ids are snowflake
// strings and `players.discord_id` is stored as a string, but a strict `===`
// would silently 403 every login — indistinguishable from "player not found" —
// if that shape ever drifted to a number/Long. Returns `null` for no match (and
// for a null/undefined argument); never throws on the comparison itself.
export async function getPlayerByDiscordId(discordId) {
  if (discordId == null) return null;
  const target = String(discordId);
  const players = await getPlayers();
  return players.find((p) => String(p.discord_id) === target) ?? null;
}
