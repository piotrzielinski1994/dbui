import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  within,
  fireEvent,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { TableCard } from "@/components/workspace/table-card";
import { Console } from "@/components/workspace/console";
import { toast } from "sonner";
import { fetchTable, countTable, applyRowMutations } from "@/lib/tauri";
import type {
  ConnectionConfig,
  TableColumn,
  TableRows,
  TreeNode,
} from "@/lib/workspace/model";

// The Tauri boundary is mocked; everything else (TableCard, DataGrid, Console,
// WorkspaceProvider) is the real system under test. `applyRowMutations` is the new
// batched command that replaces `update_table` (spec "Data model" / AC-005).
vi.mock("@/lib/tauri", () => ({
  fetchTable: vi.fn(),
  countTable: vi.fn(),
  applyRowMutations: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const mockFetch = vi.mocked(fetchTable);
const mockCount = vi.mocked(countTable);
const mockApply = vi.mocked(applyRowMutations);
const mockToast = vi.mocked(toast);

const config: ConnectionConfig = {
  engine: "postgres",
  host: "localhost",
  port: 5432,
  database: "ppp",
  user: "postgres",
  password: "postgres",
};

const connectedTree: TreeNode[] = [
  {
    kind: "database",
    accentColor: null,
    readOnly: false,
    manualCommit: false,
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
  },
];

function renderLive() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceProvider
        tree={connectedTree}
        initialActiveTabId="db-ppp::users"
        initialConnections={[["db-ppp", config]]}
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

// The data grid is one <table>; scope row/cell queries to it so the footer/Changes
// list text doesn't collide with grid text.
function grid() {
  return screen.getByRole("table");
}

function gridRows() {
  // skip the header row
  return within(grid()).getAllByRole("row").slice(1);
}

describe("Row mutations - insert (AC-001, TC-001)", () => {
  // behavior (a "+ Add row" control appends an editable draft row)
  it("should append an editable draft row when Add row is clicked", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(
      rowsResult(["id", "name"], [["1", "Ada"]], "id"),
    );
    renderLive();

    await screen.findByText("Ada");
    expect(gridRows()).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: /add row/i }));

    // a new (empty) row is appended below the saved one
    await waitFor(() => {
      expect(gridRows()).toHaveLength(2);
    });
  });

  // behavior (typing into a draft cell stages a pending insert + bumps the footer count)
  it("should stage a pending insert and show the footer count when a draft cell is typed", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(
      rowsResult(["id", "name"], [["1", "Ada"]], "id"),
    );
    renderLive();

    await screen.findByText("Ada");
    await user.click(screen.getByRole("button", { name: /add row/i }));

    const draftRow = gridRows()[1];
    const nameCell = within(draftRow).getAllByRole("cell")[1];
    await user.dblClick(nameCell);
    const input = within(draftRow).getByDisplayValue("");
    await user.type(input, "Dee");
    await user.keyboard("{Enter}");

    expect(screen.getByText(/1 pending/i)).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: /changes \(1\)/i }),
    ).toBeInTheDocument();
  });
});

describe("Row mutations - clone (AC-002, TC-002)", () => {
  // behavior (right-click -> Clone appends a draft pre-filled with the row's values, PK empty)
  it("should append a draft pre-filled from the row with the primary-key cell empty when Clone is selected", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(
      rowsResult(
        ["id", "name", "email"],
        [["1", "Ada", "ada@example.com"]],
        "id",
      ),
    );
    renderLive();

    await screen.findByText("Ada");
    const sourceRow = gridRows()[0];
    fireEvent.contextMenu(sourceRow);

    await user.click(
      await screen.findByRole("menuitem", { name: /clone/i }),
    );

    await waitFor(() => {
      expect(gridRows()).toHaveLength(2);
    });
    const draftRow = gridRows()[1];
    const cells = within(draftRow).getAllByRole("cell");
    // name + email copied from the source row
    expect(draftRow).toHaveTextContent("Ada");
    expect(draftRow).toHaveTextContent("ada@example.com");
    // the PK column (first cell, "id") is left empty so the DB assigns it
    expect(cells[0]).not.toHaveTextContent("1");
  });
});

describe("Row mutations - delete + undo (AC-003, TC-003, TC-004)", () => {
  // behavior (right-click -> Delete strikes through the row in place; Undo restores it)
  it("should strike through the row on Delete and restore it on Undo delete", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(
      rowsResult(
        ["id", "name"],
        [
          ["1", "Ada"],
          ["2", "Bo"],
        ],
        "id",
      ),
    );
    renderLive();

    await screen.findByText("Bo");
    const target = gridRows()[1];
    fireEvent.contextMenu(target);
    await user.click(await screen.findByRole("menuitem", { name: /^delete/i }));

    // the row is still present but visually struck-through / dimmed
    await waitFor(() => {
      const deleted = gridRows()[1];
      expect(deleted).toHaveTextContent("Bo");
      expect(deleted.className).toMatch(/line-through|opacity/);
    });

    const deleted = gridRows()[1];
    fireEvent.contextMenu(deleted);
    await user.click(
      await screen.findByRole("menuitem", { name: /undo delete/i }),
    );

    await waitFor(() => {
      const restored = gridRows()[1];
      expect(restored.className).not.toMatch(/line-through/);
    });
  });

  // behavior (deleting a row that has a pending cell edit drops that cell edit)
  it("should drop the row's pending cell edit when the row is deleted", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(
      rowsResult(["id", "name"], [["1", "Ada"]], "id"),
    );
    renderLive();

    await user.dblClick(await screen.findByText("Ada"));
    const input = screen.getByDisplayValue("Ada");
    await user.clear(input);
    await user.type(input, "Adah");
    await user.keyboard("{Enter}");

    // one pending cell edit so far
    expect(
      screen.getByRole("tab", { name: /changes \(1\)/i }),
    ).toBeInTheDocument();

    const target = gridRows()[0];
    fireEvent.contextMenu(target);
    await user.click(await screen.findByRole("menuitem", { name: /^delete/i }));

    // the cell edit is gone; only the delete mutation remains for that row
    await waitFor(() => {
      expect(
        screen.getByRole("tab", { name: /changes \(1\)/i }),
      ).toBeInTheDocument();
    });
    const changes = screen.getByRole("list", { name: /pending changes/i });
    expect(changes).toHaveTextContent(/DELETE FROM "users"/i);
    expect(changes).not.toHaveTextContent(/UPDATE "users"/i);
  });
});

describe("Row mutations - Changes tab previews (AC-004, TC-005)", () => {
  // behavior (insert + delete each render a SQL preview; per-row X discards just that one)
  it("should render an INSERT and a DELETE preview and discard one with its X", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(
      rowsResult(["id", "name"], [["1", "Ada"]], "id"),
    );
    renderLive();

    await screen.findByText("Ada");

    // stage a delete on row 1
    fireEvent.contextMenu(gridRows()[0]);
    await user.click(await screen.findByRole("menuitem", { name: /^delete/i }));

    // stage an insert via Add row + typing
    await user.click(screen.getByRole("button", { name: /add row/i }));
    const draftRow = gridRows().at(-1)!;
    await user.dblClick(within(draftRow).getAllByRole("cell")[1]);
    const input = within(draftRow).getByDisplayValue("");
    await user.type(input, "Dee");
    await user.keyboard("{Enter}");

    const changes = screen.getByRole("list", { name: /pending changes/i });
    expect(changes).toHaveTextContent(/INSERT INTO "users"/i);
    expect(changes).toHaveTextContent(/DELETE FROM "users" WHERE "id" = '1'/i);
    expect(within(changes).getAllByRole("listitem")).toHaveLength(2);

    // discard the insert specifically; the delete survives
    await user.click(
      within(changes).getByRole("button", { name: /discard.*insert/i }),
    );

    await waitFor(() => {
      expect(within(changes).getAllByRole("listitem")).toHaveLength(1);
    });
    expect(changes).toHaveTextContent(/DELETE FROM "users"/i);
    expect(changes).not.toHaveTextContent(/INSERT INTO "users"/i);
  });
});

describe("Row mutations - Save (AC-005, TC-006)", () => {
  // side-effect-contract (Save sends one batched call with all mutations, then reports the count)
  it("should call applyRowMutations with the insert and delete mutations on Save", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(
      rowsResult(["id", "name"], [["1", "Ada"]], "id"),
    );
    mockApply.mockResolvedValue(2);
    renderLive();

    await screen.findByText("Ada");

    fireEvent.contextMenu(gridRows()[0]);
    await user.click(await screen.findByRole("menuitem", { name: /^delete/i }));

    await user.click(screen.getByRole("button", { name: /add row/i }));
    const draftRow = gridRows().at(-1)!;
    await user.dblClick(within(draftRow).getAllByRole("cell")[1]);
    const input = within(draftRow).getByDisplayValue("");
    await user.type(input, "Dee");
    await user.keyboard("{Enter}");

    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(mockApply).toHaveBeenCalledTimes(1);
    });
    const [, table, mutations] = mockApply.mock.calls[0];
    expect(table).toBe("users");
    expect(mutations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "delete", pkValue: "1" }),
        expect.objectContaining({
          kind: "insert",
          values: expect.objectContaining({ name: "Dee" }),
        }),
      ]),
    );
    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledWith("Saved 2 change(s)");
    });
  });

  // behavior (a resolved Save clears the table's pending mutations)
  it("should clear the pending mutations after Save resolves", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(
      rowsResult(["id", "name"], [["1", "Ada"]], "id"),
    );
    mockApply.mockResolvedValue(1);
    renderLive();

    await screen.findByText("Ada");
    fireEvent.contextMenu(gridRows()[0]);
    await user.click(await screen.findByRole("menuitem", { name: /^delete/i }));

    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalled();
    });
    expect(screen.queryByRole("button", { name: /^save$/i })).toBeNull();
    expect(screen.queryByRole("tab", { name: /changes \(\d+\)/i })).toBeNull();
  });

  // behavior (a delete/insert changes the total, so Save must refetch the unbounded count)
  it("should refetch the row count after Save since a delete changes the total", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(
      rowsResult(["id", "name"], [["1", "Ada"]], "id"),
    );
    mockApply.mockResolvedValue(1);
    renderLive();

    await screen.findByText("Ada");
    await waitFor(() => {
      expect(mockCount).toHaveBeenCalledTimes(1);
    });

    fireEvent.contextMenu(gridRows()[0]);
    await user.click(await screen.findByRole("menuitem", { name: /^delete/i }));
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(mockCount).toHaveBeenCalledTimes(2);
    });
  });

  // behavior (a saved mutation is logged to History, like a SELECT is)
  it("should log each saved mutation to the History tab", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(
      rowsResult(["id", "name"], [["1", "Ada"]], "id"),
    );
    mockApply.mockResolvedValue(1);
    renderLive();

    await screen.findByText("Ada");

    await user.click(screen.getByRole("button", { name: /add row/i }));
    const draftRow = gridRows().at(-1)!;
    await user.dblClick(within(draftRow).getAllByRole("cell")[1]);
    const input = within(draftRow).getByDisplayValue("");
    await user.type(input, "Dee");
    await user.keyboard("{Enter}");

    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalled();
    });
    const historyList = screen.getByRole("list", { name: /query history/i });
    expect(historyList).toHaveTextContent(/INSERT INTO "users"/i);
  });
});

describe("Row mutations - empty draft dropped on Save (AC-006, TC-008)", () => {
  // behavior (an untouched draft row is not sent in the Save payload)
  it("should exclude an untouched draft row from the Save payload", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(
      rowsResult(["id", "name"], [["1", "Ada"]], "id"),
    );
    mockApply.mockResolvedValue(1);
    renderLive();

    await screen.findByText("Ada");

    // a real, typed insert
    await user.click(screen.getByRole("button", { name: /add row/i }));
    const firstDraft = gridRows().at(-1)!;
    await user.dblClick(within(firstDraft).getAllByRole("cell")[1]);
    const input = within(firstDraft).getByDisplayValue("");
    await user.type(input, "Dee");
    await user.keyboard("{Enter}");

    // a second, untouched draft
    await user.click(screen.getByRole("button", { name: /add row/i }));

    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(mockApply).toHaveBeenCalledTimes(1);
    });
    const mutations = mockApply.mock.calls[0][2];
    const inserts = mutations.filter((m) => m.kind === "insert");
    expect(inserts).toHaveLength(1);
  });
});

describe("Row mutations - no primary key gating (AC-008, TC-010)", () => {
  // behavior (no PK -> no "+ Add row" control). The precondition - a PK table DOES expose
  // the control - keeps this red until the feature exists, so the absence assertion can't
  // pass tautologically before any impl.
  it("should not render the Add row control when the table has no primary key", async () => {
    mockFetch.mockResolvedValueOnce(
      rowsResult(["id", "name"], [["1", "Ada"]], "id"),
    );
    const pkRender = renderLive();
    await screen.findByText("Ada");
    expect(
      screen.getByRole("button", { name: /add row/i }),
    ).toBeInTheDocument();
    pkRender.unmount();

    mockFetch.mockResolvedValue(
      rowsResult(["log_id", "message"], [["1", "boot"]], null),
    );
    renderLive();

    await screen.findByText("boot");
    expect(screen.queryByRole("button", { name: /add row/i })).toBeNull();
  });

  // behavior (no PK -> right-click offers no Delete / Clone row menu). Same precondition guard.
  it("should not open a Delete or Clone row menu when the table has no primary key", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce(
      rowsResult(["id", "name"], [["1", "Ada"]], "id"),
    );
    const pkRender = renderLive();
    await screen.findByText("Ada");
    fireEvent.contextMenu(gridRows()[0]);
    expect(
      await screen.findByRole("menuitem", { name: /^delete/i }),
    ).toBeInTheDocument();
    await user.keyboard("{Escape}");
    pkRender.unmount();

    mockFetch.mockResolvedValue(
      rowsResult(["log_id", "message"], [["1", "boot"]], null),
    );
    renderLive();

    await screen.findByText("boot");
    fireEvent.contextMenu(gridRows()[0]);

    expect(screen.queryByRole("menuitem", { name: /^delete/i })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /clone/i })).toBeNull();
  });
});

describe("Row mutations - cell edit regression (AC-009, TC-011)", () => {
  // side-effect-contract (the existing cell edit still saves, now as a `cell` mutation)
  it("should still stage a cell mutation and send it through applyRowMutations on Save", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(
      rowsResult(["id", "price"], [["1", "999"]], "id"),
    );
    mockApply.mockResolvedValue(1);
    renderLive();

    await user.dblClick(await screen.findByText("999"));
    const input = screen.getByDisplayValue("999");
    await user.clear(input);
    await user.type(input, "1500");
    await user.keyboard("{Enter}");

    // pending preview is the familiar UPDATE statement
    const changes = screen.getByRole("list", { name: /pending changes/i });
    expect(changes).toHaveTextContent(
      `UPDATE "users" SET "price" = '1500' WHERE "id" = '1'`,
    );

    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(mockApply).toHaveBeenCalledTimes(1);
    });
    const [, table, mutations] = mockApply.mock.calls[0];
    expect(table).toBe("users");
    expect(mutations).toEqual([
      expect.objectContaining({
        kind: "cell",
        column: "price",
        pkValue: "1",
        newValue: "1500",
      }),
    ]);
  });
});
