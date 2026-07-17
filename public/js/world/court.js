// public/js/world/court.js — the Court page (story 3-1 rework).
//
// Presents three collapsible sections built with native <details>/<summary>
// (so keyboard operation and disclosure semantics come free, no JS click
// handler): Court (every office-title holder), Regencies (each territory's
// Regent only), and Who's Who (the full active roster grouped by covenant).
// The view model is assembled by the DOM-free buildCourtView (court-view.js),
// which joins GET /api/world and GET /api/characters on String(_id); this file
// only fetches and draws. Every dynamic string goes through esc() before
// innerHTML. Honest empty/vacant states, truthful counts, no fabricated holder.

import { apiGet } from '../data/api.js';
import { esc } from '../data/display.js';
import { buildCourtView } from './court-view.js';

const rootEl = document.getElementById('court-root');
const status = document.getElementById('status');

function showStatus(message, isError) {
  status.textContent = message;
  status.hidden = false;
  status.classList.toggle('hero__status--error', !!isError);
}

// A covenant crest span. The slug selects the mask via the shared
// .roster-cov-icon--<slug> modifier class — never an inline style. A null slug
// (unrecognised/absent covenant) renders nothing, an honest gap not a broken
// icon.
function covIconHtml(slug, label) {
  if (!slug) return '';
  return `<span class="roster-cov-icon roster-cov-icon--${slug}" aria-hidden="true" title="${esc(label || '')}"></span>`;
}

// A Court or Regencies row: linked name on the left, a badge cluster on the
// right (title/territory badge + clan text + covenant crest).
function personRowHtml({ id, name, badge, clan, covSlug, covenant }) {
  const href = id ? `/character.html?id=${encodeURIComponent(id)}` : null;
  const inner = `
    <span class="roster-row__name">${esc(name)}</span>
    <span class="roster-row__badges">
      ${badge ? `<span class="roster-badge">${esc(badge)}</span>` : ''}
      ${clan ? `<span class="roster-clan">${esc(clan)}</span>` : ''}
      ${covIconHtml(covSlug, covenant)}
    </span>`;
  return href
    ? `<a class="roster-row" href="${href}">${inner}</a>`
    : `<div class="roster-row">${inner}</div>`;
}

// A vacant regency row: the territory badge is kept, the name slot reads Vacant.
function vacantRowHtml(territory) {
  return `
    <div class="roster-row">
      <span class="roster-row__name">Vacant</span>
      <span class="roster-row__badges">
        ${territory ? `<span class="roster-badge">${esc(territory)}</span>` : ''}
      </span>
    </div>`;
}

function emptyHtml(message) {
  return `<div class="empty-state">${esc(message)}</div>`;
}

// A <details open> section with a <summary> header carrying the label, the
// rotating chevron, and a truthful count badge.
function sectionHtml(label, count, bodyHtml) {
  return `
    <details class="roster-section" open>
      <summary class="roster-section__head">
        <span class="roster-section__chevron"></span>
        <span>${esc(label)}</span>
        <span class="roster-section__count">${count}</span>
      </summary>
      <div class="roster-section__body">${bodyHtml}</div>
    </details>`;
}

function courtSectionHtml(rows) {
  const body = rows.length
    ? rows.map((r) => personRowHtml({
        id: r.id, name: r.name, badge: r.title, clan: r.clan, covSlug: r.covSlug, covenant: r.covenant,
      })).join('')
    : emptyHtml('No titled offices recorded.');
  return sectionHtml('Court', rows.length, body);
}

function regenciesSectionHtml(rows) {
  const body = rows.length
    ? rows.map((r) => (r.vacant
        ? vacantRowHtml(r.territory)
        : personRowHtml({
            id: r.id, name: r.name, badge: r.territory, clan: r.clan, covSlug: r.covSlug, covenant: r.covenant,
          }))).join('')
    : emptyHtml('No territories recorded.');
  return sectionHtml('Regencies', rows.length, body);
}

function whosWhoGroupHtml(group) {
  const head = `
    <div class="roster-group__head">
      ${group.covSlug ? `<span class="roster-group__icon roster-group__icon--${group.covSlug}" aria-hidden="true"></span>` : ''}
      <span>${esc(group.covenant)}</span>
    </div>`;
  const rows = group.rows.map((r) => {
    const href = r.id ? `/character.html?id=${encodeURIComponent(r.id)}` : null;
    const inner = `
      <span class="roster-row__name">${esc(r.name)}</span>
      <span class="roster-row__badges">
        ${r.title ? `<span class="roster-badge">${esc(r.title)}</span>` : ''}
        ${r.clan ? `<span class="roster-clan">${esc(r.clan)}</span>` : ''}
      </span>`;
    return href
      ? `<a class="roster-row" href="${href}">${inner}</a>`
      : `<div class="roster-row">${inner}</div>`;
  }).join('');
  return head + rows;
}

function whosWhoSectionHtml(groups) {
  const total = groups.reduce((n, g) => n + g.rows.length, 0);
  const body = total
    ? groups.map(whosWhoGroupHtml).join('')
    : emptyHtml('No characters recorded.');
  return sectionHtml("Who's Who", total, body);
}

function render(view) {
  rootEl.innerHTML = [
    courtSectionHtml(view.court),
    regenciesSectionHtml(view.regencies),
    whosWhoSectionHtml(view.whosWho),
  ].join('');
}

async function init() {
  let world;
  let roster;
  try {
    [world, roster] = await Promise.all([apiGet('/api/world'), apiGet('/api/characters')]);
  } catch (err) {
    showStatus(err.message || 'Could not load the court.', true);
    return;
  }
  if (!world || !roster) return; // redirected to login
  render(buildCourtView(world, roster));
}

init();
