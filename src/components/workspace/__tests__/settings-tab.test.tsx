import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { SettingsTab } from "@/components/workspace/settings-tab";
import { SidebarTree } from "@/components/workspace/sidebar-tree";
import { fixtureTree } from "@/components/workspace/__tests__/fixtures";
import { connectDatabase } from "@/lib/tauri";
import { toast } from "sonner";

vi.mock("@/lib/tauri", () => ({
  connectDatabase: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const mockConnect = vi.mocked(connectDatabase);
const mockToast = vi.mocked(toast);

function renderSettings(opts?: {
  activeTabId?: string;
  expanded?: string[];
  children?: ReactNode;
  connected?: boolean;
}) {
  const activeTabId = opts?.activeTabId ?? "db-admin";
  return render(
    <WorkspaceProvider
      tree={fixtureTree}
      initialActiveTabId={activeTabId}
      initialExpandedIds={opts?.expanded ?? []}
      initialConnections={
        opts?.connected
          ? [
              [
                activeTabId,
                {
                  engine: "postgres",
                  host: "db.internal",
                  port: 5433,
                  database: "admin",
                  user: "seed_admin",
                  password: "s3cr3t-pw",
                },
              ],
            ]
          : []
      }
    >
      <SettingsTab />
      {opts?.children}
    </WorkspaceProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SettingsTab", () => {
  // AC-001 - behavior (form controls present)
  it("should render an engine selector, host/port/database/user/password inputs and a Connect button", () => {
    renderSettings();
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /host/i })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /port/i })).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: /database/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /user/i })).toBeInTheDocument();
    expect(
      screen.getByLabelText("Password", { exact: true }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^connect$/i }),
    ).toBeInTheDocument();
  });

  // AC-002, AC-001 - behavior (engine selector shows the node's engine)
  it("should show the active database's engine in the selector trigger", () => {
    renderSettings();
    expect(screen.getByRole("combobox")).toHaveTextContent(/postgres/i);
  });

  // AC-002 - behavior (form seeded from active node)
  it("should seed host, port, database and user from the active database node", () => {
    renderSettings();
    expect(screen.getByRole("textbox", { name: /host/i })).toHaveValue(
      "db.internal",
    );
    expect(screen.getByRole("textbox", { name: /port/i })).toHaveValue("5433");
    expect(screen.getByRole("textbox", { name: /database/i })).toHaveValue(
      "admin",
    );
    expect(screen.getByRole("textbox", { name: /user/i })).toHaveValue(
      "seed_admin",
    );
  });

  // AC-002 - behavior (password masked by default)
  it("should mask the password field by default", () => {
    renderSettings();
    expect(screen.getByLabelText("Password", { exact: true })).toHaveAttribute(
      "type",
      "password",
    );
  });

  // AC-002 - behavior (show/hide toggle reveals the password)
  it("should reveal the password as plain text when the show-password button is clicked", async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByRole("button", { name: /show password/i }));

    expect(screen.getByLabelText("Password", { exact: true })).toHaveAttribute(
      "type",
      "text",
    );
  });

  // AC-002, TC-003, E-6 - behavior (inputs are editable, not readOnly)
  it("should let the user edit the host input", async () => {
    const user = userEvent.setup();
    renderSettings();

    const host = screen.getByRole("textbox", { name: /host/i });
    await user.clear(host);
    await user.type(host, "remote.example.com");

    expect(host).toHaveValue("remote.example.com");
  });

  // AC-002, TC-003 - behavior (user input is editable)
  it("should let the user edit the user input", async () => {
    const user = userEvent.setup();
    renderSettings();

    const userInput = screen.getByRole("textbox", { name: /user/i });
    await user.clear(userInput);
    await user.type(userInput, "new_user");

    expect(userInput).toHaveValue("new_user");
  });

  // AC-003, TC-001 - behavior (Connect calls the backend once with the form config)
  it("should invoke connectDatabase once with the current form config when Connect is clicked", async () => {
    const user = userEvent.setup();
    mockConnect.mockResolvedValueOnce(["a", "b"]);
    renderSettings();

    await user.click(screen.getByRole("button", { name: /^connect$/i }));

    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(mockConnect).toHaveBeenCalledWith(
      expect.objectContaining({
        engine: "postgres",
        host: "db.internal",
        port: 5433,
        database: "admin",
        user: "seed_admin",
        password: "s3cr3t-pw",
      }),
    );
  });

  // AC-003 - behavior (Connect sends edited values)
  it("should send the edited host to the backend when the host was changed before connecting", async () => {
    const user = userEvent.setup();
    mockConnect.mockResolvedValueOnce([]);
    renderSettings();

    const host = screen.getByRole("textbox", { name: /host/i });
    await user.clear(host);
    await user.type(host, "edited.host");
    await user.click(screen.getByRole("button", { name: /^connect$/i }));

    expect(mockConnect).toHaveBeenCalledWith(
      expect.objectContaining({ host: "edited.host" }),
    );
  });

  // AC-004, TC-001 - side-effect-contract (success toast reports the table count)
  it("should fire a success toast reporting the table count when the connect resolves", async () => {
    const user = userEvent.setup();
    mockConnect.mockResolvedValueOnce(["a", "b"]);
    renderSettings();

    await user.click(screen.getByRole("button", { name: /^connect$/i }));

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledTimes(1);
    });
    expect(mockToast.success).toHaveBeenCalledWith(
      expect.stringMatching(/2 tables/i),
    );
  });

  // AC-005, TC-002 - side-effect-contract (error toast carries the backend message)
  it("should fire an error toast with the backend message when the connect rejects", async () => {
    const user = userEvent.setup();
    mockConnect.mockRejectedValueOnce(new Error("connection refused"));
    renderSettings();

    await user.click(screen.getByRole("button", { name: /^connect$/i }));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledTimes(1);
    });
    expect(mockToast.error).toHaveBeenCalledWith(
      expect.stringMatching(/connection refused/i),
    );
    expect(mockToast.success).not.toHaveBeenCalled();
  });

  // AC-007, TC-004 - behavior (pending state: disabled + "Connecting...")
  it("should disable the Connect button and label it Connecting while the connect is in flight", async () => {
    const user = userEvent.setup();
    let resolveConnect: (tables: string[]) => void = () => {};
    mockConnect.mockReturnValueOnce(
      new Promise<string[]>((resolve) => {
        resolveConnect = resolve;
      }),
    );
    renderSettings();

    await user.click(screen.getByRole("button", { name: /^connect$/i }));

    const pending = await screen.findByRole("button", {
      name: /connecting/i,
    });
    expect(pending).toBeDisabled();

    resolveConnect([]);
  });

  // E-1 - behavior (Connect disabled when host is empty)
  it("should disable Connect when the host is empty", async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.clear(screen.getByRole("textbox", { name: /host/i }));

    expect(screen.getByRole("button", { name: /^connect$/i })).toBeDisabled();
  });

  // E-1 - behavior (Connect disabled when database is empty)
  it("should disable Connect when the database is empty", async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.clear(screen.getByRole("textbox", { name: /database/i }));

    expect(screen.getByRole("button", { name: /^connect$/i })).toBeDisabled();
  });

  // E-1 - behavior (Connect disabled when user is empty)
  it("should disable Connect when the user is empty", async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.clear(screen.getByRole("textbox", { name: /user/i }));

    expect(screen.getByRole("button", { name: /^connect$/i })).toBeDisabled();
  });

  // E-6 - behavior (non-database active node renders nothing)
  it("should render nothing when the active node is a table rather than a database", () => {
    renderSettings({ activeTabId: "tbl-accounts" });
    expect(screen.queryByRole("button", { name: /^connect$/i })).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  // behavior (a connected database shows Disconnect instead of Connect)
  it("should show a Disconnect button when the database is already connected", () => {
    renderSettings({ connected: true });
    expect(
      screen.getByRole("button", { name: /^disconnect$/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^connect$/i })).toBeNull();
  });

  // behavior (clicking Disconnect drops the connection -> Connect returns)
  it("should drop the connection and restore Connect when Disconnect is clicked", async () => {
    const user = userEvent.setup();
    renderSettings({ connected: true });

    await user.click(screen.getByRole("button", { name: /^disconnect$/i }));

    expect(
      screen.getByRole("button", { name: /^connect$/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^disconnect$/i })).toBeNull();
  });
});

describe("SettingsTab connect flow updates the sidebar", () => {
  // AC-004, TC-001 - behavior (sidebar tables replaced by fetched names)
  it("should reveal the fetched table names in the sidebar on a successful connect", async () => {
    const user = userEvent.setup();
    mockConnect.mockResolvedValueOnce(["fetched_one", "fetched_two"]);
    renderSettings({
      activeTabId: "db-admin",
      expanded: ["folder-staging", "db-admin"],
      children: <SidebarTree />,
    });

    // Not connected yet: no table leaves are shown (the app can't know them).
    expect(
      screen.queryByRole("treeitem", { name: "accounts" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^connect$/i }));

    expect(
      await screen.findByRole("treeitem", { name: "fetched_one" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("treeitem", { name: "fetched_two" }),
    ).toBeInTheDocument();
  });

  // AC-005, TC-002 - behavior (no tables revealed when the connect fails)
  it("should reveal no sidebar tables when the connect rejects", async () => {
    const user = userEvent.setup();
    mockConnect.mockRejectedValueOnce(new Error("boom"));
    renderSettings({
      activeTabId: "db-admin",
      expanded: ["folder-staging", "db-admin"],
      children: <SidebarTree />,
    });

    await user.click(screen.getByRole("button", { name: /^connect$/i }));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
    expect(
      screen.queryByRole("treeitem", { name: "accounts" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("treeitem", { name: "audit_log" }),
    ).not.toBeInTheDocument();
  });

  // AC-004, TC-005, E-3 - behavior (zero tables -> childless list + "0 tables" toast)
  it("should report 0 tables and leave the database childless when the connect returns an empty list", async () => {
    const user = userEvent.setup();
    mockConnect.mockResolvedValueOnce([]);
    renderSettings({
      activeTabId: "db-admin",
      expanded: ["folder-staging", "db-admin"],
      children: <SidebarTree />,
    });

    await user.click(screen.getByRole("button", { name: /^connect$/i }));

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledWith(
        expect.stringMatching(/0 tables/i),
      );
    });
    expect(
      screen.queryByRole("treeitem", { name: "accounts" }),
    ).not.toBeInTheDocument();
    const dbRow = screen.getByRole("treeitem", { name: "admin_db" });
    const group = within(dbRow.closest("li") as HTMLElement).queryByRole(
      "group",
    );
    if (group) {
      expect(within(group).queryAllByRole("treeitem")).toHaveLength(0);
    }
  });
});
