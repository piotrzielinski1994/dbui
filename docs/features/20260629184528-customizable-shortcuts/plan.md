# Plan: Customizable Keyboard Shortcuts

## Approach

Port `requi`'s shortcut stack, adding a `scope` tag. Reuse `@tanstack/react-hotkeys`
primitives (`useHotkeys`, `useHotkeyRecorder`, `normalizeHotkey`, `validateHotkey`,
`formatForDisplay`). Pure logic in `src/lib/shortcuts/`; UI in `src/components/settings/`;
persistence extends the existing `Settings` + `tauri-store` `theme.json`-split pattern.

Scope dispatch = `useHotkeys` with a `target` ref per non-global scope (grid/tree fire
only when focus is inside their element); editor keys bridge into CodeMirror via
`toCodeMirrorKey`. This resolves the only real overload (`Backspace`: grid vs tree).

## Domain-modeling gate

Neither `pz-ddd` nor `pz-archetypes` applies — this is UI/settings plumbing (keybinding
registry, persistence, recorder UI), no domain model, aggregate, consistency boundary,
or recurring domain shape. Recorded in Decision Log.

## Decision Log

| Date       | Decision | Rationale |
| ---------- | -------- | --------- |
| 2026-06-29 | Add `@tanstack/react-hotkeys` rather than hand-roll | Mirrors `requi`; reuses recorder/normalize/validate/format; less surface to test | 
| 2026-06-29 | Scoped registry (add `scope` to `requi`'s flat model) | Context-overloaded keys (Backspace grid vs tree) can't disambiguate in a flat model | 
| 2026-06-29 | Per-scope conflict detection | Same combo allowed across scopes; only same-scope duplicates conflict | 
| 2026-06-29 | Wire next/prev/close-tab as real `tab`-scope bindings | They were palette-only phantom hints; making them real fixes the misleading hints | 
| 2026-06-29 | Keep `Delete` as a fixed alias to delete-rows/nodes; only `Backspace` rebindable | Preserves today's dual-key delete without two registry entries per delete | 
| 2026-06-29 | `keymap.json` separate store | Mirrors `theme.json` split; keymap independently syncable | 
| 2026-06-29 | Neither pz-ddd nor pz-archetypes applies | Pure UI/settings plumbing, no domain model or recurring shape | 

## File changes

### New — pure logic
- `src/lib/shortcuts/registry.ts` — `ShortcutScope`, `ShortcutAction`, `ShortcutActionId`,
  `ShortcutOverrides`, `SHORTCUT_ACTIONS` array.
- `src/lib/shortcuts/resolve.ts` — `safeNormalize`, `resolveShortcuts`, `findConflict`
  (per-scope), helper to look up an action's scope.
- `src/lib/shortcuts/to-codemirror-key.ts` — `toCodeMirrorKey(hotkey): string | null`.

### New — hooks/UI
- `src/lib/shortcuts/use-scoped-hotkeys.ts` — wraps `useHotkeys`; takes a
  `Partial<Record<ShortcutActionId, () => void>>` + optional `target` ref, resolves
  effective bindings, registers only the passed ids.
- `src/components/settings/shortcuts-section.tsx` — groups rows by scope.
- `src/components/settings/shortcut-row.tsx` — recorder row (ported from `requi`).

### Modified
- `src/lib/settings/settings.ts` — add `shortcuts` to `Settings` + `DEFAULT_SETTINGS`;
  `mergeShortcuts` + wire into `mergeSettings`.
- `src/lib/settings/settings-context.tsx` — add `saveShortcut`, `resetShortcut`.
- `src/lib/settings/tauri-store.ts` — second `LazyStore("keymap.json")`; load/merge +
  strip-on-save (mirror theme split).
- `src/components/workspace/workspace-layout.tsx` — replace the `window` keydown listener
  with `use-scoped-hotkeys` (global + tab scopes).
- `src/components/workspace/data-grid.tsx` — replace the Tab + Delete `window` listeners
  with grid-scope hotkeys on `containerRef`.
- `src/components/workspace/sidebar-tree.tsx` — replace the Delete `window` listener with
  tree-scope hotkeys on the tree container ref.
- `src/components/workspace/sql-editor.tsx` — derive `run-query`/`save-script` CM keys
  from resolved bindings via `toCodeMirrorKey` (read settings, pass keys into the keymap).
- `src/components/workspace/command-registry.ts` — drop `hint` strings; keep a mapping
  from `PaletteCommandId` → `ShortcutActionId` (where one exists).
- `src/components/workspace/command-palette.tsx` — derive hint from `resolveShortcuts` +
  `formatForDisplay`.
- `src/routes/settings.tsx` — render `<ShortcutsSection/>` under `<ThemeSection/>`.
- `package.json` — add `@tanstack/react-hotkeys`.

## Execution order (TDD)

1. RED: tests for `registry`, `resolve` (per-scope conflict), `to-codemirror-key`,
   `settings` merge, `settings-context` save/reset, `ShortcutsSection`/`ShortcutRow`
   render, palette hint derivation.
2. GREEN: add dep; implement pure libs → settings → context → store → UI → wire
   call-sites → palette.
3. REFACTOR: dedupe scope-grouping, tighten types, ensure no `any`.

## Acceptance verification

- `npm test` (Vitest) green incl. new specs.
- `npm run typecheck` clean (no `any`).
- `npm run lint` clean.
- Manual smoke: rebind a global shortcut, see it fire; rebind delete in grid vs tree
  independently; palette hints reflect overrides.

## AC traceability (verified)

| AC | Test(s) |
| -- | ------- |
| AC-001 | `registry.test.ts` - ids/scopes/defaults |
| AC-002 | `resolve.test.ts` - resolveShortcuts override/fallback |
| AC-003 | `resolve.test.ts` - findConflict per-scope (TC-004/005) |
| AC-004 | `to-codemirror-key.test.ts` |
| AC-005 | `settings-shortcuts.test.ts` - merge validation |
| AC-006 | `tauri-store.ts` keymap.json split (mirrors untested theme split) |
| AC-007 | `settings-context-shortcuts.test.tsx` - save/reset |
| AC-008 | `shortcuts-section.test.tsx` - heading + rows |
| AC-009 | `shortcuts-section.test.tsx` - Reset visibility |
| AC-010 | `match-hotkey.test.ts` + `command-palette-hints.test.tsx` (real keydown dispatch) |
| AC-011 | `command-palette-hints.test.tsx` - derived hints |

## Deviations from plan

- Dispatch does NOT use `useHotkeys` with a `target` ref. jsdom resolves the test
  platform to "linux" (so TanStack maps `Mod`->Control only), while every existing
  dbui shortcut test fires `metaKey` OR `ctrlKey` interchangeably. A hand-rolled
  `matchesHotkey` (where `Mod` = meta||ctrl) on each component's existing
  window-keydown listener keeps all prior tests green and is the smaller change. The
  lib is still used for the recorder, normalize/validate, and `formatForDisplay`.
- Added `useSettingsOptional` (mirrors the existing `useThemeOptional`) so the
  workspace/grid/tree render outside a SettingsProvider (isolated tests) by falling
  back to `DEFAULT_SETTINGS.shortcuts`.
- Added `match-hotkey.ts` (+ test) - not in the original file list, needed for the
  dispatch approach above.

## Risks

- jsdom can't fire real hotkeys / CM keymaps → behavioral coverage stays at pure-logic
  layer; wiring verified by resolver + key-convert unit tests + manual smoke (accepted,
  same constraint as dnd-kit tests).
- `@tanstack/react-hotkeys` `target` ref scoping behavior under focus → covered by
  per-scope conflict logic; manual smoke confirms grid-vs-tree Backspace.
- Mac `Mod` resolution in CodeMirror (`Mod-` prefix) already used in current keymaps →
  low risk, `toCodeMirrorKey` preserves the `Mod-` form.
