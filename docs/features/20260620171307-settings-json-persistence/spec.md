# Spec: Settings + JSON-file persistence layer

**Version:** 0.1.0
**Created:** 2026-06-20
**Status:** Implemented

## AC traceability

| AC | Test |
|----|------|
| AC-001 | settings `DEFAULT_SETTINGS should expose the documented default shape` |
| AC-002 | settings `mergeSettings` suite (18 cases: full pass-through, missing-key fill, unknown-key drop, per-slice fallback, activeTabId coercion, garbage never-throws) |
| AC-003 | settings `mergeSettings connections` suite (keep valid / drop malformed / mysql / bad host / missing password / garbage) |
| AC-004 | in-memory-store `createInMemorySettingsStore` suite (default / seed / save-load / overwrite) |
| AC-005 | `tauri-store.ts` (runtime seam: LazyStore split + `.catch`->defaults + two-file round-trip; verified by typecheck/build/manual, not unit-tested - see plan) |
| AC-006 | settings-context `SettingsProvider` suite (load, render-after-load, persist updates, save-through, remount round-trip) + `useSettings should throw if used outside a SettingsProvider` |
| AC-007 | workspace-persistence `WorkspaceProvider seeded persistence state` suite (sidebar/console hidden, split, expanded, open tabs+active, connections) |
| AC-008 | workspace-persistence `onPersist side-effect contract` suite (sidebar/console/split/expand/open-tab/connection) |
| AC-009 | workspace-persistence `should seed the connections map from initialConnections` (config retained) + database-card `should auto-connect the database when its view is opened` (re-fetch on open) + sidebar-tree `should not reveal table leaves when an expanded database is not connected` (no stale tables) |
| AC-010 | workspace-persistence `should still toggle the sidebar with no onPersist prop and not throw` + 13 pre-existing workspace tests unchanged |
| AC-011 | `Cargo.toml` + `lib.rs` plugin reg + `capabilities/default.json` `store:default` + `package.json` dep (runtime seam) |
| AC-012 | `npm run lint` (0 errors) / `npm run typecheck` / `npm test` (213) / `cargo test` (34) |

## Known minor (non-blocking)

- `isConnectionConfig` accepts `port: NaN` (`typeof NaN === "number"`); harmless (fails at
  connect time, never crashes merge) and mirrors requi's guard shape exactly. Harden with
  `Number.isFinite` if revisited.

## 1. Overview

DbUI holds all UI and connection state in memory (`WorkspaceProvider`); nothing
survives a restart. Every session starts from mock data, panel toggles reset, and
connection credentials must be re-typed.

This feature adds a **JSON-file persistence layer modeled on the `requi` repo**
(`requi/src/lib/settings/`). requi persists frontend UI state to OS-config-dir JSON
files via `@tauri-apps/plugin-store` (`LazyStore`), validated through a
`mergeSettings()` gatekeeper, behind a `SettingsStore` interface with two
implementations (Tauri-backed + in-memory test double) and a React context
(`SettingsProvider` / `useSettings`). We replicate that architecture in DbUI.

What this delivers:
- A `src/lib/settings/` module mirroring requi: `Settings` type + `DEFAULT_SETTINGS`,
  `mergeSettings()` validation, `SettingsStore` interface, `createTauriSettingsStore()`
  (LazyStore -> JSON), `createInMemorySettingsStore()` (tests), `SettingsProvider` +
  `useSettings()`.
- Two JSON files in the OS app-config dir (faithful to requi's `settings.json` +
  `keymap.json` split): `settings.json` (UI/layout state) and `connections.json`
  (saved connection configs, isolating credentials in their own file).
- Persisted slices: sidebar/console visibility, split orientation, expanded tree
  nodes, open tab ids + active tab, and per-database connection configs (engine,
  host, port, database, user, **password in plaintext** - see Out of Scope note).
- Restore on launch: panel layout + open tabs + expanded nodes rehydrate; saved
  connections rehydrate as live+connected (the backend is stateless, so a stored
  config is immediately usable - opening a table fetches with it, no re-typing).

What this does **not** deliver (out of scope, not requested):
- No backend (Rust) settings logic beyond enabling the store plugin + capability.
  All settings live in the frontend, exactly like requi.
- No encryption / OS keychain for passwords (user chose plaintext JSON, matching
  requi's "store plugin writes plaintext JSON" behavior).
- No new settings UI - the existing Settings sub-tab is unchanged. Persistence is
  invisible plumbing behind current controls.
- No settings file migration logic beyond the `version` field + `mergeSettings`
  forward-compat (requi has none either).
- No "add/remove database" feature - the tree is still the mock tree; we persist
  state keyed by its stable node ids.

### User Story

As a developer using DbUI, I want my panel layout, open tabs, and database
connection details to survive an app restart, so I resume exactly where I left off
without re-typing credentials or re-toggling panels.

## 2. Acceptance Criteria

| ID | Criterion | Priority |
|----|-----------|----------|
| AC-001 | A `Settings` type + `DEFAULT_SETTINGS` exist with: `version`, `sidebarHidden`, `consoleHidden`, `splitOrientation`, `expandedIds`, `openTabIds`, `activeTabId`, `connections` | Must |
| AC-002 | `mergeSettings(defaults, partial)` returns a fully valid `Settings`, never throws, drops/ignores type-mismatched or unknown fields, and falls back to defaults for each invalid slice | Must |
| AC-003 | `mergeSettings` validates `connections`: keeps only entries whose value is a valid `ConnectionConfig` (engine in {postgres,mysql}; host/database/user/password strings; port a number); drops the rest | Must |
| AC-004 | A `SettingsStore` interface (`load(): Promise<Settings>`, `save(settings): Promise<void>`) exists with a `createInMemorySettingsStore()` implementation usable in tests | Must |
| AC-005 | `createTauriSettingsStore()` persists via `LazyStore`: UI/layout slices to `settings.json`, the `connections` slice to `connections.json`; load merges both through `mergeSettings`; a missing/corrupt file yields `DEFAULT_SETTINGS` (errors caught, warned, not thrown) | Must |
| AC-006 | A `SettingsProvider` loads on mount (renders nothing until loaded, like requi) and a `useSettings()` hook exposes `settings` + a `persist(next)` save path; `useSettings` throws if used outside the provider | Must |
| AC-007 | On launch (under `SettingsProvider`) the workspace seeds its initial sidebar/console visibility, split orientation, expanded ids, open tabs + active tab, and connections from the loaded settings | Must |
| AC-008 | Changing any persisted slice (toggle sidebar/console, flip split, expand/collapse a node, open/close/switch a tab, connect/disconnect) writes the updated `Settings` to disk via the store | Must |
| AC-009 | A restored connection retains its saved config (no re-type): opening that database auto-connects with the stored config and fetches the live catalog. Tables are NEVER shown until a real connect succeeds (the app cannot know a database's tables before connecting), so a restored connection re-fetches rather than displaying stale mock tables | Must |
| AC-010 | Existing `WorkspaceProvider` tests still pass unchanged (persistence is opt-in; standalone provider keeps current in-memory behavior) | Must |
| AC-011 | The Tauri store plugin is enabled (Rust `tauri-plugin-store`, npm `@tauri-apps/plugin-store`, `store:default` capability) | Must |
| AC-012 | `npm run lint`, `npm run typecheck`, `npm test`, and `cargo test` all exit 0 | Must |

## 3. User Test Cases

### TC-001 (happy path): Layout survives restart
Hide the sidebar (`Cmd/Ctrl+B`), flip split to vertical (`Cmd/Ctrl+\`), expand a folder,
open two tabs. Restart the app.
**Expected:** sidebar hidden, split vertical, folder expanded, both tabs open with the
same active tab. **Maps to:** AC-007, AC-008.

### TC-002 (happy path): Connection survives restart
Open a database's Settings, enter host/port/db/user/password, Connect. Restart.
**Expected:** the database shows connected; opening its tables fetches rows with the
saved config; the Settings form shows the saved values. **Maps to:** AC-008, AC-009.

### TC-003 (cold start): No settings file yet
First launch (no `settings.json`/`connections.json`).
**Expected:** app loads with `DEFAULT_SETTINGS` (current default layout, no saved
connections); no crash. **Maps to:** AC-005.

### TC-004 (resilience): Corrupt / partial settings file
`settings.json` contains garbage or a partial/typo'd object (e.g. `splitOrientation: 5`,
an unknown key, a malformed connection entry).
**Expected:** `mergeSettings` drops the invalid slices, keeps the valid ones, fills the
rest from defaults; app loads normally. **Maps to:** AC-002, AC-003, AC-005.

### TC-005 (round-trip, unit): Store save -> load
Save a non-default `Settings` through a store, then load via a fresh store instance.
**Expected:** loaded settings equal the saved ones (after merge). **Maps to:** AC-004, AC-005.

### TC-006 (isolation): Tests don't touch disk
Existing workspace tests mount `WorkspaceProvider` without a `SettingsProvider`.
**Expected:** they behave exactly as before (in-memory, no persistence calls). **Maps to:** AC-010.

## 4. UI States

| State | Behavior |
| ----- | -------- |
| Loading (settings not yet read) | `SettingsProvider` renders nothing (blank) until `load()` resolves, then mounts children seeded from settings (requi behavior) |
| Cold (no file) | Defaults applied; app identical to today's first run |
| Corrupt/partial file | Invalid slices dropped, valid ones kept, rest defaulted; no error surfaced to the user |
| Restored | Panel layout / tabs / expanded nodes match last session; saved DB connections appear connected and usable |

## 5. Data Model

Frontend `src/lib/settings/settings.ts`:

```ts
type PanelLayout = Record<string, number>;     // panel id -> size %
type PanelGroupKey = "workspace" | "main" | "sql";

type Settings = {
  version: 1;
  sidebarHidden: boolean;        // requi naming (hidden, not visible)
  consoleHidden: boolean;
  splitOrientation: "horizontal" | "vertical";
  layouts: Partial<Record<PanelGroupKey, PanelLayout>>; // resizable panel sizes (requi parity)
  expandedIds: string[];
  openTabIds: string[];
  activeTabId: string | null;
  connections: Record<string, ConnectionConfig>; // keyed by database node id
};
```

`layouts` mirrors requi's slice: `workspace` (sidebar|content), `main` (content|console)
are `react-resizable-panels` groups captured via `onLayoutChanged`/`defaultLayout`; `sql`
is the hand-rolled SQL editor|results split (`{ left: number }`, persisted on drag-end).

`ConnectionConfig` is reused from `mock-data.ts` (engine, host, port, database, user,
password) - no new type. `mergeSettings` re-validates it on load.

Storage (`createTauriSettingsStore`):
- `settings.json` key `settings` <- everything except `connections`.
- `connections.json` key `connections` <- the `connections` record (credentials isolated).
- Path resolution handled by `LazyStore` -> OS app-config dir
  (`~/Library/Application Support/com.dbui.app/` on macOS, etc.).

## 6. Edge Cases

| # | Case | Handling |
|---|------|----------|
| E-1 | No settings file (cold start) | `LazyStore.get` -> undefined -> `mergeSettings` returns defaults |
| E-2 | Corrupt JSON / wrong types | `.catch(() => undefined)` on get; `mergeSettings` drops bad slices |
| E-3 | Unknown / future keys in file | Silently ignored by `mergeSettings` (forward-compatible) |
| E-4 | Malformed connection entry (missing field / wrong type) | Dropped per-entry by the connections validator; valid entries kept |
| E-5 | `activeTabId` not in `openTabIds` | Coerced to `null` (consistency, like requi's activeRequestId rule) |
| E-6 | Disk write fails (permissions) | `.catch` warns to console; in-memory state unaffected, no crash |
| E-7 | Tests with no `SettingsProvider` | `WorkspaceProvider` uses defaults; no store calls (opt-in persistence) |

## 7. Dependencies

- Rust: `tauri-plugin-store = "2"` in `src-tauri/Cargo.toml`; `.plugin(tauri_plugin_store::Builder::new().build())` in `run()`.
- Frontend: `@tauri-apps/plugin-store` (npm).
- Capability: add `store:default` to `src-tauri/capabilities/default.json`.
- Reuses existing `ConnectionConfig`, `WorkspaceProvider` initial-state props, and the
  React 19 / TanStack Router setup.

## 8. Out of Scope

Backend settings persistence, password encryption / keychain, new settings UI,
add/remove-database, settings-file migrations beyond `version` + forward-compat merge,
persisting ephemeral live state (connection status dot is derived, query history,
pending edits).

**Security note:** per explicit product decision, connection passwords are written to
`connections.json` in plaintext (same trust model as requi's plaintext store files).
Documented here so it is a deliberate, visible choice.
