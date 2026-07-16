// server/snapshot-store.test.js — Story 1.3 (the reusable snapshot loader).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  setSnapshot,
  getSnapshot,
  getPlayers,
  getCharacters,
  getTerritories,
  getDossiers,
  getPlayerByDiscordId,
} from './snapshot-store.js';

const SNAP = {
  characters: [{ _id: 'c1' }],
  character_dossier: [{ _id: 'd1' }],
  territories: [{ _id: 't1' }],
  players: [
    { discord_id: '111', role: 'player', character_ids: ['charA'], discord_username: 'solo' },
    { discord_id: '222', role: 'st', character_ids: ['charB', 'charC'], discord_username: 'dual' },
  ],
};

test('setSnapshot + accessors expose each collection', () => {
  setSnapshot(SNAP);
  assert.equal(getSnapshot(), SNAP);
  assert.deepEqual(getCharacters(), SNAP.characters);
  assert.deepEqual(getTerritories(), SNAP.territories);
  assert.deepEqual(getDossiers(), SNAP.character_dossier);
  assert.equal(getPlayers().length, 2);
});

test('getPlayerByDiscordId resolves a known id and returns null for unknown/null', () => {
  setSnapshot(SNAP);
  assert.equal(getPlayerByDiscordId('222').discord_username, 'dual');
  assert.equal(getPlayerByDiscordId('nope'), null);
  assert.equal(getPlayerByDiscordId(null), null);
  assert.equal(getPlayerByDiscordId(undefined), null);
});

test('accessors tolerate a snapshot missing a collection key', () => {
  setSnapshot({ players: [] });
  assert.deepEqual(getCharacters(), []);
  assert.deepEqual(getTerritories(), []);
  assert.deepEqual(getDossiers(), []);
  assert.deepEqual(getPlayers(), []);
});
