// public/js/world/world.js — the World / Court page (story 2-2 AC #10/#11/#12).
//
// Fetches GET /api/world (already fully assembled and allowlist-projected by the
// server — retired characters excluded, vacant seats marked) and renders two
// clearly-labelled sections: territory regents/lieutenants, and court titles
// grouped by honorific. Each office-holder links to their Story 2-1 profile page.
// A vacant seat and an empty court render honest plain states, never a placeholder
// implying a bug. Every dynamic string goes through esc() before innerHTML.

import { apiGet } from '../data/api.js';
import { displayName, cardName, esc, portraitInitial } from '../data/display.js';

const territoriesEl = document.getElementById('territories');
const courtEl = document.getElementById('court');
const status = document.getElementById('status');

function showStatus(message, isError) {
  status.textContent = message;
  status.hidden = false;
  status.classList.toggle('hero__status--error', !!isError);
}

// A single office seat: the labelled role plus either a linked holder or an honest
// "Vacant". The holder link mirrors the roster card so seats and cards read alike.
function seatHtml(label, holder) {
  if (!holder) {
    return `
      <div class="office-seat office-seat--vacant">
        <span class="office-seat__label">${esc(label)}</span>
        <span class="office-seat__vacant">Vacant</span>
      </div>`;
  }
  return `
    <a class="office-seat" href="/character.html?id=${encodeURIComponent(holder._id)}">
      <span class="office-seat__label">${esc(label)}</span>
      <span class="office-seat__holder">${esc(displayName(holder))}</span>
    </a>`;
}

function territoryCardHtml(row) {
  return `
    <div class="office-card">
      <h3 class="office-card__territory">${esc(row.territory || 'Unnamed territory')}</h3>
      <div class="office-seats">
        ${seatHtml('Regent', row.regent)}
        ${seatHtml('Lieutenant', row.lieutenant)}
      </div>
    </div>`;
}

// A court holder card. The group heading already states the honorific, so the
// card name uses cardName (moniker || name) to avoid doubling the title
// (e.g. heading "Bishop" + "Bishop Severin" would read the office twice).
function courtHolderHtml(holder) {
  return `
    <a class="char-card" href="/character.html?id=${encodeURIComponent(holder._id)}">
      <span class="portrait" aria-hidden="true">${esc(portraitInitial(holder))}</span>
      <span class="char-card__body">
        <span class="char-card__name">${esc(cardName(holder))}</span>
      </span>
    </a>`;
}

function titleGroupHtml(group) {
  const cards = group.holders.map(courtHolderHtml).join('');
  return `
    <div class="title-group">
      <h3 class="title-group__heading">${esc(group.honorific)}</h3>
      <div class="char-grid">${cards}</div>
    </div>`;
}

function renderTerritories(territories) {
  if (!territories || !territories.length) {
    territoriesEl.innerHTML = '<div class="empty-state">No territories recorded.</div>';
    return;
  }
  territoriesEl.innerHTML = territories.map(territoryCardHtml).join('');
}

function renderCourt(titleGroups) {
  if (!titleGroups || !titleGroups.length) {
    courtEl.innerHTML = '<div class="empty-state">No titled court recorded.</div>';
    return;
  }
  courtEl.innerHTML = titleGroups.map(titleGroupHtml).join('');
}

async function init() {
  let data;
  try {
    data = await apiGet('/api/world');
  } catch (err) {
    showStatus(err.message || 'Could not load the world and court.', true);
    return;
  }
  if (!data) return; // redirected to login
  renderTerritories(data.territories || []);
  renderCourt(data.titleGroups || []);
}

init();
