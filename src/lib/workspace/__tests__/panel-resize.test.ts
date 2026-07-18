import { describe, it, expect } from "vitest";

import {
  PANEL_RESIZE_STEP,
  resolveFocusedPanel,
  stepLayout,
  type PanelResizeTarget,
} from "@/lib/workspace/panel-resize";

// Build a focusable element nested inside a `data-panel id="<id>"` wrapper (the
// shape react-resizable-panels renders), so resolveFocusedPanel walks `closest`
// exactly as it does off document.activeElement in the real layout.
function elementInPanel(id: string): Element {
  const panel = document.createElement("div");
  panel.setAttribute("data-panel", "");
  panel.id = id;
  const inner = document.createElement("button");
  panel.appendChild(inner);
  return inner;
}

// The real sidebar/console targets (min/max come from the module, not the test),
// so stepLayout's clamp math is exercised against the actual declared bounds.
const sidebarTarget = resolveFocusedPanel(elementInPanel("sidebar"))!;
const consoleTarget = resolveFocusedPanel(elementInPanel("console"))!;

describe("PANEL_RESIZE_STEP", () => {
  // AC-002/AC-003 - behavior: the fixed step is 5 percentage points.
  it("should be a 5 percentage-point step", () => {
    expect(PANEL_RESIZE_STEP).toBe(5);
  });
});

describe("resolveFocusedPanel", () => {
  // AC-002, TC-001 - behavior: an element inside the sidebar panel resolves to
  // the sidebar target (group workspace, sibling content, 12/40).
  it("should return the sidebar target for an element inside the sidebar panel", () => {
    const target = resolveFocusedPanel(elementInPanel("sidebar"));

    expect(target).toEqual<PanelResizeTarget>({
      group: "workspace",
      panelId: "sidebar",
      siblingId: "content",
      min: 12,
      max: 40,
    });
  });

  // AC-003 - behavior: an element inside the console panel resolves to the
  // console target (group main, sibling content, 10/70).
  it("should return the console target for an element inside the console panel", () => {
    const target = resolveFocusedPanel(elementInPanel("console"));

    expect(target).toEqual<PanelResizeTarget>({
      group: "main",
      panelId: "console",
      siblingId: "content",
      min: 10,
      max: 70,
    });
  });

  // AC-005 - behavior: the content panel is a sibling, never a target itself.
  it("should return null for an element inside the content panel", () => {
    expect(resolveFocusedPanel(elementInPanel("content"))).toBeNull();
  });

  // AC-005 - behavior: an element with no data-panel ancestor is not a target.
  it("should return null for an element outside any panel", () => {
    expect(resolveFocusedPanel(document.createElement("div"))).toBeNull();
  });

  // AC-005 - behavior: a null active element (nothing focused) is not a target.
  it("should return null for a null element", () => {
    expect(resolveFocusedPanel(null)).toBeNull();
  });
});

describe("stepLayout", () => {
  // AC-002, TC-002 - behavior: a positive step grows the panel; the sibling
  // absorbs the same delta so the layout still sums to 100.
  it("should grow the panel and shrink the sibling by the delta", () => {
    const next = stepLayout({ sidebar: 20, content: 80 }, sidebarTarget, 5);

    expect(next).toEqual({ sidebar: 25, content: 75 });
  });

  // AC-002, TC-003 - behavior: a negative step shrinks the panel; the sibling grows.
  it("should shrink the panel and grow the sibling by the delta", () => {
    const next = stepLayout({ sidebar: 20, content: 80 }, sidebarTarget, -5);

    expect(next).toEqual({ sidebar: 15, content: 85 });
  });

  // AC-004, TC-005 - behavior: from 38%, a +5% step is clamped to the 40% max,
  // so only 2% is applied and the sibling absorbs exactly that 2%.
  it("should clamp a grow at the panel's max and apply only the clamped delta", () => {
    const next = stepLayout({ sidebar: 38, content: 62 }, sidebarTarget, 5);

    expect(next).toEqual({ sidebar: 40, content: 60 });
  });

  // AC-004, TC-006 - behavior: from 14%, a -5% step is clamped to the 12% min,
  // so only -2% is applied and the sibling grows by 2%.
  it("should clamp a shrink at the panel's min and apply only the clamped delta", () => {
    const next = stepLayout({ sidebar: 14, content: 86 }, sidebarTarget, -5);

    expect(next).toEqual({ sidebar: 12, content: 88 });
  });

  // AC-003 - behavior: the console's real ceiling is 70% (content's 30% floor),
  // so a +5% from 68% clamps to 70% and content lands on 30%.
  it("should clamp the console grow at its 70% max", () => {
    const next = stepLayout({ content: 32, console: 68 }, consoleTarget, 5);

    expect(next).toEqual({ content: 30, console: 70 });
  });

  // AC-004 - behavior: a step that clamps to zero applied delta leaves the
  // layout unchanged (no spurious sibling shift).
  it("should return an unchanged layout when a grow is already at the max", () => {
    const layout = { sidebar: 40, content: 60 };

    expect(stepLayout(layout, sidebarTarget, 5)).toEqual(layout);
  });

  // AC-004 - behavior: same zero-delta no-op at the min bound.
  it("should return an unchanged layout when a shrink is already at the min", () => {
    const layout = { sidebar: 12, content: 88 };

    expect(stepLayout(layout, sidebarTarget, -5)).toEqual(layout);
  });

  // Correctness - behavior: stepLayout must not mutate its input layout.
  it("should not mutate the input layout", () => {
    const layout = { sidebar: 20, content: 80 };
    stepLayout(layout, sidebarTarget, 5);

    expect(layout).toEqual({ sidebar: 20, content: 80 });
  });
});
