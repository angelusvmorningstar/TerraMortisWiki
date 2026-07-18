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
import { apiGet } from '../data/api.js';

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

  // Viewer-scoped layer. The server route (/api/st-map/locations) already filters per viewer — a
  // player gets back only their own havens plus any territories the ST has revealed to them; the
  // ST gets everything — so the map just renders whatever comes back. No client-side auth here.
  loadViewerLocations(map);
}

// Splat palette for revealed territories — matches the shared map key (colour = splat, and a
// per-splat dash pattern as the colour-independent second channel).
const REVEAL_SPLAT = {
  werewolf: { color: '#c0742a', dash: '10 6' },
  mage: { color: '#34827b', dash: '3 8' },
  changeling: { color: '#326638', dash: '14 5 3 5' },
  geist: { color: '#26306b', dash: '20 8' },
  ghost: { color: '#3a3a42', dash: '1 4' },
};

// Fetch the viewer-scoped locations and draw them: the viewer's own havens as oxblood circles
// (map key: circle = home, oxblood = personal vampire), and any ST-revealed territories as their
// splat-coloured polygon. Fail-soft: any error just means no extra layer, rest of the map is fine.
async function loadViewerLocations(map) {
  // Use the shared authed helper (attaches the Discord Bearer token) — a bare fetch gets 401.
  let data;
  try {
    data = await apiGet('/api/st-map/locations');
  } catch {
    return;
  }
  if (!data || data._notFound) return;
  const locs = Array.isArray(data.locations) ? data.locations : [];
  if (!locs.length) return;
  const group = L.layerGroup();
  locs.forEach((l) => {
    if (Array.isArray(l.polygon) && l.polygon.length) {
      // Revealed territory. Stored polygon is [lon, lat] pairs; Leaflet wants [lat, lon].
      const ring = l.polygon.map((pt) => [pt[1], pt[0]]);
      const splat = REVEAL_SPLAT[l.faction] || { color: l.color || '#888', dash: null };
      const poly = L.polygon(ring, {
        color: splat.color,
        weight: 2,
        opacity: 0.9,
        fillColor: splat.color,
        fillOpacity: 0.3,
        dashArray: splat.dash,
      });
      let body = `<strong>${esc(l.name || 'Territory')}</strong>`;
      if (l.faction) body += `<br><em>${esc(l.faction)} territory</em>`;
      poly.bindPopup(body);
      poly.bindTooltip(esc(l.name || ''), {
        permanent: true,
        direction: 'center',
        className: 'terr-label',
        interactive: false,
      });
      group.addLayer(poly);
    } else if (l.faction === 'haven' && Number.isFinite(l.lat) && Number.isFinite(l.lon)) {
      const marker = L.circleMarker([l.lat, l.lon], {
        radius: 6,
        color: '#fff',
        weight: 1.5,
        fillColor: '#6e1f22',
        fillOpacity: 0.95,
      });
      let body = `<strong>${esc(l.name || 'Haven')}</strong>`;
      if (Array.isArray(l.resident_names) && l.resident_names.length) {
        body += `<br>${esc(l.resident_names.join(', '))}`;
      }
      if (l.address) body += `<br><em>${esc(l.address)}</em>`;
      marker.bindPopup(body);
      group.addLayer(marker);
    }
  });
  group.addTo(map);
}

init();
