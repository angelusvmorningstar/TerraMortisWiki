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

## Snapshot (ST-only, manual)

`data/snapshot.json` is how the deployed site gets its data. It is generated on
command — never at request time — by reading `tm_suite` read-only, and is
committed like any other change. The deployed service holds no Mongo connection.

### Read-only setup (one-time, manual)

In the MongoDB Atlas console, provision the database user this script connects as
with a **read-only** role on `tm_suite` (e.g. `read`). The script itself issues
zero write calls, but Atlas IAM is the real enforcement layer — the client cannot
enforce read-only from its side. (This mirrors how the Discord redirect URI is
registered manually in Story 1.3; the guardrail lives outside this codebase.)

### Running it

```bash
# 1. Put the read-only connection string in a local .env (gitignored — never commit):
echo 'MONGODB_URI=mongodb+srv://<read-only-user>:<pw>@<cluster>/tm_suite?...' > .env

# 2. Generate the snapshot:
npm run snapshot        # == node scripts/snapshot.mjs
```

- **Required env var:** `MONGODB_URI` (read from `.env`). Optional `MONGODB_DB`
  (defaults to `tm_suite`).
- **Expected runtime:** seconds, not minutes (~41 characters + a handful of other
  small collections). If it hangs, connection has failed — see below.
- **On success** it prints one line and writes `data/snapshot.json`, e.g.:

  ```
  Snapshot written to .../data/snapshot.json in 1.4s — characters:41 dossiers:31 players:34 territories:20
  ```

  The output is deterministic: re-running with no underlying Mongo changes
  produces a byte-identical file, so `git diff data/snapshot.json` shows only
  real data changes.
- **On connection failure** (bad/missing URI, network, wrong credentials) it
  prints `Snapshot failed: <reason>`, exits non-zero, and does **not** write or
  truncate `data/snapshot.json`. Missing `MONGODB_URI` prints a setup hint and
  exits non-zero.

After a successful run, review the diff, then commit and push `data/snapshot.json`
so the deploy picks up the fresh data.

## Project layout

```
server/            Express app (skeleton; auth + routes arrive in later stories)
scripts/           on-command Mongo → JSON snapshot script (snapshot.mjs)
data/              the committed snapshot.json the deployed app reads
public/css/        design tokens (theme.css) + base layout, ported from TM Suite
specs/             PRD, architecture, epics, stories
```

Later stories add `content/lore/` (static lore markdown).
