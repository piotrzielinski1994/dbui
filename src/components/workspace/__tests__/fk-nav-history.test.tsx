import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import {
  WorkspaceProvider,
  useWorkspace,
} from "@/components/workspace/workspace-context";
import { ContentHeader } from "@/components/workspace/content-header";
import { TableCard } from "@/components/workspace/table-card";
import {
  fetchTable,
  countTable,
  fetchTableStructure,
} from "@/lib/tauri";
import type {
  ConnectionConfig,
  TableColumn,
  TableRows,
  TableStructure,
  TreeNode,
} from "@/lib/workspace/model";

vi.mock("@/lib/tauri", () => ({
  fetchTable: vi.fn(),
  countTable: vi.fn(),
  fetchTableStructure: vi.fn(),
  applyRowMutations: vi.fn(),
  disconnectDatabase: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

const mockFetch = vi.mocked(fetchTable);
const mockCount = vi.mocked(countTable);
const mockStructure = vi.mocked(fetchTableStructure);

const ORDERS_ID = "db-ppp::public::orders";
const CUSTOMERS_ID = "db-ppp::public::customers";

const pgConfig: ConnectionConfig = {
  engine: "postgres",
  host: "localhost",
  port: 5432,
  database: "ppp",
  user: "postgres",
  password: "postgres",
};

function tableNode(id: string, name: string) {
  return {
    kind: "table" as const,
    id,
    name,
    schema: "public",
    columns: [],
    rows: [],
  };
}

const pgTree: TreeNode[] = [
  {
    kind: "database",
    id: "db-ppp",
    name: "ppp",
    accentColor: null,
    readOnly: false,
    manualCommit: false,
    engine: "postgres",
    host: "localhost",
    port: 5432,
    database: "ppp",
    user: "postgres",
    password: "postgres",
    tables: [tableNode(ORDERS_ID, "orders"), tableNode(CUSTOMERS_ID, "customers")],
    views: [],
    sql: "",
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

function column(name: string, isPrimaryKey = false): TableColumn {
  return { name, dataType: "text", nullable: true, isPrimaryKey };
}

function rowsResult(columns: string[], rows: (string | null)[][]): TableRows {
  return {
    columns: columns.map((name) => column(name, name === "id")),
    rows,
    primaryKey: "id",
  };
}

const customerFkStructure: TableStructure = {
  columns: [],
  indexes: [],
  foreignKeys: [
    {
      name: "orders_customer_fk",
      columns: ["customer_id"],
      referencedTable: "customers",
      referencedSchema: "public",
      referencedColumns: ["id"],
    },
  ],
  constraints: [],
};

function StateProbe() {
  const { activeTabId, tableFilters } = useWorkspace();
  return (
    <div>
      <span data-testid="active-tab">{activeTabId ?? ""}</span>
      <span data-testid="customers-filter">
        {tableFilters.get(CUSTOMERS_ID) ?? ""}
      </span>
    </div>
  );
}

function renderApp() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceProvider
        tree={pgTree}
        initialActiveTabId={ORDERS_ID}
        initialOpenTabIds={[ORDERS_ID]}
        initialConnections={[["db-ppp", pgConfig]]}
      >
        <StateProbe />
        <ContentHeader />
        <TableCard />
      </WorkspaceProvider>
    </QueryClientProvider>,
  );
}

const rowFor = (text: string) =>
  screen.getByText(text).closest("tr") as HTMLElement;

const goToItem = (name: string) =>
  screen.queryByRole("menuitem", { name }) ?? screen.getByText(name);

// Jump orders -> customers via the FK "Go to" item; shared setup for the back/forward assertions.
async function jumpToCustomers() {
  const user = userEvent.setup();
  mockFetch.mockResolvedValue(
    rowsResult(["id", "customer_id"], [["1", "42"]]),
  );
  mockStructure.mockResolvedValue(customerFkStructure);
  renderApp();

  const header = await screen.findByRole("columnheader", {
    name: "customer_id",
  });
  await waitFor(() => expect(header).toHaveTextContent("FK"));

  fireEvent.contextMenu(rowFor("42"));
  await user.click(goToItem("Go to customers (customer_id=42)"));

  await waitFor(() =>
    expect(screen.getByTestId("active-tab")).toHaveTextContent(CUSTOMERS_ID),
  );
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCount.mockResolvedValue(0);
});

describe("FK navigation - back/forward history", () => {
  // behavior: Back is disabled before any navigation, enabled after a jump.
  it("should disable Back until a foreign key has been navigated", async () => {
    mockFetch.mockResolvedValue(
      rowsResult(["id", "customer_id"], [["1", "42"]]),
    );
    mockStructure.mockResolvedValue(customerFkStructure);
    renderApp();
    await screen.findByRole("columnheader", { name: "customer_id" });

    expect(screen.getByRole("button", { name: "Navigate back" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Navigate forward" }),
    ).toBeDisabled();
  });

  // behavior: Back returns to the source table (orders) after an FK jump to customers.
  it("should return to the source table when Back is clicked after a jump", async () => {
    const user = await jumpToCustomers();

    const back = screen.getByRole("button", { name: "Navigate back" });
    await waitFor(() => expect(back).toBeEnabled());
    await user.click(back);

    await waitFor(() =>
      expect(screen.getByTestId("active-tab")).toHaveTextContent(ORDERS_ID),
    );
  });

  // behavior: Forward re-applies the jump (customers + its filter) after going Back.
  it("should re-open the target and re-apply its filter when Forward is clicked", async () => {
    const user = await jumpToCustomers();

    await user.click(screen.getByRole("button", { name: "Navigate back" }));
    await waitFor(() =>
      expect(screen.getByTestId("active-tab")).toHaveTextContent(ORDERS_ID),
    );

    const forward = screen.getByRole("button", { name: "Navigate forward" });
    await waitFor(() => expect(forward).toBeEnabled());
    await user.click(forward);

    await waitFor(() =>
      expect(screen.getByTestId("active-tab")).toHaveTextContent(CUSTOMERS_ID),
    );
    expect(screen.getByTestId("customers-filter")).toHaveTextContent(
      `"id" = '42'`,
    );
  });

  // behavior: Forward is disabled once at the newest entry (nothing ahead).
  it("should disable Forward at the newest history entry", async () => {
    await jumpToCustomers();
    expect(
      screen.getByRole("button", { name: "Navigate forward" }),
    ).toBeDisabled();
  });
});
