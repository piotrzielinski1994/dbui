# DbUI

A minimal, keyboard-driven, fully configurable, desktop database client.

Built as a Tauri 2 desktop app with a React 19 + TypeScript frontend on the TanStack
stack (Router, Query, Table, Form, Hotkeys) and shadcn/ui + Tailwind v4.

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
> filter row + the table's content grid). A console strip sits below; the sidebar|content
> and content|console splits are resizable. The sidebar toggles with `Cmd/Ctrl+B` and the
> console panel with `Cmd/Ctrl+J` (also via palette commands).
>
> The **Settings** sub-tab is live: pick an engine (Postgres / MySQL), edit the connection
> fields, and press **Connect** to open a real `sqlx` connection (Rust backend) and replace
> that database's sidebar tables with the live catalog. Status shows as a toast + a coloured
> dot on the database row. A database lists its tables only after a successful connect
> (the live catalog); table leaves are never shown before connecting. Opening a table of a
> connected database fetches its real content (first 200 rows, NULL shown as `[NULL]`). The
> SQL tab is live: edit SQL and Run it
> (or Cmd/Ctrl+Enter) against the connected database - row-returning queries show a result
> grid, other statements report rows-affected. The editor|results split flips between
> side-by-side and stacked via `Cmd/Ctrl+\` (or the "Toggle split layout" palette command).
> Views/Script tabs remain mock. The sidebar tree + its connection configs persist in
> `workspace.json`; UI/layout state (panel toggles, split orientation, expanded nodes, open
> tabs) persists in `settings.json` - both JSON files in the OS app-config dir (via
> `@tauri-apps/plugin-store`).

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
                        database card (SQL/Views/Script/Connection), table card, console,
                        command palette (Cmd/Ctrl+K)
    ui/                 shadcn primitives
  lib/                  tauri.ts (typed invoke wrappers), utils.ts (cn),
                        settings/ (UI-state JSON persistence: types + mergeSettings,
                        tauri/in-memory stores, SettingsProvider),
                        workspace/ (sidebar tree from workspace.json: types +
                        mergeWorkspace + hydrate/dehydrate, stores, WorkspaceStoreProvider)
  index.css             Tailwind v4 + theme tokens
  test/setup.ts         Vitest + Testing Library setup
src-tauri/              Rust desktop shell (greet command, tauri.conf.json)
tests/e2e/              Behavior smoke tests
docs/                   spec/plan per feature, ADR, learnings, design.md
```

UI conventions (no rounded corners, 1px dividers, density, etc.) live in
[docs/design.md](docs/design.md).
