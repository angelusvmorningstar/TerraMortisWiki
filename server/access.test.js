// server/access.test.js - Story 3.3 (st-superviewer-access).
//
// Unit tests for the superviewer gate. This gate widens two security boundaries
// (characters.js, status.js), so its exact truth table matters: it must be true
// for the ONE named ST and fail closed for everyone else, including another
// genuine ST and the named id at a non-st role.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSuperViewer, SUPERVIEWER_DISCORD_IDS } from './access.js';

const ANGELUS = '694104767298797618'; // the one allowlisted id (see access.js)

test('AC #1: the allowlist is frozen and contains the named ST id', () => {
  assert.ok(Object.isFrozen(SUPERVIEWER_DISCORD_IDS));
  assert.ok(SUPERVIEWER_DISCORD_IDS.includes(ANGELUS));
});

test('AC #1: true ONLY for role st AND an allowlisted id', () => {
  assert.equal(isSuperViewer({ role: 'st', id: ANGELUS }), true);
});

test('AC #2 (fail-closed, id-scoped): another genuine ST is NOT a superviewer', () => {
  // role is right, id is not on the allowlist - the whole point of "specifically
  // just me", not "any ST".
  assert.equal(isSuperViewer({ role: 'st', id: '405594065841946624' }), false); // Symon (also an ST)
  assert.equal(isSuperViewer({ role: 'st', id: '000' }), false);
});

test('AC #2 (fail-closed, role-scoped): the allowlisted id at a non-st role is NOT a superviewer', () => {
  assert.equal(isSuperViewer({ role: 'player', id: ANGELUS }), false);
  assert.equal(isSuperViewer({ role: 'dev', id: ANGELUS }), false);
  assert.equal(isSuperViewer({ role: 'coordinator', id: ANGELUS }), false);
});

test('AC #2 (fail-closed): missing viewer / missing field is false, never a throw', () => {
  assert.equal(isSuperViewer(null), false);
  assert.equal(isSuperViewer(undefined), false);
  assert.equal(isSuperViewer({}), false);
  assert.equal(isSuperViewer({ role: 'st' }), false); // no id
  assert.equal(isSuperViewer({ id: ANGELUS }), false); // no role
});

test('AC #1: id is String()-normalised on the viewer side (ObjectId/String-object safe)', () => {
  // mirrors isOwner's normalisation test - a String-like id must still match.
  assert.equal(isSuperViewer({ role: 'st', id: { toString: () => ANGELUS } }), true);
});
