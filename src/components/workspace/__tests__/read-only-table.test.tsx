import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
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

// Same live harness as row-mutations.test.tsx: the Tauri boundary is mocked, TableCard + DataGrid +
// WorkspaceProvider are the real system. The one difference is the database node carries the F11
// `readOnly` flag, which must force the `editable` gate off (identical to the no-PK path).
vi.mock("@/lib/tauri", () => ({
  fetchTable: vi.fn(),
  countTable: vi.fn(),
  applyRowMutations: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const mockFetch = vi.mocked(fetchTable);
const mockCount = vi.mocked(countTable);

const config: ConnectionConfig = {
  engine: "postgres",
  host: "localhost",
  port: 5432,
  database: "ppp",
  user: "postgres",
  password: "postgres",
};

// `readOnly` is spread via a cast because the runtime DatabaseNode type may not declare it until the
// field lands; the gate behaviour is what these tests observe.
function connectedTree(readOnly: boolean): TreeNode[] {
  return [
    {
      kind: "database",
      accentColor: null,
      readOnly,
      id: "db-ppp",
      name: "ppp",
      engine: "postgres",
      host: "localhost",
      port: 5432,
      database: "ppp",
      user: "postgres",
      password: "postgres",
      tables: [
        {
          kind: "table",
          id: "db-ppp::users",
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

function renderLive(readOnly: boolean, initialJsonView = false) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceProvider
        tree={connectedTree(readOnly)}
        initialActiveTabId="db-ppp::users"
        initialConnections={[["db-ppp", config]]}
        initialJsonView={initialJsonView}
      >
        <TableCard />
        <Console />
      </WorkspaceProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCount.mockResolvedValue(0);
});

function column(name: string, overrides?: Partial<TableColumn>): TableColumn {
  return {
    name,
    dataType: overrides?.dataType ?? "text",
    nullable: overrides?.nullable ?? true,
    isPrimaryKey: overrides?.isPrimaryKey ?? false,
  };
}

function rowsResult(
  columns: string[],
  rows: (string | null)[][],
  primaryKey: string | null = "id",
): TableRows {
  return {
    columns: columns.map((col) =>
      column(col, { isPrimaryKey: col === primaryKey }),
    ),
    rows,
    primaryKey,
  };
}

function grid() {
  return screen.getByRole("table");
}

function gridRows() {
  return within(grid()).getAllByRole("row").slice(1);
}

describe("Read-only table gate (AC-003, TC-001)", () => {
  // AC-003, TC-001 - behavior (a read-only database with a PK table exposes NO Add row control,
  // even though a writable PK table does - so the absence is the gate, not a missing feature).
  it("should not render the Add row control when the database is read-only", async () => {
    mockFetch.mockResolvedValueOnce(rowsResult(["id", "name"], [["1", "Ada"]], "id"));
    const writable = renderLive(false);
    await screen.findByText("Ada");
    expect(
      screen.getByRole("button", { name: /add row/i }),
    ).toBeInTheDocument();
    writable.unmount();

    mockFetch.mockResolvedValue(rowsResult(["id", "name"], [["1", "Ada"]], "id"));
    renderLive(true);

    await screen.findByText("Ada");
    expect(screen.queryByRole("button", { name: /add row/i })).toBeNull();
  });

  // AC-003, TC-001 - behavior (a read-only database offers no Delete / Clone row menu on right-click,
  // where a writable PK table does)
  it("should not open a Delete or Clone row menu when the database is read-only", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce(rowsResult(["id", "name"], [["1", "Ada"]], "id"));
    const writable = renderLive(false);
    await screen.findByText("Ada");
    fireEvent.contextMenu(gridRows()[0]);
    expect(
      await screen.findByRole("menuitem", { name: /^delete/i }),
    ).toBeInTheDocument();
    await user.keyboard("{Escape}");
    writable.unmount();

    mockFetch.mockResolvedValue(rowsResult(["id", "name"], [["1", "Ada"]], "id"));
    renderLive(true);

    await screen.findByText("Ada");
    fireEvent.contextMenu(gridRows()[0]);

    expect(screen.queryByRole("menuitem", { name: /^delete/i })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /clone/i })).toBeNull();
  });

  // AC-003, TC-001 - behavior (double-clicking a cell in a read-only database does NOT enter edit
  // mode, so no editable input appears; a writable table does open one)
  it("should not enter cell edit mode on double-click when the database is read-only", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce(rowsResult(["id", "name"], [["1", "Ada"]], "id"));
    const writable = renderLive(false);
    await user.dblClick(await screen.findByText("Ada"));
    expect(screen.getByDisplayValue("Ada")).toBeInTheDocument();
    writable.unmount();

    mockFetch.mockResolvedValue(rowsResult(["id", "name"], [["1", "Ada"]], "id"));
    renderLive(true);

    await user.dblClick(await screen.findByText("Ada"));

    expect(screen.queryByDisplayValue("Ada")).toBeNull();
  });

  // AC-003 - behavior (the JSON view is a non-editable viewer for a read-only database, where a
  // writable table's JSON view is contenteditable - the flag flips the JSON editor to read-only).
  it("should render the JSON view non-editable when the database is read-only", async () => {
    mockFetch.mockResolvedValueOnce(rowsResult(["id", "name"], [["1", "Ada"]], "id"));
    const writable = renderLive(false, true);
    await waitFor(() => {
      expect(
        screen.getByRole("textbox", { name: /rows as json/i }),
      ).toHaveAttribute("contenteditable", "true");
    });
    writable.unmount();

    mockFetch.mockResolvedValue(rowsResult(["id", "name"], [["1", "Ada"]], "id"));
    renderLive(true, true);

    await waitFor(() => {
      expect(
        screen.getByRole("textbox", { name: /rows as json/i }),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByRole("textbox", { name: /rows as json/i }),
    ).toHaveAttribute("contenteditable", "false");
  });
});

describe("Read-only OFF keeps writes (AC-005, TC-004)", () => {
  // AC-005, TC-004 - behavior (a writable database still exposes the Add row control - no regression)
  it("should still render the Add row control when the database is not read-only", async () => {
    mockFetch.mockResolvedValue(rowsResult(["id", "name"], [["1", "Ada"]], "id"));
    renderLive(false);

    await screen.findByText("Ada");
    expect(
      screen.getByRole("button", { name: /add row/i }),
    ).toBeInTheDocument();
  });
});
