import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  WorkspaceProvider,
  useWorkspace,
} from "@/components/workspace/workspace-context";
import { useConnectionActions } from "@/components/workspace/use-connection";
import { connectDatabase, fetchSchema } from "@/lib/tauri";
import type {
  ConnectionConfig,
  TableSchema,
  TreeNode,
} from "@/lib/workspace/model";

vi.mock("@/lib/tauri", () => ({
  connectDatabase: vi.fn(),
  fetchSchema: vi.fn(),
  disconnectDatabase: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const mockConnect = vi.mocked(connectDatabase);
const mockFetchSchema = vi.mocked(fetchSchema);

const config: ConnectionConfig = {
  engine: "postgres",
  host: "localhost",
  port: 5432,
  database: "app",
  user: "app_user",
  password: "secret",
};

const schema: TableSchema[] = [
  { schema: null, name: "users", columns: [{ name: "id", dataType: "int4" }] },
];

const tree: TreeNode[] = [
  {
    kind: "database",
    accentColor: null,
    readOnly: false,
    manualCommit: false,
    id: "db-app",
    name: "app",
    engine: "postgres",
    host: "localhost",
    port: 5432,
    database: "app",
    user: "app_user",
    password: "secret",
    tables: [],
    views: [],
    sql: "SELECT 1",
    savedScripts: [],
    savedJsScripts: [],
    result: {
      status: "success",
      timeMs: 0,
      rowCount: 0,
      columns: [],
      rows: [],
      message: "",
    },
  },
];

// Drives connect/disconnect and exposes the stored schema for db-app as text.
function Probe() {
  const { databaseSchemas } = useWorkspace();
  const { connect, disconnect } = useConnectionActions();
  const stored = databaseSchemas.get("db-app");
  return (
    <div>
      <span data-testid="schema">
        {stored === undefined
          ? "absent"
          : stored.map((table) => table.name).join(",") || "empty"}
      </span>
      <button type="button" onClick={() => connect("db-app", config)}>
        connect
      </button>
      <button type="button" onClick={() => disconnect("db-app")}>
        disconnect
      </button>
    </div>
  );
}

function renderProbe() {
  return render(
    <WorkspaceProvider tree={tree}>
      <Probe />
    </WorkspaceProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("connect schema fetch", () => {
  // TC-011 / AC-007 - behavior: a successful connect stores the fetched schema keyed by db id.
  it("should store the fetched schema for the database when connect succeeds", async () => {
    const user = userEvent.setup();
    mockConnect.mockResolvedValue({ tables: [{ schema: null, name: "users" }], views: [] });
    mockFetchSchema.mockResolvedValue(schema);
    renderProbe();

    expect(screen.getByTestId("schema")).toHaveTextContent("absent");
    await user.click(screen.getByRole("button", { name: /^connect$/i }));

    await waitFor(() => {
      expect(screen.getByTestId("schema")).toHaveTextContent("users");
    });
    expect(mockFetchSchema).toHaveBeenCalledWith("db-app");
  });

  // TC-011 / AC-007 - behavior: disconnect clears the stored schema.
  it("should clear the stored schema when the database is disconnected", async () => {
    const user = userEvent.setup();
    mockConnect.mockResolvedValue({ tables: [{ schema: null, name: "users" }], views: [] });
    mockFetchSchema.mockResolvedValue(schema);
    renderProbe();

    await user.click(screen.getByRole("button", { name: /^connect$/i }));
    await waitFor(() => {
      expect(screen.getByTestId("schema")).toHaveTextContent("users");
    });

    await user.click(screen.getByRole("button", { name: /^disconnect$/i }));
    await waitFor(() => {
      expect(screen.getByTestId("schema")).toHaveTextContent("absent");
    });
  });

  // TC-011 / AC-007 - behavior: a failed schema fetch leaves the connection up with an empty
  // schema (no throw), so the editor still works with keyword completion.
  it("should store an empty schema when the schema fetch fails", async () => {
    const user = userEvent.setup();
    mockConnect.mockResolvedValue({ tables: [{ schema: null, name: "users" }], views: [] });
    mockFetchSchema.mockRejectedValue("schema boom");
    renderProbe();

    await user.click(screen.getByRole("button", { name: /^connect$/i }));

    await waitFor(() => {
      expect(screen.getByTestId("schema")).toHaveTextContent("empty");
    });
  });
});
