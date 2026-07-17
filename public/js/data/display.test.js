// public/js/data/display.test.js — Story 2.1.
//
// The ported display helpers are pure, so they are unit-tested directly under
// node:test (mirroring login-core.test.js) — no browser, no jsdom.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayName, sortName, cardName, esc, portraitInitial } from './display.js';

test('displayName = honorific + (moniker || name)', () => {
  assert.equal(displayName({ name: 'Ambrose', honorific: 'Lord' }), 'Lord Ambrose');
  assert.equal(displayName({ name: 'Ambrose', moniker: 'The Whip', honorific: 'Lord' }), 'Lord The Whip');
  assert.equal(displayName({ name: 'Ambrose' }), 'Ambrose'); // no honorific
  assert.equal(displayName({ name: 'Ambrose', moniker: 'Amby' }), 'Amby'); // moniker wins over name
});

test('sortName = (moniker || name), lower-cased', () => {
  assert.equal(sortName({ name: 'Béatrice', moniker: 'Bea' }), 'bea');
  assert.equal(sortName({ name: 'Ambrose', honorific: 'Lord' }), 'ambrose'); // honorific ignored
  assert.equal(sortName({}), '');
});

test('cardName = moniker || name, no honorific', () => {
  assert.equal(cardName({ name: 'Ambrose', honorific: 'Lord' }), 'Ambrose');
  assert.equal(cardName({ name: 'Ambrose', moniker: 'Amby' }), 'Amby');
});

test('esc neutralises HTML metacharacters', () => {
  assert.equal(esc('<script>&"'), '&lt;script&gt;&amp;&quot;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});

test('portraitInitial is the uppercase first letter of the card name', () => {
  assert.equal(portraitInitial({ name: 'ambrose' }), 'A');
  assert.equal(portraitInitial({ name: 'Béatrice', moniker: 'bea' }), 'B');
  assert.equal(portraitInitial({}), '?');
});

test('helpers never throw on a null/undefined character', () => {
  assert.equal(displayName(null), '');
  assert.equal(sortName(undefined), '');
  assert.equal(cardName(null), '');
  assert.equal(portraitInitial(null), '?');
});
