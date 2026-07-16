# CLAUDE.md

Guidance for Claude Code working in this repository.

## Hard rules

- **Never push to origin or merge to main without the user's current message explicitly saying so.** Commit locally per story is fine and expected; pushing is a separate, explicit ask.
- **Never write to the TM Suite MongoDB (`tm_suite`) from this app at request time.** This site is a read-only consumer of a locally-generated snapshot (see Architecture). The only writes to `tm_suite` happen from ad hoc scripts run from the TM Suite dev environment (a sibling project), never from this app's deployed service.
- **Never commit AI-generated character portraits.** `assets/portraits/` (or wherever the snapshot script stages them) is gitignored. The live site always renders a placeholder when a portrait is absent — this is the permanent behaviour, not a temporary gap.
- British English throughout. No em-dashes in app-authored strings or prose.
- Branch: work directly on `main` (solo project, no deploy pipeline wired up yet). Revisit this convention once a hosting/deploy target exists.

## Project overview

Terra Mortis Wiki is a companion, read-only, player-facing site for the Terra Mortis Vampire: The Requiem 2e chronicle. It sits alongside `TM Suite` (the ST-facing character management app, sibling directory `../TM Suite`) and reads from the same MongoDB `tm_suite` database, but never writes to it.

Full product/architecture decisions are recorded in `specs/prd.md`, `specs/architecture.md`, and `specs/epics.md` — these came out of a multi-agent design roundtable and are the source of truth for what this app is and how it's built. Read them before making product or architecture calls that aren't already decided there.

### Core shape (see specs/architecture.md for detail)

1. A **snapshot script**, run on command from the TM Suite dev environment (`server/scripts/` in that repo, or a script here that points at the same Mongo URI) — reads `tm_suite` collections once, writes a JSON snapshot into this repo, committed and pushed like any other change.
2. A **thin Express service** — Discord OAuth (reusing TM Suite's OAuth app/credentials), gates the whole site, serves per-viewer-projected views computed from the in-memory snapshot. It never holds a Mongo connection.
3. **CSS**: reuse TM Suite's normalised design tokens (`public/css/theme.css`, `public/css/components.css` in `../TM Suite`) rather than inventing a new visual language. Port the tokens/components actually needed, don't duplicate the whole stylesheet blind.

### v1 scope

- Character dossiers: your own character in full, everyone else's as a fixed-field whitelist summary.
- World tab: court holders, regents, offices.
- Lore: primer, game guide, rules, a friendlier rewrite of the house-rules errata — static pages.
- Deferred to v2: the living-city map, and any tooling/UI around fact-level "reveals" (the schema exists from v1, nothing reads/writes it via UI yet).

## Running & testing

No test framework is set up yet — the first story establishes it. Follow whatever the current story's dev notes specify once written.

## BMAD workflow

This repo uses the `bmad-loop` skill for story-by-story delivery: `bmad-create-story` → `bmad-dev-story` → `bmad-code-review` → commit (local only, per the hard rule above). `specs/stories/sprint-status.yaml` tracks position.
