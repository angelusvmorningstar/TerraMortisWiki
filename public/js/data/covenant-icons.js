// public/js/data/covenant-icons.js — the shared covenant-name -> icon-slug map.
//
// Canonical home for the five covenant slugs (matching
// ../TM Suite/public/js/data/constants.js COVENANTS). Extracted so both the
// roster page (public/js/characters/list.js) and the Court page
// (public/js/world/court.js) read the SAME map rather than each carrying a copy
// that could drift. The matching SVGs live in public/img/covenant/ and are
// applied as CSS masks via the .char-card__icon--<slug> / .roster-cov-icon--<slug>
// modifier classes in components.css.
//
// A covenant not present here (empty/absent/unrecognised) has no slug: callers
// fall back honestly (a letter-monogram or a "No covenant recorded" group),
// never a broken icon.

export const COVENANT_ICON_SLUG = {
  'Carthian Movement': 'carthian-movement',
  'Circle of the Crone': 'circle-of-the-crone',
  'Invictus': 'invictus',
  'Lancea et Sanctum': 'lancea-et-sanctum',
  'Ordo Dracul': 'ordo-dracul',
};

// The icon slug for a covenant name, or null when unrecognised/absent.
export function covenantSlug(covenant) {
  return (covenant && COVENANT_ICON_SLUG[covenant]) || null;
}
