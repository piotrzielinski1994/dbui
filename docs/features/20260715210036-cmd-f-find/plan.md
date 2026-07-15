# Plan: In-app Cmd+F find

Full task breakdown, file map, and decision log live in `.pzielinski/cmd-f-find.md` (`## Solution Plan`). This file is the how-summary.

## Execution order

1. **T1** - `src/lib/browser-defaults.ts`: port vidui reserved-key slice (`isReservedBrowserShortcut` + keydown guard). Kills native find/zoom/reload/etc.
2. **T2** - `src/lib/shortcuts/registry.ts`: `open-find` action (`Mod+F`, grid). `command-registry.ts` + `command-palette.tsx`: "Find" command (View group).
3. **T3** - `src/components/workspace/find-bar.tsx`: shared presentational FindBar (design.md compliant).
4. **T4** - `src/lib/workspace/grid-find.ts` (pure `findMatches`) + `data-grid.tsx` wiring (open on Mod+F when grid focused, count, highlight+scroll active cell, Enter/Shift+Enter cycle, Escape close).
5. **T5** - `@codemirror/search` direct dep + `search({createPanel})` mounting FindBar in `sql-editor.tsx`, reused by `js-editor.tsx` / `json-view.tsx`.

## File changes

| File | Change |
| ---- | ------ |
| `src/lib/browser-defaults.ts` | + reserved-key guard |
| `src/lib/shortcuts/registry.ts` | + `open-find` action |
| `src/lib/workspace/grid-find.ts` | new pure module |
| `src/components/workspace/find-bar.tsx` | new component |
| `src/components/workspace/data-grid.tsx` | + grid find |
| `src/components/workspace/sql-editor.tsx` | + CM search |
| `src/components/workspace/js-editor.tsx` | + CM search |
| `src/components/workspace/json-view.tsx` | + CM search |
| `src/components/workspace/command-registry.ts` | + Find command |
| `src/components/workspace/command-palette.tsx` | wire Find command |
| `package.json` | + `@codemirror/search` |

## Acceptance verification

TDD per task: RED (test-writer subagent) -> GREEN -> REFACTOR. Fresh verifier subagent runs lint + tsc + full `npm test` + maps each AC to a test. AC->test table appended to the task file on pass.
