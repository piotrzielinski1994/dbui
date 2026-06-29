# DbUI

Briefing for Claude Code. Read [README.md](README.md) first - setup, commands, repo layout. This file lists conventions and the non-obvious bits not visible from reading individual files.

## Communication

- Keep replies short and to the point. No filler, no pleasantries, no recap of what the user just said.
- Status updates fit in one or two sentences.

## UI rules (non-negotiable)

- **All visual/interaction rules live in [docs/design.md](docs/design.md)** - read it before any UI change. Highlights, all enforced: NO rounded corners anywhere (`--radius` pinned to `0rem` in [src/index.css](src/index.css)); dividers are 1px and NEVER thicken/colour on hover or drag (use an invisible `::after` hit area); compact IDE density; theme tokens not hard-coded colors. The user has flagged rounded corners and thick borders repeatedly - treat either as a defect.
- **Sidebar tree drag-and-drop** (reparent databases/folders into folders, reorder siblings) mirrors the `requi` repo's `@dnd-kit/core` tree. Pure logic: [src/lib/workspace/tree-edit.ts](src/lib/workspace/tree-edit.ts) (`findNode`/`containsId`/`removeNode`/`insertNode`), [src/lib/workspace/move.ts](src/lib/workspace/move.ts) (`moveNode` + folder-parent/cycle guards), [src/lib/workspace/tree-locate.ts](src/lib/workspace/tree-locate.ts) (`projectDropPosition`/`dropTarget`/empty-zone ids); drag-state context is [src/components/workspace/tree-dnd.tsx](src/components/workspace/tree-dnd.tsx). **Only `folder` and `database` rows are draggable; `table` leaves are NOT** (ephemeral live-catalog nodes, never persisted-movable - so `moveNode` rejects a database/table parent, and `TableRow` has no drag wiring). A move flows through `WorkspaceProvider.moveNode` -> `setTree` -> the existing `onTreeChange` persist effect (no new wiring). dnd-kit pointer drags don't run in jsdom, so behavioral ACs live in the pure-lib tests; inject a crafted `TreeDndProvider` state to test cue rendering.
- **Sidebar multi-select** (Cmd/Ctrl+click toggle, Shift+click range, plain click resets) lives in `WorkspaceProvider`: `selectedIds: Set<string>` + `selectInTree(id, mode)` + `clearSelection`, with range computed over the VISIBLE rows by [src/lib/workspace/tree-select.ts](src/lib/workspace/tree-select.ts) (`flattenSelectable`/`rangeBetween`). Only folders/databases are selectable (tables excluded). Backspace/Delete (macOS delete emits Backspace) on a non-empty selection opens the shared `DeleteNodeDialog` (now takes `nodes: TreeNode[]` and renders "Delete N items?" for a multi-delete); the global window-keydown listener in [src/components/workspace/sidebar-tree.tsx](src/components/workspace/sidebar-tree.tsx) is guarded by `isEditableTarget` ([src/lib/workspace/is-editable-target.ts](src/lib/workspace/is-editable-target.ts)) so typing in an input/CodeMirror never deletes. Bulk delete flows through `removeNodes(ids)` (the single `removeNode` delegates to it). A right-click Delete on a row inside the selection deletes the whole selection.
- **Multi-select + drag** moves the WHOLE selection: dragging a row that is part of a multi-selection calls `moveNodes(ids, target)` ([src/lib/workspace/move.ts](src/lib/workspace/move.ts)); dragging an unselected row stays single (`moveNode`). `moveNodes` drops selected descendants of a selected folder (the folder carries them), inserts in tree document order, and rejects dropping into a dragged folder. It wants the RAW drop index, so `handleDragEnd` uses `rawDropTarget` (no single-node compensation) for the multi path while the single path keeps `dropTarget`'s compensation - `dropTarget` is now `rawDropTarget` + the single-node shift.
- **Sidebar/tab context menus** (ported from requi): the empty sidebar area ([src/components/workspace/sidebar-tree.tsx](src/components/workspace/sidebar-tree.tsx), `ContextMenu` wrapping the `<ul>`) -> New database / New folder at root; a folder row -> New database / New folder INSIDE it + Rename + Delete; a database row -> Connect/Disconnect + Rename + Delete; an open content tab ([src/components/workspace/content-header.tsx](src/components/workspace/content-header.tsx)) -> Close / Close other tabs / Close all. A row's own (nested) `ContextMenuTrigger` wins over the empty-area menu, so right-clicking a row shows the row menu, not the root one. Context actions live in `WorkspaceProvider`: `addDatabase(parentId?)` / `createFolder(parentId?)` (insert inside the folder, auto-expand it; `createFolder` then opens the inline rename), `renameNode(id, name)` (renames ANY node, ignores blank), `renamingNodeId`/`beginRename`/`cancelRename`, `closeOtherTabs(keepId)`. Inline rename is the requi `RenameInput` in [src/components/workspace/tree-row.tsx](src/components/workspace/tree-row.tsx) (Enter commits, Escape cancels, blur commits, with the readyRef guard against the radix focus-teardown blur; `onPointerDown` stops the drag from starting while editing). The separate `NewFolderDialog` + `addFolder(name)` (Cmd/Ctrl+Shift+N, command palette) still exist for the root-folder path.
- **Grid row multi-select**: the shared `DataGrid` takes `selectedRows: Set<number>` + `onSelectRow(index, mode)` (NOT a single `selectedRow`) - Cmd/Ctrl+click toggles, Shift+click ranges, plain click replaces, via the pure reducer [src/lib/workspace/row-select.ts](src/lib/workspace/row-select.ts) (`nextRowSelection`). The editable table card ([table-card.tsx](src/components/workspace/table-card.tsx)) holds the selection STAMPED with the `rows` array it was made against - when `rows` change (sort/filter/paging/refetch) the stamp mismatches and the selection reads empty, so a positional bulk delete never hits the wrong rows (no reset-effect; `set-state-in-effect` is a lint error here). Bulk delete = `onDeleteRows(indices)` -> stages one delete mutation per row (reversible via Changes tab, same as single delete); shown as "Delete N rows" in the row menu and bound to Delete/Backspace (guarded by `isEditableTarget` + the grid must contain focus). The read-only SQL result grid passes a stable empty Set + no `onDeleteRows`, so it's non-selectable. RecordView focuses `selection.anchor`.
- **ONE data grid, always identical.** The table card and the SQL result pane MUST render rows/cells/headers with the exact same component - [src/components/workspace/data-grid.tsx](src/components/workspace/data-grid.tsx) (`DataGrid`). Never fork a second grid or diverge their styling. Read-only callers (SQL results) pass `editable={false}` + no-op edit handlers; the editable table card passes the real ones. If a grid change is needed, change `DataGrid` so both update together. (Grid visual rules are in design.md.) **MongoDB documents render through this SAME grid** - the backend flattens documents to the shared `TableRows` shape (top-level keys -> columns, `_id` first + `PK`, nested object/array -> compact JSON text, missing field -> `[NULL]`). Do NOT build a document-specific view.

- **Customizable keyboard shortcuts** (ported from `requi`, with a `scope` added): every app shortcut is a `ShortcutAction` in the scoped registry [src/lib/shortcuts/registry.ts](src/lib/shortcuts/registry.ts) (`id`/`name`/`description`/`defaultHotkey`/`scope`, scope = `global`/`tab`/`grid`/`tree`/`editor`). Pure logic: [resolve.ts](src/lib/shortcuts/resolve.ts) (`resolveShortcuts` = override-else-default with `safeNormalize`; `findConflict` is **per-scope** - same combo in two scopes is NOT a conflict), [to-codemirror-key.ts](src/lib/shortcuts/to-codemirror-key.ts) (`Mod+Enter`->`Mod-Enter`), [match-hotkey.ts](src/lib/shortcuts/match-hotkey.ts). Overrides are a sparse `Settings.shortcuts` map persisted in a separate `keymap.json` (mirrors the `theme.json` split in [tauri-store.ts](src/lib/settings/tauri-store.ts)); `saveShortcut`/`resetShortcut` on the settings context. **Do NOT dispatch via `@tanstack/react-hotkeys`' `useHotkeys`** - under jsdom the lib resolves the test platform to "linux" so `Mod`->Control only, but every dbui test fires meta OR ctrl. Instead each component keeps its own window-keydown listener and matches with `matchesHotkey` (where `Mod` = `metaKey||ctrlKey`); the lib is used only for the recorder, normalize/validate, and `formatForDisplay`. Editor keys (`run-query`/`save-script`) bridge into the CodeMirror keymap via `toCodeMirrorKey` in [sql-editor.tsx](src/components/workspace/sql-editor.tsx). The PC forward-`Delete` key stays a FIXED alias to delete-rows/delete-nodes (only `Backspace` is the rebindable default). `persistChrome` in [src/routes/index.tsx](src/routes/index.tsx) MUST preserve `shortcuts` (and `theme`) across a chrome/layout write or a layout change silently wipes the keymap. Components read overrides via `useSettingsOptional` (like `useThemeOptional`) so they still render outside a `SettingsProvider`. The palette derives its hints from the resolved binding (`command-registry.ts` carries an `actionId`, not a hardcoded `hint`).

## Engines: SQL vs MongoDB (dispatch seam)

- The SQL engines (Postgres/MySQL/SQLite) run on `sqlx::Any` in [src-tauri/src/db.rs](src-tauri/src/db.rs). **MongoDB is NOT a `DbEngine`/`sqlx` arm** - it lives in [src-tauri/src/mongo.rs](src-tauri/src/mongo.rs) (the `mongodb` crate) with its own client registry. `sqlx::Any` cannot drive Mongo; never add a `DbEngine::Mongo` to `db.rs`.
- [src-tauri/src/lib.rs](src-tauri/src/lib.rs) is the dispatcher: every connection-addressed command routes to the Mongo path when `mongo::is_connected(id)`, else the SQL path. `connect_database` takes a raw `serde_json::Value` and peeks the `engine` tag (`mongodb` -> `MongoConfig`, else the SQL `ConnectionConfig` enum). Keep new per-connection commands dispatching the same way.
- The Mongo path returns the SAME IPC structs as SQL (`TableRef`/`TableRows`/`QueryOutcome`/`RowMutation`) so the frontend stays engine-agnostic. The shared `RowMutation::Replace` (full-document `replaceOne`) is Mongo-only - the SQL `build_mutation` returns `Err` for it.
- Build BSON from JSON via the hand-rolled `Value -> Bson` map in `mongo.rs`, NOT `bson::to_document`: the crate-wide serde_json `arbitrary_precision` feature makes `to_document` emit a `$serde_json::private::Number` wrapper Mongo rejects.
- Frontend per-engine differences (History preview strings, filter syntax) live behind `queryPreview(engine)` in [src/components/workspace/query-preview.ts](src/components/workspace/query-preview.ts) + a `mongodb` JSON CodeMirror mode in [src/components/workspace/sql-editor.tsx](src/components/workspace/sql-editor.tsx). Add to the strategy, don't sprinkle `engine === "mongodb"` through the table card.
- The Mongo **Query tab reuses the SQL editor pane** (`SqlTab`/`SqlPane`): same saved-script document tabs, Run/Cancel, History. `SqlTab` picks the executor by `node.engine` (`executeMongo` vs `executeSql`). Mongo commands are self-contained `db.<coll>.find({...})` / `db.<coll>.aggregate([...])` (collection in the text, no picker), `;`-separated; backend `parse_command` + `run_query` in `mongo.rs`. Do NOT reintroduce a collection picker or a separate mongo query component.
- Mongo Query-tab **autocomplete**: `db.` -> collection names, `db.<coll>.` -> find/aggregate, inside the body after a `"` -> that collection's sampled field names. Fields come from `mongo::fetch_schema` (samples ~50 docs/collection on connect -> `TableSchema` per collection) flowing through the same `databaseSchemas` -> `schema` prop as SQL. Completion lives in `mongoCommandSource` in [src/components/workspace/sql-editor.tsx](src/components/workspace/sql-editor.tsx).
- ObjectId/date `_id` (or any BSON type) in a filter uses **Extended JSON**: `{"_id":{"$oid":"..."}}`, `{"$numberLong":"42"}`, `{"$date":"..."}`. Plain JSON can't match an ObjectId. Decoded in `json_value_to_bson`/`extended_json_type`; a malformed wrapper is a filter error.
- Live Mongo smoke (needs the docker test-stack up): `cargo test --manifest-path src-tauri/Cargo.toml live_mongo -- --ignored`. Test-stack Mongo is host port 27018 (root user `dbui`/`dbui`, `authSource=admin`).

## Learning from conversation

If during a session you learn something project-specific that future-you would otherwise have to re-derive - a non-obvious convention the user prefers, a constraint that bit us, a gotcha worth recording - append it to [docs/learnings.md](docs/learnings.md). Examples: formatting rules the user repeated, gotchas that broke a hook/CI, naming conventions enforced via review.

For architectural trade-offs (significant, costly-to-reverse, or contested choices) use [docs/adr.md](docs/adr.md) instead - that's a separate log.

For UI visual/interaction conventions (corners, borders, density, grids, color, a11y) use [docs/design.md](docs/design.md). A UI rule the user wants enforced goes there, NOT in learnings.md or inline in CLAUDE.md.

Don't add: one-off task context, debugging notes, things obvious from the code itself, or anything that would fit better in [README.md](README.md). Don't ask permission for small additions - just keep the file tight and the diff visible in the next commit.

## Features

- Each feature lives in its own folder: `docs/features/<timestamp>-<slug>/`.
  - `<timestamp>` = `YYYYMMDDHHMMSS` (creation time). `<slug>` = short kebab-case name.
  - Example: `docs/features/20260618193518-bootstrap/`.
- Every feature folder holds two files:
  - `spec.md` - what + why. Follows the spec template structure (overview, acceptance criteria, user test cases, data model, edge cases, dependencies).
  - `plan.md` - how. Follows the plan template structure (task breakdown, execution order, file changes, acceptance verification).
- Adding a new feature:
  1. Create the folder with current timestamp + slug.
  2. Write `spec.md` first. Get it approved before planning.
  3. Write `plan.md` from the approved spec.
  4. Log any significant choices made while specing to [docs/adr.md](docs/adr.md).
- Branch naming: when working on a feature (not a quick fix), the branch name must match the feature's folder name under `docs/features/` exactly (e.g. folder `20260618223203-layout` -> branch `20260618223203-layout`). Quick fixes are exempt.

## Architectural Decisions

- Log only significant, costly-to-reverse or contested decisions to [docs/adr.md](docs/adr.md).
- Significant = changes architecture/data model, hard to undo later, or had real alternatives debated. NOT routine config (script aliases, package manager, default lib options).

## Before committing

- Check whether the change makes README.md or CLAUDE.md drift:
  - New script / removed dependency / renamed module -> update README.
  - New convention or gotcha that future-you would miss -> add to CLAUDE.md (or docs/learnings.md).
  - Removed feature or file referenced in either doc -> remove the reference.
- No duplicates between README.md and CLAUDE.md. Each fact lives in exactly one place:
  - README.md = onboarding facts a human needs to run the app: install steps, commands, repo layout sketch.
  - CLAUDE.md = working rules for an agent editing this repo: conventions, gotchas, "how to add a feature", invariants.
  - If a fact would fit both, put it in CLAUDE.md and link from README only if a human reader needs the pointer.
- If neither doc needs to change, say so explicitly in the pre-commit summary so it's a deliberate decision, not an oversight.

## TDD

Write code red-green-refactor:

1. Red - add a failing test that pins the behaviour you want. Run the relevant suite and confirm it fails for the right reason (not a typo, not a missing import).
2. Green - write the smallest production change that makes it pass. No speculative branches, no helper extraction yet.
3. Refactor - once green, clean up names, extract duplication, tighten types. Tests stay green throughout.

Two test layers, pick the one that owns the behaviour:
- Frontend (React/TS) -> `npm test` (Vitest).
- Rust backend / Tauri commands -> `cargo test` in `src-tauri/`.

Don't skip red. A test that's never seen failing is a test you can't trust. Don't refactor on red - get to green first, then improve.
