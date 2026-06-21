import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { SidebarTree } from "@/components/workspace/sidebar-tree";
import { ContentHeader } from "@/components/workspace/content-header";
import { connectDatabase } from "@/lib/tauri";
import type {
  ConnectionConfig,
  TreeNode,
} from "@/components/workspace/mock-data";
import { fixtureTree } from "@/components/workspace/__tests__/fixtures";

vi.mock("@/lib/tauri", () => ({
  connectDatabase: vi.fn(),
}));

vi.mock("sonner", () => ({
  Toaster: () => null,
  toast: { success: vi.fn(), error: vi.fn() },
}));

const mockConnect = vi.mocked(connectDatabase);

// admin_db's connection config (matches fixtures.adminDb). Seeding initialConnections
// with this id is how the Settings button (and so the row toggle) reads "connected".
const adminConfig: ConnectionConfig = {
  engine: "postgres",
  host: "db.internal",
  port: 5433,
  database: "admin",
  user: "seed_admin",
  password: "s3cr3t-pw",
};

function renderTree(opts?: {
  tree?: TreeNode[];
  expanded?: string[];
  activeTabId?: string;
  openTabIds?: string[];
  connectedStatus?: string[];
  connections?: [string, ConnectionConfig][];
  children?: ReactNode;
}) {
  return render(
    <WorkspaceProvider
      tree={opts?.tree ?? fixtureTree}
      initialExpandedIds={opts?.expanded ?? []}
      initialActiveTabId={opts?.activeTabId}
      initialOpenTabIds={opts?.openTabIds}
      initialConnectionStatus={(opts?.connectedStatus ?? []).map((id) => [
        id,
        "connected",
      ])}
      initialConnections={opts?.connections ?? []}
    >
      <SidebarTree />
      {opts?.children}
    </WorkspaceProvider>,
  );
}

function openRowMenu(name: string) {
  const row = screen.getByRole("treeitem", { name });
  fireEvent.contextMenu(row);
  return row;
}

// Prefer the menuitem role; fall back to plain text if radix doesn't expose the role.
function menuItem(name: RegExp | string) {
  const byRole = screen.queryByRole("menuitem", { name });
  if (byRole) {
    return byRole;
  }
  return screen.getByText(name);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("row context menu - database row", () => {
  // AC-102 - behavior
  it("should open a context menu with a connection toggle and a Delete item when a database row is right-clicked", () => {
    renderTree({ expanded: ["folder-staging"] });

    openRowMenu("admin_db");

    expect(menuItem(/^(connect|disconnect)$/i)).toBeInTheDocument();
    expect(menuItem(/^delete$/i)).toBeInTheDocument();
  });

  // AC-103 - behavior (not connected -> "Connect")
  it("should label the toggle Connect when the database is not connected", () => {
    renderTree({ expanded: ["folder-staging"] });

    openRowMenu("admin_db");

    expect(menuItem(/^connect$/i)).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /^disconnect$/i })).toBeNull();
  });

  // AC-103 - behavior (connected -> "Disconnect")
  it("should label the toggle Disconnect when the database is connected", () => {
    renderTree({
      expanded: ["folder-staging"],
      connectedStatus: ["db-admin"],
      connections: [["db-admin", adminConfig]],
    });

    openRowMenu("admin_db");

    expect(menuItem(/^disconnect$/i)).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /^connect$/i })).toBeNull();
  });

  // AC-104, TC-103 - side-effect-contract (Connect calls connectDatabase with node config)
  it("should invoke connectDatabase with the node config when Connect is selected on a not-connected database", async () => {
    const user = userEvent.setup();
    mockConnect.mockResolvedValueOnce([]);
    renderTree({ expanded: ["folder-staging"] });

    openRowMenu("admin_db");
    await user.click(menuItem(/^connect$/i));

    await waitFor(() => {
      expect(mockConnect).toHaveBeenCalledTimes(1);
    });
    expect(mockConnect).toHaveBeenCalledWith(
      expect.objectContaining({
        engine: "postgres",
        host: "db.internal",
        port: 5433,
        database: "admin",
        user: "seed_admin",
      }),
    );
  });

  // AC-104, TC-102 - behavior (Disconnect drops the connection; status dot clears)
  it("should drop the connection and clear the connected dot when Disconnect is selected on a connected database", async () => {
    const user = userEvent.setup();
    renderTree({
      expanded: ["folder-staging"],
      connectedStatus: ["db-admin"],
      connections: [["db-admin", adminConfig]],
    });

    expect(screen.getByLabelText(/admin_db connected/i)).toBeInTheDocument();

    openRowMenu("admin_db");
    await user.click(menuItem(/^disconnect$/i));

    await waitFor(() => {
      expect(screen.queryByLabelText(/admin_db connected/i)).toBeNull();
    });
  });
});

describe("row context menu - folder row", () => {
  // AC-105, E-104 - behavior (folder menu has Delete, no connection toggle)
  it("should open a context menu with Delete and no connection toggle when a folder row is right-clicked", () => {
    renderTree();

    openRowMenu("staging");

    expect(menuItem(/^delete$/i)).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /^connect$/i })).toBeNull();
    expect(
      screen.queryByRole("menuitem", { name: /^disconnect$/i }),
    ).toBeNull();
  });
});

describe("row context menu - table leaf", () => {
  // AC-110, TC-108, E-104 - behavior (no menu on a table leaf)
  it("should not open a Delete or Connect menu when a table leaf is right-clicked", async () => {
    const user = userEvent.setup();
    renderTree({
      expanded: ["folder-staging"],
      connectedStatus: ["db-admin"],
      connections: [["db-admin", adminConfig]],
    });

    // Reveal the table leaves: db-admin is connected, expand its tables.
    await user.click(
      within(screen.getByRole("treeitem", { name: "admin_db" })).getByRole(
        "button",
        { name: /toggle .*tables/i },
      ),
    );

    // Precondition: the database row DOES open a menu (proves the menu infra
    // is wired) - this assertion fails until the feature exists, keeping the
    // table-leaf case meaningfully red rather than a false green.
    openRowMenu("admin_db");
    expect(menuItem(/^delete$/i)).toBeInTheDocument();
    await user.keyboard("{Escape}");

    const tableLeaf = screen.getByRole("treeitem", { name: "accounts" });
    fireEvent.contextMenu(tableLeaf);

    expect(screen.queryByRole("menuitem", { name: /^delete$/i })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /^connect$/i })).toBeNull();
    expect(screen.queryByText("Delete")).toBeNull();
  });
});

describe("row context menu - delete confirm dialog", () => {
  // AC-106 - behavior (database delete dialog names the node)
  it("should open a confirm dialog naming the database when Delete is selected on a database row", async () => {
    const user = userEvent.setup();
    renderTree({ expanded: ["folder-staging"] });

    openRowMenu("admin_db");
    await user.click(menuItem(/^delete$/i));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/delete .*admin_db/i)).toBeInTheDocument();
  });

  // AC-106 - behavior (folder delete dialog warns about the databases inside)
  it("should warn the folder's databases are removed too when Delete is selected on a folder row", async () => {
    const user = userEvent.setup();
    renderTree();

    openRowMenu("staging");
    await user.click(menuItem(/^delete$/i));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/delete .*staging/i)).toBeInTheDocument();
    expect(
      within(dialog).getByText(/databases inside|inside it|its databases/i),
    ).toBeInTheDocument();
  });

  // AC-107, TC-104 - behavior (confirming the delete removes the database row)
  it("should remove the database row from the tree when the delete is confirmed", async () => {
    const user = userEvent.setup();
    renderTree({ expanded: ["folder-staging"] });

    openRowMenu("admin_db");
    await user.click(menuItem(/^delete$/i));

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^delete$/i }));

    await waitFor(() => {
      expect(screen.queryByRole("treeitem", { name: "admin_db" })).toBeNull();
    });
  });

  // AC-107, TC-105 - behavior (deleting a folder removes the folder and its child db)
  it("should remove the folder and its child database when a folder delete is confirmed", async () => {
    const user = userEvent.setup();
    renderTree({ expanded: ["folder-staging"] });

    expect(screen.getByRole("treeitem", { name: "admin_db" })).toBeInTheDocument();

    openRowMenu("staging");
    await user.click(menuItem(/^delete$/i));

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^delete$/i }));

    await waitFor(() => {
      expect(screen.queryByRole("treeitem", { name: "staging" })).toBeNull();
    });
    expect(screen.queryByRole("treeitem", { name: "admin_db" })).toBeNull();
  });

  // AC-107 - behavior (deleting a folder removes a database nested two levels deep)
  it("should remove a database nested two folders deep when the outer folder is deleted", async () => {
    const user = userEvent.setup();
    // fixtureTree: folder-prod > folder-team > app_db
    renderTree({ expanded: ["folder-prod", "folder-team"] });

    expect(screen.getByRole("treeitem", { name: "app_db" })).toBeInTheDocument();

    openRowMenu("prod");
    await user.click(menuItem(/^delete$/i));

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^delete$/i }));

    await waitFor(() => {
      expect(screen.queryByRole("treeitem", { name: "prod" })).toBeNull();
    });
    expect(screen.queryByRole("treeitem", { name: "team" })).toBeNull();
    expect(screen.queryByRole("treeitem", { name: "app_db" })).toBeNull();
  });

  // E-105 - behavior (deleting an empty folder removes it cleanly)
  it("should remove an empty folder when its delete is confirmed", async () => {
    const user = userEvent.setup();
    const emptyFolderTree: TreeNode[] = [
      { kind: "folder", id: "folder-empty", name: "archive", children: [] },
    ];
    renderTree({ tree: emptyFolderTree });

    openRowMenu("archive");
    await user.click(menuItem(/^delete$/i));

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^delete$/i }));

    await waitFor(() => {
      expect(screen.queryByRole("treeitem", { name: "archive" })).toBeNull();
    });
  });

  // AC-108, TC-106, E-106 - behavior (Escape closes the dialog, node remains)
  it("should close the dialog and keep the database when the delete is cancelled with Escape", async () => {
    const user = userEvent.setup();
    renderTree({ expanded: ["folder-staging"] });

    openRowMenu("admin_db");
    await user.click(menuItem(/^delete$/i));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(screen.getByRole("treeitem", { name: "admin_db" })).toBeInTheDocument();
  });

  // AC-108, E-106 - behavior (Cancel button closes the dialog, node remains)
  it("should close the dialog and keep the database when the Cancel button is clicked", async () => {
    const user = userEvent.setup();
    renderTree({ expanded: ["folder-staging"] });

    openRowMenu("admin_db");
    await user.click(menuItem(/^delete$/i));

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^cancel$/i }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(screen.getByRole("treeitem", { name: "admin_db" })).toBeInTheDocument();
  });
});

describe("row context menu - delete prunes tabs", () => {
  // AC-109, TC-107 - behavior (deleting an open database closes its tab)
  it("should close the open tab for a database when it is deleted", async () => {
    const user = userEvent.setup();
    renderTree({
      expanded: ["folder-staging"],
      activeTabId: "db-admin",
      openTabIds: ["db-admin"],
      children: <ContentHeader />,
    });

    expect(screen.getByRole("tab", { name: "admin_db" })).toBeInTheDocument();

    openRowMenu("admin_db");
    await user.click(menuItem(/^delete$/i));

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^delete$/i }));

    await waitFor(() => {
      expect(screen.queryByRole("tab", { name: "admin_db" })).toBeNull();
    });
  });
});
