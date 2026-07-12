import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { TableCard } from "@/components/workspace/table-card";
import { Console } from "@/components/workspace/console";
import { fetchTable, countTable } from "@/lib/tauri";
import type {
  ConnectionConfig,
  TableColumn,
  TableRows,
  TreeNode,
} from "@/lib/workspace/model";

// Same live harness as read-only-table.test.tsx: the Tauri boundary is mocked; TableCard + DataGrid +
// WorkspaceProvider are the real system. The Mock Data dialog is opened via the provider's
// initialMockDataOpen seed (mirrors initialJsonView), so the test drives the dialog directly without
// going through the command palette.
vi.mock("@/lib/tauri", () => ({
  fetchTable: vi.fn(),
  countTable: vi.fn(),
  applyRowMutations: vi.fn(),
  fetchTableStructure: vi.fn().mockResolvedValue({
    columns: [],
    indexes: [],
    foreignKeys: [],
    constraints: [],
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const mockFetch = vi.mocked(fetchTable);
const mockCount = vi.mocked(countTable);

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

function tree(engine: "postgres" | "mongodb", readOnly: boolean): TreeNode[] {
  const isMongo = engine === "mongodb";
  return [
    {
      kind: "database",
      accentColor: null,
      readOnly,
      id: "db-1",
      name: isMongo ? "shop" : "ppp",
      engine,
      host: isMongo ? "localhost" : "localhost",
      port: isMongo ? 27017 : 5432,
      database: isMongo ? "shop" : "ppp",
      user: isMongo ? "root" : "postgres",
      password: isMongo ? "root" : "postgres",
      tables: [
        {
          kind: "table",
          id: "db-1::users",
          name: "users",
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
    } as unknown as TreeNode,
  ];
}

function column(name: string, overrides?: Partial<TableColumn>): TableColumn {
  return {
    name,
    dataType: overrides?.dataType ?? "text",
    nullable: overrides?.nullable ?? true,
    isPrimaryKey: overrides?.isPrimaryKey ?? false,
  };
}

function rowsResult(primaryKey: string | null = "id"): TableRows {
  return {
    columns: [
      column("id", { dataType: "int8", isPrimaryKey: primaryKey === "id" }),
      column("email", { dataType: "varchar" }),
      column("active", { dataType: "bool" }),
    ],
    rows: [["1", "ada@example.com", "true"]],
    primaryKey,
  };
}

function renderLive(opts: {
  engine?: "postgres" | "mongodb";
  readOnly?: boolean;
  primaryKey?: string | null;
}) {
  const engine = opts.engine ?? "postgres";
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceProvider
        tree={tree(engine, opts.readOnly ?? false)}
        initialActiveTabId="db-1::users"
        initialConnections={[["db-1", engine === "mongodb" ? mongoConfig : pgConfig]]}
        initialMockDataOpen
      >
        <TableCard />
        <Console />
      </WorkspaceProvider>
    </QueryClientProvider>,
  );
}

function mockDialog(): HTMLElement {
  return screen.getByRole("dialog", { name: /mock data/i });
}

function insertButton(): HTMLElement {
  return within(mockDialog()).getByRole("button", { name: /^insert/i });
}

// The dialog holds two <table>s: the column-config table (its header includes "strategy") and, once
// Preview is clicked, the shared read-only DataGrid preview. Pick the one that is NOT the config
// table.
function previewGrid(dialog: HTMLElement): HTMLElement {
  const tables = within(dialog).getAllByRole("table");
  const grid = tables.find(
    (table) => !table.textContent?.toLowerCase().includes("strategy"),
  );
  if (!grid) {
    throw new Error("preview grid not found");
  }
  return grid;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCount.mockResolvedValue(0);
});

describe("Mock data dialog (AC-002)", () => {
  // AC-002, TC-001 - behavior: the dialog lists every column of the open table.
  it("should list every column of the open table", async () => {
    mockFetch.mockResolvedValue(rowsResult("id"));
    renderLive({});

    const dialog = await screen.findByRole("dialog", { name: /mock data/i });
    for (const name of ["id", "email", "active"]) {
      expect(within(dialog).getByText(name)).toBeInTheDocument();
    }
  });

  // AC-002/AC-010 - behavior: each column exposes a strategy control (one per column).
  it("should render a strategy selector per column", async () => {
    mockFetch.mockResolvedValue(rowsResult("id"));
    renderLive({});

    const dialog = await screen.findByRole("dialog", { name: /mock data/i });
    const selectors = within(dialog).getAllByRole("combobox");
    expect(selectors.length).toBeGreaterThanOrEqual(3);
  });
});

describe("Mock data dialog preview (AC-005)", () => {
  // AC-005, TC-004 - behavior: Preview renders the generated sample rows in a grid inside the dialog.
  it("should render a preview grid of generated rows when Preview is clicked", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(rowsResult("id"));
    renderLive({});

    const dialog = await screen.findByRole("dialog", { name: /mock data/i });

    const countInput = within(dialog).getByLabelText(/rows/i);
    await user.clear(countInput);
    await user.type(countInput, "5");
    await user.click(within(dialog).getByRole("button", { name: /^preview/i }));

    // A preview grid appears (the shared DataGrid) in addition to the always-present config table.
    // The config table has 3 columns + 1 header row; the preview grid has one row per generated row
    // (a sequence PK id is deterministic: 1..5 for start=1).
    await waitFor(() => {
      expect(within(dialog).getAllByRole("table")).toHaveLength(2);
    });
    const grid = previewGrid(dialog);
    const bodyRows = within(grid).getAllByRole("row").slice(1);
    expect(bodyRows).toHaveLength(5);
    // The sequence PK id is deterministic (start=1): the body cells hold 1..5 in order.
    const idCells = bodyRows.map(
      (row) => within(row).getAllByRole("cell")[0]?.textContent,
    );
    expect(idCells).toEqual(["1", "2", "3", "4", "5"]);
  });

  // AC-005 - behavior: Regenerate re-rolls the seed and re-previews (still deterministic per seed,
  // so the grid still shows a full sample - not a crash / empty state).
  it("should re-preview a fresh sample when Regenerate is clicked", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(rowsResult("id"));
    renderLive({});

    const dialog = await screen.findByRole("dialog", { name: /mock data/i });
    const countInput = within(dialog).getByLabelText(/rows/i);
    await user.clear(countInput);
    await user.type(countInput, "3");

    await user.click(within(dialog).getByRole("button", { name: /regenerate/i }));

    await waitFor(() => {
      expect(within(dialog).getAllByRole("table")).toHaveLength(2);
    });
    expect(
      within(previewGrid(dialog)).getAllByRole("row").slice(1),
    ).toHaveLength(3);
  });
});

describe("Mock data dialog staging (AC-007)", () => {
  // AC-007, TC-006 - side-effect-contract: Insert stages one insert pending edit per generated row,
  // visible as a SQL preview in the Changes tab, and the dialog closes.
  it("should stage one insert pending edit per generated row when Insert is clicked", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(rowsResult("id"));
    renderLive({});

    await screen.findByRole("dialog", { name: /mock data/i });

    const countInput = within(mockDialog()).getByLabelText(/rows/i);
    await user.clear(countInput);
    await user.type(countInput, "3");

    await user.click(insertButton());

    // Dialog closes after staging.
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: /mock data/i }),
      ).not.toBeInTheDocument();
    });

    // Changes tab shows the staged INSERTs.
    await user.click(screen.getByRole("tab", { name: /changes/i }));
    const changes = screen.getByRole("list", { name: /pending changes/i });
    // SqlText splits each statement across per-token spans, so match on each row's textContent.
    const inserts = within(changes)
      .getAllByRole("listitem")
      .filter((node) => /INSERT\s+INTO/i.test(node.textContent ?? ""));
    expect(inserts).toHaveLength(3);
  });
});

describe("Mock data dialog read-only / no-PK gate (AC-008)", () => {
  // AC-008, TC-007 - behavior: a read-only database disables Insert (no staging possible).
  it("should disable Insert when the database is read-only", async () => {
    mockFetch.mockResolvedValue(rowsResult("id"));
    renderLive({ readOnly: true });

    await screen.findByRole("dialog", { name: /mock data/i });
    expect(insertButton()).toBeDisabled();
  });

  // AC-008 - behavior: a table with no primary key disables Insert.
  it("should disable Insert when the table has no primary key", async () => {
    mockFetch.mockResolvedValue(rowsResult(null));
    renderLive({ primaryKey: null });

    await screen.findByRole("dialog", { name: /mock data/i });
    expect(insertButton()).toBeDisabled();
  });

  // AC-005/AC-008 - behavior: a writable PK table enables Insert (the gate is the flag, not a
  // permanently-disabled button).
  it("should enable Insert for a writable table with a primary key", async () => {
    mockFetch.mockResolvedValue(rowsResult("id"));
    renderLive({});

    await screen.findByRole("dialog", { name: /mock data/i });
    expect(insertButton()).toBeEnabled();
  });
});

describe("Mock data dialog on MongoDB (AC-009)", () => {
  // AC-009, TC-008 - side-effect-contract: a mongo collection stages insertOne-shaped inserts.
  it("should stage insertOne-shaped inserts for a mongo collection", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(rowsResult("_id"));
    renderLive({ engine: "mongodb", primaryKey: "_id" });

    await screen.findByRole("dialog", { name: /mock data/i });

    const countInput = within(mockDialog()).getByLabelText(/rows/i);
    await user.clear(countInput);
    await user.type(countInput, "2");
    await user.click(insertButton());

    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: /mock data/i }),
      ).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("tab", { name: /changes/i }));
    const changes = screen.getByRole("list", { name: /pending changes/i });
    // SqlText splits the command across per-token spans, so match on each row's textContent.
    const inserts = within(changes)
      .getAllByRole("listitem")
      .filter((node) => /insertOne\(/i.test(node.textContent ?? ""));
    expect(inserts.length).toBeGreaterThanOrEqual(2);
  });
});
