import type { PanelGroupKey, PanelLayout } from "@/lib/settings/settings";

export const PANEL_RESIZE_STEP = 5;

export type PanelResizeTarget = {
  group: PanelGroupKey;
  panelId: string;
  siblingId: string;
  min: number;
  max: number;
};

// Which focusable panels can be resized, keyed by their DOM `id` (the panel's
// react-resizable-panels id, rendered as `data-panel id="..."`). `content` is
// intentionally absent - it is a resize target's sibling, never a target itself.
const RESIZE_TARGETS: Record<string, PanelResizeTarget> = {
  sidebar: {
    group: "workspace",
    panelId: "sidebar",
    siblingId: "content",
    min: 12,
    max: 40,
  },
  console: {
    group: "main",
    panelId: "console",
    siblingId: "content",
    min: 10,
    // The `content` sibling declares minSize 30%, so the console's real ceiling
    // is 70%; keep the helper's clamp in step with the library's.
    max: 70,
  },
};

export function resolveFocusedPanel(
  activeEl: Element | null,
): PanelResizeTarget | null {
  const panel = activeEl?.closest("[data-panel]");
  if (!panel) {
    return null;
  }
  return RESIZE_TARGETS[panel.id] ?? null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function stepLayout(
  layout: PanelLayout,
  target: PanelResizeTarget,
  deltaPct: number,
): PanelLayout {
  const current = layout[target.panelId];
  const next = clamp(current + deltaPct, target.min, target.max);
  const applied = next - current;
  if (applied === 0) {
    return { ...layout };
  }
  return {
    ...layout,
    [target.panelId]: next,
    [target.siblingId]: layout[target.siblingId] - applied,
  };
}
