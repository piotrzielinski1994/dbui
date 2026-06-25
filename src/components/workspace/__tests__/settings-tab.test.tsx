import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { SettingsTab } from "@/components/workspace/settings-tab";
import { SidebarTree } from "@/components/workspace/sidebar-tree";
import { fixtureTree } from "@/components/workspace/__tests__/fixtures";
import type {
  DatabaseNode,
  QueryResult,
  TreeNode,
} from "@/lib/workspace/model";
import { connectDatabase, cancelConnect } from "@/lib/tauri";
import { toast } from "sonner";

vi.mock("@/lib/tauri", () => ({
  connectDatabase: vi.fn(),
  fetchSchema: vi.fn(() => Promise.resolve([])),
  disconnectDatabase: vi.fn(),
  cancelConnect: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const mockConnect = vi.mocked(connectDatabase);
const mockCancel = vi.mocked(cancelConnect);
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
      "db-admin",
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

  // behavior (a stuck connect shows Cancel; clicking it aborts via the connect-namespaced key)
  it("should show Cancel while connecting and abort the connect when clicked", async () => {
    const user = userEvent.setup();
    // Never-resolving connect holds the "connecting" state so the button stays "Cancel".
    mockConnect.mockReturnValueOnce(new Promise(() => {}));
    renderSettings();

    await user.click(screen.getByRole("button", { name: /^connect$/i }));

    const cancelButton = await screen.findByRole("button", { name: /^cancel$/i });
    await user.click(cancelButton);

    expect(mockCancel).toHaveBeenCalledWith("db-admin");
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
      "db-admin",
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

  // behavior (pending state: the Connect button becomes an enabled Cancel control - the connect is
  // abortable, not a dead "Connecting..." label)
  it("should swap Connect for an enabled Cancel button while the connect is in flight", async () => {
    const user = userEvent.setup();
    let resolveConnect: (tables: string[]) => void = () => {};
    mockConnect.mockReturnValueOnce(
      new Promise<string[]>((resolve) => {
        resolveConnect = resolve;
      }),
    );
    renderSettings();

    await user.click(screen.getByRole("button", { name: /^connect$/i }));

    const cancelButton = await screen.findByRole("button", {
      name: /^cancel$/i,
    });
    expect(cancelButton).toBeEnabled();
    expect(screen.queryByRole("button", { name: /^connect$/i })).toBeNull();

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

const sqliteResult: QueryResult = {
  status: "success",
  timeMs: 0,
  rowCount: 0,
  columns: [],
  rows: [],
  message: "",
};

// A SQLite database node: engine + a single file path, no host/port/user/password.
// The form must render a "Database file" field and hide the network fields.
function sqliteNode(file: string): DatabaseNode {
  return {
    kind: "database",
    id: "db-local",
    name: "my_local_db",
    engine: "sqlite",
    file,
    tables: [],
    views: [],
    sql: "",
    savedScripts: [],
    script: "",
    result: sqliteResult,
  };
}

function renderSqliteSettings(file = "/Users/me/data/app.sqlite") {
  const tree: TreeNode[] = [sqliteNode(file)];
  return render(
    <WorkspaceProvider tree={tree} initialActiveTabId="db-local">
      <SettingsTab />
    </WorkspaceProvider>,
  );
}

describe("SettingsTab SQLite engine", () => {
  // TC-001, AC-001/AC-002 - behavior (sqlite engine shows the Database file field)
  it("should show a Database file field when the engine is sqlite", () => {
    renderSqliteSettings();
    expect(
      screen.getByLabelText("Database file", { exact: true }),
    ).toBeInTheDocument();
  });

  // TC-001, AC-002 - behavior (sqlite hides the network fields)
  it("should hide the host, port, user and password fields when the engine is sqlite", () => {
    renderSqliteSettings();
    expect(screen.queryByRole("textbox", { name: /host/i })).toBeNull();
    expect(screen.queryByRole("textbox", { name: /port/i })).toBeNull();
    expect(screen.queryByRole("textbox", { name: /user/i })).toBeNull();
    expect(screen.queryByLabelText("Password", { exact: true })).toBeNull();
  });

  // TC-001, AC-002 - behavior (sqlite form seeds the file path from the node)
  it("should seed the Database file field from the active sqlite node", () => {
    renderSqliteSettings("/var/db/app.sqlite");
    expect(
      screen.getByLabelText("Database file", { exact: true }),
    ).toHaveValue("/var/db/app.sqlite");
  });

  // TC-002, AC-002 - behavior (postgres engine keeps the network fields, no Database file)
  it("should show the network fields and no Database file field when the engine is postgres", () => {
    renderSettings();
    expect(screen.getByRole("textbox", { name: /host/i })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /port/i })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /user/i })).toBeInTheDocument();
    expect(
      screen.getByLabelText("Password", { exact: true }),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Database file", { exact: true }),
    ).toBeNull();
  });

  // TC-003, AC-003 - behavior (empty file path disables Connect)
  it("should disable Connect when the sqlite file path is empty", () => {
    renderSqliteSettings("");
    expect(screen.getByRole("button", { name: /^connect$/i })).toBeDisabled();
  });

  // TC-003, AC-003 - behavior (non-empty file path enables Connect)
  it("should enable Connect when the sqlite file path is non-empty", () => {
    renderSqliteSettings("/Users/me/data/app.sqlite");
    expect(
      screen.getByRole("button", { name: /^connect$/i }),
    ).toBeEnabled();
  });

  // TC-003, AC-003 - behavior (clearing then typing toggles the gate)
  it("should disable Connect after the file path is cleared and re-enable it after typing", async () => {
    const user = userEvent.setup();
    renderSqliteSettings("/Users/me/data/app.sqlite");

    const fileField = screen.getByLabelText("Database file", { exact: true });
    await user.clear(fileField);
    expect(screen.getByRole("button", { name: /^connect$/i })).toBeDisabled();

    await user.type(fileField, "/tmp/new.sqlite");
    expect(screen.getByRole("button", { name: /^connect$/i })).toBeEnabled();
  });

  // TC-003, AC-003 - behavior (Connect sends the sqlite file path to the backend)
  it("should invoke connectDatabase with the sqlite engine and file path when Connect is clicked", async () => {
    const user = userEvent.setup();
    mockConnect.mockResolvedValueOnce([]);
    renderSqliteSettings("/Users/me/data/app.sqlite");

    await user.click(screen.getByRole("button", { name: /^connect$/i }));

    expect(mockConnect).toHaveBeenCalledWith(
      "db-local",
      expect.objectContaining({
        engine: "sqlite",
        file: "/Users/me/data/app.sqlite",
      }),
    );
  });
});

describe("SettingsTab engine switch keeps both shapes (TC-011)", () => {
  // TC-011, AC-002, E-5 - behavior (a postgres node renders its typed network values)
  it("should keep the postgres network values when rendering a postgres node", () => {
    renderSettings();
    expect(screen.getByRole("textbox", { name: /host/i })).toHaveValue(
      "db.internal",
    );
    expect(screen.getByRole("textbox", { name: /user/i })).toHaveValue(
      "seed_admin",
    );
    expect(
      screen.queryByLabelText("Database file", { exact: true }),
    ).toBeNull();
  });

  // TC-011, AC-002, E-5 - behavior (a sqlite node renders its file value and no stale host)
  it("should keep the sqlite file value when rendering a sqlite node", () => {
    renderSqliteSettings("/Users/me/data/app.sqlite");
    expect(
      screen.getByLabelText("Database file", { exact: true }),
    ).toHaveValue("/Users/me/data/app.sqlite");
    expect(screen.queryByRole("textbox", { name: /host/i })).toBeNull();
  });
});
