// public/js/lore/index.js — the lore index page (story 2-3 AC #9/#11/#12).
//
// Fetches GET /api/lore (the ordered manifest of { slug, title }) via the authed
// apiGet helper and renders each entry as a card linking to
// lore-page.html?slug=<slug>. The lore CONTENT itself never travels with this
// index — only the manifest does — and both arrive only behind the login gate.
// Manifest titles are dev-controlled, but every dynamic string still goes through
// esc() before innerHTML for consistency with the sibling pages.

import { apiGet } from '../data/api.js';
import { esc } from '../data/display.js';

const grid = document.getElementById('grid');
const status = document.getElementById('status');

function showStatus(message, isError) {
  status.textContent = message;
  status.hidden = false;
  status.classList.toggle('hero__status--error', !!isError);
}

function cardHtml(entry) {
  return `
    <a class="char-card lore-card" href="/lore-page.html?slug=${encodeURIComponent(entry.slug)}">
      <span class="char-card__body">
        <span class="char-card__name">${esc(entry.title)}</span>
      </span>
    </a>`;
}

async function init() {
  let data;
  try {
    data = await apiGet('/api/lore');
  } catch (err) {
    showStatus(err.message || 'Could not load the lore index.', true);
    return;
  }
  if (!data) return; // redirected to login

  const entries = Array.isArray(data) ? data : [];
  if (!entries.length) {
    grid.innerHTML = '<div class="empty-state">No lore pages are available yet.</div>';
    return;
  }
  grid.innerHTML = entries.map(cardHtml).join('');
}

init();
