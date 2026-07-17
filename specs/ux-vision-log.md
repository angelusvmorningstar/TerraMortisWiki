# UX Vision Log

Overflow ideas parked during design-lock phases, kept so they aren't lost or
silently re-litigated later. Not commitments, not scoped, not scheduled.

## Story 3-1 (world-status-layout), design-lock 2026-07-17

- **Clan icons.** Only the 5 covenant SVGs exist as web assets in this repo
  (`public/img/covenant/`, ported from `Character Sheets/Sheet Elements/` this
  session, recoloured via CSS mask). The mockup shows clan as plain text.
  Porting the matching 5 clan icons (same source folder, same
  `mask-image` technique) would let clan render as an icon too, matching the
  TM Suite reference screenshots more closely. Not blocking 3-1.

## Story 3-2 (covenant-clan-status-ladders), design-lock 2026-07-17

- **Empty-standing vs no-character, same rendering.** The locked mockup shows
  the "own no character" empty state for Covenant/Clan. Whether a viewer who
  owns a character but holds zero standing in it should read any differently
  wasn't tested in the mockup (no example row hits this). Dev-story should
  confirm they render the same honest-gap message, or note if the copy needs
  to differ. Not blocking, just a case the mockup didn't visually cover.
