import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  WorkspaceProvider,
  useWorkspace,
} from "@/components/workspace/workspace-context";
import { fixtureTree } from "@/components/workspace/__tests__/fixtures";
import type { ConnectionConfig } from "@/components/workspace/mock-data";
import type { Settings } from "@/lib/settings/settings";

const adminConnection: ConnectionConfig = {
  engine: "postgres",
  host: "db.internal",
  port: 5433,
  database: "admin",
  user: "seed_admin",
  password: "s3cr3t-pw",
};

// Surfaces the persisted workspace slices into the DOM and exposes buttons to
// trigger each persisted action - so we assert on observable seeded state and
// on the onPersist side-effect contract.
function WorkspaceProbe() {
  const {
    isSidebarVisible,
    isConsoleVisible,
    splitOrientation,
    layouts,
    saveLayout,
    expandedIds,
    openTabIds,
    activeTabId,
    connections,
    toggleSidebar,
    toggleConsole,
    toggleSplitOrientation,
    toggleExpand,
    openNode,
    setConnection,
  } = useWorkspace();

  return (
    <div>
      <span data-testid="sidebar-visible">{String(isSidebarVisible)}</span>
      <span data-testid="console-visible">{String(isConsoleVisible)}</span>
      <span data-testid="split">{splitOrientation}</span>
      <span data-testid="layout-main">
        {JSON.stringify(layouts.main ?? null)}
      </span>
      <span data-testid="expanded">{[...expandedIds].sort().join(",")}</span>
      <span data-testid="open-tabs">{openTabIds.join(",")}</span>
      <span data-testid="active-tab">{String(activeTabId)}</span>
      <span data-testid="admin-conn">
        {JSON.stringify(connections.get("db-admin") ?? null)}
      </span>
      <button type="button" onClick={toggleSidebar}>
        toggle sidebar
      </button>
      <button type="button" onClick={toggleConsole}>
        toggle console
      </button>
      <button type="button" onClick={toggleSplitOrientation}>
        toggle split
      </button>
      <button
        type="button"
        onClick={() => saveLayout("main", { content: 60, console: 40 })}
      >
        save layout
      </button>
      <button type="button" onClick={() => toggleExpand("folder-prod")}>
        expand folder
      </button>
      <button type="button" onClick={() => openNode("db-admin")}>
        open db-admin
      </button>
      <button
        type="button"
        onClick={() => setConnection("db-app", adminConnection)}
      >
        set connection
      </button>
    </div>
  );
}

describe("WorkspaceProvider seeded persistence state", () => {
  // AC-007 - behavior
  it("should hide the sidebar when initialSidebarHidden is true", () => {
    render(
      <WorkspaceProvider tree={fixtureTree} initialSidebarHidden>
        <WorkspaceProbe />
      </WorkspaceProvider>,
    );

    expect(screen.getByTestId("sidebar-visible")).toHaveTextContent("false");
  });

  // AC-007 - behavior
  it("should hide the console when initialConsoleHidden is true", () => {
    render(
      <WorkspaceProvider tree={fixtureTree} initialConsoleHidden>
        <WorkspaceProbe />
      </WorkspaceProvider>,
    );

    expect(screen.getByTestId("console-visible")).toHaveTextContent("false");
  });

  // AC-007 - behavior
  it("should seed panel layouts from initialLayouts", () => {
    render(
      <WorkspaceProvider
        tree={fixtureTree}
        initialLayouts={{ main: { content: 70, console: 30 } }}
      >
        <WorkspaceProbe />
      </WorkspaceProvider>,
    );

    expect(screen.getByTestId("layout-main")).toHaveTextContent(
      JSON.stringify({ content: 70, console: 30 }),
    );
  });

  // AC-007 - behavior
  it("should honor initialSplitOrientation vertical", () => {
    render(
      <WorkspaceProvider tree={fixtureTree} initialSplitOrientation="vertical">
        <WorkspaceProbe />
      </WorkspaceProvider>,
    );

    expect(screen.getByTestId("split")).toHaveTextContent("vertical");
  });

  // AC-007 - behavior
  it("should seed expandedIds from initialExpandedIds", () => {
    render(
      <WorkspaceProvider
        tree={fixtureTree}
        initialExpandedIds={["folder-staging", "db-admin"]}
      >
        <WorkspaceProbe />
      </WorkspaceProvider>,
    );

    expect(screen.getByTestId("expanded")).toHaveTextContent(
      "db-admin,folder-staging",
    );
  });

  // AC-007 - behavior
  it("should seed openTabIds and activeTabId from the initial props", () => {
    render(
      <WorkspaceProvider
        tree={fixtureTree}
        initialOpenTabIds={["db-admin", "tbl-accounts"]}
        initialActiveTabId="tbl-accounts"
      >
        <WorkspaceProbe />
      </WorkspaceProvider>,
    );

    expect(screen.getByTestId("open-tabs")).toHaveTextContent(
      "db-admin,tbl-accounts",
    );
    expect(screen.getByTestId("active-tab")).toHaveTextContent("tbl-accounts");
  });

  // AC-007, AC-009 - behavior (restored connection is retrievable / live)
  it("should seed the connections map from initialConnections", () => {
    render(
      <WorkspaceProvider
        tree={fixtureTree}
        initialConnections={[["db-admin", adminConnection]]}
      >
        <WorkspaceProbe />
      </WorkspaceProvider>,
    );

    expect(screen.getByTestId("admin-conn")).toHaveTextContent(
      JSON.stringify(adminConnection),
    );
  });
});

describe("WorkspaceProvider onPersist side-effect contract", () => {
  // AC-008 - side-effect-contract
  it("should call onPersist with sidebarHidden true when toggleSidebar flips it off", async () => {
    const user = userEvent.setup();
    const onPersist = vi.fn<(settings: Settings) => void>();

    render(
      <WorkspaceProvider tree={fixtureTree} onPersist={onPersist}>
        <WorkspaceProbe />
      </WorkspaceProvider>,
    );

    await user.click(screen.getByRole("button", { name: /toggle sidebar/i }));

    await waitFor(() => {
      const last = onPersist.mock.calls.at(-1)?.[0];
      expect(last?.sidebarHidden).toBe(true);
    });
  });

  // AC-008 - side-effect-contract
  it("should call onPersist with consoleHidden true when toggleConsole flips it off", async () => {
    const user = userEvent.setup();
    const onPersist = vi.fn<(settings: Settings) => void>();

    render(
      <WorkspaceProvider tree={fixtureTree} onPersist={onPersist}>
        <WorkspaceProbe />
      </WorkspaceProvider>,
    );

    await user.click(screen.getByRole("button", { name: /toggle console/i }));

    await waitFor(() => {
      const last = onPersist.mock.calls.at(-1)?.[0];
      expect(last?.consoleHidden).toBe(true);
    });
  });

  // AC-008 - side-effect-contract
  it("should call onPersist with splitOrientation vertical when toggleSplitOrientation fires", async () => {
    const user = userEvent.setup();
    const onPersist = vi.fn<(settings: Settings) => void>();

    render(
      <WorkspaceProvider tree={fixtureTree} onPersist={onPersist}>
        <WorkspaceProbe />
      </WorkspaceProvider>,
    );

    await user.click(screen.getByRole("button", { name: /toggle split/i }));

    await waitFor(() => {
      const last = onPersist.mock.calls.at(-1)?.[0];
      expect(last?.splitOrientation).toBe("vertical");
    });
  });

  // AC-008 - side-effect-contract
  it("should call onPersist with the saved panel layout when saveLayout fires", async () => {
    const user = userEvent.setup();
    const onPersist = vi.fn<(settings: Settings) => void>();

    render(
      <WorkspaceProvider tree={fixtureTree} onPersist={onPersist}>
        <WorkspaceProbe />
      </WorkspaceProvider>,
    );

    await user.click(screen.getByRole("button", { name: /save layout/i }));

    await waitFor(() => {
      const last = onPersist.mock.calls.at(-1)?.[0];
      expect(last?.layouts.main).toEqual({ content: 60, console: 40 });
    });
  });

  // AC-008 - side-effect-contract
  it("should call onPersist with the changed expandedIds when toggleExpand fires", async () => {
    const user = userEvent.setup();
    const onPersist = vi.fn<(settings: Settings) => void>();

    render(
      <WorkspaceProvider tree={fixtureTree} onPersist={onPersist}>
        <WorkspaceProbe />
      </WorkspaceProvider>,
    );

    await user.click(screen.getByRole("button", { name: /expand folder/i }));

    await waitFor(() => {
      const last = onPersist.mock.calls.at(-1)?.[0];
      expect(last?.expandedIds).toContain("folder-prod");
    });
  });

  // AC-008 - side-effect-contract
  it("should call onPersist with the opened tab in openTabIds and activeTabId when a tab opens", async () => {
    const user = userEvent.setup();
    const onPersist = vi.fn<(settings: Settings) => void>();

    render(
      <WorkspaceProvider tree={fixtureTree} onPersist={onPersist}>
        <WorkspaceProbe />
      </WorkspaceProvider>,
    );

    await user.click(screen.getByRole("button", { name: /open db-admin/i }));

    await waitFor(() => {
      const last = onPersist.mock.calls.at(-1)?.[0];
      expect(last?.openTabIds).toContain("db-admin");
      expect(last?.activeTabId).toBe("db-admin");
    });
  });

  // AC-008 - side-effect-contract
  it("should call onPersist with the new connection in connections when setConnection fires", async () => {
    const user = userEvent.setup();
    const onPersist = vi.fn<(settings: Settings) => void>();

    render(
      <WorkspaceProvider tree={fixtureTree} onPersist={onPersist}>
        <WorkspaceProbe />
      </WorkspaceProvider>,
    );

    await user.click(screen.getByRole("button", { name: /set connection/i }));

    await waitFor(() => {
      const last = onPersist.mock.calls.at(-1)?.[0];
      expect(last?.connections["db-app"]).toEqual(adminConnection);
    });
  });
});

describe("WorkspaceProvider without onPersist", () => {
  // AC-010, E-7 - behavior (opt-in: provider still works with no onPersist)
  it("should still toggle the sidebar with no onPersist prop and not throw", async () => {
    const user = userEvent.setup();

    render(
      <WorkspaceProvider tree={fixtureTree}>
        <WorkspaceProbe />
      </WorkspaceProvider>,
    );

    expect(screen.getByTestId("sidebar-visible")).toHaveTextContent("true");

    await user.click(screen.getByRole("button", { name: /toggle sidebar/i }));

    expect(screen.getByTestId("sidebar-visible")).toHaveTextContent("false");
  });
});
