import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Tab, TabBar } from "@/components/workspace/tab-bar";

describe("Tab click target", () => {
  // The bug: only the inner text was clickable; the tab's padding/area around the glyph did nothing.
  // The label button now fills the tab's full height + carries the padding, so a click anywhere on
  // the tab (the full-height button) selects it.
  it("should fire onSelect when the tab is clicked on its padding, not just the label text", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <TabBar ariaLabel="demo tabs">
        <Tab isActive={false} onSelect={onSelect} ariaLabel="alpha">
          alpha
        </Tab>
      </TabBar>,
    );

    const tab = screen.getByRole("tab", { name: "alpha" });
    // the click target is the full-height button (has px padding), so clicking it (the area, not a
    // zero-size text node) selects the tab
    const styles = tab.className;
    expect(styles).toContain("h-full");
    expect(styles).toContain("px-3");

    await user.click(tab);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  // CSS-contract: the tablist must own a horizontal scroller so overflowing tabs scroll inside the
  // bar instead of stretching it and dragging the whole content pane into a horizontal scroll.
  // jsdom can't measure layout, so we assert the classes that deliver the scroll.
  it("should let the tab strip scroll horizontally if its tabs overflow, not the whole content", () => {
    render(
      <TabBar ariaLabel="demo tabs">
        <Tab isActive={false} onSelect={() => {}} ariaLabel="alpha">
          alpha
        </Tab>
      </TabBar>,
    );

    const tablist = screen.getByRole("tablist", { name: "demo tabs" });
    expect(tablist.className).toContain("overflow-x-auto");
    expect(tablist.className).toContain("overflow-y-hidden");
    expect(tablist.className).toContain("min-w-0");
  });

  it("should keep each tab at its intrinsic width (shrink-0) so it scrolls instead of squishing", () => {
    render(
      <TabBar ariaLabel="demo tabs">
        <Tab isActive={false} onSelect={() => {}} ariaLabel="alpha">
          alpha
        </Tab>
      </TabBar>,
    );

    // walk up from the role=tab button to the tab's outer element (the shrink-0 flex row)
    const outer = screen.getByRole("tab", { name: "alpha" }).parentElement;
    expect(outer?.className).toContain("shrink-0");
  });

  it("should not trigger onSelect when the trailing close control is clicked", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <TabBar ariaLabel="demo tabs">
        <Tab
          isActive={false}
          onSelect={onSelect}
          ariaLabel="alpha"
          trailing={
            <button type="button" aria-label="close alpha" onClick={onClose}>
              x
            </button>
          }
        >
          alpha
        </Tab>
      </TabBar>,
    );

    await user.click(screen.getByRole("button", { name: "close alpha" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
