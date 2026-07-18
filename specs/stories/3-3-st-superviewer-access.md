# Story 3.3 — Storyteller superviewer access

**Status:** done (commit local + pushed per user's explicit instruction 2026-07-19 AEST)
**Epic:** 3 (world/status)

## User story

As **the Storyteller who owns the chronicle (Angelus)**, I want to **see everything on the wiki — every character's full dossier and every faction's status ladder — without owning those characters**, so that **I can use the player-facing site as a complete reference, the same way I see everything in TM Suite**.

## Context

The wiki has three per-viewer authorisation boundaries. Only one (`routes/st-map.js`) honoured `role === 'st'`; the other two (`routes/characters.js`, `routes/status.js`) gated purely on character ownership, so an ST saw other characters redacted and most ladders hidden. This story adds a deliberately narrow full-sight override to those two boundaries.

## Scope

**In:**
- A shared gate `server/access.js` → `isSuperViewer(viewer)`: `role === 'st'` AND Discord id on an explicit allowlist. Fail-closed.
- `routes/characters.js`: superviewer gets owner-tier (full doc + all `st_hidden` facts) for every character; roster list includes retired characters for the superviewer.
- `routes/status.js`: superviewer's covenant/clan ladder list is derived from the whole active roster (every faction with a current member), not just owned characters.

**NOT (explicitly out of scope):**
- **Not all Storytellers.** Specifically one named id (Angelus). Symon (also `role: 'st'`) gets the normal per-viewer gate. Widening to all STs is a future decision, not this story.
- **Not `st-map.js`.** That boundary is already ST-wide by design (2026-07-18) and is left untouched.
- **No frontend changes.** The superviewer receives the existing `tier: 'owner'` shape, so the current profile/status rendering displays it with no new branch. Any superviewer-specific UI badge is deferred.
- **No relaxing of the per-row/field allowlists.** The override changes *which* records the viewer receives, never the field/row allowlists (owner-only fields and the `status` sub-document stay stripped for everyone, superviewer included).

## Acceptance criteria (BDD)

1. **Given** a viewer with `role === 'st'` and an allowlisted Discord id, **then** `isSuperViewer` is true; **given** any other viewer (another ST, the allowlisted id at a non-st role, missing fields, null) **then** it is false (fail-closed).
2. **Given** the superviewer requests a character they do not own, **then** they receive owner tier: full document plus every fact including `st_hidden` ones.
3. **Given** the superviewer requests `/api/status`, **then** they receive every covenant and clan ladder that has a current (non-retired) member, including factions they belong to none of.
4. **Given** the superviewer requests the roster, **then** retired characters are included; **given** a normal player, retired stay hidden.
5. **Given** any superviewer response, **then** no owner-only field and no `status` sub-document appears (per-row/field allowlists unchanged).
6. **Given** another genuine ST (not allowlisted), **then** dossiers and ladders are gated exactly as for a normal viewer (no leak).

## Files touched

- `server/access.js` (new) · `server/access.test.js` (new)
- `server/routes/characters.js` · `server/routes/characters.test.js`
- `server/routes/status.js` · `server/routes/status.test.js`
- `specs/architecture.md` (carve-out note) · `specs/stories/sprint-status.yaml`

## Dev Agent Record

TDD, red→green. Full suite 164/164 green (127 prior + 6 access-gate + 5 characters superviewer + 4 status superviewer, plus the now-tracked st-map suite). Ran under `node --test`.

## Senior Developer Review (3-lens, prove-discrimination)

- **Prove-discrimination** on all three widenings, each reverted in isolation and the target test observed failing, then restored:
  1. `characters.js` projection bypass reverted → the superviewer dossier pure + HTTP tests fail (`superviewer must see owner-only field attributes`).
  2. `status.js` `factionSource` bypass reverted → the superviewer full-ladder pure + HTTP tests fail.
  3. `characters.js` roster-retired widening reverted → the superviewer roster test fails.
- **Fail-closed discrimination asserted positively:** another ST and the allowlisted-id-at-role-player both fall back to the normal gate with no leak (unit + route).
- **Leak channels re-checked:** the override widens channel 2 (which records) only; channels 1 (owner-only fields) and 3 (`status` sub-document / scalar isolation) remain allowlist-constructed and were asserted clean in the superviewer body.
- Full regression green after restore: 164/164.

British English, no em-dashes in app-authored strings (comments/prose).
