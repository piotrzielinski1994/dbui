# Customizable Keyboard Shortcuts

## Overview

dbui's keyboard shortcuts are hardcoded across four `window`-keydown listeners, two
CodeMirror keymaps, and the command palette's display-only `hint` strings. Nothing is
user-rebindable, and the palette advertises three shortcuts (`Tab` next-tab,
`Shift+Tab` prev-tab, `Ctrl+W` close-tab) that are **not actually bound to any key**.

This feature ports `requi`'s shortcut-customization stack into dbui: a central action
registry, an effective-binding resolver with conflict detection, persistence in a
separate `keymap.json`, a recorder-based rebinding UI in Settings, and palette hints
derived from the live bindings. It extends `requi`'s flat model with a **scope** tag so
that context-overloaded keys (the same combo meaning different things depending on
focus) resolve correctly.

Library: add `@tanstack/react-hotkeys` (same version `requi` uses, `^0.10.0`) and reuse
its `useHotkeys`, `useHotkeyRecorder`, `normalizeHotkey`, `validateHotkey`,
`formatForDisplay`.

## Scope model

Every action carries a `scope`. A scope determines where its hotkey is allowed to fire:

| Scope    | Active when                              | Dispatch path                          |
| -------- | ---------------------------------------- | -------------------------------------- |
| `global` | always                                   | `useHotkeys`, `target` = document      |
| `tab`    | always                                   | `useHotkeys`, `target` = document      |
| `grid`   | focus within the data-grid container     | `useHotkeys`, `target` = grid ref      |
| `tree`   | focus within the sidebar tree container  | `useHotkeys`, `target` = sidebar ref   |
| `editor` | CodeMirror editor focused                | CodeMirror `keymap.of` (bridge)        |

Scoping by `target` ref means a grid hotkey only fires when the keydown originates
inside the grid element; the tree hotkey only when inside the tree. This is how
`Backspace` can mean **delete-rows** in the grid and **delete-nodes** in the tree
without collision.

Conflict detection is **per-scope**: the same combo in two different scopes is allowed;
the same combo twice in one scope is a conflict.

## Action registry (defaults)

`global`
- `open-command-palette` — `Mod+K`
- `new-database` — `Mod+N`
- `new-folder` — `Mod+Shift+N`
- `toggle-sidebar` — `Mod+B`
- `toggle-console` — `Mod+J`
- `toggle-theme` — `Mod+Shift+L`
- `toggle-split-orientation` — `Mod+\` (callback guards to split view, as today)

`tab` (newly wired — were palette-only)
- `next-tab` — `Ctrl+Tab`
- `prev-tab` — `Ctrl+Shift+Tab`
- `close-tab` — `Mod+W`

`grid`
- `toggle-record-view` — `Tab`
- `delete-rows` — `Backspace`

`tree`
- `delete-nodes` — `Backspace`

`editor`
- `run-query` — `Mod+Enter`
- `save-script` — `Mod+S`

Notes:
- `delete-rows`/`delete-nodes` keep working with the PC forward-`Delete` key too: each
  delete action also registers a fixed, non-rebindable `Delete` alias to the same
  callback, preserving today's dual-key (Backspace + Delete) behavior. Only the
  `Backspace` default is user-rebindable.
- The single-line filter editor's bare `Enter`-to-submit is intrinsic (not a registry
  action); only the multi-line editor's `Mod+Enter` maps to `run-query`.
- `Escape` is never rebindable (recorder uses it to cancel), matching `requi`.

## Acceptance Criteria

- AC-001: A scoped action registry (`id`, `name`, `description`, `defaultHotkey`,
  `scope`) lists every action above; `ShortcutOverrides` is a sparse
  `Partial<Record<ShortcutActionId, string>>`.
- AC-002: `resolveShortcuts(overrides)` returns the effective binding per action: a
  valid override wins, otherwise the default; an invalid/garbage override falls back to
  the default (via `safeNormalize` using the lib's validate/normalize).
- AC-003: `findConflict(hotkey, forAction, effective)` returns a conflicting action id
  only when another action **in the same scope** resolves to the same normalized combo;
  the same combo across different scopes returns `null` (no conflict).
- AC-004: `toCodeMirrorKey` converts a registry hotkey string to a CodeMirror key
  string (`Mod+Enter`→`Mod-Enter`, `Mod+S`→`Mod-s`, `Mod+Shift+L`→`Mod-Shift-l`,
  `Backspace`→`Backspace`); an invalid hotkey returns `null`.
- AC-005: `Settings` gains `shortcuts: ShortcutOverrides` (default `{}`); `mergeSettings`
  validates persisted shortcuts and drops invalid entries.
- AC-006: Shortcut overrides persist to a separate `keymap.json` store (mirroring the
  `theme.json` split); `settings.json` does not carry them.
- AC-007: `settings-context` exposes `saveShortcut(id, hotkey)` and `resetShortcut(id)`;
  saving merges the override, resetting removes that key from the override map.
- AC-008: A "Keyboard Shortcuts" section renders under the Theme section on the Settings
  page, one row per action grouped by scope, each row showing the action name and its
  effective binding formatted for display (⌘ on mac).
- AC-009: A shortcut row records a new combo via `useHotkeyRecorder`; on a same-scope
  conflict it shows the conflicting action's name and does NOT save; otherwise it saves
  the override. A Reset control appears only when an override exists and restores the
  default.
- AC-010: All global/tab/grid/tree shortcuts fire through the resolved bindings (not the
  old hardcoded `window` listeners), each in its scope; the editor `run-query` and
  `save-script` fire through CodeMirror using the resolved bindings.
- AC-011: The command palette derives each command's displayed hint from the resolved
  binding (no hardcoded `hint` strings); commands without a registry action show no hint.

## Test Cases

- TC-001 (AC-001): registry contains every listed action id with a non-empty
  `defaultHotkey` and a valid `scope`. Maps to: AC-001
- TC-002 (AC-002): override `{ "toggle-sidebar": "Mod+Shift+B" }` → effective
  `toggle-sidebar` is `Mod+Shift+B`, others are defaults. Maps to: AC-002
- TC-003 (AC-002): garbage override `{ "toggle-sidebar": "NotAKey++" }` → effective falls
  back to default `Mod+B`. Maps to: AC-002
- TC-004 (AC-003): rebinding `delete-rows` (grid) to `Backspace` while `delete-nodes`
  (tree) is `Backspace` → `findConflict` returns `null` (different scopes). Maps to: AC-003
- TC-005 (AC-003): rebinding `toggle-console` to `Mod+B` (already `toggle-sidebar`, same
  `global` scope) → `findConflict` returns `toggle-sidebar`. Maps to: AC-003
- TC-006 (AC-004): `toCodeMirrorKey("Mod+Enter")` === `"Mod-Enter"`;
  `toCodeMirrorKey("Mod+S")` === `"Mod-s"`; `toCodeMirrorKey("Mod+Shift+L")` ===
  `"Mod-Shift-l"`; `toCodeMirrorKey("Backspace")` === `"Backspace"`. Maps to: AC-004
- TC-007 (AC-004): `toCodeMirrorKey("###")` === `null`. Maps to: AC-004
- TC-008 (AC-005): `mergeSettings(DEFAULT_SETTINGS, { shortcuts: { "x": "y", "toggle-sidebar":
  "Mod+B" } })` keeps only valid known-action entries. Maps to: AC-005
- TC-009 (AC-007): `saveShortcut("toggle-sidebar", "Mod+Shift+B")` then
  `resetShortcut("toggle-sidebar")` → override map back to not containing the key. Maps to: AC-007
- TC-010 (AC-008): Settings page renders a "Keyboard Shortcuts" heading and a row whose
  text includes the action name and its formatted binding. Maps to: AC-008
- TC-011 (AC-009): a row with an override renders a Reset control; a row at default does
  not. Maps to: AC-009
- TC-012 (AC-011): palette command `toggle-sidebar` shows the hint derived from
  `resolveShortcuts` (default `Mod+B` → formatted), and reflects an override when set.
  Maps to: AC-011

## UI States

| State     | Behavior                                                                 |
| --------- | ------------------------------------------------------------------------ |
| Default   | Row shows action name + formatted default binding; no Reset control.     |
| Recording | Row shows "Press keys…"; Cancel control shown; Escape cancels.           |
| Conflict  | Row shows "<Action> already uses that shortcut"; override NOT saved.     |
| Override  | Row shows the custom binding + a Reset control restoring the default.    |

## Data model

```ts
type ShortcutScope = "global" | "tab" | "grid" | "tree" | "editor";

type ShortcutAction = {
  id: ShortcutActionId;
  name: string;
  description: string;
  defaultHotkey: string;       // e.g. "Mod+K"
  scope: ShortcutScope;
};

type ShortcutOverrides = Partial<Record<ShortcutActionId, string>>;
```

Persistence: `Settings.shortcuts: ShortcutOverrides` (default `{}`), stored in
`keymap.json` (key `shortcuts`), stripped out of `settings.json` — exactly mirroring how
`theme.colors` lives in `theme.json`.

## Edge cases

- Invalid/garbage persisted override → dropped at merge / falls back to default at resolve.
- Same combo in two different scopes → allowed (no conflict).
- Same combo twice in one scope → conflict, not saved.
- macOS delete key emits `Backspace`; PC forward-delete emits `Delete` → both delete;
  only `Backspace` is rebindable, `Delete` is a fixed alias.
- Typing in an input / CodeMirror must never trigger bare-key actions (`Tab`,
  `Backspace`) → the lib's per-hotkey `ignoreInputs` default (true for bare/Shift keys)
  plus existing `isEditableTarget` guards.
- `toggle-split-orientation` only valid in SQL split view → callback guard retained.
- Empty selection on delete → callback no-ops (guard retained).

## Dependencies

- New: `@tanstack/react-hotkeys@^0.10.0` (+ transitive `@tanstack/hotkeys`).
- Existing: `@tauri-apps/plugin-store` (LazyStore), CodeMirror, Vitest, jsdom.

## Out of scope

- Rebinding the single-line filter `Enter`, inline cell-edit `Enter`/`Escape`, dialog
  `Enter`, and tree-rename `Enter`/`Escape` (intrinsic input semantics, not app commands).
- Import/export of keymaps; per-profile keymaps; sequence (chord) shortcuts.

## Testing strategy

- Pure libs (`registry`, `resolve`, `to-codemirror-key`, `settings` merge) are the test
  spine — fully unit-tested in jsdom (TC-001..009).
- `ShortcutsSection`/`ShortcutRow` render tests for the UI states (TC-010, TC-011).
- Palette hint derivation test (TC-012).
- Real key-event firing and CodeMirror keymaps do not run meaningfully in jsdom (same
  constraint the dnd-kit drags have), so AC-010's wiring is covered by the pure
  resolver + `toCodeMirrorKey` unit tests plus manual smoke; behavioral assertions stay
  at the pure-logic layer.
