# Design

UI design rules for this app. Entries are about *visual language and interaction*, not domain logic. Read this before any UI change.

## Corners

- **No rounded corners. Anywhere.** Sharp edges only. The radius token is pinned to zero (`--radius: 0rem` and every `--radius-{sm,md,lg,xl}: 0rem`) - never raise it.
- Do not use `rounded-*` utilities (`rounded`, `rounded-sm/md/lg/full/xs`, ...). If a UI primitive (e.g. shadcn) ships with a `rounded-*` class, strip it.
- Treat any rounded corner as a defect.

## Borders & dividers

- **Dividers are 1px. Never thicken, brighten, or colour on hover or drag.** A resize handle (sidebar split, console split, editor/results split) is a `w-px`/`h-px` line in `bg-border`.
- Give a thin divider a larger **invisible** hit area instead of a visible thick bar: an `::after` overlay (`after:absolute after:inset-y-0 after:left-1/2 after:w-2 after:-translate-x-1/2` for a vertical handle) catches the pointer while the visible line stays 1px.
- Cursor signals affordance (`cursor-col-resize` / `cursor-row-resize`), not thickness.
- Borders use the `border`/`border-border` token, 1px. Don't introduce heavier borders for emphasis - use background/spacing instead.

## Drag-and-drop drop cues

- The sidebar tree drag-and-drop (reparent/reorder) draws **transient** drop cues that are NOT structural dividers but still obey the 1px rule:
  - **before/after** a row: a 1px primary line (`h-px bg-primary`, the `DropLine` in [src/components/workspace/tree-row.tsx](../src/components/workspace/tree-row.tsx)). Never the 2px `h-0.5` line requi uses - we pin it to `h-px`.
  - **inside** a folder (or the empty-folder "Drop here" zone): a 1px inset ring (`ring-1 ring-inset ring-primary`), never a fill or a thicker border.
  - the dragged row dims via dnd-kit's `isDragging` (`opacity-50`); the drag overlay is a square `bg-accent` chip (no `rounded-*`).
- These are the only place a primary-colored 1px line/ring appears on hover/drag; they vanish on drop/cancel. Don't promote them to a permanent border or thicken them.

## Scrollbars

- **One scrollbar everywhere: thin, square, semi-transparent, overlay, auto-hiding.** The Tauri app ships from one WebView on all platforms, so we draw the bar ourselves - never defer to the OS default (thick gray gutter on Windows/Linux).
- The standard is the shared Radix `ScrollArea` ([src/components/ui/scroll-area.tsx](../src/components/ui/scroll-area.tsx)): `type="hover"` auto-hide, a thin `w-1.5`/`h-1.5` track, and a `bg-foreground/20` (hover `/30`) thumb. Wrap any scrollable region in it rather than using a bare `overflow-auto` div.
- Surfaces that own their own internal scroller and can't host a `ScrollArea` - CodeMirror (`.cm-scroller`), the Radix Select and cmdk Command popovers - are covered by the global `::-webkit-scrollbar` + `scrollbar-width`/`scrollbar-color` rule in [src/index.css](../src/index.css), tuned to the same visual. It's always-visible (webkit can't auto-hide) but thin enough to read identically.
- **The thumb stays square** - no `rounded-*`, no `bg-border`. macOS uses a rounded pill; we deliver "macOS-style" via thin + semi-transparent + overlay + auto-hide, NOT rounding. The thumb is not an exception to the no-rounded-corners rule.
- Thumb color tracks `--foreground` (semi-transparent via `color-mix`), so it adapts across all themes automatically. Don't hard-code a scrollbar color.

## Tables / grids

- One grid component, reused everywhere a result set is shown. All grids look identical: same row height, padding, header treatment, single-line cells (`overflow-hidden text-ellipsis whitespace-nowrap`), resizable columns.
- Headers always render, even for an empty result, so the column structure stays visible; show an empty-state message ("No rows.") beneath the header row, not instead of it.
- NULL renders as a dim `[NULL]`, visually distinct from an empty string.
- Edited/dirty cells get a subtle highlight (`bg-amber-500/15`), applied identically in every view (list and single-record).
- Rows are `select-none`: click/Shift-click/Cmd-click select ROWS, and must never trigger the browser's native text selection (which would highlight cell text blue and fight range-select). An inline-edit `<input>` re-enables its own text selection, so editing is unaffected.
- Copy CSV/JSON is not a footer button - it lives in the row context menu and copies the current selection (right-clicking a row outside the selection copies just that row). Both the editable table card and the read-only SQL result grid are row-selectable for this.
- The "one grid" rule is for RESULT SETS (rows of data). Metadata panels - the Views tab and the Structure view (columns/indexes/FK/constraints) - are read-only descriptive tables, NOT the result grid, so they render as their own plain `<table>` (same compact density, muted headers, `font-mono` cells, 1px `border-b` dividers) rather than reusing `DataGrid`. Match the look, don't fork the grid.

## Density & typography

- Compact, keyboard-first, IDE-like. Rows and controls are single-line and tight (`py-1`/`py-1.5`, `text-xs`/`text-sm`).
- Monospace (`font-mono`) for data, SQL, identifiers, and anything tabular. UI chrome (labels, buttons, tabs) uses the default sans stack.
- Muted foreground (`text-muted-foreground`) for secondary text (column headers, hints, timestamps); full foreground for primary content.

## Color & status

- Theme via CSS tokens (`bg-background`, `bg-muted/30`, `text-foreground`, `border-border`), not hard-coded colors, so light/dark both work.
- Status colors: success green (`text-green-600 dark:text-green-400`), error/destructive red (`text-red-600 dark:text-red-400`). A destructive action button (e.g. Disconnect) is filled red.
- **A primary action button is the filled `default` Button variant** (`bg-primary text-primary-foreground`, same look as requi's `Send`/`Save`) - the one solid, high-contrast control that runs the panel's main action (run filter, send, save). Use it for the single primary action per surface; everything else stays `ghost`/`outline`. Don't restyle a primary action as a faint icon button.
- Status dots are a small `size-2` filled circle, right-aligned, never with a text label leaking into an accessible name (give the row an explicit `aria-label`).
- **A database row/tab shows its engine's brand glyph, monochrome.** The sidebar database row and the open-tab strip render a per-engine icon (Postgres/MySQL/SQLite/MongoDB) via `EngineIcon` ([src/components/workspace/engine-icon.tsx](../src/components/workspace/engine-icon.tsx), simple-icons from `react-icons/si`). It is NOT brand-colored - simple-icons render `fill="currentColor"`, so the glyph tracks `text-muted-foreground` like the generic icon it replaced (no hue exception; the "theme tokens not hard-coded colors" rule stands). Table leaves keep the lucide `Table` icon. Both surfaces share `EngineIcon` so the same database reads identically in tree and tabs.
- **Syntax highlighting is the one exception to "no hard-coded colors".** The SQL editor (CodeMirror) colors tokens (keyword/string/number/property/comment/invalid) from the **9 theme editor tokens** for the active mode, via the factories `makeSqlChrome`/`makeSqlHighlight` in [src/components/workspace/sql-editor-theme.ts](../src/components/workspace/sql-editor-theme.ts) (no longer a fixed Darcula constant - it recolors with the theme). Token coloring genuinely needs hue; the editor *chrome* (background, gutter, active line) stays transparent so it inherits the themed pane behind it. Don't extend this exception to UI chrome.
- **Theme = mode + per-mode color overrides.** Light/dark/system mode toggles a `.dark` class on `<html>`; the 18 app tokens + 9 editor tokens have built-in defaults in [src/lib/theme/theme-defaults.ts](../src/lib/theme/theme-defaults.ts) whose **app-token values must stay in sync with `:root`/`.dark` in [src/index.css](../src/index.css)** (that table is the TS source of truth for seeding the color editor + "reset" targets). User overrides are sparse (only diffs from default) and apply as inline `--<token>` CSS vars for the active mode (app tokens only; editor tokens flow through the CodeMirror extensions, not the DOM). The color editor (the `/settings` Theme section) is the one place that edits these; everywhere else, keep using the `--token` utilities, never hard-coded colors.
- **Per-database accent color is the second exception, scoped to that feature.** A database may carry a user-chosen `accentColor` (hex) as a safety/orientation cue ("this is prod"). It does NOT add a frame and does NOT change border width - it only **recolors the existing 1px borders** by overriding the `--border` theme token on the workspace shell root ([src/components/workspace/workspace-layout.tsx](../src/components/workspace/workspace-layout.tsx)). Because every divider/input/grid border resolves from `var(--border)` (see `@layer base * { border-color }` in [src/index.css](../src/index.css)), the override recolors the whole shell at once (sidebar, tabs, inputs, splits, grid). The accent applies whenever the **active tab** belongs to a colored database (or one of its tables - a table inherits its parent's accent, resolved via the single `accentColorFor(id)` helper in [src/components/workspace/workspace-context.tsx](../src/components/workspace/workspace-context.tsx)); no accent (`null`) leaves the default token untouched. Two deliberate details: (1) the hex is used verbatim and accepts an optional alpha pair (`#rrggbb` or `#rrggbbaa`), so the **user** dials how loud the borders are - `#dc262640` is a faint red, `#dc2626` a solid one; we never force a blend. The native `<input type=color>` has no alpha channel, so it edits only the RGB part and preserves any alpha the user typed in the hex field. (2) **only** `--border` is overridden, never `--input` - inputs/selects use `--input` for their *background* too (`dark:bg-input/30`), so overriding it would tint backgrounds (a bug we hit). Input/select **borders** therefore use `border-border`, not `border-input`. The one new element is a 2px left bar on the sidebar database row (`border-l-2`, accent at 70%) so an inactive colored database is still recognisable in the tree. This overrides the "theme tokens not hard-coded colors" rule, scoped to this feature - don't hard-code accent colors elsewhere, and don't turn the recolor into thicker borders (the 1px-divider rule stands; the sidebar bar is the sole, deliberate 2px accent).

## Layout

- Resizable splits at the shell level (sidebar|content, content|console). Inside a tab panel, a split must be hand-rolled (the `react-resizable-panels` group breaks tab-switching) but still obey the 1px-divider rule.
- Tabs are flat, square, separated by 1px borders; the active tab reads via `bg-background` + full foreground, inactive via muted foreground.
- **Every tab strip owns its OWN horizontal scroller - a bar's tabs scroll INSIDE the bar, never stretch it.** The shared `TabBar` ([src/components/workspace/tab-bar.tsx](../src/components/workspace/tab-bar.tsx)) tablist carries `min-w-0 overflow-x-auto overflow-y-hidden` and each `Tab` is `shrink-0`; without this an overflowing bar (many open tabs) widens the whole content pane and the entire content scrolls horizontally instead (bug ported-fix from `requi`'s `bar-overflow`). The 1px active-underline therefore CANNOT use a bottom-border overhang (a vertical scroller clips it): the baseline is a 1px inset `--border` shadow on the bar + every inactive tab, and the active tab swaps its own inset shadow to `--primary` - one continuous divider, active underline drawn on top, nothing overhangs the box. Tabs also set `after:hidden` so no `::after` pseudo re-triggers a vertical scrollbar.
- **Toggles are square switches, theme-token colored, no rounded corners.** The per-database Read-only switch ([settings-tab.tsx](../src/components/workspace/settings-tab.tsx) `ReadOnlyField`) is `role="switch"` + `aria-checked`, a `bg-primary` (on) / `bg-input/40` (off) track with a `bg-background` knob that shifts via `translate-x` - obeys the no-rounded-corners rule (no `rounded-full` pill). There is no shared `Switch` component; if a second toggle appears, extract this pattern rather than importing a rounded shadcn switch.
- **Every `Select` must set `position="popper"` on its `SelectContent`.** The radix default (`item-aligned`) positions the popup by aligning the selected item over the trigger via measurement; inside a scrollable/flex panel (e.g. the Settings tab) it mispositions and the dropdown renders with no visible options. `popper` anchors the list under the trigger like a normal dropdown. requi sets `popper` on all its Selects; mirror that. (jsdom can't open a radix Select, so this is not unit-testable - it's a standing rule.)

## Accessibility

- Interactive affordances that are purely visual (resize handles, status dots) are `aria-hidden` or carry an explicit non-leaking label so they don't pollute the accessible name of their container (treeitem, columnheader).
- Inputs opt out of browser autofill noise: `autoComplete="off"`, `autoCorrect="off"`, `autoCapitalize="off"`, `spellCheck={false}`, plus `data-1p-ignore` / `data-lpignore` for password managers.
