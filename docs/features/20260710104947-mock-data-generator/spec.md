# F17 - Mock data generator

Generate synthetic rows for the open live table and stage them as reversible draft inserts.

**Status: specced** (branch `20260710104947-mock-data-generator`; awaiting approval).

## Overview

Filling a table with realistic-looking test data by hand is tedious. This feature adds a **"Generate
mock data"** palette command (Create group), enabled only when a **live editable table** is active.
It opens a dialog that:

1. Lists every column of the open table with a **strategy** selector, pre-set to a type/PK/name-aware
   auto default.
2. Takes a **row count** (1..200) and a **seed**.
3. **Preview** renders a deterministic sample of the generated rows in the shared read-only
   `DataGrid`.
4. **Insert** stages one draft `insert` mutation per row through the EXISTING pending-edits pipeline -
   the same `kind:"insert"` shape as Add-row/Clone - so the rows appear as draft grid rows, are
   reversible via Discard/Changes tab, and commit through the single table Save gate.

**No backend change.** Generation is pure frontend; staging reuses `upsertPendingEdit` +
`preview.insert`; committing reuses the existing `applyRowMutations` insert path. Columns come from
the live fetched rows' `columns` (`TableRows.columns`: name/dataType/nullable/isPrimaryKey) - the same
uniform, engine-agnostic metadata the grid's `columnMeta` already uses (Mongo flattens documents to
this shape), so the dialog needs no engine branch and no extra structure fetch.

Pairs with the "ONE data grid" rule (preview uses the shared `DataGrid`, `editable={false}`) and the
`editable = primaryKey !== null && !readOnly` gate (F11): a read-only DB or a PK-less table cannot
generate.

## Non-goals (YAGNI)

- Committing the rows directly to the DB from the dialog (they stage as pending edits; commit is the
  existing table Save gate).
- Locale-aware / production-realistic faker data (no `faker` dependency; small built-in word lists).
- Persisting generator config per table across launches (in-memory dialog state only).
- FK-aware generation (drawing values from a referenced table). Documented follow-up.
- Regex/pattern/custom-JS strategies. Fixed strategy set only.
- Generating into the SQL result pane (no single target table there).

## Acceptance Criteria

- AC-001: A palette command "Generate mock data" (Create group) shows when a table tab is active and
  is hidden for a database tab or when no table is active (gated on `isTableActive`, like the JSON /
  Structure view commands). Whether the active table can actually generate is enforced by the dialog
  (AC-008), not the command's visibility.
- AC-002: Opening it shows the Mock Data dialog listing EVERY column of the open table, each with a
  strategy selector pre-set to a type/PK-aware auto default (nothing hidden or force-skipped; the
  default is a visible, overridable pick).
- AC-003: Auto-detection maps data type -> default strategy: integer types -> integer range (an
  integer PK -> `sequence`), numeric/decimal -> decimal, boolean -> boolean, uuid -> uuid,
  date/timestamp -> date, text/varchar/char -> words; plus a column-name heuristic (`email` -> email,
  a name-like column -> fullName). Mongo `_id` defaults to `skip`.
- AC-004: The row-count input accepts 1..200; a value outside the range cannot generate (blocked) -
  never more than 200 rows staged.
- AC-005: Preview renders a read-only sample of the generated rows in the shared `DataGrid`; the same
  config + seed is deterministic (identical rows on regenerate with the same seed), and each strategy
  yields a value matching its kind (integer within [min,max]; boolean in {true,false}; email contains
  `@`; uuid matches the uuid shape; enum a member of its list; sequence = start + rowIndex).
- AC-006: A column set to "Skip" is OMITTED from the generated insert entirely (DB fills
  default/serial); a column set to "Null" is INCLUDED with a null value. The two are distinct.
- AC-007: "Insert" stages one draft `insert` mutation per generated row via `upsertPendingEdit` (same
  shape as Add-row: `kind:"insert"`, `values`, `sql` via `preview.insert`), each reversible via
  Discard/Changes tab; the dialog then closes and N draft rows appear appended to the grid.
- AC-008: A read-only database or a table without a primary key cannot generate: the dialog's Insert
  is disabled with an explanatory note and no mutations are staged.
- AC-009: MongoDB collections generate documents: columns come from the fetched rows' columns (the
  flattened-document shape), strategies auto-detect, and Insert stages `insertOne`-shaped inserts
  (`preview.insert` builds a `db.<coll>.insertOne({...})` string) through the same pipeline.
- AC-010: The enum / fixed / words strategies expose their params (value list, fixed value, word
  count) in the dialog and honor them in generation; an empty enum list is a validation error that
  blocks generation (nothing staged).

## Test Cases

- TC-001 (happy path, AC-001/002): live PG table `users` active -> "Generate mock data" present in the
  palette -> dialog lists all columns with auto defaults. Maps to AC-001, AC-002.
- TC-002 (auto-detect, AC-003): columns `id int8 PK`, `active bool`, `email varchar`, `note text`,
  `created_at timestamp`, `uid uuid` default to sequence/boolean/email/words/date/uuid respectively.
  Maps to AC-003.
- TC-003 (cap, AC-004): count `201` blocks generation (no rows); count `0` blocks; `200` allowed.
  Maps to AC-004.
- TC-004 (deterministic + kinds, AC-005): `generateRows(config, seed)` called twice with the same
  seed -> deep-equal; every integer-strategy value within [min,max]; sequence value = start + row
  index. Maps to AC-005.
- TC-005 (skip vs null, AC-006): a `skip` column's key is absent from every values object; a `null`
  column's key is present with value `null`. Maps to AC-006.
- TC-006 (stage, AC-007): Insert of 3 rows -> exactly 3 `insert` pending edits, each `sql` produced by
  `preview.insert`; the grid shows 3 appended draft rows; Discard clears them. Maps to AC-007.
- TC-007 (read-only / no-PK, AC-008): a read-only DB (or PK-less table) -> Insert disabled + note; no
  `upsertPendingEdit` call. Maps to AC-008.
- TC-008 (mongo, AC-009): a mongo collection -> columns from the fetched rows' columns; each staged
  insert's `sql` is `db.<coll>.insertOne({...})`. Maps to AC-009.
- TC-009 (params + validation, AC-010): enum strategy with list `["a","b"]` -> every generated value
  in {a,b}; an empty enum list -> validation error, generation blocked, nothing staged. Maps to
  AC-010.

## Data model

Pure logic in `src/lib/workspace/mock-data.ts` (no new persisted state):

- `MockStrategyKind =
  "skip" | "null" | "sequence" | "integer" | "decimal" | "boolean" | "uuid" | "date" | "words" |
  "fullName" | "email" | "enum" | "fixed"`.
- `MockColumnConfig = { column: string; kind: MockStrategyKind; params: MockParams }` where
  `MockParams` is a discriminated set carrying only the fields a kind needs (e.g. `{ min, max }`,
  `{ start }`, `{ values: string[] }`, `{ value: string }`, `{ count: number }`).
- `autoStrategy(column: { name; dataType; isPrimaryKey })` -> `MockColumnConfig` (the type/name/PK
  heuristic).
- `generateRows(configs: MockColumnConfig[], count: number, seed: number)` ->
  `Result<Record<string, string | null>[], string>` - deterministic (seeded PRNG), validates params
  (empty enum -> `Err`), omits `skip` columns, emits `null` for `null` columns, and stringifies every
  value (the pending-edit `values` map is `Record<string, string | null>`, matching the existing
  insert shape). ADT result, not throw.

New in-memory context `MockDataContext` (`isMockDataOpen` / `openMockData` / `closeMockData`),
isolated like `StructureViewContext` so the dialog's open flag never churns the heavy `TableCard`.

## Edge cases

1. No primary key / read-only DB -> Insert disabled, note shown, nothing staged (AC-008).
2. Structure not yet loaded (SQL eager fetch pending) -> column list empty/loading, Preview/Insert
   disabled.
3. Count out of range (0, 201, blank, non-integer) -> generation blocked (AC-004).
4. Empty enum list / other invalid params -> validation error, nothing staged (AC-010).
5. `skip` vs `null` are distinct outcomes (AC-006).
6. Deterministic output for a fixed seed; Regenerate re-rolls a new seed (AC-005).
7. Mongo `_id` -> defaults to `skip` (server-assigned); other Mongo fields auto-detect from sampled
   type (AC-009).
8. Generated PK/sequence values can collide with existing rows on commit -> documented gap (bounded by
   the explicit Changes-tab Save gate that shows the SQL first; same footgun as manual Add-row).

## Dependencies

None. Builds on the existing insert pending-edits pipeline (`upsertPendingEdit`, `preview.insert`,
`applyRowMutations`), `TableStructure`/`TableSchema` introspection (F6), the shared read-only
`DataGrid` (ONE-grid rule), and the palette command registry.

## Known gaps (documented, not addressed)

- No FK-aware value drawing (a FK column generates a raw value, not necessarily an existing referenced
  key). Follow-up.
- Sequence/PK collision with existing rows is not detected before commit (edge case 8).
- Mongo type auto-detection is best-effort over sampled fields; user overrides per column.
