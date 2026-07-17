// public/js/characters/list.js — the character roster page (story 2-1 AC #9/#10).
//
// Fetches GET /api/characters (summary-safe entries only — the server already
// stripped every owner-only field) and renders one card per character, linking
// to the per-character profile page. Retired characters get a muted treatment,
// not hidden (AC #9). Display name via the ported displayName() convention.

import { apiGet } from '../data/api.js';
import { displayName, esc, portraitInitial } from '../data/display.js';
import { COVENANT_ICON_SLUG } from '../data/covenant-icons.js';

const grid = document.getElementById('grid');
const count = document.getElementById('count');
const status = document.getElementById('status');

function showStatus(message, isError) {
  status.textContent = message;
  status.hidden = false;
  status.classList.toggle('hero__status--error', !!isError);
}

// Covenant-name -> icon-slug map is shared with the Court page; see
// ../data/covenant-icons.js. A character with no covenant on file (or an
// unrecognised one) falls back to the letter-monogram portrait rather than a
// broken icon — an honest gap, not a guess.

// The crest: covenant icon when recognised, otherwise the letter-monogram
// portrait so the card is never left blank.
function crestHtml(c) {
  const slug = c.covenant && COVENANT_ICON_SLUG[c.covenant];
  if (slug) {
    return `<span class="char-card__icon char-card__icon--${slug}" aria-hidden="true" title="${esc(c.covenant)}"></span>`;
  }
  return `<span class="portrait" aria-hidden="true">${esc(portraitInitial(c))}</span>`;
}

function cardHtml(c) {
  const retiredClass = c.retired ? ' char-card--retired' : '';
  return `
    <a class="char-card${retiredClass}" href="/character.html?id=${encodeURIComponent(c._id)}">
      ${crestHtml(c)}
      <span class="char-card__name">${esc(displayName(c))}</span>
    </a>`;
}

async function init() {
  let data;
  try {
    data = await apiGet('/api/characters');
  } catch (err) {
    showStatus(err.message || 'Could not load the character roster.', true);
    return;
  }
  if (!data) return; // redirected to login

  const characters = data.characters || [];
  count.textContent = characters.length === 1 ? '1 character' : `${characters.length} characters`;
  grid.innerHTML = characters.map(cardHtml).join('');
}

init();
