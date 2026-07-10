# F17 - Mock data generator - plan

How to build the spec. TDD: RED (test-writer subagent) -> GREEN (min code per AC) -> REFACTOR ->
VERIFY (fresh subagent).

## Approach

Pure-frontend feature over the existing insert pending-edits pipeline (mirrors F11/F13 - no backend
change). Three layers:

1. **Pure logic** (`src/lib/workspace/mock-data.ts`) - strategy types, `autoStrategy` (heuristic),
   `generateRows` (seeded deterministic ADT generator). All ACs about detection/generation prove
   here (fast, no DOM).
2. **Isolated context** (`MockDataContext` in `workspace-context.tsx`) - `isMockDataOpen` /
   `openMockData` / `closeMockData`, mounted like `StructureViewContext` so the open flag never
   churns the heavy `TableCard`.
3. **Dialog UI** (`src/components/workspace/mock-data-dialog.tsx`) - rendered inside `LiveTable`
   (which owns structure/preview/columns/upsertPendingEdit/editable). Reuses the shared read-only
   `DataGrid` for preview (ONE-grid rule) + the radix `Dialog` chrome (like `DocumentEditorDialog`).

Design pattern: **Strategy** (one generator function per `MockStrategyKind`, dispatched by kind) -
avoids an if-chain. ADT `Result` for validation (no throw), per coding standards.

## File changes

### New

- `src/lib/workspace/mock-data.ts` - `MockStrategyKind`, `MockColumnConfig`, `MockParams`,
  `autoStrategy(column)`, `generateRows(configs, count, seed): Result<Record<string,string|null>[]>`,
  `MAX_MOCK_ROWS = 200`. Seeded PRNG (mulberry32-style, pure). Small built-in word/name lists.
- `src/components/workspace/mock-data-dialog.tsx` - `MockDataDialog`: takes `open`, `columns`
  (name/dataType/isPrimaryKey), `engine`, `preview`, `canGenerate` (editable), `onClose`,
  `onStageInserts(rows)`. Local state: per-column config, count, seed, preview rows, error. Renders
  the column strategy table, count/seed inputs, Preview button -> `generateRows` -> read-only
  `DataGrid`, Insert -> `onStageInserts`.
- `src/lib/workspace/__tests__/mock-data.test.ts` - pure-logic tests (AC-003/004/005/006/010).
- `src/components/workspace/__tests__/mock-data-dialog.test.tsx` - dialog + staging tests
  (AC-002/007/008/009/010 UI).
- `src/components/workspace/__tests__/mock-data-command.test.tsx` - palette command presence
  (AC-001). (Test-writer picks final split/names; these are the targets.)

### Modified

- `src/components/workspace/command-registry.ts` - add `"generate-mock-data"` to
  `PaletteCommandId`; add a `PALETTE_COMMANDS` entry (group `Create`, `when: (s) => s.isTableActive`).
  (No shortcut binding -> omit `actionId`, like `new-tab`.)
- `src/components/workspace/command-palette.tsx` - map `"generate-mock-data"` -> `openMockData` from
  `useMockData()`. `isTableActive` already computed.
- `src/components/workspace/workspace-context.tsx` - add `MockDataContext` + `useMockData` (optional,
  like `useStructureView`), `isMockDataOpen` state + memoized value, mount the provider alongside
  `StructureViewContext`.
- `src/components/workspace/table-card.tsx` - in `LiveTable`, read `useMockData()`; render
  `<MockDataDialog open={isMockDataOpen} ... onStageInserts={stageMockInserts} />`. Add
  `stageMockInserts(rows)`: for each row `upsertPendingEdit({kind:"insert", id, draftId, tableId,
  tableName, values: row, sql: preview.insert(tableName, row)})` (same shape as `addRow`/`cloneRow`),
  then `closeMockData()`. Pass `canGenerate = editable`, `columns` from the fetched
  `data.pages[0].columns` (name/dataType/isPrimaryKey - uniform SQL+Mongo), `preview`. Dialog is only
  rendered by LiveTable, so it's never mounted for a static/mock table.

## Execution order (per-AC commits)

1. **RED**: spawn test-writer subagent (task file `.pzielinski/F17.md`). Confirm suite red.
2. `feat: AC-003/004/005/006/010 mock-data pure generator + autoStrategy` - `mock-data.ts` green.
3. `feat: AC-001 generate-mock-data palette command` - registry + palette + MockDataContext.
4. `feat: AC-002/007/008/009 mock data dialog + insert staging` - dialog + LiveTable wiring.
5. **REFACTOR**: extract strategy dispatch / tidy, tests stay green.
6. **VERIFY**: fresh verifier subagent; loop until all PASS; write AC traceability into `.pzielinski/F17.md`.

## Auto-detect heuristic (autoStrategy)

Priority: name heuristic first (`email` -> email; name-like -> fullName), else by dataType (lowercased,
prefix match):

- `int`/`serial`/`bigint`/`smallint` -> integer PK ? `sequence` : `integer` (min 1, max 1000)
- `numeric`/`decimal`/`real`/`double`/`float` -> `decimal`
- `bool` -> `boolean`
- `uuid` -> `uuid`
- `date`/`timestamp`/`time` -> `date`
- `text`/`char`/`varchar`/`string` -> `words` (count 3)
- Mongo `_id` -> `skip`
- fallback -> `words`

## Edge cases -> tests

| Edge | Test |
| ---- | ---- |
| no PK / read-only -> Insert disabled, nothing staged | dialog test AC-008 |
| structure not loaded -> empty cols, disabled | dialog test (loading) |
| count 0 / 201 / blank -> blocked | pure + dialog AC-004 |
| empty enum -> Err, nothing staged | pure AC-010 + dialog |
| skip vs null distinct | pure AC-006 |
| deterministic same seed | pure AC-005 |
| mongo _id skip + insertOne sql | dialog AC-009 |

## Acceptance verification

Gates (fresh verifier): `npx tsc --noEmit`, `npm run lint`, `npm test` (full suite), plus adversarial
edge probing. Coverage threshold: none. No new Rust -> no `cargo test` needed (confirm no
`src-tauri` diff). Visual check: dialog opens from palette, columns list, Preview grid renders,
Insert appends draft rows, no rounded corners, `Select` uses `position="popper"`.

## Doc drift

- README.md: no new command/dep/module a human runs -> no change (confirm).
- CLAUDE.md: add a bullet describing the mock-data generator seam (pure logic in `mock-data.ts`,
  reuses insert pipeline, isolated `MockDataContext`) after the JSON-view bullet.
- docs/design.md: if the dialog introduces any new visual rule (it shouldn't - reuses Dialog + grid +
  square controls), note it; else no change.
