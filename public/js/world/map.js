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
    fillOpacity: 0.40,
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
    pointToLayer: (feature, latlng) => {
      // Gold diamond = Elysium / communal ground (map key: shape = function, gold = communal vampire).
      if (feature.properties.kind === 'elysium') {
        return L.marker(latlng, {
          icon: L.divIcon({
            className: 'world-ely',
            html: '<span style="display:block;width:13px;height:13px;background:#c8a13a;border:1.5px solid #fff;transform:rotate(45deg);box-shadow:0 1px 4px rgba(40,30,16,.6)"></span>',
            iconSize: [16, 16], iconAnchor: [8, 8],
          }),
        });
      }
      return L.circleMarker(latlng, {
        radius: 8,
        color: feature.properties.color,
        fillColor: feature.properties.color,
        fillOpacity: 0.9,
        weight: 2,
      });
    },
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

  // Own-haven markers. The server route (/api/st-map/locations) already filters per viewer — a
  // player gets back only havens their own character lives in; the ST gets all — so the map just
  // renders whatever comes back. No client-side auth logic here, by design.
  loadOwnHavens(map);
}

// Fetch the viewer-scoped locations and draw any havens as oxblood circles (map key: circle =
// home/safe place, oxblood = personal vampire). Fail-soft: any error just means no haven layer,
// and the rest of the map is unaffected.
async function loadOwnHavens(map) {
  let data;
  try {
    const res = await fetch('/api/st-map/locations');
    if (!res.ok) return;
    data = await res.json();
  } catch {
    return;
  }
  const locs = Array.isArray(data && data.locations) ? data.locations : [];
  const havens = locs.filter(
    (l) => l.faction === 'haven' && Number.isFinite(l.lat) && Number.isFinite(l.lon),
  );
  if (!havens.length) return;
  const group = L.layerGroup();
  havens.forEach((h) => {
    const marker = L.circleMarker([h.lat, h.lon], {
      radius: 6,
      color: '#fff',
      weight: 1.5,
      fillColor: '#6e1f22',
      fillOpacity: 0.95,
    });
    let body = `<strong>${esc(h.name || 'Haven')}</strong>`;
    if (Array.isArray(h.resident_names) && h.resident_names.length) {
      body += `<br>${esc(h.resident_names.join(', '))}`;
    }
    if (h.address) body += `<br><em>${esc(h.address)}</em>`;
    marker.bindPopup(body);
    group.addLayer(marker);
  });
  group.addTo(map);
}

init();
