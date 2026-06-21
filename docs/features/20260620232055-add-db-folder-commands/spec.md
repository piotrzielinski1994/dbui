# Spec: Add / manage database & folder (palette, shortcuts, row menu)

**Version:** 0.2.0
**Created:** 2026-06-20
**Status:** Draft

> v0.1.0 added creation (palette commands + shortcuts + Settings Name field). v0.2.0 (section 9
> below) adds the `+` button wiring and a sidebar row **context menu** to delete a database/folder
> and toggle a connection - the management half of the same workspace-tree feature.

> A fresh DbUI install starts with an empty sidebar tree and no way to populate it: the tree
> is built only from persisted `workspace.json` / mock data, `setTree` is private to the
> workspace context, and nothing (command, button, shortcut) creates a database or folder.
> This feature unblocks the empty state by exposing **New database** and **New folder** as
> command-palette commands plus keyboard shortcuts. It also adds an editable **Name** field to
> the database Settings sub-tab (today there is none, and no rename exists), so a newly created
> database can be named/renamed.

## 1. Overview

Two creation actions, reachable from the command palette (Cmd/Ctrl+K) and via global shortcuts:

- **New database** - creates a database node at the tree root with default connection values,
  opens it as the active tab on its **Settings** sub-tab (the existing connection form), and
  does **not** auto-connect (the node is seeded `idle` so the user fills the form and clicks
  Connect manually). The user names it via the new Name field in Settings.
- **New folder** - opens a small dialog with a single name input; submitting creates an empty
  folder node at the tree root.

Both commands are always listed (like the existing inert "New tab"). New nodes are appended at
the **root**; moving a database into a folder is a later drag-and-drop feature (out of scope).

What this feature delivers:
- `New database` and `New folder` palette commands (always available).
- Shortcuts: **Cmd/Ctrl+N** -> new database, **Cmd/Ctrl+Shift+N** -> new folder (default
  suppressed, palette not opened).
- A single-field **New folder** dialog (radix Dialog), Add disabled until the name is non-blank.
- An editable **Name** field at the top of the database Settings form, seeded from the node and
  writing straight to the tree (renames the sidebar row + tab title, persists to `workspace.json`).
- New tree-mutation actions on the workspace context: `addDatabase`, `addFolder`, `renameDatabase`.

What this feature does **not** deliver (YAGNI):
- No sidebar "+" buttons or context menus (palette + shortcuts only, per request).
- No drag-and-drop / move-into-folder (explicitly deferred).
- No nested-folder creation, no "new database inside folder" target picker (root only).
- No name-uniqueness validation or collision handling.
- No change to the inert "New tab" command / `+` button.

### User Story

As a developer opening a fresh DbUI, I want to create a database connection and folders from the
keyboard, so I can start working without a pre-seeded `workspace.json`.

### Approved layout (ASCII)

New folder dialog (centered modal over a dimmed backdrop):

```
+----------------------------------------+
|                                        |  <- dimmed backdrop (click / Esc closes)
|   +--------------------------------+   |
|   | New folder                     |   |  <- DialogTitle
|   |                                |   |
|   | Name                           |   |
|   | [____________________________] |   |  <- autofocused text input
|   |                                |   |
|   |              [Cancel]  [ Add ] |   |  <- Add disabled while name blank
|   +--------------------------------+   |
|                                        |
+----------------------------------------+
```

Database Settings sub-tab with the new Name field at the top:

```
+-----------------------------------+
| Name                              |
| [my_database____________________] |  <- new; edits rename node immediately
| Type                              |
| [Postgres                      v] |
| Host                              |
| [localhost____________________]   |
| Port            Database          |
| [5432_____]     [_______________] |
| User                              |
| [_____________________________]   |
| Password                          |
| [_____________________________] o |
|                        [ Connect ]|
+-----------------------------------+
```

Palette listing both new commands (always present):

```
+--------------------------------------+
| (search)  Type a command...          |
+--------------------------------------+
| New database                         |
| New folder                           |
| New tab                              |
| Toggle sidebar              Cmd/Ctrl+B|
| Toggle console panel        Cmd/Ctrl+J|
+--------------------------------------+
```

## 2. Acceptance Criteria

| ID | Criterion | Priority |
|----|-----------|----------|
| AC-001 | A **New database** command is always listed in the palette | Must |
| AC-002 | Selecting **New database** creates a database node at the tree root, opens it as the active tab, and activates the **Settings** sub-tab | Must |
| AC-003 | A newly created database does **not** auto-connect: its status is seeded `idle`, so no `connectDatabase` call and no error toast fire on creation | Must |
| AC-004 | A **New folder** command is always listed in the palette | Must |
| AC-005 | Selecting **New folder** opens a dialog with a single name input and Cancel/Add buttons | Must |
| AC-006 | Submitting the folder dialog with a non-blank name creates a folder node at the tree root and closes the dialog; a blank/whitespace name keeps Add disabled | Must |
| AC-007 | **Cmd/Ctrl+N** creates a new database (same effect as the command) and suppresses the browser/OS default | Must |
| AC-008 | **Cmd/Ctrl+Shift+N** opens the New folder dialog and suppresses the default | Must |
| AC-009 | The Settings sub-tab shows an editable **Name** field seeded from the database node; editing it renames the node (sidebar row + open-tab title reflect it) and the change persists via the tree | Must |
| AC-010 | `npm run lint`, `npm run typecheck`, and `npm test` exit 0 | Must |

## 3. User Test Cases

### TC-001: New database from palette (empty tree)
**Precondition:** empty tree, no tabs. **Steps:** Cmd+K, select "New database". **Expected:** a
database tab opens active; its card shows the Settings sub-tab; sidebar gains one database row.
**Maps to:** AC-001, AC-002.

### TC-002: New database does not auto-connect
**Precondition:** `connectDatabase` mocked. **Steps:** create a database via the command.
**Expected:** `connectDatabase` is not called; no error toast. **Maps to:** AC-003.

### TC-003: New folder dialog + create
**Steps:** Cmd+K, select "New folder", type "reports", click Add. **Expected:** dialog closes; a
folder row "reports" appears at the tree root. **Maps to:** AC-004, AC-005, AC-006.

### TC-004: Blank folder name disables Add
**Steps:** open New folder dialog, leave name blank (or spaces). **Expected:** Add is disabled;
no folder created. **Maps to:** AC-006.

### TC-005: New database shortcut
**Steps:** press Cmd/Ctrl+N. **Expected:** a new database tab opens on Settings; default
suppressed; palette stays closed. **Maps to:** AC-007.

### TC-006: New folder shortcut
**Steps:** press Cmd/Ctrl+Shift+N. **Expected:** the New folder dialog opens; default
suppressed; palette stays closed. **Maps to:** AC-008.

### TC-007: Rename via Settings Name field
**Precondition:** a database open on Settings. **Steps:** edit the Name field to "billing".
**Expected:** the sidebar row and the open-tab title update to "billing". **Maps to:** AC-009.

## 4. UI States

| State (New folder dialog) | Behavior |
| ------- | -------- |
| Closed  | Nothing rendered |
| Open    | Centered modal over dimmed backdrop; name input autofocused; Add disabled while blank |
| Empty (blank name) | Add disabled; submitting via Enter is a no-op |
| Success | Non-blank name + Add (or Enter) creates the folder and closes the dialog |

(The dialog is synchronous; no loading/error states.)

## 5. Data Model

No new persisted shape. New nodes reuse existing `DatabaseNode` / `FolderNode`. Ids are generated
with `crypto.randomUUID()`. A new database's default node:

```ts
{
  kind: "database",
  id: crypto.randomUUID(),
  name: "new_database",
  engine: "postgres",
  host: "localhost",
  port: 5432,
  database: "",
  user: "",
  password: "",
  tables: [], views: [], sql: "", savedScripts: [], script: "",
  result: { status: "success", timeMs: 0, rowCount: 0, columns: [], rows: [], message: "" },
}
```

A new folder: `{ kind: "folder", id: crypto.randomUUID(), name, children: [] }`.

New palette command ids: `"new-database" | "new-folder"`, both `when: () => true`.

New workspace-context actions:
- `addDatabase(): void` - append node at root, open + activate it, set Settings sub-tab, seed status `idle`.
- `addFolder(name: string): void` - append empty folder at root.
- `renameDatabase(id: string, name: string): void` - update the node's `name` in the tree.

## 6. Edge Cases

| # | Case | Handling |
|---|------|----------|
| E-1 | Empty tree / fresh app | Palette + shortcuts still work (layout mounts them regardless); creation populates the tree |
| E-2 | Blank or whitespace-only folder name | Add disabled (name trimmed); Enter is a no-op |
| E-3 | Esc / Cancel / backdrop on the folder dialog | Closes without creating |
| E-4 | Database Name field cleared to empty | Node name becomes empty; tab/row render blank but do not crash (low stakes; user retypes) |
| E-5 | Multiple new databases created | Each gets a unique `randomUUID` id; all appear; the latest is active |
| E-6 | New database created while another tab is active | Appended at root and becomes the active tab on Settings |
| E-7 | New database opened -> auto-connect must not fire | Seeded `idle` status makes `useAutoConnect` skip it |

## 7. Dependencies

- **Reused UI:** `Dialog` family (radix umbrella, already a dep), `Input`, `Button`, `cmdk`
  palette, `lucide-react`, theme tokens.
- **Reused context:** `useWorkspace()` - adds `addDatabase`, `addFolder`, `renameDatabase`.
- **Persistence:** existing `onTreeChange` -> `persistTree` flow; new nodes dehydrate/hydrate
  with no schema change (empty `database`/`user` are valid strings).
- **Test:** Vitest + Testing Library; reuse `fixtureTree`, mock `@/lib/tauri` + `sonner` as in
  existing Settings tests.

## 8. Out of Scope

- Drag-and-drop / moving a database into a folder.
- Nested-folder creation, folder-target pickers.
- Name-uniqueness / collision validation.
- Touching the inert "New tab" command.

> Note: v0.2.0 (section 9) brings the `+` button and a sidebar context menu (delete +
> connect/disconnect) into scope; the bullets above are the parts that remain out.

## 9. v0.2.0 - `+` button + sidebar row context menu (delete & connect toggle)

Once you can create databases/folders you also need to remove them and toggle a connection
without opening the Settings tab. v0.2.0 wires the content-header `+` button to "new database"
and adds a right-click context menu to sidebar database/folder rows.

### 9.1 Scope

- **`+` button**: the content-header `+` (previously the inert `newTab`) now runs `addDatabase`
  (same as the palette command / Cmd-Ctrl+N): a database node at root, opened on its Settings tab.
- **Database row context menu**: `Connect` (when not connected) / `Disconnect` (when connected),
  then `Delete`. Connect/Disconnect call the SAME `useConnectionActions().connect/disconnect` the
  Settings button uses - identical behavior, nothing more.
- **Folder row context menu**: `Delete` only.
- **Table leaf**: no context menu (tables are derived from a live catalog, not user-managed).
- **Delete** opens a confirm dialog naming the node; a folder's dialog warns it also removes the
  databases inside it. Confirm removes the node (+ folder descendants) from the tree, prunes its
  open tab(s) and connection state, and persists via the existing tree-change flow. Cancel / Esc /
  backdrop = no-op.

Not in v0.2.0 (still YAGNI): table-leaf actions, rename/create-from-menu, bulk/multi delete,
undo, drag-and-drop, a delete keyboard shortcut.

### 9.2 Acceptance Criteria

| ID | Criterion | Priority |
|----|-----------|----------|
| AC-101 | The content-header `+` button creates a new database (root node, opened on Settings) - same effect as the "New database" command | Must |
| AC-102 | Right-clicking a database row opens a context menu with a connection-toggle item and a `Delete` item | Must |
| AC-103 | The toggle item reads `Connect` when the database is not connected and `Disconnect` when it is | Must |
| AC-104 | Selecting `Connect` invokes `connectDatabase` with the node's config (same as the Settings button); selecting `Disconnect` drops the connection and sets status idle | Must |
| AC-105 | Right-clicking a folder row opens a context menu with a `Delete` item and no connection toggle | Must |
| AC-106 | Selecting `Delete` opens a confirm dialog naming the node; a folder's dialog additionally warns it removes the databases inside it | Must |
| AC-107 | Confirming the delete removes the database/folder from the tree; deleting a folder also removes its descendant databases | Must |
| AC-108 | Cancelling (Cancel / Esc / backdrop) closes the dialog and removes nothing | Must |
| AC-109 | Deleting a node closes any open tab for that node (and for descendants when a folder is deleted); the active tab falls back as on a normal close | Must |
| AC-110 | A table leaf has no context menu (right-click does not open the database/folder menu) | Must |
| AC-111 | `npm run lint`, `npm run typecheck`, `npm test` exit 0 | Must |

### 9.3 User Test Cases

- TC-101 (`+` creates db): click `+` on an empty tree -> a `new_database` tab opens on Settings + a sidebar row appears. -> AC-101.
- TC-102 (disconnect from menu): connected db, right-click -> `Disconnect` -> connection dropped, dot clears. -> AC-102, AC-103, AC-104.
- TC-103 (connect from menu): not-connected db (mock `connectDatabase`), right-click -> `Connect` -> `connectDatabase` called with node config. -> AC-104.
- TC-104 (delete db): right-click db -> `Delete` -> confirm -> row gone. -> AC-106, AC-107.
- TC-105 (delete folder removes children): right-click folder with a child db -> `Delete` -> confirm -> folder + child gone. -> AC-107.
- TC-106 (cancel): open delete dialog, Esc -> dialog closes, node remains. -> AC-108.
- TC-107 (delete closes tab): db open as a tab, delete it -> its tab gone. -> AC-109.
- TC-108 (no menu on table): right-click a table leaf -> no Delete/Connect menu. -> AC-110.

### 9.4 UI States (delete confirm dialog)

| State | Behavior |
| ----- | -------- |
| Closed | Nothing rendered |
| Open (database) | Modal `Delete "<name>"?` + "removes the connection from the workspace"; Cancel + filled-red Delete |
| Open (folder) | Same; body warns it also removes the databases inside it |
| Confirmed | Node (+ folder descendants) removed from tree, dialog closes, open tabs pruned |

### 9.5 Data Model (additions)

New workspace-context action:
- `removeNode(id: string): void` - remove the database/folder with this id from anywhere in the
  tree; drop its connection + status (if a database) and close the open tab(s) for it and, when a
  folder, every database id beneath it.

Menu items are data-driven per node kind (no inline JSX ifology): database -> `[toggle, delete]`,
folder -> `[delete]`, table -> none.

### 9.6 Edge Cases

| # | Case | Handling |
|---|------|----------|
| E-101 | Delete a node that is not the active tab | Removed; active tab unchanged unless it was a descendant |
| E-102 | Delete a folder whose child db is the active tab | Child removed + its tab closed; active falls back per normal close |
| E-103 | Disconnect a db mid-connect ("connecting") | Mirrors the Settings button: drop connection + set idle |
| E-104 | Right-click a table leaf | No menu (table rows render without a ContextMenu wrapper) |
| E-105 | Delete an empty folder | Folder removed; nothing else changes |
| E-106 | Cancel via Esc / Cancel button / backdrop | All three close without deleting |
| E-107 | Delete a never-connected database | Removed cleanly; no connection state to drop |

### 9.7 Dependencies (additions)

- **New UI primitive:** `src/components/ui/context-menu.tsx` on the `radix-ui` umbrella
  (`import { ContextMenu as ContextMenuPrimitive } from "radix-ui"`). No new npm dep.
- **Reused:** `Dialog` (confirm), `Button` (filled-red destructive Delete), `useConnectionActions`
  (connect/disconnect), `useWorkspace` (+`removeNode`).
- **Test:** right-click via `fireEvent.contextMenu`; mock `@/lib/tauri` + `sonner` as elsewhere.
