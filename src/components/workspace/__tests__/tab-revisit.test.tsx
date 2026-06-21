import { describe, it, expect, vi, beforeEach } from "vitest";
import { StrictMode } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { DatabaseCard } from "@/components/workspace/database-card";
import { TableCard } from "@/components/workspace/table-card";
import { Console } from "@/components/workspace/console";
import { connectDatabase, fetchTable } from "@/lib/tauri";
import type {
  ConnectionConfig,
  TableRows,
  TreeNode,
} from "@/lib/workspace/model";

vi.mock("@/lib/tauri", () => ({
  connectDatabase: vi.fn(),
  fetchTable: vi.fn(),
  updateTable: vi.fn(),
  executeSql: vi.fn(),
}));

vi.mock("sonner", () => ({
  Toaster: () => null,
  toast: { success: vi.fn(), error: vi.fn() },
}));

const mockConnect = vi.mocked(connectDatabase);
const mockFetch = vi.mocked(fetchTable);

const config: ConnectionConfig = {
  engine: "postgres",
  host: "localhost",
  port: 5432,
  database: "ppp",
  user: "postgres",
  password: "postgres",
};

const tree: TreeNode[] = [
  {
    kind: "database",
    id: "db-ppp",
    name: "ppp",
    engine: "postgres",
    host: "localhost",
    port: 5432,
    database: "ppp",
    user: "postgres",
    password: "postgres",
    tables: [
      { kind: "table", id: "db-ppp::product", name: "product", columns: [], rows: [] },
    ],
    views: [],
    sql: "SELECT 1",
    savedScripts: [],
    script: "",
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

const productRows: TableRows = {
  columns: [
    { name: "id", dataType: "int4", nullable: false, isPrimaryKey: true },
    { name: "name", dataType: "text", nullable: true, isPrimaryKey: false },
  ],
  rows: [["1", "Ada"]],
  primaryKey: "id",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockConnect.mockResolvedValue([]);
  mockFetch.mockResolvedValue(productRows);
});

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe("auto-connect under StrictMode", () => {
  // side-effect-contract (StrictMode double-invokes effects; auto-connect must fire once)
  it("should call connectDatabase only once if a database tab is opened under StrictMode", async () => {
    render(
      <StrictMode>
        <QueryClientProvider client={newClient()}>
          <WorkspaceProvider tree={tree} initialActiveTabId="db-ppp">
            <DatabaseCard />
          </WorkspaceProvider>
        </QueryClientProvider>
      </StrictMode>,
    );

    await waitFor(() => expect(mockConnect).toHaveBeenCalled());
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });
});

describe("revisiting a table tab", () => {
  function Tree({ visible }: { visible: boolean }) {
    return (
      <QueryClientProvider client={client}>
        <WorkspaceProvider
          tree={tree}
          initialActiveTabId="db-ppp::product"
          initialConnections={[["db-ppp", config]]}
          initialConnectionStatus={[["db-ppp", "connected"]]}
        >
          {visible ? <TableCard /> : <div>away</div>}
          <Console />
        </WorkspaceProvider>
      </QueryClientProvider>
    );
  }
  let client: QueryClient;

  beforeEach(() => {
    client = newClient();
  });

  // side-effect-contract (no refetch when returning to a table tab)
  it("should not refetch the table if the tab is left and re-entered", async () => {
    const { rerender } = render(<Tree visible />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

    rerender(<Tree visible={false} />);
    rerender(<Tree visible />);

    // give any stray remount fetch a chance to fire
    await screen.findByText("Ada");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  // behavior (history keeps exactly one entry for the single fetch across revisits)
  it("should keep a single history entry for the table if the tab is left and re-entered", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Tree visible />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

    rerender(<Tree visible={false} />);
    rerender(<Tree visible />);
    await screen.findByText("Ada");

    await user.click(screen.getByRole("tab", { name: /history/i }));
    const history = screen.getByRole("list", { name: /query history/i });
    expect(
      within(history).getAllByText(/SELECT \* FROM "product" LIMIT 200/),
    ).toHaveLength(1);
  });
});
