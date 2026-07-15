# Spec: In-app Cmd+F find

## Overview

Replace the native WKWebView find-in-page (opened by Cmd/Ctrl+F today, because dbui never ported vidui's reserved-key browser guard) with a focus-partitioned in-app find:

- **Editor focused** (SQL editor / JS editor / JSON view) -> CodeMirror `@codemirror/search` with a dbui-styled find bar.
- **Grid focused** (table card / SQL result) -> a non-destructive find bar over the shared `DataGrid`: highlight + next/prev, rows stay put.
- Native find-in-page (and the other reserved browser combos) suppressed app-wide.

## Acceptance Criteria

See `.pzielinski/cmd-f-find.md` (canonical) - AC-001 .. AC-012.

## User Test Cases

See `.pzielinski/cmd-f-find.md` - TC-001 .. TC-010.

## Data Model

No persisted model. Ephemeral in-component state:

- `GridMatch = { rowIndex: number; columnId: string }` (pure `grid-find.ts`).
- Grid find state: `{ query, activeIndex }` inside `DataGrid`.
- Editor find: owned by CodeMirror `@codemirror/search` state.

New shortcut action `open-find` (default `Mod+F`, scope `grid`), a rebindable `ShortcutAction` like every other.

## Edge Cases

- Empty query / no matches -> `0/0`, next/prev disabled.
- NULL cells never match; the literal `[NULL]` placeholder is display-only and not matched.
- Wrap-around at first/last match.
- Grid not focused -> Cmd+F does not open the grid bar (the focused surface owns it).
- The find input itself is an editable target - typing there must not trip grid keyboard shortcuts.

## Dependencies

`@codemirror/search` promoted to a direct dependency (present transitively at v6.7.1 via `@uiw/codemirror-extensions-basic-setup`).
