import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { ContentHeader } from "@/components/workspace/content-header";
import { SidebarTree } from "@/components/workspace/sidebar-tree";
import {
  fixtureTree,
  expandedToAppDb,
} from "@/components/workspace/__tests__/fixtures";

async function expandDbTables(
  user: ReturnType<typeof userEvent.setup>,
  dbName: string,
) {
  await user.click(
    within(screen.getByRole("treeitem", { name: dbName })).getByRole("button", {
      name: /toggle .*tables/i,
    }),
  );
}

describe("ContentHeader", () => {
  // AC-007 — behavior
  it("should expose a tablist named open tabs", () => {
    render(
      <WorkspaceProvider tree={fixtureTree} initialActiveTabId="db-admin">
        <ContentHeader />
      </WorkspaceProvider>,
    );
    expect(
      screen.getByRole("tablist", { name: /open tabs/i }),
    ).toBeInTheDocument();
  });

  // AC-007 — behavior (a database tab is named by the database name)
  it("should render an open database as a tab named by the database name", () => {
    render(
      <WorkspaceProvider tree={fixtureTree} initialActiveTabId="db-admin">
        <ContentHeader />
      </WorkspaceProvider>,
    );
    expect(screen.getByRole("tab", { name: "admin_db" })).toBeInTheDocument();
  });

  // AC-007 — behavior (a table tab is named by the table name)
  it("should render an open table as a tab named by the table name", () => {
    render(
      <WorkspaceProvider tree={fixtureTree} initialActiveTabId="tbl-users">
        <ContentHeader />
      </WorkspaceProvider>,
    );
    expect(screen.getByRole("tab", { name: "users" })).toBeInTheDocument();
  });

  // AC-007 — behavior (new-tab plus button presence)
  it("should offer a new-tab plus button", () => {
    render(
      <WorkspaceProvider tree={fixtureTree} initialActiveTabId="db-admin">
        <ContentHeader />
      </WorkspaceProvider>,
    );
    expect(screen.getByRole("button", { name: /new /i })).toBeInTheDocument();
  });

  // behavior (the plus button creates a new database tab on its Settings card)
  it("should open a new database tab on the Settings card if the plus button is clicked", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider tree={[]}>
        <ContentHeader />
        <SidebarTree />
      </WorkspaceProvider>,
    );

    await user.click(screen.getByRole("button", { name: /new /i }));

    expect(
      screen.getByRole("tab", { name: "new_database" }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("tree", { name: /navigator/i })).getByRole(
        "treeitem",
        { name: "new_database" },
      ),
    ).toBeInTheDocument();
  });

  // AC-007 — behavior (close button per tab)
  it("should offer a close button per open tab", () => {
    render(
      <WorkspaceProvider tree={fixtureTree} initialActiveTabId="db-admin">
        <ContentHeader />
      </WorkspaceProvider>,
    );
    expect(
      screen.getByRole("button", { name: "Close admin_db" }),
    ).toBeInTheDocument();
  });

  // AC-005, AC-007, TC-003 — behavior (selecting a database from the tree opens + focuses its tab)
  it("should open and focus a tab for a database name clicked in the tree", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider
        tree={fixtureTree}
        initialExpandedIds={expandedToAppDb}
      >
        <SidebarTree />
        <ContentHeader />
      </WorkspaceProvider>,
    );

    expect(
      screen.queryByRole("tab", { name: "app_db" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("treeitem", { name: "app_db" }));

    const tab = await screen.findByRole("tab", { name: "app_db" });
    expect(tab).toHaveAttribute("aria-selected", "true");
  });

  // AC-006, AC-007, E-8 — behavior (a database tab and a table tab open side by side)
  it("should open both a database tab and a table tab when each is selected", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider
        tree={fixtureTree}
        initialExpandedIds={["folder-staging"]}
        initialConnectionStatus={[["db-admin", "connected"]]}
      >
        <SidebarTree />
        <ContentHeader />
      </WorkspaceProvider>,
    );

    await user.click(screen.getByRole("treeitem", { name: "admin_db" }));
    await expandDbTables(user, "admin_db");
    await user.click(screen.getByRole("treeitem", { name: "accounts" }));

    expect(screen.getByRole("tab", { name: "admin_db" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "accounts" })).toBeInTheDocument();
  });

  // AC-007, E-3 — behavior (no duplicate tab on re-open)
  it("should not duplicate a tab when an already-open database is re-selected", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider
        tree={fixtureTree}
        initialExpandedIds={expandedToAppDb}
      >
        <SidebarTree />
        <ContentHeader />
      </WorkspaceProvider>,
    );

    await user.click(screen.getByRole("treeitem", { name: "app_db" }));
    await screen.findByRole("tab", { name: "app_db" });
    await user.click(screen.getByRole("treeitem", { name: "app_db" }));

    expect(screen.getAllByRole("tab", { name: "app_db" })).toHaveLength(1);
  });

  // TC-007, AC-007, E-8 — behavior (close one of a mixed pair, the other remains)
  it("should remove only the closed tab and keep the other open", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider
        tree={fixtureTree}
        initialExpandedIds={["folder-staging"]}
        initialConnectionStatus={[["db-admin", "connected"]]}
      >
        <SidebarTree />
        <ContentHeader />
      </WorkspaceProvider>,
    );

    await user.click(screen.getByRole("treeitem", { name: "admin_db" }));
    await expandDbTables(user, "admin_db");
    await user.click(screen.getByRole("treeitem", { name: "accounts" }));

    expect(screen.getByRole("tab", { name: "admin_db" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "accounts" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close admin_db" }));

    expect(
      screen.queryByRole("tab", { name: "admin_db" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "accounts" })).toBeInTheDocument();
  });

  // AC-007, E-4 — behavior (closing the active tab reassigns to a remaining tab)
  it("should move the active tab to a remaining tab when the active tab is closed", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider
        tree={fixtureTree}
        initialExpandedIds={["folder-staging"]}
        initialConnectionStatus={[["db-admin", "connected"]]}
      >
        <SidebarTree />
        <ContentHeader />
      </WorkspaceProvider>,
    );

    await user.click(screen.getByRole("treeitem", { name: "admin_db" }));
    await expandDbTables(user, "admin_db");
    await user.click(screen.getByRole("treeitem", { name: "accounts" }));

    // accounts is the active (last-selected) tab; close it.
    await user.click(screen.getByRole("button", { name: "Close accounts" }));

    expect(
      screen.queryByRole("tab", { name: "accounts" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "admin_db" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  // AC-007, AC-019, E-1, E-4 — behavior (closing the last tab leaves no tabs)
  it("should leave no open tab when the only open tab is closed", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider tree={fixtureTree} initialActiveTabId="db-admin">
        <ContentHeader />
      </WorkspaceProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Close admin_db" }));

    expect(
      screen.queryByRole("tab", { name: "admin_db" }),
    ).not.toBeInTheDocument();
  });
});
