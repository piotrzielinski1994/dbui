import { describe, it, expect } from "vitest";
import {
  render as rtlRender,
  screen,
  within,
  type RenderOptions,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

import { QueryWrapper } from "@/test/query-wrapper";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";

function render(ui: ReactNode, options?: RenderOptions) {
  return rtlRender(ui, { wrapper: QueryWrapper, ...options });
}
import { WorkspaceLayout } from "@/components/workspace/workspace-layout";
import {
  fixtureTree,
  fixtureConsoleLines,
  expandedToAppDb,
} from "@/components/workspace/__tests__/fixtures";

function renderLayout(opts?: {
  expanded?: string[];
  activeTabId?: string;
  connected?: string[];
}) {
  return render(
    <WorkspaceProvider
      tree={fixtureTree}
      consoleLines={fixtureConsoleLines}
      initialExpandedIds={opts?.expanded ?? expandedToAppDb}
      initialActiveTabId={opts?.activeTabId ?? "db-app"}
      initialConnectionStatus={(opts?.connected ?? []).map((id) => [
        id,
        "connected",
      ])}
    >
      <WorkspaceLayout />
    </WorkspaceProvider>,
  );
}

describe("WorkspaceLayout", () => {
  // TC-001, AC-001, AC-002, AC-008, AC-016 — behavior
  it("should render the sidebar tree, an active card and the console together", () => {
    renderLayout();

    expect(
      screen.getByRole("tree", { name: /navigator/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tablist", { name: /database sections|workbench/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: /console/i }),
    ).toBeInTheDocument();
  });

  // TC-001 — behavior (statement/target bar removed)
  it("should not render a statement bar group or a target textbox", () => {
    renderLayout();

    expect(
      screen.queryByRole("group", { name: /statement bar/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: /target/i }),
    ).not.toBeInTheDocument();
  });

  // AC-017, TC-001 — side-effect-contract (two resizable shell splits)
  it("should render at least two resizable separators for the shell splits", () => {
    renderLayout();
    expect(screen.getAllByRole("separator").length).toBeGreaterThanOrEqual(2);
  });

  // AC-005, AC-018, TC-003 — behavior (shared state: tree drives the database card)
  it("should reflect a database selected in the tree across the content tabs and card", async () => {
    const user = userEvent.setup();
    renderLayout({ expanded: ["folder-staging"], activeTabId: undefined });

    await user.click(screen.getByRole("treeitem", { name: "admin_db" }));

    expect(screen.getByRole("tab", { name: "admin_db" })).toBeInTheDocument();
    expect(
      screen.getByRole("tablist", { name: /database sections|workbench/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/FROM accounts/)).toBeInTheDocument();
  });

  // AC-006, AC-008, AC-015, AC-018, E-8 — behavior (a table tab renders a table card, not a database card)
  it("should render a table card without database sub-tabs when a table tab is active", async () => {
    const user = userEvent.setup();
    renderLayout({
      expanded: ["folder-staging"],
      activeTabId: undefined,
      connected: ["db-admin"],
    });

    await user.click(
      within(screen.getByRole("treeitem", { name: "admin_db" })).getByRole(
        "button",
        { name: /toggle .*tables/i },
      ),
    );
    await user.click(screen.getByRole("treeitem", { name: "accounts" }));

    expect(
      screen.getByRole("textbox", { name: /filter/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("tablist", { name: /database sections|workbench/i }),
    ).not.toBeInTheDocument();
  });
});
