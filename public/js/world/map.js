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

// Splat palette for territory zones — matches the shared map key (colour = splat, and a
// per-splat border dash as the colour-independent second channel).
const REVEAL_SPLAT = {
  vampire: { color: '#a5342e', dash: null },
  werewolf: { color: '#c0742a', dash: '10 6' },
  mage: { color: '#34827b', dash: '3 8' },
  changeling: { color: '#326638', dash: '14 5 3 5' },
  geist: { color: '#26306b', dash: '20 8' },
  ghost: { color: '#3a3a42', dash: '1 4' },
};

// Average-vertex centroid of a [lon,lat] ring, returned as [lat,lon] for Leaflet — enough to
// place a point marker (e.g. an HQ star) at the middle of a territory polygon.
function ringCentroidLatLon(polygon) {
  if (!Array.isArray(polygon) || !polygon.length) return null;
  let slat = 0, slon = 0, n = 0;
  for (const pt of polygon) {
    if (Array.isArray(pt) && pt.length >= 2 && Number.isFinite(pt[0]) && Number.isFinite(pt[1])) {
      slon += pt[0]; slat += pt[1]; n += 1;
    }
  }
  return n ? [slat / n, slon / n] : null;
}

// A glyph divIcon (▲ ★ ▼ …) styled inline, so the map key's shapes render without depending on
// any cockpit-only CSS class (this file already styles its markers inline, cf. the Elysium diamond).
function glyphIcon(glyph, color, px) {
  return L.divIcon({
    className: 'st-glyph',
    html: '<span style="display:block;color:' + color + ';font-size:' + px + 'px;line-height:1;'
      + 'text-shadow:0 0 2px #2a2018,0 0 3px #2a2018,0 1px 3px rgba(0,0,0,.6)">' + glyph + '</span>',
    iconSize: [px, px], iconAnchor: [px / 2, px / 2],
  });
}

const dots = (n) => '●'.repeat(Math.max(0, n)) + '○'.repeat(Math.max(0, 5 - n));

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
  const ptOk = (l) => Number.isFinite(l.lat) && Number.isFinite(l.lon);
  const hasPoly = (l) => Array.isArray(l.polygon) && l.polygon.length > 0;

  locs.forEach((l) => {
    const type = l.type || l.faction;

    // --- Covenant HQ / seat of power: gold STAR at the polygon centroid (shape = seat). ---
    if (type === 'hq' && hasPoly(l)) {
      const c = ringCentroidLatLon(l.polygon);
      if (!c) return;
      const m = L.marker(c, { icon: glyphIcon('&#9733;', '#c8a13a', 22) });
      let body = `<strong>${esc(l.name || 'Old Covenant Seat')}</strong><br><em>Old Covenant Seat</em>`;
      if (l.real_place) body += `<br>${esc(l.real_place)}`;
      m.bindPopup(body);
      m.bindTooltip(esc(l.name || ''), { permanent: true, direction: 'top', className: 'terr-label', interactive: false, offset: [0, -9] });
      group.addLayer(m);
      return;
    }

    // --- Territory zone: splat-coloured polygon + per-splat border dash (colour = splat). ---
    // Stored polygon is [lon, lat] pairs; Leaflet wants [lat, lon].
    if (hasPoly(l)) {
      const ring = l.polygon.map((pt) => [pt[1], pt[0]]);
      const splat = REVEAL_SPLAT[l.faction] || { color: l.color || '#888', dash: null };
      const poly = L.polygon(ring, {
        color: splat.color, weight: 2, opacity: 0.9,
        fillColor: splat.color, fillOpacity: 0.3, dashArray: splat.dash,
      });
      let body = `<strong>${esc(l.name || 'Territory')}</strong>`;
      if (l.faction) body += `<br><em>${esc(l.faction)} territory</em>`;
      if (l.werewolf_faction) body += `<br><b>${esc(l.werewolf_faction)}</b> turf`;
      else if (l.mage_order) body += `<br><b>${esc(l.mage_order)}</b>`;
      poly.bindPopup(body);
      poly.bindTooltip(esc(l.name || ''), { permanent: true, direction: 'center', className: 'terr-label', interactive: false });
      group.addLayer(poly);
      return;
    }

    // --- Ley line: teal current, faint halo + dotted core (colour = splat: mage). ---
    if (type === 'leyline' && Array.isArray(l.path) && l.path.length) {
      const path = l.path.map((pt) => [pt[1], pt[0]]);
      const minor = l.tier === 'minor';
      const lcol = '#34827b';
      L.polyline(path, { color: lcol, weight: minor ? 6 : 11, opacity: minor ? 0.10 : 0.14, lineCap: 'round', interactive: false }).addTo(group);
      const core = L.polyline(path, { color: lcol, weight: minor ? 1.5 : 2.5, opacity: minor ? 0.6 : 0.9, lineCap: 'round', dashArray: minor ? '1 9' : '2 8' });
      let body = `<strong>${esc(l.name || 'Ley Line')}</strong>${minor ? ' <em>(minor)</em>' : ''}`;
      if (l.resonance) body += `<br><b>Resonance:</b> ${esc(l.resonance)}`;
      if (l.note) body += `<br><em>${esc(l.note)}</em>`;
      core.bindPopup(body);
      group.addLayer(core);
      return;
    }

    if (!ptOk(l)) return;                    // every remaining shape is a single point
    const ll = [l.lat, l.lon];

    // --- Haven: oxblood circle (shape = home, oxblood = personal vampire). ---
    if (type === 'haven') {
      const m = L.circleMarker(ll, { radius: 6, color: '#fff', weight: 1.5, fillColor: '#6e1f22', fillOpacity: 0.95 });
      let body = `<strong>${esc(l.name || 'Haven')}</strong>`;
      if (Array.isArray(l.resident_names) && l.resident_names.length) body += `<br>${esc(l.resident_names.join(', '))}`;
      if (l.address) body += `<br><em>${esc(l.address)}</em>`;
      m.bindPopup(body);
      group.addLayer(m);
      return;
    }

    // --- Elysium / communal ground: gold diamond (shape = communal, gold = communal vampire). ---
    if (type === 'elysium') {
      const m = L.marker(ll, { icon: L.divIcon({
        className: 'world-ely',
        html: '<span style="display:block;width:13px;height:13px;background:#c8a13a;border:1.5px solid #fff;transform:rotate(45deg);box-shadow:0 1px 4px rgba(40,30,16,.6)"></span>',
        iconSize: [16, 16], iconAnchor: [8, 8],
      }) });
      let body = `<strong>${esc(l.name || 'Elysium')}</strong><br><em>Elysium</em>`;
      if (l.note) body += `<br>${esc(l.note)}`;
      if (l.address) body += `<br><em>${esc(l.address)}</em>`;
      m.bindPopup(body);
      group.addLayer(m);
      return;
    }

    // --- NPC site: taupe square (workplace) or circle (home); ? when unconfirmed. ---
    if (type === 'npc_site') {
      const work = l.category === 'workplace';
      const q = l.confirmed ? '' : '<span style="color:#fff;font:700 9px/1 serif">?</span>';
      const m = L.marker(ll, { icon: L.divIcon({
        className: 'world-npc',
        html: '<span style="display:flex;align-items:center;justify-content:center;width:13px;height:13px;background:#6b5f4a;border:1.5px solid #fff;'
          + (work ? '' : 'border-radius:50%;') + 'box-shadow:0 1px 4px rgba(40,30,16,.5)">' + q + '</span>',
        iconSize: [16, 16], iconAnchor: [8, 8],
      }) });
      let body = `<strong>${esc(l.name || 'NPC site')}</strong><br><em>NPC ${work ? 'workplace' : 'home'}${l.confirmed ? '' : ' · unconfirmed'}</em>`;
      if (l.tied_to) body += `<br>tied to ${esc(l.tied_to)}`;
      if (l.desc) body += `<br>${esc(l.desc)}`;
      if (l.suggested_address) body += `<br><em>${l.confirmed ? '' : 'Suggested: '}${esc(l.suggested_address)}</em>`;
      m.bindPopup(body);
      group.addLayer(m);
      return;
    }

    // --- Site of power: upward triangle, colour = splat (Hallow teal / Locus orange / Nest gold). ---
    if (type === 'locus') {
      const col = l.faction === 'mage' ? '#34827b' : l.faction === 'werewolf' ? '#c0742a' : '#c8a13a';
      const m = L.marker(ll, { icon: glyphIcon('&#9650;', col, l.tier === 'minor' ? 13 : 18) });
      const kind = l.faction === 'mage' ? 'Hallow' : 'Locus';
      let body = `<strong>${esc(l.name || kind)}</strong><br><em>${kind}${l.locus_type ? ' · ' + esc(l.locus_type) : ''}</em>`;
      if (l.rating) body += `<br><b>Rating:</b> ${dots(l.rating)}`;
      if (l.resonance) body += `<br><b>Resonance:</b> ${esc(l.resonance)}`;
      if (l.territory) body += `<br><em>${esc(l.territory)}</em>`;
      m.bindPopup(body);
      group.addLayer(m);
      return;
    }

    // --- Wyrm's Nest (Ordo Dracul reading of a place of power): gold triangle. ---
    if (type === 'wyrmnest') {
      const m = L.marker(ll, { icon: glyphIcon('&#9650;', '#c8a13a', 16) });
      let body = `<strong>${esc(l.name || "Wyrm's Nest")}</strong><br><em>Wyrm's Nest${l.nest_type ? ' · ' + esc(l.nest_type) : ''}</em>`;
      if (l.rating) body += `<br><b>Rating:</b> ${dots(l.rating)}`;
      if (l.resonance) body += `<br><b>Resonance:</b> ${esc(l.resonance)}`;
      m.bindPopup(body);
      group.addLayer(m);
      return;
    }

    // --- Cenote / Avernian Gate (Sin-Eater Underworld): indigo down-triangle. ---
    if (type === 'cenote') {
      const gate = l.site_type === 'Avernian Gate';
      const m = L.marker(ll, { icon: glyphIcon(gate ? '&#9660;' : '&#9661;', '#26306b', gate ? 18 : 14) });
      let body = `<strong>${esc(l.name || 'Cenote')}</strong><br><em>${esc(l.site_type || 'Cenote')}</em>`;
      if (l.rating) body += `<br><b>Rating:</b> ${dots(l.rating)}`;
      if (l.resonance) body += `<br><b>Resonance:</b> ${esc(l.resonance)}`;
      m.bindPopup(body);
      group.addLayer(m);
      return;
    }

    // --- Changeling seasonal Court: green star (shape = seat, dark green = changeling). ---
    if (type === 'court') {
      const m = L.marker(ll, { icon: glyphIcon('&#9733;', '#326638', 18) });
      let body = `<strong>${esc(l.name || 'Court')}</strong><br><em>${esc(l.court || '')} Court${l.crown ? ' · ' + esc(l.crown) : ''}</em>`;
      if (l.emotion) body += `<br><b>Emotion:</b> ${esc(l.emotion)}`;
      if (l.resonance) body += `<br><b>Resonance:</b> ${esc(l.resonance)}`;
      m.bindPopup(body);
      group.addLayer(m);
      return;
    }

    // Unknown point type — a small neutral marker so nothing silently vanishes.
    const m = L.circleMarker(ll, { radius: 4, color: '#fff', weight: 1, fillColor: '#6b5b43', fillOpacity: 0.8 });
    m.bindPopup(`<strong>${esc(l.name || 'Location')}</strong>`);
    group.addLayer(m);
  });
  group.addTo(map);
}

init();
