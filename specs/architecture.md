# Terra Mortis Wiki — Architecture

Decisions below came out of the design roundtable (Winston/Architect leading, with John/PM narrowing scope and Mary/Analyst pressure-testing edge cases) plus Angelus's direct calls. Cite this document, not the roundtable transcript, for implementation.

## Shape

```
Snapshot script (run on command,       Wiki repo (this one)
 from the TM Suite dev environment) ─▶  data/snapshot.json  ─▶  Express service ─▶  Player's browser
        reads tm_suite (Mongo)             (committed)          (Discord OAuth +
        ONE TIME per run                                         per-viewer projection)
```

- **Snapshot script**: a Node script, run manually by Angelus (from this dev environment) at the close of a downtime cycle. Connects to `tm_suite` with a **read-only** Mongo Atlas database user, reads the collections below, writes `data/snapshot.json` (or a small set of per-domain JSON files) into this repo. Angelus commits and pushes; the normal Render/Netlify deploy picks up the new snapshot on the next deploy. The deployed service never holds a Mongo connection string.
- **Wiki service**: a thin Express app. Two jobs only: (1) Discord OAuth login, reusing TM Suite's Discord application and its existing `players` collection; (2) serve per-viewer-projected views computed from the snapshot loaded into memory at boot. No database driver in the deployed process.
- **No live query, ever, in v1 or v2.** This was a deliberate, explicit call (Angelus, over the PM's initial push for it): rebuild-on-command is the freshness model, not per-request Mongo reads.

## Auth — port, don't reinvent

TM Suite's existing pattern (`../TM Suite/server/routes/auth.js` + `../TM Suite/server/middleware/auth.js`) is:

1. `GET /api/auth/discord` redirects to Discord's OAuth2 consent screen (`identify` scope only).
2. `POST /api/auth/discord/callback` exchanges the code for a Discord access token, fetches the Discord profile, looks up (or auto-links by username) a matching doc in the `players` collection by `discord_id`, and returns the Discord `access_token` plus a `user` object (`role`, `player_id`, `character_ids`, `is_dual_role`).
3. The frontend holds that Discord `access_token` (not a wiki-issued JWT) and sends it as `Authorization: Bearer <token>` on every subsequent request.
4. `requireAuth` middleware validates the bearer token against Discord's `/users/@me` on each request (cached 60s per token, in-memory `Map`), re-derives `req.user` from the `players` collection lookup.

**Port this near-verbatim into the wiki's Express service.** Same Discord app (register the wiki's redirect URI as a second entry on the same Discord application — Discord supports multiple redirect URIs natively), same `players` collection shape read from the snapshot (not live Mongo). Do not invent a separate session/JWT scheme — the existing pattern is what "same authorisation as TM Suite" means concretely.

`players.character_ids` is already an array — multi-character-per-player is already representable even though every player has exactly one today. Do not special-case "one character" anywhere in the ownership logic.

The whole site sits behind this login. There is no anonymous/public tier in v1 (Angelus's explicit call).

## Data model

### Snapshot contents

The snapshot script reads (read-only) from `tm_suite`:
- `characters` — full documents, all 41 (including retired).
- `character_dossier` — the existing fact-extraction collection (`facts[]`, see `../TM Suite/server/schemas/character_dossier.schema.js` for the shape already in production — `tag`/`value`/`source`/`st_hidden`/etc.).
- `players` — for the `discord_id` ↔ `character_ids` mapping the auth layer needs. **Only the fields needed for auth** (`discord_id`, `role`, `character_ids`, `discord_username`) go into the snapshot — nothing else from this collection is player-facing.
- `territories` — for `regent_id` / `lieutenant_id` (World tab office data).
- Lore content (primer/game guide/rules/friendly errata) — see "Lore content" below for where this actually lives.

### Character dossier field whitelist (the "summary" tier)

This is a fixed list, same shape for every character, decided in the roundtable (Option A, not ST-curated prose):
- `name` (legal), `honorific`, `moniker` (i.e. however `displayName()` already resolves it in TM Suite)
- `clan`, `covenant`, `bloodline`
- `apparent_age`
- `retired` flag
- Any `character_dossier.facts[]` entries where `st_hidden` is **not** true AND (see reveals, below) either the fact has no `revealed_to` restriction, or the current viewer's character is in it.

Everything else on the character document (attributes, skills, disciplines, merits, XP, tracker state, secrets) is **owner-only** — visible solely when the viewer's `character_ids` includes this character's `_id`.

### Reveals — extend the existing fact schema, don't fork a new one

`character_dossier.schema.js` already has `st_hidden: boolean` per fact — a binary "ST-only vs public" flag. Add one field to the same fact shape rather than introducing a parallel collection:

```js
revealed_to: { type: ['array', 'null'], items: { type: 'string' } } // character _ids this fact has been explicitly shown to, despite st_hidden
```

A fact with `st_hidden: true` and `revealed_to: ['<Rene's character _id>']` is visible in Rene's view of that character's summary, and no one else's. This is authored by Angelus via an ad hoc script from the TM Suite dev environment (there is no admin UI for this in v1 or v2) — the schema is the only guardrail, so:
- `revealed_to`, when present, must be an array of valid `characters._id` values — the authoring script should verify referential integrity before writing (target character exists, every id in `revealed_to` exists) since nothing else will catch a typo.
- This field is **out of scope to build UI for** in v1. The schema supports it from day one; nothing in this app's routes needs to expose a way to *set* it.

Territory/map-level reveals (the Homebush example is literally a territory, not a character fact) are v2, alongside the map itself — no schema decision needed for v1 beyond not blocking it later.

### Lore content

Primer/game guide/rules/friendly-errata: **static files in this repo** (e.g. `content/lore/*.md`, rendered at build/serve time), not a new Mongo collection. Rationale: this content changes rarely, is authored by Angelus directly as prose (not extracted from play data), and per-request Mongo reads are explicitly out of scope anyway. The project's general "new reference data defaults to Mongo-backed" convention (documented in `../TM Suite/CLAUDE.md`) does not apply here — this is editorial prose content produced and edited directly in this repo, not structured game-rules data managed through an admin surface.

## Portraits

Never committed, never served. `assets/portraits/` (if it exists locally at all, e.g. for Angelus's own reference) is gitignored via `.gitignore`. Every character page and card renders a CSS-only placeholder tile (initial letter, tokenised colours) — there is no "if portrait exists, show it" branch to build; the placeholder is the only path in v1.

## CSS reuse

Port (not fork) the design tokens and components actually needed from `../TM Suite/public/css/theme.css` and `../TM Suite/public/css/components.css` — `:root` custom properties (colours, fonts, spacing), the parchment/gold-accent palette, Cinzel/Lora font stack, and any card/grid/chip component classes that fit this site's needs (e.g. `.char-card`, `.char-grid`, `.char-chip` equivalents). Follow the same rule TM Suite enforces on itself: no bare hex, no inline `style="..."`, reuse or extend a token/class, never invent a one-off.

## Directory layout (this repo)

```
server/            Express app: auth (ported), routes, view rendering
scripts/           snapshot.mjs (the on-command Mongo → JSON script)
data/              snapshot.json (committed, regenerated on command)
content/lore/      static lore markdown (primer, game guide, rules, friendly errata)
public/css/        ported design tokens/components from TM Suite
views/ or public/   rendered character/world/lore pages
specs/              this PRD, this architecture doc, epics.md, stories/
```

Exact framework choices for templating (server-rendered HTML vs a lightweight client render) are left to the story 1-1 implementation — match whatever is simplest given Express + the ported CSS, no new frontend framework needed for this scope.
