# F11 - Read-only connection mode (prod safety)

> Status: implemented on branch `20260709125736-read-only-connection`. All 6 ACs verified
> green (npm test 1003 pass, tsc clean, lint 0 errors). AC traceability in `.pzielinski/F11.md`.
> Backlog item F11 in `.pzielinski/todos.md` (flip to `done` on merge).

## Overview

A per-database **Read-only** toggle that, when on, blocks every write path to that
database at the application boundary - before any statement/mutation reaches the backend.
It is a safety cue for connecting to production: pair it with the per-database accent
color ("this is prod") so a destructive action is impossible by accident.

The flag lives on the database node, is edited in the database **Settings** tab (next to
the accent-color field), and is **persisted in `workspace.json`** (mirrors how
`accentColor` / `savedScripts` persist on the node - NOT `settings.json`).

## Why

Today any connected database is fully writable: inline cell edits, row insert/delete,
JSON-view auto-stage, and write-shaped SQL in the SQL tab all reach the DB on Save/Run.
Connecting to prod with the same client used for dev is a foot-gun. A read-only flag makes
"look but don't touch" a first-class, persisted per-connection setting.

## Scope: the write paths blocked when read-only is ON

There are exactly two families of write path, both already funneled through single seams:

1. **Table mutations** (the `editable` gate in [table-card.tsx](../../../src/components/workspace/table-card.tsx)):
   inline cell edit, row insert (Add row), row delete / bulk delete, clone row, Mongo
   document replace, and JSON-view auto-stage. Today all gate on `editable = primaryKey !== null`.
   Read-only forces `editable = false`, so the grid renders exactly like the no-PK
   read-only path already does (no edit affordances, no Add-row, no delete, JSON view is a
   read-only viewer). This reuses an EXISTING code path - no new "disabled" rendering.
2. **Write-shaped SQL in the SQL tab** ([sql-tab.tsx](../../../src/components/workspace/sql-tab.tsx) `submit`/`run`):
   a statement whose leading keyword is a write (INSERT/UPDATE/DELETE/DROP/ALTER/CREATE/
   TRUNCATE/REPLACE/MERGE/GRANT/REVOKE) is rejected before `executeSql`, reusing the pure
   `isWriteSql` guard from [dispatch.ts](../../../src/lib/script/dispatch.ts) (same guard
   the Script tab already uses). Block = sticky warning toast + Console error line + the
   statement never sent. Best-effort / prefix-only, exactly as documented for the Script tab.

**Out of scope / already safe:**
- The **Mongo Query tab** is already read-only at the backend (`parse_command` only accepts
  `find`/`aggregate`; anything else errors). No frontend change needed there - a Mongo
  database with read-only ON therefore only tightens its table mutations.
- The **Script tab** `db.query` is already blocked by `isWriteSql` unconditionally (scripts
  are always read-only). Read-only mode doesn't change it.
- No backend change. The block is enforced entirely on the frontend boundary. (A truly
  DB-enforced read-only session is a bigger, separate feature - not this.)

## View-model: the flag

- New optional field on the database node: `readOnly: boolean` (default `false`).
- Runtime type `DatabaseNodeBase.readOnly: boolean`; persisted type
  `PersistedDatabase.readOnly?: boolean` (omitted when false, like `accentColor`).
- `mergeDatabase` keeps it only when it is a boolean; `hydrate` defaults missing -> `false`;
  `dehydrate` omits `false`.
- Provider action `setDatabaseReadOnly(id, readOnly)` mirrors `setDatabaseAccent` exactly
  (recursive `setReadOnly` tree map -> `setTree` -> existing persist effect).
- Read via `activeNode` in the components that own a write path (table-card, sql-tab), same
  as they read the node today.

## UI

- A **Read-only** labelled toggle in the Settings tab, directly under the accent-color
  field (both are per-database safety cues). Rendered as an accessible switch
  (`role="switch"`, `aria-checked`), square (no rounded corners), theme-token colored -
  there is no existing `Switch` component so it is a small local control obeying design.md.
- No separate icon/badge in the tree or tabs for now (YAGNI - the accent color is the
  visual prod cue; the toggle state is visible in Settings). This keeps the diff minimal.

## Acceptance criteria

- AC-001: The database Settings tab shows a **Read-only** toggle reflecting the node's
  current `readOnly` value; toggling it flips `readOnly` on that database node.
- AC-002: `readOnly` persists to `workspace.json` (survives reload): a node saved
  read-only hydrates read-only; the field is omitted from the persisted shape when false.
- AC-003: When a table's database is read-only, the table card is **non-editable**: no
  inline cell editing, no Add-row button, no row delete / bulk delete / clone, no Mongo
  document-edit, and the JSON view is a read-only viewer (no auto-stage). Identical to the
  existing no-primary-key read-only rendering.
- AC-004: When a database is read-only, running a **write-shaped** SQL statement in the SQL
  tab is **blocked**: it is not sent to the backend, a sticky warning toast appears, and a
  Console/History error line is recorded. A **read** statement (SELECT/SHOW/EXPLAIN/WITH...
  SELECT/etc.) runs normally.
- AC-005: When a database is **not** read-only (default), all write paths behave exactly as
  today (no regression): table edits stage and save, write SQL runs.
- AC-006: The `readOnly` merge is defensive: a non-boolean persisted `readOnly` is dropped
  (treated as false), so a hand-edited/garbage `workspace.json` never crashes hydrate.

## User test cases

- TC-001 (happy, AC-001/003): Connect a Postgres DB, open a table -> rows editable. Open
  Settings, toggle Read-only ON. Reopen the table -> no edit affordances, no Add-row, no
  delete; double-clicking a cell does not enter edit mode. Maps to: AC-001, AC-003.
- TC-002 (happy, AC-004): With Read-only ON, in the SQL tab run `DELETE FROM users;` ->
  blocked, sticky toast "read-only", nothing sent, History shows an error line. Then run
  `SELECT * FROM users;` -> runs and returns rows. Maps to: AC-004.
- TC-003 (persistence, AC-002): Toggle Read-only ON, reload the app -> the DB is still
  read-only (Settings toggle on, table non-editable). Maps to: AC-002.
- TC-004 (no regression, AC-005): A DB with Read-only OFF: edit a cell -> stages; Save ->
  writes. Run `UPDATE ...` -> runs. Maps to: AC-005.
- TC-005 (edge, AC-006): `workspace.json` with `"readOnly": "yes"` (string) on a node ->
  hydrates as NOT read-only (false), no crash. Maps to: AC-006.
- TC-006 (edge, AC-004): Read-only ON, run a mixed buffer `SELECT 1; DELETE FROM t;` ->
  the guard is prefix-only per statement; document that a multi-statement buffer whose
  FIRST keyword is a read is NOT caught (same best-effort limitation as the Script tab).
  Decision: block at the **buffer** granularity the same way the Script tab does - reject
  if the buffer's leading keyword is a write; a read-led buffer that chains a write is a
  known gap (logged, not fixed here). Maps to: AC-004.

## UI States

| State                    | Behavior                                                              |
| ------------------------ | --------------------------------------------------------------------- |
| Read-only OFF (default)  | All write paths active; toggle shows unchecked.                       |
| Read-only ON, table      | Grid read-only (reuses no-PK path); no Add-row/delete; JSON viewer.   |
| Read-only ON, write SQL  | Sticky warning toast + Console error line; statement not sent.        |
| Read-only ON, read SQL   | Runs normally, returns rows.                                          |

## Data model

- `DatabaseNodeBase.readOnly: boolean` (runtime, always present, default false).
- `PersistedNetworkDatabase | PersistedSqliteDatabase | PersistedMongoDatabase`:
  `readOnly?: boolean` (persisted, omitted when false).
- No backend/IPC type change.

## Edge cases

- Non-boolean persisted value -> dropped (AC-006).
- Toggling read-only ON while a table has pending edits: the pending edits already exist in
  the Changes pipeline; read-only removes the affordance to ADD more and to Save from the
  table card's own bar. Decision: read-only also disables the table card Save bar (block the
  write at commit too), leaving Discard available. (The Changes-tab commit is the same
  `applyRowMutations` path; must also guard there if a global Save exists - verify.)
- Toggling read-only OFF re-enables everything immediately (no reconnect needed) - it's a
  pure frontend gate keyed off the live node value.
- SQLite/MySQL/Postgres/Mongo all honor the flag; Mongo's Query tab is already read-only so
  the flag only affects its table mutations.

## Dependencies

None. Reuses `isWriteSql` (dispatch.ts) and the existing `editable` gate + accent-setter
plumbing. No new backend command.
