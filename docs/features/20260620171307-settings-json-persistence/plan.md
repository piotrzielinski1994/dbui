# Plan: Settings + JSON-file persistence layer

Implements `spec.md` v0.1.0. Modeled faithfully on `requi/src/lib/settings/`. TDD, red-green-refactor.

Coverage threshold: none (no threshold configured in `vitest.config.ts`).

## Approach & key decisions

- **Mirror requi's module shape.** New `src/lib/settings/` with the same five pieces:
  `settings.ts` (types + `DEFAULT_SETTINGS` + `mergeSettings`), `tauri-store.ts`
  (`createTauriSettingsStore` via `LazyStore`), `in-memory-store.ts`
  (`createInMemorySettingsStore` for tests), `settings-context.tsx`
  (`SettingsProvider` + `useSettings`). Same `SettingsStore` interface
  (`load`/`save`), same store-injected-as-prop pattern (so tests never import the
  Tauri plugin -> jsdom stays happy, exactly as requi does it).

- **Two JSON files, requi-style split.** requi splits `settings.json` + `keymap.json`;
  we split `settings.json` (UI/layout) + `connections.json` (credentials isolated).
  `load` reads both and merges through `mergeSettings`; `save` strips `connections`
  into its own file via the same `persist(store, key, value)` helper requi uses.

- **`mergeSettings` is the gatekeeper (ADT-style, never throws).** Pure function, guard
  helpers (`isRecord`, `isConnectionConfig`, per-slice validators), drops invalid /
  unknown data, fills from defaults. Same structure as requi's `mergeSettings` +
  `mergeLayouts`/`mergeShortcuts`/`mergeOpenRequestIds`. `activeTabId` coerced to
  `null` unless present in `openTabIds` (E-5, mirrors requi's activeRequestId rule).

- **Persistence is opt-in on `WorkspaceProvider` (keeps AC-010 cheap).** The workspace
  already owns every persisted slice in `useState`. Rather than thread a save into
  each of its many setters (invasive, error-prone), add ONE optional prop
  `onPersist?: (settings: Settings) => void` and ONE `useEffect` that derives the
  current `Settings` from state and calls `onPersist` whenever a persisted slice
  changes. When `onPersist` is absent (all existing tests), zero behavior change -
  no store, no disk, identical to today.
  - *Alternative considered:* replicate requi's granular `save*` methods on the
    context. Rejected: requi's state is small and lives in the settings context
    itself; dbui's lives in `WorkspaceProvider` and the wholesale-derive effect is
    one integration point vs. ~8 setter edits. The derived save is idempotent and
    naturally batches React updates.

- **Seed initial state from settings.** Extend `WorkspaceProvider` props with the
  missing slices (`initialSidebarHidden`, `initialConsoleHidden`,
  `initialSplitOrientation`, `initialOpenTabIds`); existing props
  (`initialExpandedIds`, `initialActiveTabId`, `initialConnections`) stay. A thin
  bridge in `HomePage` reads `useSettings()` and maps `Settings` -> these props +
  `onPersist={persist}`.

- **Restored connections are live for free.** The backend is stateless (every
  `fetch_table` / `execute_sql` reconnects with the passed `ConnectionConfig`).
  Seeding `initialConnections` from saved settings + marking their status
  `connected` makes table opens fetch with the stored config immediately - no live
  pool, no re-type (AC-009). The auto-connect effect already skips nodes with a
  non-`undefined` status, so a restored "connected" node won't re-trigger.

- **`SettingsProvider` at the root, like requi.** `__root.tsx` instantiates
  `createTauriSettingsStore` via `useState` and wraps the tree; `useSettings`
  throws outside the provider. Renders nothing until `load()` resolves (requi
  behavior).

## Files

Backend:
- `src-tauri/Cargo.toml` - add `tauri-plugin-store = "2"`.
- `src-tauri/src/lib.rs` - `.plugin(tauri_plugin_store::Builder::new().build())` in `run()`.
- `src-tauri/capabilities/default.json` - add `"store:default"` permission.

Frontend (new, `src/lib/settings/`):
- `settings.ts` - `Settings`, `DEFAULT_SETTINGS`, `SettingsStore`, `mergeSettings` + guards.
- `tauri-store.ts` - `createTauriSettingsStore()` (two `LazyStore`s: `settings.json`, `connections.json`).
- `in-memory-store.ts` - `createInMemorySettingsStore(initial?)`.
- `settings-context.tsx` - `SettingsProvider` (loads on mount), `useSettings()` -> `{ settings, persist }`.

Frontend (edits):
- `src/components/workspace/workspace-context.tsx` - add the four new initial props,
  seed state from them, add the derive+`onPersist` effect.
- `src/routes/__root.tsx` - wrap `<Outlet/>` in `<SettingsProvider store={createTauriSettingsStore()}>` (store via `useState`).
- `src/routes/index.tsx` - `HomePage` reads `useSettings()`, maps settings -> `WorkspaceProvider` initial props + `onPersist`.
- `package.json` - add `@tauri-apps/plugin-store`.

Tests (RED first, written by test-writer subagent):
- `src/lib/settings/__tests__/settings.test.ts` - `mergeSettings`: valid/partial/garbage/unknown-keys, per-slice fallback, connection validation, activeTabId coercion (AC-002, AC-003, E-1..E-5).
- `src/lib/settings/__tests__/in-memory-store.test.ts` - load/save round-trip via in-memory store (AC-004, TC-005).
- `src/lib/settings/__tests__/settings-context.test.tsx` - provider loads from store and renders children; `persist` writes through `store.save`; round-trip across remount; `useSettings` throws outside provider (AC-006).
- `src/components/workspace/__tests__/workspace-persistence.test.tsx` - `WorkspaceProvider` seeds state from initial props (sidebar/console hidden, split, expanded, open tabs, active tab, connections) AND calls `onPersist` with the updated `Settings` on each persisted change; a restored connection makes a table open fetch with the saved config (AC-007, AC-008, AC-009).

## Edge cases to handle

E-1 cold start -> defaults; E-2 corrupt JSON -> `.catch`->undefined-> defaults via merge;
E-3 unknown keys ignored; E-4 malformed connection entry dropped per-entry; E-5 dangling
`activeTabId` -> `null`; E-6 disk write failure -> `console.warn`, no crash; E-7 no
`SettingsProvider`/`onPersist` -> in-memory, no store calls.

## Test mocking & non-tested seams

- Tests use `createInMemorySettingsStore` and `onPersist` spies - they NEVER import
  `tauri-store.ts` (which imports `@tauri-apps/plugin-store`, unavailable in jsdom).
  This is exactly how requi keeps its suite runnable; `settings-context.tsx` takes the
  store as a prop so it never transitively imports the plugin.
- `createTauriSettingsStore` (LazyStore wiring) and the Rust plugin registration
  (AC-011) require the Tauri runtime; verified by `typecheck` + build + manual
  end-to-end (TC-001/TC-002), not by unit tests. The pure, testable core
  (`mergeSettings`, the store contract, the provider, the workspace wiring) carries
  the AC coverage. This split mirrors requi.

## Execution order

1. RED: settings unit tests + context test + workspace-persistence test (subagent); confirm all fail for the right reason.
2. GREEN:
   - `settings.ts` (`Settings`/`DEFAULT_SETTINGS`/`mergeSettings`) -> AC-001/002/003.
   - `in-memory-store.ts` + `SettingsStore` -> AC-004.
   - `settings-context.tsx` -> AC-006.
   - `workspace-context.tsx` initial props + persist effect -> AC-007/008/009/010.
   - `tauri-store.ts` + root wiring + Cargo/capability/npm -> AC-005/011.
3. REFACTOR: extract slice validators cleanly; dedupe the settings<->workspace mapping; keep guards inline-typed.
4. VERIFY: fresh verifier subagent runs lint/typecheck/`npm test`/`cargo test` + probes E-1..E-7.

## Acceptance verification

One test per AC where unit-testable (AC-001..AC-010 via Vitest as listed); AC-011 +
the Tauri-store path via typecheck/build/manual; AC-012 via the four quality gates.
Manual end-to-end (real restart with a live DB) covers TC-001/TC-002 - noted as a
prerequisite, not CI-gated.

## Risks

- **Plaintext credentials on disk** (`connections.json`): explicit product decision;
  documented in spec Out-of-Scope. Mitigation: isolated in its own file; revisit with
  OS keychain if threat model changes.
- **`@tauri-apps/plugin-store` import in jsdom**: mitigated by store-as-prop injection
  (tests never import the Tauri store), mirroring requi.
- **Persist effect firing on mount**: a redundant first write equal to loaded settings;
  idempotent and harmless (fire-and-forget), matching requi's update-then-save.
- **Open-tabs seeding shape change**: `WorkspaceProvider` currently derives a single
  open tab from `initialActiveTabId`; adding `initialOpenTabIds` must not break the 13
  existing tests - new prop defaults preserve current behavior (AC-010).
