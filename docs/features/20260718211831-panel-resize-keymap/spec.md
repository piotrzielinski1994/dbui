# Panel resize keymap (expand/shrink sidebar + console)

## Overview

Add keyboard + palette actions to grow/shrink the focused UI panel (sidebar or
bottom console) by a fixed step, mirroring `purerequest`'s `panel-expand` /
`panel-shrink`. Today purequery only has show/hide toggles (`toggle-sidebar`
Mod+B, `toggle-console` Mod+J) - no size adjustment via keyboard.

The resize target is resolved from the focused/last-clicked panel: focus (or a
last click) inside the sidebar tree targets the sidebar; inside the console
targets the console; inside the content area targets nothing (no-op). Each press
steps the panel size by ±5 percentage points, clamped to that panel's declared
min/max, and the new layout persists (same `settings.json` `layouts` seam the
drag handle already writes).

Ported seam: `purerequest`'s pure `panel-resize.ts` (`PANEL_RESIZE_STEP`,
`resolveFocusedPanel`, `stepLayout`) + the panel-group imperative registry
(`registerPanelGroup`/`getPanelGroup`) that purequery does not yet have.

## Acceptance Criteria

- AC-001: The shortcut registry defines `panel-expand` (default `Mod+Alt+=`,
  scope `global`) and `panel-shrink` (default `Mod+Alt+-`, scope `global`), each
  with a non-empty name + description.
- AC-002: With focus (or the last pointer click) inside the sidebar, `panel-expand`
  grows the sidebar panel by 5% and `panel-shrink` shrinks it by 5%, clamped to
  its min (12%) / max (40%); the sibling `content` panel absorbs the delta.
- AC-003: With focus (or the last pointer click) inside the console, `panel-expand`
  grows the console panel by 5% and `panel-shrink` shrinks it by 5%, clamped to
  its min (10%) / max (70%, i.e. the content sibling's 30% floor); the sibling
  `content` panel absorbs the delta.
- AC-004: A resize step is clamped: from 38% a +5% sidebar expand lands on 40%
  (not 43); from 14% a -5% shrink lands on 12% (not 9). A step whose clamp yields
  zero applied delta leaves the layout unchanged.
- AC-005: With focus / last click in the content area (no resizable panel target),
  `panel-expand`/`panel-shrink` are no-ops - no layout change, no persist write.
- AC-006: A resize persists the new layout to `settings.json` `layouts.workspace`
  (sidebar) / `layouts.main` (console), so it survives relaunch.
- AC-007: The command palette exposes `Expand panel` and `Shrink panel` in the
  `View` group; each shows its resolved hotkey hint and, when run, resizes the
  panel that was focused when the palette opened (focus snapshot, since the modal
  traps focus).

## Test Cases

- TC-001 (registry): `SHORTCUT_ACTIONS` contains `panel-expand`+`panel-shrink`
  with the documented defaults + scope. Maps to: AC-001.
- TC-002 (sidebar expand, happy): seed layout `{sidebar:20, content:80}`, focus a
  tree row, fire `panel-expand` -> sidebar 25, persisted 25. Maps to: AC-002, AC-006.
- TC-003 (sidebar shrink): same seed, fire `panel-shrink` -> sidebar 15. Maps to: AC-002.
- TC-004 (console expand): seed `{content:75, console:25}`, focus the console
  region, fire `panel-expand` -> console 30, persisted 30. Maps to: AC-003, AC-006.
- TC-005 (sidebar clamp max): seed `{sidebar:38}`, expand -> 40 (clamped). Maps to: AC-004.
- TC-006 (sidebar clamp min): seed `{sidebar:14}`, shrink -> 12 (clamped). Maps to: AC-004.
- TC-007 (content no-op): last click in content region, expand -> no size change,
  no persist. Maps to: AC-005.
- TC-008 (pointer target): click a blank (non-focusable) area of the sidebar (no
  DOM focus inside), expand -> sidebar grows. Maps to: AC-002.
- TC-009 (palette expand): open palette with focus in the sidebar, run `Expand
  panel` -> sidebar grows. Maps to: AC-007.

## UI States

| State   | Behavior                                                              |
| ------- | -------------------------------------------------------------------- |
| Loading | N/A - synchronous layout math, no async.                             |
| Empty   | No resizable panel focused (content) -> action is a silent no-op.    |
| Error   | Panel group handle unregistered (not mounted) -> silent no-op.       |
| Success | Panel flexGrow shifts by the clamped step; layout persisted.         |

## Data Model

No new persisted fields. Reuses `Settings.layouts` (`Partial<Record<PanelGroupKey,
PanelLayout>>`, `PanelLayout = Record<string, number>`), the same store the drag
handle's `onLayoutChanged -> saveLayout` already writes.

New in-memory-only seam on `WorkspaceProvider`: a `Map<PanelGroupKey,
GroupImperativeHandle>` registry (`registerPanelGroup`/`getPanelGroup`), ref-based,
never persisted, never reactive.

New pure module `src/lib/workspace/panel-resize.ts`:

- `PANEL_RESIZE_STEP = 5`
- `PanelResizeTarget = { group: PanelGroupKey; panelId; siblingId; min; max }`
- `resolveFocusedPanel(el: Element | null): PanelResizeTarget | null`
- `stepLayout(layout, target, deltaPct): PanelLayout` (clamped)

`RESIZE_TARGETS`: `sidebar` (group `workspace`, sibling `content`, 12/40),
`console` (group `main`, sibling `content`, 10/70).

## Edge Cases

- Focus in content / an editor / a table cell -> `resolveFocusedPanel` returns
  null -> no-op (AC-005).
- Sidebar hidden (`toggle-sidebar` off) -> its panel is unmounted, handle absent
  or `getLayout` has no `sidebar` key -> no-op.
- Clamp at boundary yields zero delta -> `stepLayout` returns layout unchanged,
  no spurious persist churn beyond what the library already emits.
- Palette open (focus trapped in modal) -> resize reads the focus snapshot taken
  on palette open, not live `document.activeElement`.
- Reserved-key guard: `=`/`-` are in `RESERVED_KEYS`, so `installBrowserDefaultGuards`
  already `preventDefault`s the webview zoom on Mod+Alt+=/- ; the app handler still
  fires (guard only preventDefaults, does not stopPropagation).

## Dependencies

- `react-resizable-panels@4.11.2` `GroupImperativeHandle` (`getLayout`/`setLayout`,
  percentages 0..100) + `groupRef` prop (already the lib in use).
- Existing `saveLayout` / `layouts` chrome persistence seam.
- Existing reserved-key window guard (no change needed).
- No backend change. No new npm dep.
