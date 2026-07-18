# Plan: Panel resize keymap

## Approach

Direct mirror of `purerequest`'s panel-resize seam onto purequery's panel stack.
purequery already persists panel layouts (`saveLayout`/`layouts`) via the library's
`onLayoutChanged`, but has NO imperative handle to *set* a layout from code. The
one structural addition is a panel-group registry on `WorkspaceProvider` (a
`Map<PanelGroupKey, GroupImperativeHandle>`, ref-based), exactly as purerequest
does it. Everything else is a copy of purerequest's pure `panel-resize.ts` +
handler wiring, adapted to purequery names (`PanelGroupKey`, `groupRef`).

Because the library's `setLayout` internally fires `onLayoutChanged`, the existing
`saveLayout` persist path runs for free on a programmatic resize - no extra persist
call needed. Confirmed against v4.11.2 source.

Coverage threshold: none (no enforced threshold in vitest config).

## File Structure

- `src/lib/workspace/panel-resize.ts` (CREATE) - pure: `PANEL_RESIZE_STEP`,
  `PanelResizeTarget`, `RESIZE_TARGETS`, `resolveFocusedPanel`, `stepLayout`.
- `src/lib/workspace/__tests__/panel-resize.test.ts` (CREATE) - pure unit tests
  for `resolveFocusedPanel` + `stepLayout` (clamp math, no-op, sibling absorb).
- `src/lib/shortcuts/registry.ts` (MODIFY) - add `panel-expand`/`panel-shrink`
  to `ShortcutActionId` union + `SHORTCUT_ACTIONS` (scope `global`).
- `src/lib/shortcuts/__tests__/registry.test.ts` (MODIFY) - add both ids to the
  `EXPECTED_BY_SCOPE.global` list + a default-binding assertion.
- `src/components/workspace/workspace-context.tsx` (MODIFY) - add the
  `registerPanelGroup`/`getPanelGroup` registry (ref + callbacks) to the context
  type + provider value.
- `src/components/workspace/workspace-layout.tsx` (MODIFY) - pass a `groupRef` to
  the workspace `ResizablePanelGroup` that registers under `"workspace"`; track a
  `pointerTarget` + `paletteResizeTarget`; add `panel-expand`/`panel-shrink` to
  the keydown dispatch calling `resizeFocusedPanel`.
- `src/components/workspace/main.tsx` (MODIFY) - pass a `groupRef` to the `main`
  `ResizablePanelGroup` registering under `"main"`.
- `src/components/ui/resizable.tsx` (MODIFY, if needed) - ensure `groupRef` is
  forwarded (it already spreads `...props`, so `groupRef` passes through - verify).
- `src/components/workspace/command-registry.ts` (MODIFY) - add `panel-expand`/
  `panel-shrink` palette commands (group `View`, actionId set).
- `src/components/workspace/command-palette.tsx` (MODIFY) - snapshot the focused
  resize target on open; wire the two palette handlers to resize it.
- `src/components/workspace/__tests__/panel-resize-actions.test.tsx` (CREATE) -
  behavioral: keydown + palette drive real flexGrow + persist (mirror
  purerequest's test, adapted to purequery fixtures + the offsetWidth/Height fake).

## Task 1: Pure panel-resize module

**Files:** Create `src/lib/workspace/panel-resize.ts` + `__tests__/panel-resize.test.ts`.

**Interfaces:**
- Consumes: `PanelGroupKey`, `PanelLayout` from `@/lib/settings/settings`.
- Produces: `PANEL_RESIZE_STEP: number`, `PanelResizeTarget` type,
  `resolveFocusedPanel(el: Element | null): PanelResizeTarget | null`,
  `stepLayout(layout: PanelLayout, target: PanelResizeTarget, deltaPct: number): PanelLayout`.

- [ ] Write failing tests: `stepLayout` grows/shrinks + clamps + sibling absorb +
  zero-delta no-op; `resolveFocusedPanel` returns the target for a `data-panel`
  ancestor with id `sidebar`/`console`, null for `content`/none.
- [ ] Confirm RED (module absent).
- [ ] Implement (copy purerequest, swap `content` sibling ids to purequery's).
- [ ] Confirm GREEN.
- [ ] Commit.

## Task 2: Shortcut registry entries

**Files:** Modify `registry.ts` + `__tests__/registry.test.ts`.

**Interfaces:**
- Produces: `ShortcutActionId` union gains `"panel-expand" | "panel-shrink"`;
  `SHORTCUT_ACTIONS` gains both (scope `global`, defaults `Mod+Alt+=` / `Mod+Alt+-`).

- [ ] Add both ids to `EXPECTED_BY_SCOPE.global` + a default-binding assertion (RED).
- [ ] Confirm RED (registry lacks them; the "define every id exactly once" test fails).
- [ ] Add the two action entries.
- [ ] Confirm GREEN.
- [ ] Commit.

## Task 3: Panel-group registry on WorkspaceProvider

**Files:** Modify `workspace-context.tsx`.

**Interfaces:**
- Consumes: `GroupImperativeHandle` from `react-resizable-panels`.
- Produces on the context value:
  `registerPanelGroup(key: PanelGroupKey, handle: GroupImperativeHandle | null): void`,
  `getPanelGroup(key: PanelGroupKey): GroupImperativeHandle | null`.

- [ ] Add to the context type + a `useRef<Map<...>>` + memoized callbacks + value.
- [ ] Type-check (no dedicated test; exercised by Task 5's behavioral test).
- [ ] Commit (folded with Task 4 if trivial).

## Task 4: Wire groupRef in the two panel groups

**Files:** Modify `workspace-layout.tsx`, `main.tsx`, verify `resizable.tsx`
forwards `groupRef`.

**Interfaces:**
- Consumes: `registerPanelGroup` from the context.
- Produces: the `workspace` + `main` groups register their handles on mount.

- [ ] `main.tsx`: `const ref = useCallback(h => registerPanelGroup("main", h), [...])`,
  pass `groupRef={ref}`.
- [ ] `workspace-layout.tsx`: same for `"workspace"`.
- [ ] Verify `ResizablePanelGroup` passes `groupRef` through (spread).

## Task 5: Keydown dispatch + pointer/palette targets + palette commands

**Files:** Modify `workspace-layout.tsx`, `command-registry.ts`,
`command-palette.tsx`. Create `__tests__/panel-resize-actions.test.tsx`.

**Interfaces:**
- Consumes: `getPanelGroup`, `resolveFocusedPanel`, `stepLayout`, `PANEL_RESIZE_STEP`.
- Produces: `panel-expand`/`panel-shrink` keydown handlers + palette handlers.

- [ ] Behavioral tests (RED): keydown grows/shrinks/clamps sidebar+console, content
  no-op, pointer target, palette expand. Uses the offsetWidth/Height fake so the
  imperative group API is functional in jsdom (mirror purerequest's setup).
- [ ] Confirm RED.
- [ ] `workspace-layout.tsx`: add `pointerTarget` state + pointerdown effect,
  `resizeFocusedPanel(delta)`, and the two dispatch entries. Add both ids to the
  keydown dispatch map + effect deps.
- [ ] `command-registry.ts`: add the two `View`-group commands.
- [ ] `command-palette.tsx`: snapshot `paletteResizeTarget` on open (or read the
  active element at run time via the same resolve), wire the two handlers.
- [ ] Confirm GREEN + full suite.
- [ ] Commit.

## Edge cases (from spec)

- Content/editor focus -> null target -> no-op (TC-007).
- Hidden sidebar -> handle/panel absent -> no-op.
- Clamp zero-delta -> unchanged layout (TC-005/006 land exactly on the bound).
- Palette focus trap -> focus snapshot (TC-009).
- Reserved `=`/`-` guard already preventDefaults; app handler still fires.

## Tests to write

- Pure: `panel-resize.test.ts` (stepLayout clamp/absorb/no-op; resolveFocusedPanel).
- Registry: two new entries + defaults.
- Behavioral: `panel-resize-actions.test.tsx` (TC-002..009).

## Risks

- jsdom reports 0 offset sizes so the imperative group API no-ops: mitigated by
  the offsetWidth/offsetHeight fake in the behavioral test (proven in purerequest).
- `groupRef` not forwarded by the ui wrapper: mitigated by verifying the spread
  (Task 4) - it already spreads `...props`.
- Palette focus snapshot vs live focus: mirror purerequest's `paletteResizeTarget`
  captured in the palette's open handler.

## Decision Log

| Date       | Decision | Rationale |
| ---------- | -------- | --------- |
| 2026-07-18 | Design gate: pz-ddd / pz-archetypes / pz-codebase-design all evaluated; none invoked. | UI keymap port, no domain model/aggregate. The one seam (panel-group registry) is a verbatim mirror of purerequest's proven interface - no fresh module design. |
| 2026-07-18 | Hotkeys `Mod+Alt+=` / `Mod+Alt+-` (mirror purerequest). | User choice. `=`/`-` already in the reserved-key set so the webview-zoom guard is a no-conflict win. |
| 2026-07-18 | Expose as palette commands too (View group). | User choice; needs a focus snapshot on palette open (extra wiring vs purerequest, which is keymap-only). |
| 2026-07-18 | Reuse existing `saveLayout` persist path (no explicit persist call on resize). | Library `setLayout` fires `onLayoutChanged -> saveLayout`; verified in v4.11.2 source. |

## AC Traceability

| AC | Test(s) |
| -- | ------- |
| AC-001 | `registry.test.ts` "define every documented action id exactly once" + "carry the documented default binding for the panel resize actions" |
| AC-002 | `panel-resize.test.ts` grow/shrink + sibling absorb; `panel-resize-actions.test.tsx` sidebar expand->25 / shrink->15 |
| AC-003 | `panel-resize.test.ts` console 70% clamp; `panel-resize-actions.test.tsx` console expand->30 |
| AC-004 | `panel-resize.test.ts` clamp max/min + zero-delta no-op; `panel-resize-actions.test.tsx` clamp 38->40 / 14->12 |
| AC-005 | `panel-resize.test.ts` resolveFocusedPanel null cases; `panel-resize-actions.test.tsx` content no-op (no size + no persist) |
| AC-006 | `panel-resize-actions.test.tsx` store.load() persisted-value assertions on every sidebar/console case |
| AC-007 | `panel-resize-actions.test.tsx` palette lists Expand/Shrink + palette-run resizes pre-open focus target |

## Verifier verdict (2026-07-18)

All 7 ACs PASS, all gates PASS (tsc 0, eslint 0 errors, targeted 33/33, full 1589/1589),
no bugs, no weak/tautological tests. Two pre-existing unrelated jsdom `getClientRects`
errors in table/database-card tests (not this diff).

Documented caveat (not a defect in this diff): purequery's `matchesHotkey` matches
non-alpha keys on `event.key`. On macOS holding Option (Alt) composes `=`->`≠`, `-`->`–`,
so `Mod+Alt+=`/`Mod+Alt+-` may not fire in the real WKWebView. Same exposure as the
existing `close-other-tabs` = `Mod+Alt+W` binding - a systemic matcher limitation, not
introduced here. Needs a real-app check; alternatives: rebind to non-Option combos, or
make `matchesHotkey` `event.code`-aware (touches all shortcuts, out of scope).
