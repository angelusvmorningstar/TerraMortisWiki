// public/js/characters/profile.js — the per-character profile page (story 2-1).
//
// Reads ?id= from the URL, fetches GET /api/characters/:id, and renders whatever
// TIER the API returned. The server is the ONLY authority on what this viewer
// may see: this page renders what it was given and never fetches or reconstructs
// hidden data. A thin/empty dossier renders an honest "not much is known" state
// (AC #9), never a placeholder implying the gap is a bug.
//
// Presented as one continuous dossier panel (letterhead + vitals + history),
// not a header card followed by a separate grid of floating fact cards.

import { apiGet } from '../data/api.js';
import { displayName, esc } from '../data/display.js';

const root = document.getElementById('profile');
const status = document.getElementById('status');

function showStatus(message, isError) {
  status.textContent = message;
  status.hidden = false;
  status.classList.toggle('hero__status--error', !!isError);
}

// A generic silhouette for the placeholder photo well — no image data exists
// in the character schema, so this is deliberately always a placeholder.
const SILHOUETTE_ICON = `<svg class="profile__photo-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>`;

function vitalRow(label, value, valueClass) {
  const cls = valueClass ? ` vital-row__value--${valueClass}` : '';
  return `<div class="vital-row"><span class="vital-row__label">${esc(label)}</span><span class="vital-row__value${cls}">${esc(value)}</span></div>`;
}

// Quick-glance vitals as a label:value table — each row only if present
// (honest gap), not badges.
function vitalsTable(c) {
  const rows = [];
  if (c.clan) rows.push(vitalRow('Clan', c.clan));
  if (c.covenant) rows.push(vitalRow('Covenant', c.covenant, 'cov'));
  if (c.bloodline) rows.push(vitalRow('Bloodline', c.bloodline));
  if (c.apparent_age) rows.push(vitalRow('Apparent age', c.apparent_age));
  if (c.retired) rows.push(vitalRow('Status', 'Retired', 'retired'));
  if (!rows.length) return '';
  return `<div class="profile__vitals">${rows.join('')}</div>`;
}

// Dossier facts as flowing label:value lines within the same panel as the
// letterhead — read as one continuous brief, not scattered cards.
function historySection(facts) {
  if (!facts || !facts.length) {
    return `
      <hr class="profile__divider">
      <h2 class="profile__section-title">What is known</h2>
      <div class="empty-state">Not much is known about this character.</div>`;
  }
  const rows = facts
    .map(
      (f) => `
      <div class="fact">
        ${f.tag ? `<span class="fact__tag">${esc(String(f.tag).replace(/_/g, ' '))}</span>` : ''}
        <span class="fact__value">${esc(f.value)}</span>
      </div>`,
    )
    .join('');
  return `
    <hr class="profile__divider">
    <h2 class="profile__section-title">What is known</h2>
    <div class="facts">${rows}</div>`;
}

// Owner-tier only: a compact read-only view of a few sheet headline stats,
// folded into the same dossier panel rather than a separate block. Renders
// solely when the API returned the OWNER tier — the summary tier never
// carries these fields, so there is nothing to hide client side; the branch
// simply has no data to render.
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
    <hr class="profile__divider">
    <h2 class="profile__section-title">Your sheet</h2>
    <div class="sheet-grid">${rows.join('')}</div>`;
}

function render(c) {
  const stampClass = c.tier === 'owner' ? 'profile__stamp--owner' : 'profile__stamp--summary';
  const stampLabel = c.tier === 'owner' ? 'Full file' : 'Summary file';
  root.innerHTML = `
    <div class="profile__head">
      <span class="profile__stamp ${stampClass}">${esc(stampLabel)}</span>
      <div class="profile__top">
        <div class="profile__photo">
          ${SILHOUETTE_ICON}
          <span class="profile__photo-caption">Photograph<br>not on file</span>
        </div>
        <div class="profile__id">
          <p class="profile__eyebrow">Terra Mortis &middot; Subject File</p>
          <h1 class="profile__name">${esc(displayName(c))}</h1>
        </div>
      </div>
      ${vitalsTable(c)}
      ${ownerSheetSection(c)}
      ${historySection(c.facts)}
    </div>`;
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
