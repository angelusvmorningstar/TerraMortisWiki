// public/js/auth/login-core.test.js — Story 1.4 AC #6.
//
// Proves the corrected OAuth flow at the DOM/HTTP-shape level without a real
// browser: the login page's callback-handling logic is pure functions here,
// exercised directly. The GET /auth/discord redirect itself is covered by
// server/auth.test.js (unchanged from story 1.3).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCallbackParams,
  buildCallbackRequest,
  stripCallbackParams,
  saveAuth,
  clearAuth,
  getToken,
  getUser,
} from './login-core.js';

// Minimal in-memory Storage stand-in — no jsdom/localStorage needed.
function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

test('parseCallbackParams extracts code + state from a Discord redirect URL', () => {
  const result = parseCallbackParams('https://wiki.example/login.html?code=abc123&state=xyz789');
  assert.deepEqual(result, { code: 'abc123', state: 'xyz789' });
});

test('parseCallbackParams returns null when there is no code (plain page visit)', () => {
  assert.equal(parseCallbackParams('https://wiki.example/login.html'), null);
});

test('parseCallbackParams tolerates a missing state (code present)', () => {
  const result = parseCallbackParams('https://wiki.example/login.html?code=abc123');
  assert.deepEqual(result, { code: 'abc123', state: null });
});

test('buildCallbackRequest POSTs the code+state to /auth/discord/callback', () => {
  const req = buildCallbackRequest('abc123', 'xyz789');
  assert.equal(req.method, 'POST');
  assert.equal(req.path, '/auth/discord/callback');
  assert.equal(req.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(req.body), { code: 'abc123', state: 'xyz789' });
});

test('stripCallbackParams removes code+state but keeps the rest of the URL', () => {
  const stripped = stripCallbackParams('https://wiki.example/login.html?code=abc&state=xyz&foo=bar');
  assert.equal(stripped, '/login.html?foo=bar');
});

test('stripCallbackParams on a bare path leaves it unchanged', () => {
  assert.equal(stripCallbackParams('https://wiki.example/login.html'), '/login.html');
});

test('saveAuth/getToken/getUser round-trip through storage', () => {
  const storage = fakeStorage();
  saveAuth(storage, { access_token: 'at1', expires_in: 604800, user: { role: 'player', player_id: '111' } });
  assert.equal(getToken(storage), 'at1');
  assert.deepEqual(getUser(storage), { role: 'player', player_id: '111' });
});

test('getToken returns null once the stored expiry is in the past', () => {
  const storage = fakeStorage();
  storage.setItem('tm_auth_token', 'stale');
  storage.setItem('tm_auth_expires', String(Date.now() - 1000));
  assert.equal(getToken(storage), null);
});

test('getToken returns null when nothing has been stored', () => {
  assert.equal(getToken(fakeStorage()), null);
});

test('clearAuth removes all three stored keys', () => {
  const storage = fakeStorage();
  saveAuth(storage, { access_token: 'at1', expires_in: 604800, user: { role: 'player' } });
  clearAuth(storage);
  assert.equal(getToken(storage), null);
  assert.equal(getUser(storage), null);
});
