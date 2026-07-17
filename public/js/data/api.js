// public/js/data/api.js — shared authed-fetch helper for the content pages.
//
// Every content request carries the Discord bearer token as
// `Authorization: Bearer <token>`, read from login-core.js's getToken(). A
// missing token, or a 401/403 from the API, sends the user to login.html rather
// than blanking the page (AC #10). The API_BASE resolution mirrors
// login.html's inline script (../TM Suite/public/js/data/api.js pattern):
// same-origin in production behind Netlify's /api/* proxy, an explicit localhost
// host only for local dev.

import { getToken } from '../auth/login-core.js';

export const API_BASE = location.hostname === 'localhost' ? 'http://localhost:3000' : '';

// Redirect to the login page. Extracted so it can be stubbed if ever needed.
function toLogin() {
  location.href = '/login.html';
}

// Authed GET returning parsed JSON. On a missing token or a 401/403 it redirects
// to login and returns null (the caller should stop rendering). Any other
// non-OK status throws so the page can show an honest error state rather than a
// blank one.
export async function apiGet(path) {
  const token = getToken(localStorage);
  if (!token) {
    toLogin();
    return null;
  }
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    throw new Error(`Could not reach the server: ${err.message}`);
  }
  if (res.status === 401 || res.status === 403) {
    toLogin();
    return null;
  }
  if (res.status === 404) {
    return { _notFound: true };
  }
  if (!res.ok) {
    throw new Error(`Request failed (${res.status})`);
  }
  return res.json();
}
