// server/snapshot-store.js — in-memory snapshot loader (Story 1.3).
//
// The deployed Wiki service holds NO Mongo connection (CLAUDE.md hard rule).
// Instead it reads the committed `data/snapshot.json` — produced on command by
// scripts/snapshot.mjs — ONCE at boot, keeps it in memory, and serves every
// view from it. This module is that single load-once cache plus a small set of
// accessors.
//
// Story 1.3 needs only `players` (for auth). Stories 2-1/2-2/2-3 will read
// `characters`, `character_dossier`, and `territories` from the same snapshot,
// so the accessors below are deliberately generic — not auth-specific — to
// avoid a second snapshot-loading mechanism later.
//
// Test seam: `setSnapshot(obj)` injects an in-memory snapshot with no file I/O,
// and (because `loadSnapshot()` is a no-op once a snapshot is present) a test
// that injects before `createApp()` boots is never clobbered by the boot load.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = join(__dirname, '..', 'data', 'snapshot.json');

let snapshot = null;

// Load the snapshot from disk once and cache it. Subsequent calls return the
// cached object unless `force` is set. Safe to call at every boot path (and in
// createApp) — if a snapshot is already loaded (or test-injected) it is a no-op.
export function loadSnapshot({ path = DEFAULT_PATH, force = false } = {}) {
  if (snapshot && !force) return snapshot;
  snapshot = JSON.parse(readFileSync(path, 'utf8'));
  return snapshot;
}

// Inject a snapshot object directly (tests only) — no file read.
export function setSnapshot(obj) {
  snapshot = obj;
  return snapshot;
}

// Return the loaded snapshot, lazily loading from the default path on first use.
export function getSnapshot() {
  return snapshot ?? loadSnapshot();
}

export function getPlayers() {
  return getSnapshot().players ?? [];
}

export function getCharacters() {
  return getSnapshot().characters ?? [];
}

export function getDossiers() {
  return getSnapshot().character_dossier ?? [];
}

export function getTerritories() {
  return getSnapshot().territories ?? [];
}

// Resolve a player by their Discord numeric id. The snapshot's `players` are
// keyed by `discord_id` (its Mongo `_id` is intentionally NOT projected into
// the snapshot — auth-field whitelist, Story 1.2). A player whose `discord_id`
// was never backfilled in TM Suite's own database is absent/unmatchable here —
// this app never writes back to Mongo, so it cannot self-heal that (see Story
// 1.3 dev notes). Returns null when nothing matches (never throws).
export function getPlayerByDiscordId(discordId) {
  if (discordId == null) return null;
  // String-normalise both sides: Discord IDs are snowflake strings and the
  // snapshot script writes discord_id as a string, but a strict === would
  // silently 403 every login (indistinguishable from "player not found") if a
  // future snapshot format ever emitted it as a number/Long. Cheap robustness
  // against snapshot-shape drift; no behaviour change for the current shape.
  const target = String(discordId);
  return getPlayers().find((p) => String(p.discord_id) === target) ?? null;
}
