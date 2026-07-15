import { describe, it, expect } from "vitest";
import {
  fireEvent,
  render as rtlRender,
  screen,
  within,
  type RenderOptions,
} from "@testing-library/react";
import type { ReactNode } from "react";

import { QueryWrapper } from "@/test/query-wrapper";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { WorkspaceLayout } from "@/components/workspace/workspace-layout";
import { fixtureTree } from "@/components/workspace/__tests__/fixtures";

function render(ui: ReactNode, options?: RenderOptions) {
  return rtlRender(ui, { wrapper: QueryWrapper, ...options });
}

function openPalette() {
  fireEvent.keyDown(window, { key: "k", metaKey: true });
}

describe("WorkspaceLayout command palette - Find", () => {
  // behavior: the palette lists a "Find" command under the View heading (AC-011, TC-009)
  it("should list Find under the View group", () => {
    render(
      <WorkspaceProvider tree={fixtureTree} initialActiveTabId="db-admin">
        <WorkspaceLayout />
      </WorkspaceProvider>,
    );

    openPalette();

    const viewGroup = screen
      .getByText("View")
      .closest("[cmdk-group]") as HTMLElement;
    expect(viewGroup).not.toBeNull();
    expect(within(viewGroup).getByText("Find")).toBeInTheDocument();
  });
});
