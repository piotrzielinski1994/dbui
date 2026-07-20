# purequery

A minimal, keyboard-driven, fully configurable, desktop database client.

Built as a Tauri 2 desktop app with a React 19 + TypeScript frontend on the TanStack
stack (Router, Query, Table, Form, Hotkeys), shadcn/ui + Tailwind v4, and dnd-kit for
sidebar drag-and-drop.

## Prerequisites

- **Node.js** - version pinned in [mise.toml](mise.toml). With [mise](https://mise.jdx.dev) installed, `mise install` provisions it (and it auto-activates on `cd` once `mise activate` is set up).
- **Rust** stable toolchain (`rustc`, `cargo`).
- **Tauri OS prerequisites** - platform-specific system libraries (WebKitGTK on Linux,
  Xcode CLT on macOS, WebView2 + Build Tools on Windows). See
  https://tauri.app/start/prerequisites/

If the Rust toolchain or system prerequisites are missing, `npm start` fails fast with
a build error from Cargo.

Supported engines: **Postgres**, **MySQL**, **SQLite**, **MongoDB**, **SQL Server**, and
**DynamoDB** (AWS key-value / NoSQL - PartiQL Query tab, browse + item CRUD; connects with a region +
optional keys/endpoint, works against real AWS or DynamoDB Local).

The per-database **Backup...** action needs no external tools - purequery generates the dump itself
(Postgres/MySQL -> a data-only `.sql` INSERT script, SQLite -> a file copy, MongoDB -> a `.jsonl`
Extended-JSON export, DynamoDB -> a `.jsonl` item-per-line export).

## Setup

```bash
mise install
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
> optional folders, loaded from a user-picked **workspace folder** (a `purequery.workspace.json`
> manifest + one `<slug>.db.json` per database + `<slug>/folder.json` per folder). On first
> launch no folder is open - the app shows an "Open workspace folder..." prompt; pick a folder
> (or press **Cmd/Ctrl+O** / the "Open workspace folder" palette command) and its path persists in
> `settings.json`. Add a database with
> **Cmd/Ctrl+N** (or the "New database" palette command): it appears at the tree root and opens
> on its Settings tab, where you name it and fill the connection. Add a folder with
> **Cmd/Ctrl+Shift+N** (or "New folder") - a one-field name dialog. Right-click a database or
> folder row for a context menu: Connect/Disconnect (databases) and Delete (with a confirm
> dialog; deleting a folder removes the databases inside it). The `+` button beside the tabs also
> adds a database. Each database expands
> (chevron) to list its tables once connected. Clicking a
> database name opens a **database card** (sub-tabs SQL / Views / per-engine object tabs
> (Procedures / Functions / Triggers / Sequences, read-only DDL) / Script / Variables / Settings - the
> SQL tab is an editable editor with a Run button, beside the result grid with its own status
> header). Clicking a table opens a **table card** (a
> filter row - the same CodeMirror SQL editor as the SQL tab, single-line, with highlighting +
> table/column autocomplete - + the table's content grid). A console strip sits below; the sidebar|content
> and content|console splits are resizable. The sidebar toggles with `Cmd/Ctrl+B` and the
> console panel with `Cmd/Ctrl+J` (also via palette commands).
>
> The **Settings** sub-tab is live: pick an engine (Postgres / MySQL / SQLite / MongoDB / SQL
> Server / DynamoDB), edit the
> connection fields (SQLite shows a single "Database file" path field instead of host/port/
> user/password; MongoDB adds a "Connection string (URI)" field that overrides the discrete
> host/port/database/user/password when non-empty; SQL Server uses the same host/port/database/
> user/password network fields as Postgres/MySQL, default port 1433; DynamoDB shows an AWS field
> group instead - Region + Access key id / Secret access key + optional Session token / Endpoint URL
> - blank keys fall back to the default AWS credential chain), optionally assign an **accent color** (None / Green / Blue / Red presets, a
> native picker, or any hex) that recolors the whole shell's existing borders while that database
> is active, as a prod-vs-test cue (persisted per database in its `*.db.json`), and press **Connect** to open
> a real `sqlx` connection (Rust backend) and replace that database's sidebar tables with the
> live catalog. Status shows as a toast + a coloured
> dot on the database row. A database lists its tables only after a successful connect
> (the live catalog); table leaves are never shown before connecting. A Postgres connection
> groups its tables under their **schema** rows (`public`, `analytics`, ...); SQL Server groups the
> same way (`dbo`, ...); MySQL/SQLite have
> no schema level and list tables flat. Opening a table of a
> connected database fetches its real content (first 200 rows, NULL shown as `[NULL]`); each
> column header shows its type plus `PK`/`NN` markers, clicking a header sorts the whole table
> server-side (asc/desc/none), and a **Load more** footer pages in the next rows. The status bar
> shows `<loaded> of <total>` rows (unbounded count) with an editable page-size field. Both grids'
> row context menus **Copy CSV**/**Copy JSON** the current selection to the clipboard or
> **Export CSV.../Export JSON...** it to a file; the SQL result sorts client-side. The
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
> an `untitled`. Saved scripts persist per database in its `*.db.json` and a duplicate name is
> rejected. The editor|results split flips between side-by-side and stacked via `Cmd/Ctrl+\` (or the
> "Toggle split layout" palette command).
> The **Views** tab lists the connected database's real views (queried on connect). The **Script**
> tab is a **read-only JavaScript scratchpad**: write JS in the editor, press **Run** (or
> `Cmd/Ctrl+Enter`), and it executes in an isolated Web Worker with an injected async `db` API
> (`db.query(sql)` for SQL; `db.find`/`db.aggregate` for MongoDB; plus `db.tables`/`db.schema`) that
> reads from the connected database. `console.log`/`print` stream to the bottom **Console** panel; a
> `return { header, rows }` renders in the shared data grid. Scripts are saved per database as their
> own document tabs (same `+` / `Cmd/Ctrl+S` / untitled UX as the SQL tab). Scripts cannot write - a
> write-shaped `db.query` is blocked with a sticky warning toast; **Run** flips to **Cancel** (which
> terminates the worker) and a run over ~5s raises a sticky warning. The **Variables** tab holds
> per-database `name`/`value` query variables: reference one as `{{name}}` in the SQL/Query editor and
> its value is substituted verbatim on Run (all engines); an undefined `{{name}}` blocks the Run with
> a warning. An open table also has a
> read-only **Structure** view (`Mod/Ctrl+Shift+I` or the
> "View table structure" palette command) showing its columns, indexes, foreign keys, and
> constraints (MongoDB: collection indexes only). Right-clicking a SQL table row offers a **Go to
> `<table>`** item per outbound foreign key with a non-null value, jumping to the referenced row (opens
> that table's tab, filtered to the referenced key); FK columns are marked `FK` in the grid header. The sidebar tree + its connection configs persist as files
> inside the picked workspace folder (`purequery.workspace.json` + `*.db.json` + `folder.json`); UI/layout state (panel toggles, split orientation, expanded nodes, open
> tabs, whether the window was fullscreen at exit - restored on next launch, and the default
> **row limit** a freshly opened table's grid loads per page, set in `/settings`) persists in
> `settings.json`; the theme **mode** also lives in `settings.json` while the
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

> **SQL Server** is supported as a full-parity relational engine. sqlx dropped its MSSQL driver in
> 0.7, so - like MongoDB - SQL Server lives in its own `src-tauri/src/mssql.rs` module on the
> pure-Rust **`tiberius`** TDS driver (no native libraries; works on Apple Silicon via `rustls`),
> with its own connection registry, dispatched per connection id from `lib.rs`. Because it IS
> relational SQL it reuses every shared IPC struct and the whole frontend (the shared data grid, SQL
> editor, History/Changes, Structure view, FK navigation, object tabs, backup, manual-commit
> transactions, read-only) with no forked UI - browse/query/CRUD/introspection all work as they do
> for Postgres/MySQL. Connect with the network fields (default port 1433); tables group by schema
> (`dbo`, ...). Note tiberius's `Client` is a single connection (not a pool), so commands on one
> connection serialise; manual-commit transactions are a simple `BEGIN TRAN` + flag on that held
> connection.

## Releases & auto-update

Releases are cut by the `Release` GitHub Actions workflow (`workflow_dispatch`,
input a tag like `v0.2.0`) - it builds macOS / Windows / Linux bundles via
`tauri-action` and publishes a draft GitHub release with the installers plus
updater artifacts (`.sig` files + a `latest.json`).

The app self-updates via the Tauri v2 updater plugin: on launch (and via
**Settings > Updates > Check for updates**) it reads
`releases/latest/download/latest.json` and, on a newer signed version, shows a
persistent toast with an **Update now** action that downloads and relaunches.

Signing requires two GitHub repo secrets consumed by the release workflow:
`TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (the
minisign keypair whose public half is baked into `tauri.conf.json`
`plugins.updater.pubkey`). **Caveat:** auto-update only works *forward* from the
first updater-enabled release - the already-installed v0.1.0 has no updater, so
upgrading to the first signed build is a one-time manual download.

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
                        workspace/ (sidebar tree from a picked workspace folder: model +
                        disk-format serialize/deserialize + per-db codec (mergeDatabaseFile/
                        hydrateDatabase/dehydrateDatabase), WorkspaceFs port + tauri-fs/in-memory-fs,
                        reconcile, slug, folder-picker),
                        updater/ (UpdateController port + noop, app-version, sonner
                        showUpdateToast, UpdateChecker startup bridge, UpdaterProvider)
  index.css             Tailwind v4 + theme tokens
  test/setup.ts         Vitest + Testing Library setup
src-tauri/              Rust desktop shell: db.rs (Postgres/MySQL/SQLite via sqlx Any), mongo.rs
                        (MongoDB via the mongodb crate), mssql.rs (SQL Server via the tiberius TDS
                        crate), lib.rs (commands + per-connection SQL/Mongo/mssql dispatch),
                        backup.rs (native dumps), logging.rs file logger, tauri.conf.json
tests/e2e/              Behavior smoke tests
docs/                   spec/plan per feature, ADR, learnings, design.md
```

UI conventions (no rounded corners, 1px dividers, density, etc.) live in
[docs/design.md](docs/design.md).
