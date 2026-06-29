# DbUI

A minimal, keyboard-driven, fully configurable, desktop database client.

Built as a Tauri 2 desktop app with a React 19 + TypeScript frontend on the TanStack
stack (Router, Query, Table, Form, Hotkeys), shadcn/ui + Tailwind v4, and dnd-kit for
sidebar drag-and-drop.

## Prerequisites

- **Node.js** - version pinned in [.nvmrc](.nvmrc). Run `nvm use` before any npm command.
- **Rust** stable toolchain (`rustc`, `cargo`).
- **Tauri OS prerequisites** - platform-specific system libraries (WebKitGTK on Linux,
  Xcode CLT on macOS, WebView2 + Build Tools on Windows). See
  https://tauri.app/start/prerequisites/

If the Rust toolchain or system prerequisites are missing, `npm start` fails fast with
a build error from Cargo.

## Setup

```bash
nvm use
npm install
```

## Commands

| Command | Description |
| --- | --- |
| `npm start` | Launch the desktop app (`tauri dev`) - native window + Vite dev server. |
| `npm run dev` | Frontend-only Vite dev server (browser, no native shell). |
| `npm run build` | Typecheck + production frontend build (`dist/`). |
| `npm run tauri build` | Produce a native desktop bundle. |
| `npm run lint` | ESLint (flat config). |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run format` | Prettier write. |
| `npm test` | Frontend behavior tests (Vitest, run once). |
| `npm run test:watch` | Vitest in watch mode. |

Rust backend tests: `cd src-tauri && cargo test`.

The dev server runs on port 1431 (set in both `vite.config.ts` and `src-tauri/tauri.conf.json`).

> The home route renders the workspace shell: a sidebar tree of databases grouped under
> optional folders, loaded from a persisted `workspace.json` (empty on first run - the
> sidebar shows a "No connection" state until you add a database). Add a database with
> **Cmd/Ctrl+N** (or the "New database" palette command): it appears at the tree root and opens
> on its Settings tab, where you name it and fill the connection. Add a folder with
> **Cmd/Ctrl+Shift+N** (or "New folder") - a one-field name dialog. Right-click a database or
> folder row for a context menu: Connect/Disconnect (databases) and Delete (with a confirm
> dialog; deleting a folder removes the databases inside it). The `+` button beside the tabs also
> adds a database. Each database expands
> (chevron) to list its tables once connected. Clicking a
> database name opens a **database card** (sub-tabs SQL / Views / Script / Settings - the
> SQL tab is an editable editor with a Run button, beside the result grid with its own status
> header). Clicking a table opens a **table card** (a
> filter row - the same CodeMirror SQL editor as the SQL tab, single-line, with highlighting +
> table/column autocomplete - + the table's content grid). A console strip sits below; the sidebar|content
> and content|console splits are resizable. The sidebar toggles with `Cmd/Ctrl+B` and the
> console panel with `Cmd/Ctrl+J` (also via palette commands).
>
> The **Settings** sub-tab is live: pick an engine (Postgres / MySQL / SQLite / MongoDB), edit the
> connection fields (SQLite shows a single "Database file" path field instead of host/port/
> user/password; MongoDB adds a "Connection string (URI)" field that overrides the discrete
> host/port/database/user/password when non-empty), optionally assign an **accent color** (None / Green / Blue / Red presets, a
> native picker, or any hex) that recolors the whole shell's existing borders while that database
> is active, as a prod-vs-test cue (persisted per database in `workspace.json`), and press **Connect** to open
> a real `sqlx` connection (Rust backend) and replace that database's sidebar tables with the
> live catalog. Status shows as a toast + a coloured
> dot on the database row. A database lists its tables only after a successful connect
> (the live catalog); table leaves are never shown before connecting. A Postgres connection
> groups its tables under their **schema** rows (`public`, `analytics`, ...); MySQL/SQLite have
> no schema level and list tables flat. Opening a table of a
> connected database fetches its real content (first 200 rows, NULL shown as `[NULL]`); each
> column header shows its type plus `PK`/`NN` markers, clicking a header sorts the whole table
> server-side (asc/desc/none), and a **Load more** footer pages in the next rows. The status bar
> shows `<loaded> of <total>` rows (unbounded count) with an editable page-size field. Both grids
> have **Copy CSV**/**Copy JSON** footer buttons; the SQL result sorts client-side. The
> SQL tab is a live CodeMirror editor (SQL syntax highlighting; autocomplete of keywords, the
> connected database's tables, and their columns from the live schema): edit SQL and Run it
> (or Cmd/Ctrl+Enter) against the connected database - row-returning queries show a result
> grid, other statements report rows-affected. You can run several `;`-separated statements in
> one go - they execute in order on one held connection, so your own `BEGIN`/`COMMIT` spans them;
> the result grid shows the last row-returning statement. While a query runs the Run button
> becomes **Cancel**. With a non-empty selection, Run executes only
> the selected text; otherwise the whole buffer. The editor toolbar carries per-database
> **saved-script document tabs** on the left (the same tab component as the open-content tabs): the
> editor always edits the active script, clicking a chip switches to it, and its **X** deletes it.
> The **+** button (right of the chips) opens a fresh **`untitled`** document immediately (no
> dialog) - type, then **Cmd/Ctrl+S** to save: an `untitled`'s first save prompts for a name
> (renaming the tab), a named script saves silently in place. A database with no scripts auto-opens
> an `untitled`. Saved scripts persist per database in `workspace.json` and a duplicate name is
> rejected. The editor|results split flips between side-by-side and stacked via `Cmd/Ctrl+\` (or the
> "Toggle split layout" palette command).
> Views/Script tabs remain mock. The sidebar tree + its connection configs persist in
> `workspace.json`; UI/layout state (panel toggles, split orientation, expanded nodes, open
> tabs) persists in `settings.json`; the theme **mode** also lives in `settings.json` while the
> per-mode **color overrides** persist in a separate `theme.json`, and the **keyboard-shortcut
> overrides** persist in a separate `keymap.json` - all JSON files in the OS app-config dir (via
> `@tauri-apps/plugin-store`).
>
> **Keyboard shortcuts are customizable.** Every app shortcut is a registry action with a scope
> (global / tabs / data grid / sidebar / query editor); the `/settings` route's **Keyboard
> Shortcuts** section lists them grouped by scope and lets you rebind any one by pressing **Edit**
> and typing a combination (Escape cancels, so it can't be assigned). Conflicts are detected
> **per-scope** - the same combo can mean different things in different scopes (e.g. Backspace
> deletes grid rows vs sidebar nodes). Only the sparse overrides persist (`keymap.json`); the
> command-palette hints derive from the live bindings. Built on `@tanstack/react-hotkeys`.
>
> The app supports **multiple themes**: an appearance **mode** (Light / Dark / System - System
> follows the OS `prefers-color-scheme` live) plus optional **per-mode color overrides** of the 18
> app tokens + 9 editor-syntax tokens. Toggle the mode with **Cmd/Ctrl+Shift+L** (cycles
> light -> dark -> system) or the "Toggle theme" palette command. The **`/settings`** route hosts a
> Theme section: the mode buttons + a raw-JSON color editor (schema-validated, autocomplete + hover)
> seeded with the full effective color set - edit a token to override it, set it back to the default
> to clear it, save with the **Save** button or **Cmd/Ctrl+S** (only the sparse diff persists). The
> SQL CodeMirror editor recolors live with the theme. The chosen mode toggles a `.dark` class on
> `<html>` and overrides apply as inline CSS vars.

> **MongoDB** is supported as a document engine alongside the SQL engines. A connected MongoDB
> database lists its **collections** in the sidebar (flat, no schema level). Opening a collection
> browses its documents in the same data grid: columns are the union of the sampled documents'
> top-level fields with `_id` first (marked `PK`), a nested object/array shows as compact JSON in
> its cell, and a field missing from a document shows `[NULL]`. The filter row takes a MongoDB
> **find filter as JSON** (e.g. `{"age": {"$gt": 30}}`; an ObjectId `_id` is matched with Extended
> JSON, e.g. `{"_id": {"$oid": "..."}}`). A MongoDB database card replaces the SQL/Views/Script tabs
> with a single **Query** tab that reuses the **same editor pane as the SQL tab** - identical
> saved-script document tabs (`+`, Cmd/Ctrl+S, untitled), Run/Cancel and History. Mongo commands are
> self-contained `db.<collection>.find({...})` / `db.<collection>.aggregate([...])` (the collection
> lives in the command like a SQL `FROM`, so there is no collection picker); multiple `;`-separated
> commands run in order. Editing a scalar cell
> stages an `updateOne $set` (the text is parsed as a JSON literal so number/bool/null types are
> preserved); a row's context-menu **Edit document** opens the whole document as JSON for a
> `replaceOne`; add/delete map to `insertOne`/`deleteOne`. The backend uses the official `mongodb`
> crate in a separate `src-tauri/src/mongo.rs` module (the SQL engines run on `sqlx`); `lib.rs`
> dispatches each command to the Mongo or SQL path by connection.

## Repo layout

```
index.html              Vite entry HTML
src/
  main.tsx              React entry: providers + RouterProvider
  router.tsx            Code-based TanStack Router assembly
  app/providers.tsx     QueryClientProvider
  routes/               __root (layout + 404), index (workspace home), settings
  components/
    workspace/          workspace shell: context/provider, sidebar tree, content tabs,
                        database card (SQL/Views/Script/Connection; Query/Settings for MongoDB -
                        Query reuses the SQL editor pane), table card, query-preview (per-engine
                        preview/filter strategy), console, command palette (Cmd/Ctrl+K),
                        schema-intellisense (JSON-schema CM editor)
    settings/           app-level settings UI: theme-section (mode buttons + JSON color editor),
                        shortcuts-section + shortcut-row (per-scope keybinding recorder rows)
    ui/                 shadcn primitives
  lib/                  tauri.ts (typed invoke wrappers), utils.ts (cn),
                        logging/ (file-log.ts: best-effort logMessage -> Rust file log),
                        settings/ (UI-state + theme-mode + shortcut-override JSON persistence:
                        types + mergeSettings, settings.json/theme.json/keymap.json stores,
                        SettingsProvider),
                        shortcuts/ (scoped action registry, resolveShortcuts + per-scope
                        findConflict, matchesHotkey dispatch matcher, toCodeMirrorKey bridge),
                        theme/ (theme-defaults + mode/override helpers + ThemeProvider: .dark class
                        + inline CSS vars + live OS-preference follow),
                        config-schema/ (zod + zod-derived JSON schema for the color editor),
                        workspace/ (sidebar tree from workspace.json: types +
                        mergeWorkspace + hydrate/dehydrate, stores, WorkspaceStoreProvider)
  index.css             Tailwind v4 + theme tokens
  test/setup.ts         Vitest + Testing Library setup
src-tauri/              Rust desktop shell: db.rs (SQL engines via sqlx Any), mongo.rs (MongoDB
                        via the mongodb crate), lib.rs (commands + per-connection SQL/Mongo
                        dispatch), logging.rs file logger, tauri.conf.json
tests/e2e/              Behavior smoke tests
docs/                   spec/plan per feature, ADR, learnings, design.md
```

UI conventions (no rounded corners, 1px dividers, density, etc.) live in
[docs/design.md](docs/design.md).
