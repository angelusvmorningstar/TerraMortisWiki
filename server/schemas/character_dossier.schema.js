// character_dossier schema — READ-ONLY reference mirror for the Terra Mortis Wiki.
//
// The authoritative writer of this collection is TM Suite
// (`../TM Suite/server/schemas/character_dossier.schema.js`). This Wiki repo
// never writes the collection; it only reads it into `data/snapshot.json`
// (Story 1.2) and later projects it per-viewer. This file exists so the Wiki has
// a documented, in-repo definition of the fact shape it consumes — and, per
// AC #4, so the `revealed_to` reveals field is a first-class part of that
// documented shape from day one.
//
// SCHEMA-SUPPORT ONLY (AC #4): nothing in Story 1.2 authors or reads
// `revealed_to`. The snapshot script round-trips whole `character_dossier`
// documents untouched, so a `revealed_to` value present on a fact passes through
// into the snapshot automatically — mirroring the schema here (rather than
// wiring runtime AJV validation into the script, which would add a dependency
// for a field that only needs to round-trip) is the simpler of the two options
// the story offered, and is the choice recorded in the Dev Agent Record.

export const characterDossierSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'TM Character Dossier',
  type: 'object',
  additionalProperties: true,
  required: ['character_id'],
  properties: {
    character_id: { type: ['string', 'object'] },
    facts: {
      type: 'array',
      items: {
        type: 'object',
        required: ['tag', 'value'],
        properties: {
          tag:         { type: 'string' },            // normalised classification (DOSSIER_TAGS)
          value:       { type: 'string' },            // the datum
          source:      { type: 'string' },            // history | sheet | st | downtime
          npc_id:      { type: ['string', 'null'] },  // link when the fact references a person/entity
          sheet_field: { type: ['string', 'null'] },  // sheet field this maps to, if any
          sheet_value: { type: ['string', 'null'] },  // sheet value at extraction time
          clash:       { type: 'boolean' },           // true when value contradicts the authoritative sheet
          note:        { type: ['string', 'null'] },  // ST-facing note
          st_hidden:   { type: 'boolean' },           // ST-only (secrets, sensitive obligations)
          severity:    { type: ['string', 'null'], enum: ['trivial', 'minor', 'major', 'life_threatening', null] },
          compromised: { type: ['boolean', 'null'] }, // tag=secret: has it been exposed?
          status:      { type: ['string', 'null'], enum: ['outstanding', 'repaid', null] }, // tag=boon|debt
          counterparty:{ type: ['string', 'null'] },  // tag=boon|debt: the other party (npc_id or name)
          // STORY 1.2 (AC #4) — Reveals. Character `_id`s this fact has been
          // explicitly shown to, DESPITE `st_hidden`. `null` (or absent) means
          // no per-viewer reveal restriction beyond the st_hidden gate. Authored
          // only via ad hoc TM Suite scripts (no Wiki UI in v1/v2); the schema is
          // the sole guardrail. See specs/architecture.md "Reveals".
          revealed_to: { type: ['array', 'null'], items: { type: 'string' } },
        },
        additionalProperties: true,
      },
    },
    source_history_id: { type: ['string', 'object', 'null'] },
    updated_at:        { type: 'string' },
  },
};
