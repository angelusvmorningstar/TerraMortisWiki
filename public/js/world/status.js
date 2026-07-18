// public/js/world/status.js - the Status page (story 3-2: covenant-clan-status-ladders).
//
// Renders three ladder sections: City Status (ungated, every character), Covenant
// Status and Clan Status (per-viewer GATED). The gating is done ENTIRELY on the
// server (buildStatusView in server/routes/status.js) BEFORE the response leaves
// Express: this page renders exactly the ladders the API returned and never has
// another faction's ladder to hide, because it never receives one. There is no
// "fetch everything, show only mine" path here.
//
// Every dynamic string goes through esc() before innerHTML. Honest empty states,
// truthful counts, the viewer's own characters marked with .tier-chip--me.

import { apiGet } from '../data/api.js';
import { esc, cardName } from '../data/display.js';

const rootEl = document.getElementById('status-root');
const status = document.getElementById('status');

// City Status tier appellations - ported verbatim from ../TM Suite/public/js/
// data/constants.js's CITY_STATUS_APPELLATIONS. Covenant/Clan status have no
// such named tiers in TM Suite - plain numeric dots only, unchanged.
const CITY_STATUS_APPELLATIONS = {
  1: 'Acknowledged', 2: 'Recognised', 3: 'Valued', 4: 'Respected', 5: 'Admired',
  6: 'Honoured', 7: 'Revered', 8: 'Venerated', 9: 'Glorified', 10: 'Exalted',
};

function showStatus(message, isError) {
  status.textContent = message;
  status.hidden = false;
  status.classList.toggle('hero__status--error', !!isError);
}

// Filled + hollow .pointed dots for a value out of dotMax (10 for City, 5 for
// covenant/clan). A value above the max clamps to all-filled; a value at/below 0
// renders all-hollow. Ported convention: .pointed = filled currentColor circle,
// .pointed.hollow = hollow currentColor ring.
function dotsHtml(value, dotMax) {
  const filled = Math.max(0, Math.min(value, dotMax));
  const hollow = Math.max(0, dotMax - filled);
  return '<span class="pointed"></span>'.repeat(filled)
    + '<span class="pointed hollow"></span>'.repeat(hollow);
}

// Group already-sorted rows (value desc, then sortName) into value tiers, empty
// tiers naturally skipped (only values actually present produce a tier).
function tiersFromRows(rows) {
  const tiers = [];
  let current = null;
  for (const row of rows) {
    if (!current || current.value !== row.value) {
      current = { value: row.value, rows: [] };
      tiers.push(current);
    }
    current.rows.push(row);
  }
  return tiers;
}

function chipHtml(row) {
  const meClass = row.mine ? ' tier-chip--me' : '';
  return `<span class="tier-chip${meClass}">${esc(cardName(row))}</span>`;
}

function tierHtml(tier, dotMax, appellations) {
  const label = appellations?.[tier.value];
  return `
    <div class="tier">
      <div class="tier__head">
        <span class="tier__dots">${dotsHtml(tier.value, dotMax)}</span>
        <span class="tier__val">${tier.value}</span>
        ${label ? `<span class="tier__appellation">${esc(label)}</span>` : ''}
      </div>
      <div class="tier__chips">${tier.rows.map(chipHtml).join('')}</div>
    </div>`;
}

function laddersBodyHtml(rows, dotMax, appellations) {
  return tiersFromRows(rows).map((t) => tierHtml(t, dotMax, appellations)).join('');
}

function subheadingHtml(text) {
  return `<p class="ladder-subheading">${text}</p>`;
}

function emptyHtml(message) {
  return `<div class="empty-state">${esc(message)}</div>`;
}

// A <details open> section shell with a truthful count badge (mirrors court.js).
function sectionHtml(label, count, bodyHtml, open) {
  return `
    <details class="roster-section"${open ? ' open' : ''}>
      <summary class="roster-section__head">
        <span class="roster-section__chevron"></span>
        <span>${esc(label)}</span>
        <span class="roster-section__count">${count}</span>
      </summary>
      <div class="roster-section__body">${bodyHtml}</div>
    </details>`;
}

function citySectionHtml(city) {
  const rows = city.rows || [];
  const body = subheadingHtml('Every character in the city, ranked. Always public.')
    + (rows.length ? laddersBodyHtml(rows, 10, CITY_STATUS_APPELLATIONS) : emptyHtml('No standing recorded yet.'));
  return sectionHtml('City Status', rows.length, body, true);
}

// One ladder block: a subheading naming whose standing this is, then the tiers
// (or an honest "no current members" note when the faction has no non-retired
// standing, e.g. a retired-only owner viewing their own faction).
function covenantLadderHtml(ladder) {
  const rows = ladder.rows || [];
  const sub = subheadingHtml(
    `Your covenant: <b>${esc(ladder.name)}</b>. You only see standing within your own covenant.`,
  );
  return sub + (rows.length
    ? laddersBodyHtml(rows, 5)
    : emptyHtml('No current standing recorded in this covenant.'));
}

function clanLadderHtml(ladder) {
  const rows = ladder.rows || [];
  const sub = subheadingHtml(
    `Your clan: <b>${esc(ladder.name)}</b>. You only see standing within your own clan.`,
  );
  return sub + (rows.length
    ? laddersBodyHtml(rows, 5)
    : emptyHtml('No current standing recorded in this clan.'));
}

function covenantSectionHtml(covenant) {
  const ladders = covenant.ladders || [];
  const total = ladders.reduce((n, l) => n + (l.rows ? l.rows.length : 0), 0);
  const body = ladders.length
    ? ladders.map(covenantLadderHtml).join('')
    : emptyHtml("You don't have a character on file, so covenant standing isn't shown here. This is separate from City Status above, which is always public.");
  return sectionHtml('Covenant Status', total, body, ladders.length > 0);
}

function clanSectionHtml(clan) {
  const ladders = clan.ladders || [];
  const total = ladders.reduce((n, l) => n + (l.rows ? l.rows.length : 0), 0);
  const body = ladders.length
    ? ladders.map(clanLadderHtml).join('')
    : emptyHtml("You don't have a character on file, so clan standing isn't shown here.");
  return sectionHtml('Clan Status', total, body, ladders.length > 0);
}

function render(view) {
  rootEl.innerHTML = [
    citySectionHtml(view.city || { rows: [] }),
    covenantSectionHtml(view.covenant || { ladders: [] }),
    clanSectionHtml(view.clan || { ladders: [] }),
  ].join('');
}

async function init() {
  let view;
  try {
    view = await apiGet('/api/status');
  } catch (err) {
    showStatus(err.message || 'Could not load status.', true);
    return;
  }
  if (!view) return; // redirected to login
  render(view);
}

init();
