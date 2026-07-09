# F11 - Read-only connection mode - Implementation Plan

Derived from the approved `spec.md`. Reuses existing seams; no backend change.

## Approach

One persisted boolean `readOnly` on the database node, threaded to the two write-path
owners. It reuses the EXISTING read-only rendering rather than adding disabled states:

- Table writes: fold `readOnly` into the existing `editable` gate ->
  `editable = primaryKey !== null && !readOnly`. Every affordance (inline edit, Add-row,
  delete/bulk-delete, clone, Mongo doc-edit, JSON-view auto-stage) already keys off
  `editable`, so one term disables them all with zero new branches. The Save bar also
  respects it (a DB toggled read-only after staging can't commit; Discard stays).
- SQL writes: reuse the pure `isWriteSql` guard (dispatch.ts) in the SQL tab's `submit`,
  gated by `node.readOnly`. Same guard + same block UX (sticky toast + error line) the
  Script tab already ships.

Domain-modeling gate: neither `pz-ddd` nor `pz-archetypes` apply - this is a UI feature
flag + a boundary write-guard, not a domain model, aggregate, or recurring domain shape.

## Files to change

### Data model + persistence

1. [src/lib/workspace/model.ts](../../../src/lib/workspace/model.ts)
   - `DatabaseNodeBase`: add `readOnly: boolean`.

2. [src/lib/workspace/workspace.ts](../../../src/lib/workspace/workspace.ts)
   - `PersistedNetworkDatabase | PersistedSqliteDatabase | PersistedMongoDatabase`: add
     `readOnly?: boolean`.
   - New `mergeReadOnly(value): { readOnly: boolean } | undefined` - returns `{readOnly:true}`
     only when `value === true`; anything else (incl. `false`, non-boolean) -> `undefined`
     (omit). Mirrors `mergeAccentColor`.
   - `mergeDatabase`: spread `...mergeReadOnly(value.readOnly)` into all three shapes.
   - `hydrate`: `readOnly: node.readOnly ?? false` in the runtime base.
   - `dehydrate`: `const readOnly = node.readOnly ? { readOnly: true } : undefined;` spread
     into all three shapes (omit when false, like accent).

### Provider action

3. [src/components/workspace/workspace-context.tsx](../../../src/components/workspace/workspace-context.tsx)
   - Pure `setReadOnly(nodes, databaseId, readOnly)` recursive tree map (copy of
     `setAccentColor`).
   - Context type: `setDatabaseReadOnly: (id: string, readOnly: boolean) => void`.
   - Action impl: `setDatabaseReadOnly: (id, ro) => setTree((c) => setReadOnly(c, id, ro))`.
   - Include in the context value + its deps (mirror `setDatabaseAccent`).

### Settings UI

4. [src/components/workspace/settings-tab.tsx](../../../src/components/workspace/settings-tab.tsx)
   - New `ReadOnlyField({ nodeId, readOnly })` rendering a labelled accessible switch
     (`role="switch"`, `aria-checked`, keyboard-toggle, square, theme tokens). Calls
     `setDatabaseReadOnly(nodeId, next)`.
   - Render it directly under `<AccentField .../>` in `ConnectionForm` (line ~300), reading
     `node.readOnly`.

### Table write gate

5. [src/components/workspace/table-card.tsx](../../../src/components/workspace/table-card.tsx)
   - `TableCard`: pull `nodesById` from `useWorkspace()`; resolve the database node
     (`databaseId ? nodesById.get(databaseId) : undefined`); compute
     `const readOnly = dbNode?.kind === "database" ? dbNode.readOnly : false;` and pass
     `readOnly` to `<LiveTable />`.
   - `LiveTable`: accept `readOnly: boolean`; change
     `const editable = primaryKey !== null && !readOnly;`.
   - Save bar: when `readOnly`, hide the Save button (keep Discard) OR disable+no-op `save`.
     Chosen: hide Save when `readOnly` so a read-only DB shows only Discard for any
     pre-existing staged edits. (`save()` also early-returns when `readOnly` as belt-and-braces.)

### SQL write gate

6. [src/components/workspace/sql-tab.tsx](../../../src/components/workspace/sql-tab.tsx)
   - `SqlPane` already receives `node`; read `node.readOnly`.
   - In `submit` (SQL engines only - Mongo Query tab is already read-only at the backend so
     skip the guard when `engine === "mongodb"`), before `run.mutate`: if
     `readOnly && isWriteSql(query)` -> `toast.warning(..., { duration: Infinity })`, push a
     History error entry (status `error`, message "blocked (read-only)"), and `return`
     without sending. Import `isWriteSql` from `@/lib/script/dispatch`.

### Docs

7. [docs/design.md](../../../docs/design.md) - add the read-only switch to the UI conventions
   only if it introduces a reusable control pattern (accessible square switch). Otherwise note
   the accent+read-only pairing as prod cues.
8. `.pzielinski/todos.md` - flip F11 `Status:` to `done` + check the box (after merge).

## Execution order (TDD)

1. RED: model/persistence tests (merge/hydrate/dehydrate round-trip incl. AC-006 garbage),
   provider `setDatabaseReadOnly` test, settings-toggle test, table `editable=false` test,
   SQL write-block test. Confirm red.
2. GREEN: implement 1-6 minimally until each passes.
3. REFACTOR: dedupe merge/tree-map helpers with the accent equivalents if it reads cleaner
   (only if genuinely shared - don't over-abstract).

## Acceptance verification

- AC-001 -> settings-tab test: toggle calls `setDatabaseReadOnly`, reflects node value.
- AC-002 -> workspace.ts round-trip test: dehydrate(true) persists `readOnly:true`;
  hydrate restores; false is omitted.
- AC-003 -> table-card test: `readOnly` node -> `editable` false -> no edit/Add-row/delete;
  JSON view read-only (no `onSaveJson`).
- AC-004 -> sql-tab test: `readOnly` + write SQL -> not sent (executeSql spy not called),
  toast + history error; read SQL -> sent.
- AC-005 -> existing table/sql tests stay green with `readOnly` default false.
- AC-006 -> workspace.ts test: `readOnly: "yes"` -> hydrates false, no throw.

## Risks

- Missing a write affordance not gated by `editable`: mitigated - grep confirmed every
  table mutation handler is wired through `editable` in the JSX (lines 1054-1067) + the
  Save bar is the only commit site. SQL tab `submit` is the only other send.
- `isWriteSql` is prefix-only (documented): a read-led multi-statement buffer chaining a
  write is not caught. Accepted, same as Script tab; noted in TC-006.
