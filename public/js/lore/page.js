// public/js/lore/page.js — the lore article page (story 2-3 AC #9/#12).
//
// Reads ?slug= from the URL, fetches GET /api/lore/:slug via the authed apiGet
// helper, and injects the server-rendered data.html into the .lore-article
// container. The article body is the deliberate exception to the esc()-everything
// rule: data.html is server-rendered by renderLoreMarkdown, which escaped the raw
// markdown source and emits only its own tags, so injecting it as-is is safe and
// is the whole point of server-side rendering. On success the page heading and
// document.title are set from the manifest-controlled title (colon-formatted, so
// guaranteed em-dash-free). An unknown slug and any other failure both render an
// honest state, never a blank page.

import { apiGet } from '../data/api.js';

const article = document.getElementById('article');
const pageTitle = document.getElementById('page-title');
const status = document.getElementById('status');

function showStatus(message, isError) {
  status.textContent = message;
  status.hidden = false;
  status.classList.toggle('hero__status--error', !!isError);
}

function getSlug() {
  return new URLSearchParams(location.search).get('slug') || '';
}

async function init() {
  const slug = getSlug();
  if (!slug) {
    showStatus('No lore page was requested.', true);
    return;
  }

  let data;
  try {
    data = await apiGet(`/api/lore/${encodeURIComponent(slug)}`);
  } catch (err) {
    showStatus(err.message || 'Could not load this lore page.', true);
    return;
  }
  if (!data) return; // redirected to login

  if (data._notFound) {
    article.innerHTML = '<div class="empty-state">That page was not found.</div>';
    return;
  }

  // Heading + tab title from the manifest-controlled title (colon-formatted).
  pageTitle.textContent = data.title || 'Lore';
  document.title = `Terra Mortis Wiki: ${data.title || 'Lore'}`;

  // Server-rendered HTML, injected as-is by design (see the module header).
  article.innerHTML = data.html || '';
}

init();
