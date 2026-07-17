// public/js/characters/profile.js — the per-character profile page (story 2-1).
//
// Reads ?id= from the URL, fetches GET /api/characters/:id, and renders whatever
// TIER the API returned. The server is the ONLY authority on what this viewer
// may see: this page renders what it was given and never fetches or reconstructs
// hidden data. A thin/empty dossier renders an honest "not much is known" state
// (AC #9), never a placeholder implying the gap is a bug.

import { apiGet } from '../data/api.js';
import { displayName, esc, portraitInitial } from '../data/display.js';

const root = document.getElementById('profile');
const status = document.getElementById('status');

function showStatus(message, isError) {
  status.textContent = message;
  status.hidden = false;
  status.classList.toggle('hero__status--error', !!isError);
}

function chips(c) {
  const out = [];
  if (c.clan) out.push(`<span class="chip">${esc(c.clan)}</span>`);
  if (c.covenant) out.push(`<span class="chip chip--cov">${esc(c.covenant)}</span>`);
  if (c.bloodline) out.push(`<span class="chip">${esc(c.bloodline)}</span>`);
  if (c.apparent_age) out.push(`<span class="chip">Apparent age ${esc(c.apparent_age)}</span>`);
  if (c.retired) out.push('<span class="chip chip--retired">Retired</span>');
  return out.join('');
}

function factsSection(facts) {
  if (!facts || !facts.length) {
    return `
      <section class="profile__section">
        <h2 class="profile__section-title">What is known</h2>
        <div class="empty-state">Not much is known about this character.</div>
      </section>`;
  }
  const items = facts
    .map(
      (f) => `
      <div class="fact">
        ${f.tag ? `<div class="fact__tag">${esc(String(f.tag).replace(/_/g, ' '))}</div>` : ''}
        <div class="fact__value">${esc(f.value)}</div>
      </div>`,
    )
    .join('');
  return `
    <section class="profile__section">
      <h2 class="profile__section-title">What is known</h2>
      <div class="facts">${items}</div>
    </section>`;
}

// Owner-tier only: a compact read-only view of a few sheet headline stats. This
// renders solely when the API returned the OWNER tier (tier === 'owner') — the
// summary tier never carries these fields, so there is nothing to hide client
// side; the branch simply has no data to render.
function ownerSheetSection(c) {
  if (c.tier !== 'owner') return '';
  const rows = [];
  const push = (label, value) => {
    if (value !== undefined && value !== null && value !== '') {
      rows.push(`<div class="sheet-row"><span class="sheet-row__label">${esc(label)}</span><span class="sheet-row__value">${esc(value)}</span></div>`);
    }
  };
  if (c.tracker_state) {
    push('Vitae', c.tracker_state.vitae);
    push('Willpower', c.tracker_state.willpower);
  }
  if (c.xp_log) push('XP spent', c.xp_log.spent);
  if (!rows.length) return '';
  return `
    <section class="profile__section">
      <h2 class="profile__section-title">Your sheet</h2>
      <div class="sheet-grid">${rows.join('')}</div>
    </section>`;
}

function render(c) {
  root.innerHTML = `
    <div class="profile__head">
      <span class="portrait portrait--lg" aria-hidden="true">${esc(portraitInitial(c))}</span>
      <div class="profile__id">
        <h1 class="profile__name">${esc(displayName(c))}</h1>
        <div class="profile__factions">${chips(c)}</div>
      </div>
    </div>
    ${ownerSheetSection(c)}
    ${factsSection(c.facts)}`;
}

async function init() {
  const id = new URLSearchParams(location.search).get('id');
  if (!id) {
    showStatus('No character was specified.', true);
    return;
  }
  let data;
  try {
    data = await apiGet(`/api/characters/${encodeURIComponent(id)}`);
  } catch (err) {
    showStatus(err.message || 'Could not load this character.', true);
    return;
  }
  if (!data) return; // redirected to login
  if (data._notFound || !data.character) {
    showStatus('That character could not be found.', true);
    return;
  }
  render(data.character);
}

init();
