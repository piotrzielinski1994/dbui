# Workspace file/folder structure (explode workspace.json)

Backlog item (no Jira). Mirrors the `requi` repo's on-disk workspace model.

## Overview

Replace the single `workspace.json` (Tauri `LazyStore` blob in the app-data-dir) with a
**user-picked workspace FOLDER exploded into files + directories**, exactly like `requi`:

- A **manifest** `dbui.workspace.json` at the root (`{ schemaVersion, name }`).
- One **`<slug>/folder.json`** per folder node (`{ id, name, order }`), the folder's children
  living as files inside that directory.
- One **`<slug>.db.json`** per database node - the full persisted database (connection config +
  `savedScripts`/`savedJsScripts`/`variables` INLINE + `accentColor`/`readOnly`/`manualCommit`/
  `defaultSchema` + `id` + `order`).

The user PICKS the folder (native folder dialog). The chosen path persists as
`settings.workspacePath`. First launch (no path) shows an empty state with an **Open workspace
folder...** affordance; an `open-workspace` palette command + rebindable shortcut (default `Mod+O`,
mirroring requi) opens/switches the folder afterward. Tree edits (add/rename/move/delete a
folder/database, edit scripts/variables/settings) reconcile-write the folder: changed files written,
renamed/deleted files removed, emptied dirs cleaned.

**Migration = fresh start** (explicit product decision): the old `workspace.json` is IGNORED (not
read, not migrated, not deleted - left orphaned in app-data-dir). Existing users re-open a folder
and re-add databases.

### Divergence from requi (the crux)

requi derives a node's `id` from its disk path. **dbui CANNOT** - node ids are `crypto.randomUUID()`
referenced across `settings.json` (`expandedIds`/`openTabIds`/`activeTabId`), the table-node id
formula `${databaseId}::${schema}::${name}`, and FK navigation. A path-derived id would break every
one of those on the first rename/move. So **dbui stores the `id` INSIDE each file** and reads it
back; a file missing an `id` (hand-authored) falls back to a path-derived id (documented, less
stable). This keeps every existing id consumer untouched.

Also unlike requi: dbui has **no `.env` / environments / per-folder dotenv** - the disk format is
strictly the manifest + `folder.json` + `*.db.json` (simpler; no `writeEnv`, no env-color merge).

### Security note (explicitly accepted)

Database passwords are stored **in plaintext** inside `*.db.json` in a user-chosen folder (which may
be git-tracked / synced). This is a real leak surface the user has accepted (same plaintext-password
posture as today's `workspace.json`, now in a user-visible location). Documented, not mitigated in
this feature.

## Acceptance Criteria

- AC-001: On launch with no `settings.workspacePath`, the app shows an **empty workspace** state
  (no tree) with an **Open workspace folder...** button; nothing is written to disk.
- AC-002: An `open-workspace` action (palette command in the **View** group + rebindable shortcut,
  default `Mod+O`, global scope) opens a native folder-picker; choosing a folder persists it as
  `settings.workspacePath` and loads that folder as the workspace.
- AC-003: Cancelling the folder picker is a no-op (path unchanged, nothing written).
- AC-004: A loaded workspace folder is READ by recursively collecting its managed files
  (`dbui.workspace.json`, `**/folder.json`, `**/*.db.json`) and deserialized into the tree:
  folders become `FolderNode`s (from each `folder.json` dir), databases become `DatabaseNode`s (from
  each `*.db.json`), preserving nesting and sibling `order`.
- AC-005: Every persisted database field round-trips through a file: engine + connection config,
  `accentColor`, `readOnly`, `manualCommit`, `defaultSchema`, `savedScripts`, `savedJsScripts`,
  `variables` - validated by the SAME tolerant merge helpers as today (garbage dropped, defaults
  applied), never throwing on a malformed file.
- AC-006: Each node's persisted `id` is stored in and read back from its file, so a rename or move
  keeps the id stable (open tabs, expanded rows, FK targets survive). A file lacking `id` falls back
  to a path-derived id.
- AC-007: Creating a folder/database writes its file(s); renaming a node renames its file/dir (old
  path removed, new written, id preserved); moving a node relocates its file(s) under the new parent
  dir; deleting a node (or a folder with descendants) removes its file(s) and cleans emptied dirs.
- AC-008: A tree write is RECONCILING against the folder's current contents - only changed files are
  (re)written and only stale managed files are removed (no full wipe-and-rewrite); a same-name
  sibling collision is disambiguated by a suffixed slug (`-2`), the in-file `id` keeping the two
  distinct.
- AC-009: A malformed/unparseable `folder.json` or `*.db.json` is SKIPPED (that node absent) with a
  console line naming the file; the rest of the workspace still loads. A missing manifest on a
  chosen folder loads as a fresh WRITABLE empty workspace (first edit bootstraps the manifest).
- AC-010: A configured `workspacePath` that is unreadable/absent loads as a fresh WRITABLE empty
  workspace (an empty tree wired to that path), so the first create bootstraps the folder on disk.
- AC-011: `settings.workspacePath` survives a chrome/layout persist (sidebar/console toggle, panel
  resize) - it is excluded from the `saveChrome` payload and merged from current settings (same
  hazard as `theme`/`shortcuts`/`windowFullscreen`/`rowLimit`).
- AC-012: Runtime-only node fields (`tables`, `views`, `sql`, `result`, connection status) are NEVER
  written to disk - a database's tables come from a live connect, exactly as today.

## Test Cases

- TC-001 (slug): `slugify` lowercases + hyphenates + trims (`"My DB!" -> "my-db"`, `"" -> "untitled"`);
  `uniqueSlug` suffixes a collision (`-2`, `-3`). Maps to: AC-008.
- TC-002 (serialize db): `serialize` of a one-database tree emits `dbui.workspace.json` + a
  `<slug>.db.json` carrying id/name/engine/config/order + inline scripts/variables; runtime fields
  absent. Maps to: AC-004, AC-005, AC-012.
- TC-003 (serialize nesting): a folder with a nested database emits `<folder>/folder.json` +
  `<folder>/<db>.db.json`; a deeper folder nests further. `order` reflects sibling index. Maps to:
  AC-004, AC-007.
- TC-004 (deserialize round-trip): `deserialize(serialize(tree))` reproduces the tree (ids, names,
  nesting, order, all db fields), tables/views/sql/result defaulted empty. Maps to: AC-004, AC-005,
  AC-006, AC-012.
- TC-005 (id read-back): a `*.db.json`/`folder.json` with an `id` deserializes to that id; one
  WITHOUT `id` falls back to a path-derived id. Maps to: AC-006.
- TC-006 (malformed skip): a `*.db.json` that is invalid JSON, or a folder.json failing validation,
  is skipped and reported in `skipped[]`; sibling valid files still load. Maps to: AC-009.
- TC-007 (missing manifest): `deserialize` of a FileMap with no `dbui.workspace.json` returns
  `{ ok: false }`. Maps to: AC-009.
- TC-008 (reconcile write): `planReconcile(current, next)` writes only changed files and removes only
  stale managed files; an unchanged file is neither rewritten nor removed. Maps to: AC-008.
- TC-009 (reconcile rename/delete): renaming a node (slug changes) plans the old file for removal +
  the new for write; deleting a folder plans all its descendant files removed + `emptyDirsAfterRemoval`
  returns the emptied dirs deepest-first. Maps to: AC-007, AC-008.
- TC-010 (in-memory fs): `createInMemoryWorkspaceFs` read after write returns the written FileMap;
  read of an unknown path errors. Maps to: AC-004.
- TC-011 (settings): `mergeSettings` keeps a string `workspacePath`, drops a non-string; DEFAULT has
  it undefined. Maps to: AC-002.
- TC-012 (saveChrome preserves path): a `saveChrome` call (chrome slice without `workspacePath`)
  followed by a store save keeps the current `workspacePath`. Maps to: AC-011.
- TC-013 (open-workspace UI): the palette **Open workspace** command / the `open-workspace` shortcut
  calls `picker.pick()`; a returned path calls `saveWorkspacePath`; a null return does not. Maps to:
  AC-002, AC-003.
- TC-014 (empty state UI): with `workspacePath` null the sidebar renders the **Open workspace
  folder...** prompt (not the tree); its button triggers the picker. Maps to: AC-001.
- TC-015 (loaded persist): editing the tree in a loaded workspace calls `fs.writeWorkspace(path,
  serialize(tree))`; an empty (no-path) workspace never writes. Maps to: AC-007, AC-010.
- TC-016 (fresh writable): a `workspacePath` whose folder read fails mounts an empty tree wired to
  that path, and the first create persists a manifest + the new file. Maps to: AC-010.

## UI States

| State   | Behavior                                                                             |
| ------- | ------------------------------------------------------------------------------------ |
| Loading | Workspace folder being read: render nothing (brief).                                 |
| Empty   | No `workspacePath`: sidebar shows an "Open workspace folder..." prompt; palette + Mod+O available. |
| Error   | Malformed files skipped with a console line; unreadable folder → fresh writable empty. |
| Success | Folder loaded → normal tree; edits reconcile-write the folder.                        |

## Data Model

No change to the runtime `TreeNode` model. Disk shapes (in `disk-format.ts`):

- `FileMap = Record<string, string>` (relative path -> file text).
- Manifest `dbui.workspace.json`: `{ schemaVersion: 1, name: string }`.
- `folder.json`: `{ id: string, name: string, order: number }`.
- `<slug>.db.json`: the current `PersistedDatabase` shape + `{ id, order }` (scripts/variables
  inline).
- `DeserializeResult = { ok: true; tree: TreeNode[]; skipped: string[] } | { ok: false; error: string }`.

`Settings` gains `workspacePath?: string`.

Port (from requi): `WorkspaceFs` port (`readWorkspace`/`writeWorkspace`; NO `writeEnv`), `tauri-fs`
(via `@tauri-apps/plugin-fs`), `in-memory-fs`, `slug`, `reconcile` (minus the `.env` special-casing),
`folder-picker`.

## Edge Cases

1. `workspacePath` set but folder deleted/unreadable → fresh writable empty (AC-010).
2. Malformed `folder.json`/`*.db.json` → skipped + console line (AC-009).
3. Missing manifest on a chosen folder → fresh writable empty (first edit writes manifest) (AC-009/010).
4. Two same-named siblings → `uniqueSlug` suffix; in-file `id` keeps them distinct (AC-008).
5. Rename → slug changes → old file removed, new written, `id` preserved → tabs/expanded survive (AC-007).
6. Move a database into a folder → file relocates under the folder dir, `id` preserved (AC-007).
7. Delete a folder with children → all descendant files removed + emptied dirs cleaned (AC-007).
8. A file without `id` (hand-authored) → path-derived id fallback (documented, less stable) (AC-006).
9. Plaintext passwords in a user-chosen folder → accepted leak surface (documented).
10. Concurrent persistTree calls → each re-reads current + reconciles; last-write-wins (single-user).
11. Empty/weird db name → `slugify` → `untitled` (AC-008).
12. Table nodes / runtime fields never serialized (AC-012).

## Dependencies

- `@tauri-apps/plugin-fs` (JS) + `tauri-plugin-fs` (Rust) - NEW (dialog + store already present).
- `fs:` capability entry (scoped) in `src-tauri/capabilities/default.json`.
- `@tauri-apps/plugin-dialog` (already present) - the folder picker (`open({ directory: true })`).
- Removed: the workspace `LazyStore` path (`src/lib/workspace/tauri-store.ts`) + the whole-tree
  `WorkspaceStore`/`mergeWorkspace`/`PersistedWorkspace` (superseded by `WorkspaceFs` + `disk-format`).

## AC traceability (implemented 2026-07-17)

| AC | Test |
| --- | --- |
| AC-001 | workspace-loader.test.tsx `should render an Open workspace folder prompt and no tree...`; bootstrap.spec.tsx `should render the open-workspace prompt...` |
| AC-002 | open-workspace-shortcut.test.tsx `should save the picked path and load...`; open-workspace.test.ts (registry Mod+O/global); command-registry-open-workspace.test.ts (View group); settings-context-workspace-path.test.tsx `should update the context workspacePath...` |
| AC-003 | open-workspace-shortcut.test.tsx `should not change the workspace if Mod+O is cancelled` + `should be a safe no-op...noop picker`; workspace-loader.test.tsx `should never write to the fs if there is no workspacePath` |
| AC-004 | disk-format.test.ts round-trip block; workspace-loader.test.tsx `should render the loaded workspace tree...`; in-memory-fs.test.ts read-after-write; tauri-fs.test.ts `should collect managed files recursively...` |
| AC-005 | workspace-codec.test.ts `mergeDatabaseFile`/`hydrateDatabase`/`dehydrateDatabase` suites; disk-format.test.ts round-trip with all fields |
| AC-006 | disk-format.test.ts `should read the in-file id back...` (db.json + folder.json) + `should fall back to a non-empty deterministic id...` |
| AC-007 | reconcile.test.ts rename/move/delete plans; workspace-loader.test.tsx `should write the reconciled workspace when the loaded tree is edited` + first-create bootstrap |
| AC-008 | reconcile.test.ts write/remove sets + `should not include an unmanaged orphan`; disk-format.test.ts `should produce distinct file paths...` + `should keep two same-named siblings distinct by id...`; tauri-fs.test.ts `should remove a managed file that the next write no longer contains` |
| AC-009 | disk-format.test.ts malformed-skip block + missing-manifest block; workspace-loader.test.tsx `should load the good nodes and surface a skipped malformed file` |
| AC-010 | workspace-loader.test.tsx `should mount a writable empty tree if the workspacePath cannot be read` + `should persist a manifest and a new file to a fresh workspacePath...`; tauri-fs.test.ts `should create the root dir before writing the manifest...` |
| AC-011 | settings-context-workspace-path.test.tsx `should keep a saveWorkspacePath-set path when a later saveChrome carries none` |
| AC-012 | disk-format.test.ts `should never write the runtime fields...` + round-trip resets empty; workspace-codec.test.ts `should never emit the runtime fields` |

Status: DONE. All 12 ACs proven; tsc clean, lint 0 errors, 1565 JS tests pass, cargo build ok. Divergence from requi (in-file node id) verified id-stable across round-trip. Passwords plaintext in *.db.json - accepted, documented.
