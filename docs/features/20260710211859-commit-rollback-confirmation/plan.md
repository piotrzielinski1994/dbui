# F12 - Plan

Approach: frontend confirm-before-send gate, NO backend change. Mirror F11 (`readOnly`)
byte-for-byte for the flag; add a shared `ConfirmWriteDialog` gating the two write paths.

## Task breakdown

1. Model: `DatabaseNodeBase.confirmWrites: boolean` in `src/lib/workspace/model.ts`.
2. Persistence: `src/lib/workspace/workspace.ts` - `confirmWrites?: boolean` on the 3 persisted
   node shapes; `mergeConfirmWrites` (keep only `true`); hydrate default false; dehydrate omit
   false. Clone `mergeReadOnly`/`readOnly` handling at every site.
3. Provider: `src/components/workspace/workspace-context.tsx` - `setDatabaseConfirmWrites(id, bool)`
   + `setConfirmWrites` tree map (clone `setReadOnly`); default `confirmWrites: false` in
   new-database creation + provider defaults + context type.
4. Settings UI: `src/components/workspace/settings-tab.tsx` - `ConfirmWritesField` (clone
   `ReadOnlyField`), rendered under `ReadOnlyField`.
5. Shared dialog: NEW `src/components/workspace/confirm-write-dialog.tsx` - Dialog primitive, mono
   SQL block (one or many lines), Cancel + Commit buttons.
6. SQL path: `src/components/workspace/sql-tab.tsx` - thread `confirmWrites` into `SqlPane`; in
   `submit`, after the readOnly block, when `confirmWrites && isWrite` stash the effective SQL in a
   pending-write state to open the dialog instead of `run.mutate`; Commit -> `run.mutate(pending)`,
   Cancel -> clear.
7. Table path: `src/components/workspace/table-card.tsx` - thread `confirmWrites` into `LiveTable`
   (like `readOnly`); `save` opens the dialog (listing the pending SQL) when `confirmWrites`;
   Commit runs the existing apply body.
8. Fixtures: `confirmWrites: false` in `src/components/workspace/__tests__/fixtures.ts`.

## Execution order (TDD)

RED (test-writer subagent) -> GREEN per AC -> REFACTOR -> fresh verifier.

Tests:
- `src/lib/workspace/__tests__/confirm-writes.test.ts` - persist (merge/hydrate/dehydrate/round-trip). AC-002, AC-008.
- `confirm-writes-settings.test.tsx` - toggle reflects + flips. AC-001.
- `confirm-writes-context.test.tsx` - setter flips target only + fires onTreeChange. AC-001, AC-002.
- `confirm-writes-sql.test.tsx` - Run write -> dialog, executeSql gated; Commit sends; Cancel discards; read passes through; readOnly wins; off = immediate. AC-004..007.
- `confirm-writes-table.test.tsx` - Save -> dialog, applyRowMutations gated; Commit applies; off = immediate. AC-003, AC-006.

## File changes

Model + persistence + provider + settings + 2 consumers + 1 new dialog + fixtures + 5 test files.

## Acceptance verification

Each AC maps to a named test (see `.pzielinski/F12.md` traceability, filled after verify).
Gates: `tsc`, lint, full `npm test`. No coverage threshold configured.
