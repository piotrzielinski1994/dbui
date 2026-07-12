import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import {
  WorkspaceProvider,
  useWorkspace,
} from "@/components/workspace/workspace-context";
import { TableCard } from "@/components/workspace/table-card";
import { toast } from "sonner";
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
const mockToast = vi.mocked(toast);

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

const mongoConfig: ConnectionConfig = {
  engine: "mongodb",
  host: "localhost",
  port: 27017,
  database: "shop",
  user: "root",
  password: "root",
};

// A Postgres database with an `orders` table (active) whose customer_id -> customers.id FK targets a
// `customers` table that IS loaded in the tree, so navigation can resolve its node.
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
    tables: [
      {
        kind: "table",
        id: ORDERS_ID,
        name: "orders",
        schema: "public",
        columns: [],
        rows: [],
      },
      {
        kind: "table",
        id: CUSTOMERS_ID,
        name: "customers",
        schema: "public",
        columns: [],
        rows: [],
      },
    ],
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

const mongoTree: TreeNode[] = [
  {
    kind: "database",
    id: "db-mongo",
    name: "shop",
    accentColor: null,
    readOnly: false,
    manualCommit: false,
    engine: "mongodb",
    host: "localhost",
    port: 27017,
    database: "shop",
    user: "root",
    password: "root",
    tables: [
      {
        kind: "table",
        id: "db-mongo::::customers",
        name: "customers",
        schema: null,
        columns: [],
        rows: [],
      },
    ],
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

function column(name: string, overrides?: Partial<TableColumn>): TableColumn {
  return {
    name,
    dataType: overrides?.dataType ?? "text",
    nullable: overrides?.nullable ?? true,
    isPrimaryKey: overrides?.isPrimaryKey ?? false,
  };
}

function rowsResult(
  columns: (string | TableColumn)[],
  rows: (string | null)[][],
  primaryKey: string | null = "id",
): TableRows {
  return {
    columns: columns.map((col) =>
      typeof col === "string"
        ? column(col, { isPrimaryKey: col === primaryKey })
        : col,
    ),
    rows,
    primaryKey,
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

// Reads the observable navigation state from the provider: which tab is active and the applied filter
// for the customers table, so the test asserts real behaviour (openNode + setTableFilter) not internals.
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

function renderPg() {
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
        <TableCard />
      </WorkspaceProvider>
    </QueryClientProvider>,
  );
}

function renderMongo() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceProvider
        tree={mongoTree}
        initialActiveTabId="db-mongo::::customers"
        initialOpenTabIds={["db-mongo::::customers"]}
        initialConnections={[["db-mongo", mongoConfig]]}
      >
        <TableCard />
      </WorkspaceProvider>
    </QueryClientProvider>,
  );
}

const rowFor = (text: string) =>
  screen.getByText(text).closest("tr") as HTMLElement;

const goToItem = (name: string) =>
  screen.queryByRole("menuitem", { name }) ?? screen.getByText(name);

beforeEach(() => {
  vi.clearAllMocks();
  mockCount.mockResolvedValue(0);
});

describe("FK navigation - row menu item", () => {
  // AC-001, TC-001 - behavior: a row whose FK column value is non-null shows a "Go to <table> (col=value)"
  // menu item.
  it("should show a Go to item for a row with a non-null foreign-key value", async () => {
    mockFetch.mockResolvedValue(
      rowsResult(["id", "customer_id"], [["1", "42"], ["2", null]], "id"),
    );
    mockStructure.mockResolvedValue(customerFkStructure);
    renderPg();

    // Wait for the structure (and so the FK data) to load - the header FK marker proves it.
    const header = await screen.findByRole("columnheader", {
      name: "customer_id",
    });
    await waitFor(() => expect(header).toHaveTextContent("FK"));

    fireEvent.contextMenu(rowFor("42"));

    expect(goToItem("Go to customers (customer_id=42)")).toBeInTheDocument();
  });

  // AC-004, TC-003 - behavior: a row whose FK value is NULL shows no "Go to" item.
  it("should show no Go to item for a row with a null foreign-key value", async () => {
    mockFetch.mockResolvedValue(
      rowsResult(["id", "customer_id"], [["1", "42"], ["2", null]], "id"),
    );
    mockStructure.mockResolvedValue(customerFkStructure);
    renderPg();

    const header = await screen.findByRole("columnheader", {
      name: "customer_id",
    });
    await waitFor(() => expect(header).toHaveTextContent("FK"));

    // Right-click the null row (id = 2); its customer_id is [NULL].
    fireEvent.contextMenu(rowFor("2"));

    expect(screen.queryByText(/^Go to /)).toBeNull();
  });

  // AC-005, TC-004 - behavior: the FK local column is marked FK in its grid header subtext.
  it("should mark the foreign-key column with FK in the header", async () => {
    mockFetch.mockResolvedValue(
      rowsResult(["id", "customer_id"], [["1", "42"]], "id"),
    );
    mockStructure.mockResolvedValue(customerFkStructure);
    renderPg();

    const header = await screen.findByRole("columnheader", {
      name: "customer_id",
    });
    await waitFor(() => expect(header).toHaveTextContent("FK"));
  });
});

describe("FK navigation - selecting the item", () => {
  // AC-002 - behavior: selecting the FK item opens/re-activates the referenced tab AND applies the WHERE
  // filter pinning the referenced row.
  it("should open the customers tab and apply the pinning filter when the Go to item is selected", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(
      rowsResult(["id", "customer_id"], [["1", "42"], ["2", null]], "id"),
    );
    mockStructure.mockResolvedValue(customerFkStructure);
    renderPg();

    expect(screen.getByTestId("active-tab")).toHaveTextContent(ORDERS_ID);

    const header = await screen.findByRole("columnheader", {
      name: "customer_id",
    });
    await waitFor(() => expect(header).toHaveTextContent("FK"));

    fireEvent.contextMenu(rowFor("42"));
    await user.click(goToItem("Go to customers (customer_id=42)"));

    await waitFor(() => {
      expect(screen.getByTestId("active-tab")).toHaveTextContent(CUSTOMERS_ID);
    });
    expect(screen.getByTestId("customers-filter")).toHaveTextContent(
      `"id" = '42'`,
    );
  });

  // AC-006, TC-005 - behavior: selecting an FK whose target table is not loaded toasts an error and does
  // NOT change the active tab.
  it("should error-toast and not navigate when the target table is not loaded", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(
      rowsResult(["id", "region_id"], [["1", "7"]], "id"),
    );
    mockStructure.mockResolvedValue({
      columns: [],
      indexes: [],
      foreignKeys: [
        {
          name: "orders_region_fk",
          columns: ["region_id"],
          referencedTable: "regions",
          referencedSchema: "public",
          referencedColumns: ["id"],
        },
      ],
      constraints: [],
    });
    renderPg();

    const header = await screen.findByRole("columnheader", {
      name: "region_id",
    });
    await waitFor(() => expect(header).toHaveTextContent("FK"));

    fireEvent.contextMenu(rowFor("7"));
    await user.click(goToItem("Go to regions (region_id=7)"));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith(
        expect.stringMatching(/regions.*not loaded/i),
      );
    });
    expect(screen.getByTestId("active-tab")).toHaveTextContent(ORDERS_ID);
  });
});

describe("FK navigation - clickable link cell", () => {
  // behavior: an FK cell renders its value as a link affordance (data-fk-link) so the user sees it is
  // navigable.
  it("should render a non-null foreign-key value as a link", async () => {
    mockFetch.mockResolvedValue(
      rowsResult(["id", "customer_id"], [["1", "42"], ["2", null]], "id"),
    );
    mockStructure.mockResolvedValue(customerFkStructure);
    renderPg();

    const link = await screen.findByTestId("fk-link-customer_id-0");
    expect(link).toHaveTextContent("42");
  });

  // behavior: a NULL FK value is NOT a link (nothing to navigate to).
  it("should not render a link for a null foreign-key value", async () => {
    mockFetch.mockResolvedValue(
      rowsResult(["id", "customer_id"], [["1", "42"], ["2", null]], "id"),
    );
    mockStructure.mockResolvedValue(customerFkStructure);
    renderPg();

    await screen.findByTestId("fk-link-customer_id-0");
    expect(screen.queryByTestId("fk-link-customer_id-1")).toBeNull();
  });

  // AC-013 - behavior: Cmd/Ctrl+click on an FK link navigates to the referenced table + filter.
  it("should navigate to the referenced table when the link is Cmd/Ctrl-clicked", async () => {
    mockFetch.mockResolvedValue(
      rowsResult(["id", "customer_id"], [["1", "42"], ["2", null]], "id"),
    );
    mockStructure.mockResolvedValue(customerFkStructure);
    renderPg();

    expect(screen.getByTestId("active-tab")).toHaveTextContent(ORDERS_ID);
    const link = await screen.findByTestId("fk-link-customer_id-0");

    fireEvent.click(link, { metaKey: true });

    await waitFor(() =>
      expect(screen.getByTestId("active-tab")).toHaveTextContent(CUSTOMERS_ID),
    );
    expect(screen.getByTestId("customers-filter")).toHaveTextContent(
      `"id" = '42'`,
    );
  });

  // AC-013 - behavior: a PLAIN click on an FK link does NOT navigate (only the modifier does, so a
  // plain click still selects the row like any cell).
  it("should not navigate on a plain click of an FK link", async () => {
    mockFetch.mockResolvedValue(
      rowsResult(["id", "customer_id"], [["1", "42"], ["2", null]], "id"),
    );
    mockStructure.mockResolvedValue(customerFkStructure);
    renderPg();

    const link = await screen.findByTestId("fk-link-customer_id-0");
    fireEvent.click(link);

    expect(screen.getByTestId("active-tab")).toHaveTextContent(ORDERS_ID);
  });
});

describe("FK navigation - MongoDB", () => {
  // AC-007, TC-006 - behavior: a MongoDB collection has no foreign keys, so no Go to item and no FK
  // header marker appear.
  it("should show no Go to item and no FK marker for a MongoDB collection", async () => {
    mockFetch.mockResolvedValue(
      rowsResult(["_id", "name"], [["a1", "Ada"]], "_id"),
    );
    mockStructure.mockResolvedValue({
      columns: [],
      indexes: [],
      foreignKeys: [],
      constraints: [],
    });
    renderMongo();

    const nameHeader = await screen.findByRole("columnheader", {
      name: "name",
    });
    expect(nameHeader).not.toHaveTextContent("FK");

    fireEvent.contextMenu(rowFor("Ada"));
    expect(screen.queryByText(/^Go to /)).toBeNull();
  });
});
