// public/js/data/display.js — pure display helpers.
//
// The display-name / sort-name convention, ported from
// ../TM Suite/public/js/data/helpers.js (the read-only source of truth). ONLY
// the pure logic is ported: the TM-Suite dev-mode redaction machinery
// (isRedactMode / _blockOut / redact*) is NOT ported — this app has no `dev`
// redaction role, so a straight port of that would be dead code hiding a role
// that never exists here.
//
// Kept DOM-free so it can be unit-tested under node:test without a browser (see
// display.test.js), the same split login-core.js uses.

// Display name: honorific + (moniker || name). Matches TM Suite displayName().
export function displayName(c) {
  if (!c) return '';
  const base = c.moniker || c.name || '';
  return c.honorific ? `${c.honorific} ${base}` : base;
}

// Sort key: (moniker || name), case-insensitive. Matches TM Suite sortName().
// Never rendered — internal ordering only.
export function sortName(c) {
  if (!c) return '';
  return String(c.moniker || c.name || '').toLowerCase();
}

// Card name: moniker || name, no honorific (used where the honorific is omitted
// for brevity). Matches TM Suite cardName() minus redaction.
export function cardName(c) {
  if (!c) return '';
  return c.moniker || c.name || '';
}

// HTML-escape helper (ported from TM Suite helpers.js esc()) — every dynamic
// string rendered into innerHTML must go through this.
export function esc(s) {
  return s == null
    ? ''
    : String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// The single uppercase initial used by the CSS-only portrait placeholder tile
// (architecture.md → "Portraits": there is no "if portrait exists" branch; the
// placeholder is the only path). Derived from the display base name.
export function portraitInitial(c) {
  const base = cardName(c).trim();
  return base ? base[0].toUpperCase() : '?';
}
