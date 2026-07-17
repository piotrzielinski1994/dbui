# Plan - Workspace file/folder structure

Approach: **port requi's on-disk workspace model verbatim**, minus env/dotenv, plus one divergence
(store node `id` in-file, not path-derived). Swap the `WorkspaceStore` (single-blob `LazyStore`) for a
`WorkspaceFs` port + `serialize`/`deserialize` (`disk-format`) + `reconcile` writes + a `WorkspaceLoader`
that resolves `settings.workspacePath`. Reuse the existing tolerant merge helpers in `workspace.ts` as
the per-database field codec so validation logic is not rewritten.

## Design gate verdict

Evaluated `pz-ddd` / `pz-archetypes` / `pz-codebase-design`. **Invoked: none** (applied their lens
inline). `pz-ddd`/`pz-archetypes`: N/A - no new domain model, pure serialization of the existing
`TreeNode`. `pz-codebase-design`: relevant as a lens (the `WorkspaceFs` port is a deep interface over
Tauri fs; `disk-format` hides the file-layout behind `serialize`/`deserialize`) - but the seam is
being COPIED from requi's proven shape, no new interface design needed. Recorded in Decision Log.

## File Structure

Create (mirroring requi, all under `src/lib/workspace/`):
- `slug.ts` - `slugify` / `uniqueSlug` (verbatim from requi).
- `reconcile.ts` - `planReconcile` / `parentDir` / `emptyDirsAfterRemoval` (requi minus `.env`).
- `fs.ts` - `WorkspaceFs` port: `readWorkspace` / `writeWorkspace` (NO `writeEnv`), `ReadResult` /
  `WriteResult`.
- `in-memory-fs.ts` - `createInMemoryWorkspaceFs(workspaces)` (test double).
- `tauri-fs.ts` - `createTauriWorkspaceFs()` (real, via `@tauri-apps/plugin-fs`; collect + reconcile).
- `disk-format.ts` - `FileMap`, `serialize(tree, name)`, `deserialize(files)`, `MANIFEST`,
  `DeserializeResult`.
- `folder-picker.ts` - `FolderPicker` port + `createTauriFolderPicker` / `createNoopFolderPicker`.
- `src/components/workspace/workspace-loader.tsx` - resolves `workspacePath` → reads/deserializes →
  mounts `WorkspaceProvider` with `onTreeChange = writeWorkspace(path, serialize(tree))`; empty state
  when no path.

Modify:
- `workspace.ts` - export the per-database field codec (`mergeDatabaseFile` / `hydrateDatabase` /
  `dehydrateDatabase`); REMOVE the whole-tree blob path (`PersistedWorkspace` / `WorkspaceStore` /
  `mergeWorkspace` / `DEFAULT_WORKSPACE` / `mergeNodes` / `mergeFolder`-with-children / tree `hydrate` /
  `dehydrate`).
- `src/lib/settings/settings.ts` - add `workspacePath?: string` + merge it.
- `src/lib/settings/settings-context.tsx` - `saveWorkspacePath(path)`; keep `saveChrome` excluding it.
- `src/routes/index.tsx` - drop `useWorkspaceStore`/`persistTree`; render `<WorkspaceLoader fs picker>`;
  exclude `workspacePath` from `persistChrome`'s `Omit`.
- `src/routes/__root.tsx` - drop `WorkspaceStoreProvider`/`createTauriWorkspaceStore`.
- `src/lib/shortcuts/registry.ts` - add `open-workspace` action (`Mod+O`, global).
- `src/components/workspace/command-registry.ts` - add `open-workspace` palette command (View group).
- `src/components/workspace/command-palette.tsx` - handler for `open-workspace`.
- `src/components/workspace/workspace-layout.tsx` - dispatch `open-workspace`; pass picker down.
- `src/components/workspace/sidebar-tree.tsx` (or a small empty-state) - "Open workspace folder..."
  prompt when no path / empty.
- `src-tauri/Cargo.toml` - `tauri-plugin-fs = "2"`.
- `src-tauri/src/lib.rs` - `.plugin(tauri_plugin_fs::init())`.
- `src-tauri/capabilities/default.json` - `fs:allow-read-dir`/`-read-text-file`/`-stat`/
  `-write-text-file`/`-mkdir`/`-remove` + `fs:scope` `$HOME/**` + `dialog:allow-open`.

Delete:
- `src/lib/workspace/tauri-store.ts` (workspace `LazyStore`).
- `src/lib/workspace/workspace-store-context.tsx` (`WorkspaceStoreProvider`/`useWorkspaceStore`).
- their tests (`__tests__/workspace-store-context.test.tsx`; adjust `saved-scripts.test.tsx` /
  `home-persist-theme.test.tsx` that wire the store).

## Tasks

### Task 1: `slug` (pure)
**Files:** Create `src/lib/workspace/slug.ts` + `__tests__/slug.test.ts`.
**Produces:** `slugify(name): string`, `uniqueSlug(base, used: Set<string>): string`.
- [ ] Failing tests: `slugify` lower/hyphen/trim + `""→"untitled"`; `uniqueSlug` `-2`/`-3` suffix (TC-001).
- [ ] Copy requi's `slug.ts` verbatim. Commit.

### Task 2: `reconcile` (pure)
**Files:** Create `src/lib/workspace/reconcile.ts` + `__tests__/reconcile.test.ts`.
**Consumes:** `FileMap` (from disk-format; type-only - define a local `Record<string,string>` alias to
avoid a cycle, or import the type once disk-format exists - order Task 2 before 5 by using the alias).
**Produces:** `planReconcile(current, next): { write: FileMap; remove: string[] }`, `parentDir`,
`emptyDirsAfterRemoval`.
- [ ] Failing tests: writes only changed, removes only stale managed files, unchanged untouched;
  `emptyDirsAfterRemoval` deepest-first (TC-008, TC-009).
- [ ] Copy requi's `reconcile.ts`, set `MANAGED_FILE = /(?:^|\/)folder\.json$|\.db\.json$|^dbui\.workspace\.json$/`,
  DROP `ENV_FILE`/`survivingDirs`-for-env branch (removal = `!in next && MANAGED_FILE`). Commit.

### Task 3: `WorkspaceFs` port + in-memory fs
**Files:** Create `fs.ts`, `in-memory-fs.ts` + `__tests__/in-memory-fs.test.ts`.
**Consumes:** `FileMap`.
**Produces:** `WorkspaceFs = { readWorkspace(rootPath): Promise<ReadResult>; writeWorkspace(rootPath,
files): Promise<WriteResult> }`; `ReadResult = {ok:true;files} | {ok:false;error}`; `WriteResult`;
`createInMemoryWorkspaceFs(workspaces: Record<string, FileMap>): WorkspaceFs`.
- [ ] Failing test: write-then-read returns the FileMap; unknown path → `{ok:false}` (TC-010).
- [ ] Copy requi's `fs.ts`/`in-memory-fs.ts`, DROP `writeEnv`. Commit.

### Task 4: `workspace.ts` codec refactor + `disk-format` (the core)
**Files:** Modify `workspace.ts`; Create `disk-format.ts` + `__tests__/disk-format.test.ts`;
delete/trim blob-path tests.
**Consumes:** `slugify`/`uniqueSlug`, the db-field merge helpers.
**Produces:** `FileMap`, `MANIFEST = "dbui.workspace.json"`, `serialize(tree: TreeNode[], name?:
string): FileMap`, `deserialize(files: FileMap): DeserializeResult`; from workspace.ts:
`mergeDatabaseFile(value): PersistedDatabase | null`, `hydrateDatabase(p): DatabaseNode`,
`dehydrateDatabase(node): PersistedDatabase`.
- [ ] Failing tests (TC-002..TC-007): serialize a db → manifest + `<slug>.db.json` w/ id/order + inline
  scripts/vars, runtime fields absent; nested folder → `<dir>/folder.json` + child files; `deserialize
  (serialize(tree))` round-trips (ids/names/nesting/order/all db fields, tables/views/sql/result empty);
  in-file id read back, missing id → path-derived; malformed file skipped + in `skipped[]`; missing
  manifest → `{ok:false}`.
- [ ] Refactor `workspace.ts`: export `mergeDatabaseFile` (current `mergeDatabase`, id/order-aware),
  `hydrateDatabase`/`dehydrateDatabase` (extract the db branch of the current `hydrateNode`/
  `dehydrateNode`). Remove `PersistedWorkspace`/`WorkspaceStore`/`mergeWorkspace`/`DEFAULT_WORKSPACE`/
  `mergeNodes`/`mergeFolder`-children/tree `hydrate`/`dehydrate`.
- [ ] Write `disk-format.ts`: `serialize` walks tree (folder → `<dir>/folder.json` `{id,name,order}` +
  recurse; db → `<slug>.db.json` = `dehydrateDatabase(node)` + `{id, order}`), `uniqueSlug` per level;
  `deserialize` = requi `buildLevel` shape (collect `*.db.json` at prefix → `mergeDatabaseFile`(id
  fallback = path) → `hydrateDatabase`; subdirs → `folder.json` → `FolderNode` + recurse; sort by
  `order`). Commit.

### Task 5: `tauri-fs` (real impl)
**Files:** Create `tauri-fs.ts` + `__tests__/tauri-fs.test.ts`.
**Consumes:** `WorkspaceFs`, `FileMap`, `planReconcile`/`parentDir`/`emptyDirsAfterRemoval`,
`@tauri-apps/plugin-fs`.
**Produces:** `createTauriWorkspaceFs(): WorkspaceFs`.
- [ ] Failing test (mock `@tauri-apps/plugin-fs` like requi's `tauri-fs.test.ts`): read collects managed
  files; write mkdir+reconcile writes changed / removes stale.
- [ ] Copy requi's `tauri-fs.ts`, set `MANAGED_FILE` to the dbui set, DROP `writeEnv` + the `READONLY_FILE`
  `.env` capture. Commit.

### Task 6: `folder-picker`
**Files:** Create `folder-picker.ts`.
**Produces:** `FolderPicker = { pick(): Promise<string|null> }`, `createTauriFolderPicker` /
`createNoopFolderPicker`.
- [ ] Copy requi's `folder-picker.ts` verbatim (already uses `@tauri-apps/plugin-dialog`). (No standalone
  test - a thin plugin wrapper; covered via TC-013.) Commit.

### Task 7: Settings `workspacePath`
**Files:** Modify `settings.ts`, `settings-context.tsx` + `__tests__` (settings merge, context).
**Produces:** `Settings.workspacePath?: string`; `saveWorkspacePath(path: string): void`.
- [ ] Failing tests: `mergeSettings` keeps a string `workspacePath`, drops a non-string, DEFAULT
  undefined (TC-011); a `saveChrome`-then-save keeps current `workspacePath` (TC-012).
- [ ] Add the field + merge (string-guard, like requi); `saveWorkspacePath` via `update`; confirm
  `saveChrome`'s `Omit` already excludes it (it isn't in the chrome slice → automatically preserved via
  the current-settings spread). Commit.

### Task 8: Rust `tauri-plugin-fs` + capability
**Files:** Modify `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, `capabilities/default.json`.
- [ ] Add `tauri-plugin-fs = "2"`; `.plugin(tauri_plugin_fs::init())`; the six `fs:allow-*` perms +
  `fs:scope` `$HOME/**` + `dialog:allow-open`. Verify `cargo build` (gate). Commit.

### Task 9: `WorkspaceLoader` + wiring + open-workspace command/shortcut/empty-state
**Files:** Create `workspace-loader.tsx` + `__tests__/workspace-loader.test.tsx`,
`__tests__/open-workspace.test.tsx`; modify `routes/index.tsx`, `routes/__root.tsx`,
`shortcuts/registry.ts`, `command-registry.ts`, `command-palette.tsx`, `workspace-layout.tsx`,
sidebar empty-state; delete `tauri-store.ts` + `workspace-store-context.tsx` (+ tests).
**Consumes:** `WorkspaceFs`, `FolderPicker`, `serialize`/`deserialize`, `saveWorkspacePath`.
- [ ] Failing tests (TC-013..TC-016): `open-workspace` command/shortcut → `picker.pick()`; path →
  `saveWorkspacePath`, null → not (in-memory picker); no-path → empty "Open workspace folder..." prompt;
  loaded workspace edit → `writeWorkspace(path, serialize(tree))`; unreadable path → empty writable tree
  whose first create writes a manifest + file.
- [ ] `WorkspaceLoader` (mirror requi's: `loading`/`empty`/`loaded` states, `freshWorkspace()` for
  unreadable, `deserialize` skipped→console lines) mounting `WorkspaceProvider key={workspacePath}` with
  `onTreeChange = tree => fs.writeWorkspace(path, serialize(tree))`; register `open-workspace` in
  registry (`Mod+O` global) + palette (View group, calls `picker.pick().then(p => p && saveWorkspacePath)`)
  + layout keydown dispatch; wire the empty-state button; drop the store provider + `useWorkspaceStore`;
  exclude `workspacePath` from `persistChrome` Omit. Commit.

## Cross-cutting notes

- **Approach / key decisions**: verbatim requi port (proven, sibling-repo rule) minus env; the ONE
  divergence is in-file `id` (dbui ids are UUIDs referenced by settings/table-id/FK-nav - path-derived
  would break them). Reuse `workspace.ts`'s tolerant merge helpers as the db-field codec (don't rewrite
  ~200 lines of validation). Fresh-start migration (old `workspace.json` orphaned, not read).
- **Edge cases** (spec §Edge Cases): unreadable path → fresh writable; malformed file → skip+report;
  missing manifest → fresh writable; same-name siblings → `uniqueSlug`+in-file id; rename → old removed/
  new written/id preserved; move → relocate; delete folder → descendants removed + empty dirs cleaned;
  no-id file → path-derived; runtime fields never serialized; plaintext passwords accepted.
- **Tests**: one per AC (see TC map). Behavioral where possible (serialize/deserialize round-trip,
  reconcile plan, in-memory fs read-after-write, loader writes on tree edit). Rust: `cargo build` gate
  (no new Rust logic - plugin init only).

## Infrastructure Prerequisites

| Category              | Requirement |
| --------------------- | ----------- |
| Environment variables | N/A |
| Registry images       | N/A |
| Cloud quotas          | N/A |
| Network reachability  | N/A |
| CI status             | N/A |
| External secrets      | N/A |
| Database migrations   | N/A |

Verification: `npm test` (Vitest) + `cargo build` in `src-tauri/`. New JS dep `@tauri-apps/plugin-fs`
installed via `npm i`.

## Risks

- Deleting `workspace-store-context`/`tauri-store` breaks importers → grep all consumers first; fold the
  fixes into Task 9's commit so the suite never sits red across commits.
- `FileMap` type cycle (reconcile ↔ disk-format) → define `FileMap` in `disk-format.ts`, have `reconcile`
  import the type only (requi does exactly this; no runtime cycle).
- jsdom has no Tauri fs → all behavioral tests use `createInMemoryWorkspaceFs` + `createNoopFolderPicker`
  (injected props), never the real `tauri-fs` (mock the plugin in its unit test only), mirroring requi.

## Decision Log

| Date | Decision | Rationale |
| ---- | -------- | --------- |
| 2026-07-17 | Full requi picker model (user-picked folder + `settings.workspacePath` + empty state + open-workspace cmd), not auto app-data-dir | User chose it; git-friendly/portable. Accepted: plaintext DB passwords land in a user-chosen folder (documented leak surface) |
| 2026-07-17 | Fresh-start migration - old `workspace.json` ignored (not read/migrated/deleted) | User chose it; avoids a one-shot migrator + backup logic |
| 2026-07-17 | Scripts/variables INLINE in `*.db.json` (not separate `.sql`/`.js` files) | User chose it; one-file-per-entity, smallest reconcile surface (mirrors requi keeping body+config in `.req.json`) |
| 2026-07-17 | Store node `id` INSIDE each file; path-derived id only as fallback (DIVERGES from requi) | dbui ids are `crypto.randomUUID()` referenced by `settings.json` (expandedIds/openTabIds), the table-id formula `${databaseId}::${schema}::${name}`, and FK-nav; path-derived ids break on first rename/move. In-file id keeps every existing consumer untouched |
| 2026-07-17 | Reuse `workspace.ts`'s tolerant merge helpers as the per-DB field codec; delete only the whole-tree blob path | ~200 lines of validated field-merge logic already correct; disk-format only adds the tree↔FileMap walk + manifest |
| 2026-07-17 | Design gate: evaluated ddd/archetypes/codebase-design, invoked none | No new domain model (pure serialization); the port seam is copied from requi's proven shape, no new interface design |
