# Terra Mortis Wiki — PRD

## Background

Terra Mortis is a Vampire: The Requiem 2e LARP chronicle run by Angelus (solo ST). The existing app, `TM Suite` (sibling repo, `../TM Suite`), is an Express + MongoDB Atlas + Netlify/Render + Discord-OAuth character management system for STs and players. This PRD covers a new, separate companion site — **Terra Mortis Wiki** — that is player-facing, read-only against the same `tm_suite` database, and reuses TM Suite's Discord OAuth.

This PRD was produced from a multi-agent design roundtable (Architect, Product Manager, UX Designer, Business Analyst) plus direct decisions from Angelus. It reflects settled decisions, not open questions — where the roundtable disagreed, the recorded outcome below is what Angelus decided.

## Problem / user job

Players forget their own character's history, forget who holds what court office, and re-ask the ST the same lore questions repeatedly. The job this wiki does: give players a living, in-character reference to their world — their own character in full, everyone else's characters as a public-knowledge summary, plus the setting's lore and current office-holders — without ever risking one player seeing another's private information.

## v1 scope

1. **Character dossiers** — every character (all 41, active and retired) gets a profile page.
   - The viewer's own character(s): full dossier.
   - Every other character: a fixed-field **whitelist summary** (same shape for everyone — see Architecture for the exact field list). Thin/gap data is shown honestly as a gap, never padded or invented.
2. **World tab** — a list of official court holders, regents, and office-holders (who's who).
3. **Lore** — static pages: setting primer, game guide, rules, and a friendlier rewrite of the house-rules errata document.
4. **Discord OAuth** — reusing TM Suite's Discord app and the existing `players` collection (`discord_id`, `role`, `character_ids`). The whole site sits behind login; there is no anonymous/public tier in v1.

## Explicitly out of scope for v1 (deferred to v2)

- The living-city Sydney territory map (three-tier visibility: public pins, own haven, own-territory-only).
- Any UI, review queue, or self-service tooling for tagging a fact as "revealed to character X" — this stays a manual, ad hoc, script-driven edit made from the TM Suite dev environment for the foreseeable future. The **schema** must support a per-character reveal from v1 (see Architecture), even though nothing authors it through this app.
- Per-character ST-authored "how the city sees me" blurbs — the summary is a fixed field whitelist, not curated prose, for v1.
- Multi-character-per-player handling beyond what the existing `character_ids` array already gives us for free — moot today (every player has exactly one character) but the data model must not assume a single character.

## Non-functional requirements

- **Never writes to `tm_suite`.** All writes happen from ad hoc scripts run from the TM Suite dev environment, never from this app's deployed service.
- **Data freshness**: rebuild-on-command, not live query. Angelus triggers a snapshot regeneration (realistically at the close of a downtime cycle), commits it, and the site picks it up on its next deploy. No live Mongo connection in the deployed service at all.
- **Portraits**: AI-generated character portraits are never committed or served by this app. Every portrait slot renders a placeholder, always — this is permanent behaviour, not a temporary gap.
- **Visual design**: reuse TM Suite's normalised CSS design tokens and components (`../TM Suite/public/css/theme.css`, `../TM Suite/public/css/components.css`) — port what's needed, don't invent a parallel design system, don't hardcode hex/inline styles.
- **British English**, no em-dashes, throughout all app copy.

## Success criteria for v1

- Angelus can run one command to regenerate the site's data from live `tm_suite` data.
- A player logging in via Discord sees their own character's full dossier and every other character's summary, correctly gated — no cross-player data leak, in either direction.
- The World tab and lore pages are live and reflect current office-holders (via the snapshot) without a code change.
