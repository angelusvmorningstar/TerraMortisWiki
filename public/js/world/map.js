// public/js/world/map.js — the World page: an interactive map of Sydney's
// vampire court territories (story 2-2 split into World=map / Court=offices).
//
// Reads /data/world-map.geojson — a static file checked into the repo, hand-
// derived from the ST cockpit's location data with everything except vampire
// territories, the Exclusion Zone, and Elysium stripped out. The cockpit's own
// map bakes in haven addresses, NPC sites, ley lines and other ST-only secrets
// with no field-level public/ST split; this file is a deliberately narrow,
// separately-maintained public subset, not a live read of that data. Widening
// what's shown means hand-adding another sanitised feature, not flipping a flag.
//
// Behind the login gate (server/middleware/auth.js) like every other page, but
// this file itself never calls the API — the GeoJSON is static, public content.

import { esc } from '../data/display.js';

const PARCHMENT_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

async function loadGeoJson() {
  const res = await fetch('/data/world-map.geojson');
  if (!res.ok) throw new Error('Could not load the map data.');
  return res.json();
}

// Escaped regardless of trust (this repo's house rule, per story 2-3's lore
// renderer decision) — the GeoJSON is static/checked-in, not attacker input,
// but nothing here relies on that remaining true forever.
function popupHtml(props) {
  let html = `<strong>${esc(props.name)}</strong>`;
  if (props.address) html += `<br>${esc(props.address)}`;
  if (props.note) html += `<br><em>${esc(props.note)}</em>`;
  return html;
}

function styleFeature(feature) {
  const color = feature.properties.color;
  if (feature.geometry.type === 'Point') return {};
  return {
    color,
    weight: 2,
    fillColor: color,
    fillOpacity: 0.28,
  };
}

async function init() {
  const map = L.map('map', { scrollWheelZoom: true }).setView([-33.865, 151.21], 12);

  L.tileLayer(PARCHMENT_TILE_URL, {
    maxZoom: 18,
    attribution: '&copy; OpenStreetMap contributors',
    className: 'world-map__tiles',
  }).addTo(map);

  let geojson;
  try {
    geojson = await loadGeoJson();
  } catch {
    document.getElementById('status').textContent = 'Could not load the map data.';
    document.getElementById('status').hidden = false;
    return;
  }

  const layer = L.geoJSON(geojson, {
    style: styleFeature,
    pointToLayer: (feature, latlng) =>
      L.circleMarker(latlng, {
        radius: 8,
        color: feature.properties.color,
        fillColor: feature.properties.color,
        fillOpacity: 0.9,
        weight: 2,
      }),
    onEachFeature: (feature, lyr) => {
      lyr.bindPopup(popupHtml(feature.properties));
      // Always-visible name label, centred on the shape — mirrors the ST
      // cockpit map's own terr-label tooltip treatment.
      lyr.bindTooltip(esc(feature.properties.name), {
        permanent: true,
        direction: 'center',
        className: 'terr-label',
        interactive: false,
      });
    },
  }).addTo(map);

  map.fitBounds(layer.getBounds(), { padding: [24, 24] });
}

init();
