# Plan: Add database / folder from command palette

**Spec:** docs/features/20260620232055-add-db-folder-commands/spec.md
**Created:** 2026-06-20
**Status:** Implemented (verified; awaiting user validation before commit)

## 1. Overview

Expose **New database** and **New folder** as always-listed command-palette commands plus global
shortcuts (Cmd/Ctrl+N, Cmd/Ctrl+Shift+N). New database appends a root node and opens it on the
Settings sub-tab without auto-connecting; new folder opens a one-field dialog and appends a root
folder. Add an editable Name field to the Settings form so a database can be named/renamed. All
mutations go through new workspace-context actions; persistence rides the existing
`onTreeChange` -> `persistTree` path.

Coverage threshold: none (no threshold in `vitest.config.ts` / `package.json`).

## 2. Approach & key decisions

- **All tree mutation stays in `workspace-context.tsx`.** `setTree` is private there; expose three
  intent-named actions instead of leaking the setter: `addDatabase`, `addFolder`,
  `renameDatabase`. Mirrors the existing `updateDatabaseConfig` / `setDatabaseTables` style
  (pure tree-rewrite helpers + `setTree`).
- **New database seeds status `idle`** (not undefined). `useAutoConnect` (database-card.tsx)
  skips any node whose `connectionStatus` is already set, so seeding `idle` is exactly the
  documented "manual Disconnect" path -> no `connectDatabase`, no error toast on creation (AC-003,
  E-7). `addDatabase` calls `setConnectionStatus(id, "idle")` alongside the tree append.
- **`addDatabase` also opens + activates the node and switches to Settings.** It appends, then
  reuses the same open-tab machinery (`setOpenTabIds`/`setActiveTabId`) and `setActiveDatabaseTab("settings")`.
- **Command gating unchanged (strategy `when`).** Add `"new-database"` and `"new-folder"` defs,
  both `when: () => true`. The palette's `handlers` record maps them to context actions; selecting
  `new-folder` opens the dialog (palette closes first, then dialog opens).
- **New folder dialog lives in `WorkspaceLayout`** next to the palette + key listener, same as
  `isPaletteOpen`: a `folderDialogOpen` state, a small `<NewFolderDialog>` using the existing
  `Dialog` primitive + `Input` + `Button`. Add disabled while `name.trim()` is empty (E-2);
  Enter submits when enabled; Esc/Cancel/backdrop close without creating (E-3).
- **Shortcuts in the same `WorkspaceLayout` keydown effect.** `(meta||ctrl) && key==="n"`:
  shift -> open folder dialog, no shift -> `addDatabase`; `preventDefault` either way. Guard
  added to deps. Note: browser Cmd/Ctrl+N (new window) is suppressed in-app via `preventDefault`.
- **Name field = top of the Settings form, wired to `renameDatabase`.** It is NOT part of the
  local `form` (connection) state - it writes the tree directly on change so the sidebar row and
  tab title update live (AC-009). Connection fields keep their existing local-form behavior.
- **Ids via `crypto.randomUUID()`** (available in jsdom + Node 24). No new dep.

## 3. Task breakdown

| # | Task | Spec Ref | Files | Type |
|---|------|----------|-------|------|
| 1 | Context: `addFolder(name)` - append `{kind:"folder", id:uuid, name, children:[]}` at root | AC-006 | `workspace-context.tsx` | impl |
| 2 | Context: `addDatabase()` - append default db node at root, open+activate it, set Settings sub-tab, seed status `idle` | AC-002, AC-003 | `workspace-context.tsx` | impl |
| 3 | Context: `renameDatabase(id, name)` - rewrite node name in tree | AC-009 | `workspace-context.tsx` | impl |
| 4 | Registry: add `"new-database"`, `"new-folder"` ids + defs (`when: () => true`) | AC-001, AC-004 | `command-registry.ts` | impl |
| 5 | Palette: map new ids to handlers (`new-database` -> `addDatabase`; `new-folder` -> open dialog via a passed `onNewFolder` prop) | AC-002, AC-005 | `command-palette.tsx` | impl |
| 6 | `NewFolderDialog` component: name input (autofocus) + Cancel/Add; Add disabled while blank; Enter submits; calls `addFolder` then closes | AC-005, AC-006, E-2, E-3 | `workspace-layout.tsx` (or sibling file) | impl |
| 7 | Layout: `folderDialogOpen` state; pass `onNewFolder` to palette; render dialog; keydown for Cmd/Ctrl+N and Cmd/Ctrl+Shift+N (preventDefault) | AC-007, AC-008 | `workspace-layout.tsx` | impl |
| 8 | Settings: add Name field at top, seeded from node, `onChange` -> `renameDatabase(node.id, value)` | AC-009 | `settings-tab.tsx` | impl |
| 9 | Tests: palette commands present + run, dialog create/blank, shortcuts, rename, no auto-connect | AC-001..009, TC-001..007 | `__tests__/add-db-folder.test.tsx` (+ extend `settings-tab.test.tsx`, `command-palette.test.tsx`) | test |

## 4. Edge cases to handle (from spec §6)

- E-1: palette + shortcuts mount in layout regardless of tree contents -> work on empty tree.
- E-2: folder Add disabled while `name.trim()===""`; Enter no-op when disabled.
- E-3: Esc/Cancel/backdrop close the dialog without creating.
- E-4: clearing the Name field sets empty name; render must not crash (treeitem/tab tolerate "").
- E-5: each create uses a fresh `randomUUID`; multiple databases coexist; last is active.
- E-6: `addDatabase` appends at root and activates even with another tab active.
- E-7: seeded `idle` status makes `useAutoConnect` skip -> no connect attempt.

## 5. Tests to write (one+ per AC)

- AC-001: palette lists "New database" (any tab state, incl. empty tree).
- AC-002: selecting "New database" -> a database tab is active + Settings sub-tab shown + sidebar row added.
- AC-003: after create, `connectDatabase` mock not called; no error toast.
- AC-004: palette lists "New folder".
- AC-005: selecting "New folder" opens a dialog with a name input + Add button.
- AC-006: type "reports" + Add -> dialog closes, folder row "reports" at root; blank name -> Add disabled.
- AC-007: Cmd/Ctrl+N -> new database tab on Settings; `preventDefault` asserted; palette not open.
- AC-008: Cmd/Ctrl+Shift+N -> folder dialog open; `preventDefault` asserted; palette not open.
- AC-009: edit Name field -> sidebar row + open-tab title reflect the new name.
- AC-010: `npm run lint && npm run typecheck && npm test` exit 0.

## 6. Acceptance verification

`npm run lint && npm run typecheck && npm test` all exit 0 (AC-010). Fresh-context verifier maps
each AC to its test, probes the dialog UI states (closed/open/blank/success) and E-1..E-7.

## 7. Risks

- **Cmd/Ctrl+N collides with the OS/browser "new window".** In-app `preventDefault` suppresses it
  while focus is in the app; acceptable for a Tauri desktop shell. Mitigation: documented; assert
  `defaultPrevented` in test.
- **Name field fighting the connection `form` state.** Keep Name out of `form`; write tree
  directly via `renameDatabase`. Mitigation: separate handler, tested independently.
- **Auto-connect firing on a freshly created database.** Seed `idle` status at creation.
  Mitigation: explicit AC-003/E-7 test asserting `connectDatabase` is not called.
- **jsdom Dialog/Portal focus flakiness.** Reuse the working palette/dialog test patterns; assert
  roles/text not focus internals.

## 8. Decision Log

| Date | Decision | Rationale |
| ---- | -------- | --------- |
| 2026-06-20 | New database opens the existing Settings sub-tab (no bespoke create form) | User choice; reuses the live connection form, zero new surface |
| 2026-06-20 | New database does NOT auto-connect (seed `idle`) | Defaults are blank/invalid; auto-connect would error-toast immediately |
| 2026-06-20 | New nodes appended at root; move-into-folder deferred | User choice; drag-and-drop is a separate future feature |
| 2026-06-20 | Add editable Name to Settings (vs auto-name only) | User choice; also grants rename for all databases at no extra surface |
| 2026-06-20 | Three intent-named context actions over exposing `setTree` | Keeps tree-mutation invariants in one place; matches existing action style |
| 2026-06-20 | Shortcuts Cmd/Ctrl+N (db) + Cmd/Ctrl+Shift+N (folder) | Conventional "new" chord; shift variant for the secondary create |

## 9. AC traceability

| AC | Test name |
| -- | --------- |
| AC-001 | `should list a 'New database' command in the palette even if the tree is empty` |
| AC-002 | `should open an active database tab on the Settings sub-tab and add a sidebar row if 'New database' is selected` |
| AC-003 | `should not call connectDatabase or fire an error toast if a database is created via 'New database'` |
| AC-004 | `should list a 'New folder' command in the palette even if the tree is empty` |
| AC-005 | `should open a dialog with a name textbox and an Add button if 'New folder' is selected` |
| AC-006 | `should create a root folder named 'reports' and close the dialog if a name is typed and Add is clicked`; `should keep the Add button disabled if the folder name is empty`; `... whitespace only` |
| AC-007 | `should open a database tab on the Settings sub-tab if Ctrl+N is pressed`; `should suppress the default action if Cmd+N is pressed` |
| AC-008 | `should open the New folder dialog if Ctrl+Shift+N is pressed`; `should suppress the default action if Cmd+Shift+N is pressed`; `should not open the command palette if Ctrl+Shift+N is pressed` |
| AC-009 | `should rename the sidebar row and the open-tab title if the Settings Name field is edited` |
| AC-010 | `npm run lint` (0 errors), `npm run typecheck` (clean), `npm test` (284 passed) |

Edge cases pinned: E-2 (blank + whitespace folder name disable Add), E-3 (Esc + Cancel close without creating), E-5 (`should add two database rows if 'New database' is selected twice`), E-7 (same test as AC-003). E-4/E-6 left untested (low-stakes per spec; structurally guaranteed by `addDatabase` always appending + activating).

## 10. Outcome

Implemented per plan, no deviations in production code. New: `new-folder-dialog.tsx`,
`__tests__/add-db-folder.test.tsx`. Modified: `workspace-context.tsx` (+`addDatabase` /
`addFolder` / `renameDatabase` + node factories + `renameNode` helper), `command-registry.ts`
(+`new-database` / `new-folder` defs), `command-palette.tsx` (+`onNewFolder` prop, +handlers),
`workspace-layout.tsx` (+folder-dialog state, +Cmd/Ctrl+N & Cmd/Ctrl+Shift+N listener, render
`NewFolderDialog`), `settings-tab.tsx` (+Name field -> `renameDatabase`).

Test-harness note (not a production deviation): the AC-009 rename test renders
`SettingsTab` + `SidebarTree` + `ContentHeader` as siblings under one real `WorkspaceProvider`
instead of the full `WorkspaceLayout`. The shell's `react-resizable-panels` groups swallow
database **sub-tab** pointer clicks in jsdom (documented limitation, docs/design.md §Layout), so
the Settings sub-tab can't be reached by clicking through `WorkspaceLayout` in a test. Rendering
the real components directly exercises identical production wiring (`useWorkspace().renameDatabase`).

Verifier (fresh context): PASS on all 10 ACs + all gates (lint 0 errors, typecheck clean,
284/284 tests).

---

## 11. v0.2.0 addendum - `+` button + sidebar row context menu

**Spec ref:** spec.md §9 (AC-101..AC-111).

### 11.1 Approach & key decisions

- **`+` button** (AC-101): already wired in an interim change - `content-header.tsx`'s `+` calls
  `addDatabase` (was inert `newTab`), `aria-label="New database"`. Covered by the existing
  content-header test. No further work.
- **`context-menu` primitive**: port the shadcn `context-menu` onto the `radix-ui` umbrella
  (`import { ContextMenu as ContextMenuPrimitive } from "radix-ui"`), matching `dialog.tsx`/
  `tabs.tsx`. Strip rounded corners per design.md (radius tokens are pinned to 0, so leaving the
  upstream `rounded-*` classes is visually fine, but match the dialog's minimal subset).
- **Wire the menu in `tree-row.tsx`**, NOT a new component: wrap `DatabaseRow`'s and `FolderRow`'s
  treeitem in `<ContextMenu>` + `<ContextMenuTrigger asChild>`; `TableRow` stays bare (AC-110,
  E-104). Menu items are built per node kind - database `[toggle, Delete]`, folder `[Delete]` -
  no inline ifology beyond the kind branch already present.
- **Connect/Disconnect = `useConnectionActions`** verbatim (AC-104, E-103). The toggle label reads
  the same `connections.has(id)` the Settings button uses. Zero new connection logic.
- **`removeNode(id)` in `workspace-context.tsx`** (AC-107, AC-109): a pure tree filter that drops
  the node anywhere in the tree, PLUS prune side-effects - collect the deleted subtree's database
  ids (the node itself if a db, or every db beneath a folder), `closeTab` each, and drop their
  `connections` + `connectionStatus` entries. Reuse the existing `closeTab` active-fallback logic
  by calling it per id (it already reassigns the active tab). Mirrors the intent-named-action
  style (no `setTree` leak).
- **Delete confirm dialog**: a small `DeleteNodeDialog` (like `NewFolderDialog`), rendered where
  the menu state lives. Decision: keep the "which node is pending delete" state in `SidebarTree`
  (it owns the tree render) and pass an `onRequestDelete(node)` down to rows; the dialog mounts
  once in `SidebarTree`. Filled-red destructive Delete button (design.md), folder body warns about
  children. Cancel/Esc/backdrop close without deleting (AC-108, E-106).

### 11.2 Task breakdown

| # | Task | Spec Ref | Files | Type |
|---|------|----------|-------|------|
| 1 | `removeNode(id)`: tree filter + prune tabs/connections for node & folder descendants | AC-107, AC-109 | `workspace-context.tsx` | impl |
| 2 | `ui/context-menu.tsx` primitive (radix umbrella) | dep | `src/components/ui/context-menu.tsx` | impl |
| 3 | `DeleteNodeDialog` (confirm; db vs folder body; filled-red Delete) | AC-106, AC-108 | `src/components/workspace/delete-node-dialog.tsx` | impl |
| 4 | Wrap DatabaseRow + FolderRow in ContextMenu; build items per kind; TableRow bare; lift delete-request to SidebarTree which mounts the dialog | AC-102..106, AC-110 | `tree-row.tsx`, `sidebar-tree.tsx` | impl |
| 5 | Tests: menu presence per kind, toggle label/action, delete confirm/cancel, folder removes children, delete closes tab, no menu on table | AC-102..110, TC-101..108 | `__tests__/row-context-menu.test.tsx` | test |

(AC-101 already has its test in `content-header.test.tsx`: `should open a new database tab on the Settings card if the plus button is clicked`.)

### 11.3 Edge cases

- E-101/E-102: `removeNode` calls `closeTab` per deleted db id -> existing active-fallback applies.
- E-103: disconnect path is `useConnectionActions().disconnect` (drop + idle), unchanged.
- E-104: `TableRow` renders no ContextMenu wrapper.
- E-105/E-107: empty folder / never-connected db -> filter + prune with nothing to drop, no crash.
- E-106: radix Dialog handles Esc/backdrop; Cancel button closes.

### 11.4 Risks

- **jsdom + radix ContextMenu open via right-click:** assert with `fireEvent.contextMenu(row)`
  then query the menu items by role; if focus/portal flakiness appears, mirror the working
  command-palette dialog patterns. Mitigation: keep assertions on roles/text, not pointer internals.
- **`removeNode` orphaning connection state:** prune `connections` + `connectionStatus` for every
  deleted db id, not just the node, or a deleted+recreated id could inherit stale "connected".
  Mitigation: collect descendant db ids first, drop all.

### 11.5 AC traceability

| AC | Test name |
| -- | --------- |
| AC-101 | `should open a new database tab on the Settings card if the plus button is clicked` (content-header.test.tsx) |
| AC-102 | `should open a context menu with a connection toggle and a Delete item when a database row is right-clicked` |
| AC-103 | `should label the toggle Connect when the database is not connected`; `should label the toggle Disconnect when the database is connected` |
| AC-104 | `should invoke connectDatabase with the node config when Connect is selected on a not-connected database`; `should drop the connection and clear the connected dot when Disconnect is selected on a connected database` |
| AC-105 | `should open a context menu with Delete and no connection toggle when a folder row is right-clicked` |
| AC-106 | `should open a confirm dialog naming the database when Delete is selected on a database row`; `should warn the folder's databases are removed too when Delete is selected on a folder row` |
| AC-107 | `should remove the database row from the tree when the delete is confirmed`; `should remove the folder and its child database when a folder delete is confirmed`; `should remove a database nested two folders deep when the outer folder is deleted` |
| AC-108 | `should close the dialog and keep the database when the delete is cancelled with Escape`; `should close the dialog and keep the database when the Cancel button is clicked` |
| AC-109 | `should close the open tab for a database when it is deleted` |
| AC-110 | `should not open a Delete or Connect menu when a table leaf is right-clicked` |
| AC-111 | `npm run lint` (0 errors), `npm run typecheck` (clean), `npm test` (304 passed) |

Edge cases pinned: E-105 (`should remove an empty folder when its delete is confirmed`), E-104 (table-leaf no-menu test), E-106 (Esc + Cancel). Backdrop dismissal (also E-106) left to radix Dialog (same path as Esc; not separately tested).

### 11.6 Outcome

Implemented per the addendum. New: `ui/context-menu.tsx`, `delete-node-dialog.tsx`,
`delete-request-context.tsx`, `__tests__/row-context-menu.test.tsx`. Modified:
`workspace-context.tsx` (+`removeNode` + `findNode`/`databaseIdsIn`/`removeNodeFromTree` helpers),
`tree-row.tsx` (ContextMenu on DatabaseRow + FolderRow; toggle via `useConnectionActions`; Delete
-> `useRequestDelete`), `sidebar-tree.tsx` (owns pending-delete state + mounts `DeleteNodeDialog`
inside a `DeleteRequestProvider`), `content-header.tsx` (`+` -> `addDatabase`, done earlier).

Decision: a small `DeleteRequestProvider` context carries the "request delete" callback down the
recursive `TreeRow` (avoids prop-drilling); `SidebarTree` holds the pending node + the single
dialog. `removeNode` recurses the whole tree (`findNode`), collects every descendant database id
(`databaseIdsIn`), reuses `closeTab` per id for the active-tab fallback, and prunes `connections`
+ `connectionStatus` for all removed db ids.

Verifier (fresh context): PASS on all 11 ACs + all gates (lint 0 errors, typecheck clean,
304/304). Flagged the nested-deep folder-delete coverage gap -> added the
`...nested two folders deep...` test (now 16 in row-context-menu.test.tsx). Backdrop dismissal
left to the library.
