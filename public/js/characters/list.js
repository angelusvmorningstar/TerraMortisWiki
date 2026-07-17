// public/js/characters/list.js — the character roster page (story 2-1 AC #9/#10).
//
// Fetches GET /api/characters (summary-safe entries only — the server already
// stripped every owner-only field) and renders one card per character, linking
// to the per-character profile page. Retired characters get a muted treatment,
// not hidden (AC #9). Display name via the ported displayName() convention.

import { apiGet } from '../data/api.js';
import { displayName, esc, portraitInitial } from '../data/display.js';

const grid = document.getElementById('grid');
const count = document.getElementById('count');
const status = document.getElementById('status');

function showStatus(message, isError) {
  status.textContent = message;
  status.hidden = false;
  status.classList.toggle('hero__status--error', !!isError);
}

// Faction chips: clan, covenant, bloodline — each only if present (honest gap).
function chips(c) {
  const out = [];
  if (c.clan) out.push(`<span class="chip">${esc(c.clan)}</span>`);
  if (c.covenant) out.push(`<span class="chip chip--cov">${esc(c.covenant)}</span>`);
  if (c.bloodline) out.push(`<span class="chip">${esc(c.bloodline)}</span>`);
  if (c.retired) out.push('<span class="chip chip--retired">Retired</span>');
  return out.join('');
}

function cardHtml(c) {
  const retiredClass = c.retired ? ' char-card--retired' : '';
  return `
    <a class="char-card${retiredClass}" href="/character.html?id=${encodeURIComponent(c._id)}">
      <span class="portrait" aria-hidden="true">${esc(portraitInitial(c))}</span>
      <span class="char-card__body">
        <span class="char-card__name">${esc(displayName(c))}</span>
        <span class="char-card__meta">${chips(c)}</span>
      </span>
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
