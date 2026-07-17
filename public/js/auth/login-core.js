// public/js/auth/login-core.js — pure, DOM-free helpers for the Discord OAuth
// redirect_uri landing page (public/login.html).
//
// Kept separate from the page's inline script so the callback-handling logic
// can be unit-tested directly under node:test without a browser/jsdom — see
// login-core.test.js and specs/stories/1-4-netlify-render-split.md AC #6.
// Mirrors the token-storage shape of ../TM Suite/public/js/auth/discord.js
// (`tm_auth_token`/`tm_auth_expires`/`tm_auth_user`) so story 2-1 onward reads
// the same keys.

const CALLBACK_PATH = '/auth/discord/callback';
const TOKEN_KEY = 'tm_auth_token';
const EXPIRES_KEY = 'tm_auth_expires';
const USER_KEY = 'tm_auth_user';

// Extracts { code, state } from the URL Discord redirected the browser to.
// Returns null when there is no `code` param — a plain (non-callback) visit
// to the login page.
export function parseCallbackParams(url) {
  const parsed = new URL(url);
  const code = parsed.searchParams.get('code');
  if (!code) return null;
  return { code, state: parsed.searchParams.get('state') };
}

// The exact shape of the POST that exchanges the code for a session. A plain
// data description (not a fetch call) so it's testable without a network.
export function buildCallbackRequest(code, state) {
  return {
    method: 'POST',
    path: CALLBACK_PATH,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, state }),
  };
}

// Strips ?code=&state= from the visible URL once they've been read, so a
// refresh or a copy-pasted link never resubmits (or leaks) a one-time code.
export function stripCallbackParams(url) {
  const parsed = new URL(url);
  parsed.searchParams.delete('code');
  parsed.searchParams.delete('state');
  return parsed.pathname + parsed.search + parsed.hash;
}

// --- token storage (storage is passed in — window.localStorage in the page,
// a plain in-memory fake in tests) -------------------------------------------

export function saveAuth(storage, data) {
  storage.setItem(TOKEN_KEY, data.access_token);
  storage.setItem(EXPIRES_KEY, String(Date.now() + data.expires_in * 1000));
  storage.setItem(USER_KEY, JSON.stringify(data.user));
}

export function clearAuth(storage) {
  storage.removeItem(TOKEN_KEY);
  storage.removeItem(EXPIRES_KEY);
  storage.removeItem(USER_KEY);
}

export function getToken(storage) {
  const token = storage.getItem(TOKEN_KEY);
  const expires = storage.getItem(EXPIRES_KEY);
  if (!token || !expires) return null;
  if (Date.now() > Number(expires)) return null;
  return token;
}

export function getUser(storage) {
  const raw = storage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
}

export { CALLBACK_PATH };
