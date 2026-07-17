// public/js/world/court-view.js — pure view-model assembly for the Court page
// (story 3-1). DOM-free so it can be unit-tested under node:test without a
// browser (see court-view.test.js), the same split display.js / world.js use.
//
// buildCourtView joins the two already-allowlist-projected payloads the server
// hands the page — GET /api/world ({ territories, titleGroups }) and
// GET /api/characters ({ characters }) — into the three-section model the
// renderer draws: Court, Regencies, Who's Who. The join is _id-keyed with BOTH
// sides String()-normalised (mirroring server/routes/world.js), fabricates no
// field, invents no holder, and treats an _id present in one payload but absent
// from the other as an honest gap (a title-holder off the active roster still
// renders name + title; a roster character in no title group simply has no
// badge). This module adds NO new wire field — it reads only what the routes
// already expose.

import { cardName, sortName } from '../data/display.js';
import { covenantSlug } from '../data/covenant-icons.js';

const NO_COVENANT_LABEL = 'No covenant recorded';

// Index the active roster by String(_id) so both a title-holder and a regent
// (each carrying only _id/name/honorific/moniker on the /api/world side) can be
// enriched with the clan/covenant the /api/world holder object does not carry.
function rosterIndexById(characters) {
  const index = new Map();
  for (const c of characters) {
    if (c && c._id !== undefined && c._id !== null) index.set(String(c._id), c);
  }
  return index;
}

// Index "who holds a title" by String(_id) -> honorific, flattened from the
// /api/world titleGroups (honorific is a single field per character, so an _id
// appears in exactly one group). Drives the Court section AND the Who's Who
// office badge from the SAME source, so the two can never disagree.
function titleIndexById(titleGroups) {
  const index = new Map();
  for (const group of titleGroups) {
    if (!group || !Array.isArray(group.holders)) continue;
    for (const holder of group.holders) {
      if (holder && holder._id !== undefined && holder._id !== null) {
        index.set(String(holder._id), group.honorific);
      }
    }
  }
  return index;
}

// The clan text + covenant slug for a holder, resolved from the roster index.
// An _id absent from the active roster yields null clan and null slug (honest
// gap) — the row still renders, just without clan text or crest.
function enrich(holder, rosterById) {
  const match = holder && holder._id != null ? rosterById.get(String(holder._id)) : null;
  return {
    clan: (match && match.clan) || null,
    covenant: (match && match.covenant) || null,
    covSlug: match ? covenantSlug(match.covenant) : null,
  };
}

// Court section: one row per office-title holder, flattened from titleGroups.
// The name slot uses cardName (moniker || name) because the title is shown
// separately as a badge — displayName would state the office twice.
function buildCourt(titleGroups, rosterById) {
  const rows = [];
  for (const group of titleGroups) {
    if (!group || !Array.isArray(group.holders)) continue;
    for (const holder of group.holders) {
      if (!holder) continue;
      const { clan, covenant, covSlug } = enrich(holder, rosterById);
      rows.push({
        id: holder._id != null ? String(holder._id) : null,
        name: cardName(holder),
        title: group.honorific,
        clan,
        covenant,
        covSlug,
      });
    }
  }
  return rows;
}

// Regencies section: one row per territory, REGENT ONLY (a Lieutenant is a
// territorial appointment, not a personal title — locked mockup decision). The
// territory name is the row badge. A null regent renders an honest Vacant.
function buildRegencies(territories, rosterById) {
  return territories.map((t) => {
    const regent = t && t.regent ? t.regent : null;
    if (!regent) {
      return { territory: (t && t.territory) || null, vacant: true };
    }
    const { clan, covenant, covSlug } = enrich(regent, rosterById);
    return {
      territory: (t && t.territory) || null,
      vacant: false,
      id: regent._id != null ? String(regent._id) : null,
      name: cardName(regent),
      clan,
      covenant,
      covSlug,
    };
  });
}

// Who's Who section: the full active roster grouped by covenant. A recognised
// covenant forms its own group (name + crest); an empty/absent/unrecognised
// covenant falls into an honest catch-all group with no icon. Each row carries
// an office badge ONLY if the character also holds a title (same title index as
// the Court section). The name slot uses cardName (moniker || name), not
// displayName: in this data model a character's honorific IS their office title
// (it is what titleGroups groups by), so any titled row already shows that
// office as its badge — displayName would state it twice. Matches the mockup's
// bare-name rows. Groups sorted alphabetically, catch-all last; rows sorted by
// sortName within each group.
function buildWhosWho(characters, titleById) {
  const groups = new Map();
  for (const c of characters) {
    if (!c) continue;
    const slug = covenantSlug(c.covenant);
    const key = slug ? c.covenant : NO_COVENANT_LABEL;
    if (!groups.has(key)) {
      groups.set(key, { covenant: key, covSlug: slug, rows: [] });
    }
    groups.get(key).rows.push({
      id: c._id != null ? String(c._id) : null,
      name: cardName(c),
      clan: c.clan || null,
      title: c._id != null ? (titleById.get(String(c._id)) || null) : null,
      _sort: sortName(c),
    });
  }
  const ordered = [...groups.values()].sort((a, b) => {
    if (a.covenant === NO_COVENANT_LABEL) return 1;
    if (b.covenant === NO_COVENANT_LABEL) return -1;
    return a.covenant.localeCompare(b.covenant);
  });
  for (const g of ordered) {
    g.rows.sort((a, b) => a._sort.localeCompare(b._sort));
    g.rows.forEach((r) => { delete r._sort; });
  }
  return ordered;
}

// Assemble the whole three-section model. Both payloads are optional/defensive:
// a missing array is treated as empty (honest empty state downstream), never a
// crash.
export function buildCourtView(world, roster) {
  const territories = Array.isArray(world?.territories) ? world.territories : [];
  const titleGroups = Array.isArray(world?.titleGroups) ? world.titleGroups : [];
  const characters = Array.isArray(roster?.characters) ? roster.characters : [];

  const rosterById = rosterIndexById(characters);
  const titleById = titleIndexById(titleGroups);

  return {
    court: buildCourt(titleGroups, rosterById),
    regencies: buildRegencies(territories, rosterById),
    whosWho: buildWhosWho(characters, titleById),
  };
}
