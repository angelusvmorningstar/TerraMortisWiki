# Terra Mortis Wiki

A read-only, player-facing companion site for the Terra Mortis *Vampire: The Requiem 2e* chronicle. It sits alongside `TM Suite` (the ST-facing character management app) and reads from a committed JSON snapshot of the `tm_suite` MongoDB — it never queries or writes to that database at request time.

See `specs/prd.md`, `specs/architecture.md`, and `specs/epics.md` for the full product and architecture decisions, and `CLAUDE.md` for the repo's hard rules.

## Requirements

- Node.js 18+ (uses the built-in `fetch` and `node --test`; developed on Node 24)

## Install

```bash
npm install
```

## Run

```bash
npm start
```

Serves the site on `http://localhost:3000` by default. Override the port with the `PORT` environment variable:

```bash
PORT=4000 npm start
```

## Test

```bash
npm test
```

Runs the smoke test suite via Node's built-in test runner (`node --test`) — no third-party test framework.

## Project layout

```
server/            Express app (skeleton; auth + routes arrive in later stories)
public/css/        design tokens (theme.css) + base layout, ported from TM Suite
specs/             PRD, architecture, epics, stories
```

Later stories add `scripts/` (the on-command Mongo → JSON snapshot script), `data/` (the committed snapshot), and `content/lore/` (static lore markdown).
