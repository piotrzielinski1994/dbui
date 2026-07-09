import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EditorView } from "@codemirror/view";

import {
  WorkspaceProvider,
  useWorkspace,
} from "@/components/workspace/workspace-context";
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

vi.mock("@/lib/tauri", () => ({
  fetchTable: vi.fn(),
  countTable: vi.fn(),
  applyRowMutations: vi.fn(),
  disconnectDatabase: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const mockFetch = vi.mocked(fetchTable);
const mockCount = vi.mocked(countTable);
const mockUpdate = vi.mocked(applyRowMutations);
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
    id: "db-ppp",
    name: "ppp",
    accentColor: null,
    readOnly: false,
    engine: "postgres",
    host: "localhost",
    port: 5432,
    database: "ppp",
    user: "postgres",
    password: "postgres",
    tables: [
      {
        kind: "table",
        id: "db-ppp::product",
        name: "product",
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
        initialActiveTabId="db-ppp::product"
        initialConnections={[["db-ppp", config]]}
      >
        <TableCard />
        <Console />
      </WorkspaceProvider>
    </QueryClientProvider>,
  );
}

// The filter is a single-line CodeMirror editor; jsdom can't type into it, so set its text by
// dispatching on the live EditorView found by its "Filter rows" accessible name.
function typeFilter(text: string) {
  const filterEl = screen.getByRole("textbox", { name: /filter/i });
  const editorEl = filterEl.closest<HTMLElement>(".cm-editor");
  const view = editorEl ? EditorView.findFromDOM(editorEl) : null;
  if (!view) {
    throw new Error("filter EditorView not found");
  }
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
  });
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

describe("TableCard live content", () => {
  // behavior (loading while rows fetch)
  it("should show a loading state while the rows are being fetched", () => {
    mockFetch.mockReturnValueOnce(new Promise(() => {}));
    renderLive();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  // behavior (fetched columns + rows render)
  it("should render the fetched columns and row values", async () => {
    mockFetch.mockResolvedValueOnce(
      rowsResult(
        ["id", "price"],
        [
          ["1", "999"],
          ["2", "2499"],
        ],
      ),
    );
    renderLive();

    expect(
      await screen.findByRole("columnheader", { name: "id" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "price" }),
    ).toBeInTheDocument();
    expect(screen.getByText("999")).toBeInTheDocument();
    expect(screen.getByText("2499")).toBeInTheDocument();
  });

  // behavior (NULL rendered distinctly, not as empty)
  it("should render a NULL cell as [NULL]", async () => {
    mockFetch.mockResolvedValueOnce(
      rowsResult(["id", "deleted_at"], [["1", null]]),
    );
    renderLive();

    expect(await screen.findByText("[NULL]")).toBeInTheDocument();
  });

  // behavior (the header row sticks to the top so vertical scroll keeps it visible)
  it("should render a sticky header row", async () => {
    mockFetch.mockResolvedValueOnce(rowsResult(["id", "price"], [["1", "999"]]));
    renderLive();

    const header = await screen.findByRole("columnheader", { name: "id" });
    expect(header.className).toContain("sticky");
    expect(header.className).toContain("top-0");
    // border-collapse scrolls a real border away, so the 1px divider is an inset shadow that
    // travels with the cell (design.md: dividers stay 1px). Pin it so it can't be dropped.
    expect(header.className).toContain("shadow-[inset_0_-1px_0_var(--border)]");
  });

  // behavior (AC-004: header shows the column type and a PK marker)
  it("should show the column data type and a PK marker in the header", async () => {
    mockFetch.mockResolvedValueOnce(
      rowsResult(
        [
          column("id", { dataType: "int4", nullable: false, isPrimaryKey: true }),
          column("name", { dataType: "text", nullable: false }),
        ],
        [["1", "Widget"]],
        "id",
      ),
    );
    renderLive();

    const idHeader = await screen.findByRole("columnheader", { name: "id" });
    expect(idHeader).toHaveTextContent("int4");
    expect(idHeader).toHaveTextContent("PK");
  });

  // behavior (AC-004: a not-null column shows NN, a nullable one does not)
  it("should mark a not-null column with NN and leave nullable columns unmarked", async () => {
    mockFetch.mockResolvedValueOnce(
      rowsResult(
        [
          column("id", { dataType: "int4", nullable: false, isPrimaryKey: true }),
          column("note", { dataType: "text", nullable: true }),
        ],
        [["1", "hi"]],
        "id",
      ),
    );
    renderLive();

    const idHeader = await screen.findByRole("columnheader", { name: "id" });
    expect(idHeader).toHaveTextContent("NN");
    const noteHeader = screen.getByRole("columnheader", { name: "note" });
    expect(noteHeader).not.toHaveTextContent("NN");
  });

  // behavior (fetch failure surfaces an error state)
  it("should show an error state when the fetch rejects", async () => {
    mockFetch.mockRejectedValueOnce(new Error("relation does not exist"));
    renderLive();

    // The message now appears twice (the error pane AND the console history, since a failed fetch
    // is a real query that gets logged); assert on the destructive error pane specifically.
    const messages = await screen.findAllByText(/relation does not exist/i);
    expect(
      messages.some((node) => node.classList.contains("text-destructive")),
    ).toBe(true);
  });

  // behavior (calls the backend with the stored config, table name, and no filter)
  it("should fetch with the stored connection config and the table name", async () => {
    mockFetch.mockResolvedValueOnce(rowsResult(["id"], [["1"]]));
    renderLive();

    await screen.findByText("1");
    expect(mockFetch).toHaveBeenCalledWith(
      "db-ppp",
      "product",
      expect.objectContaining({ filter: undefined }),
    );
  });

  // behavior (the filter runs only on Enter, not on idle keystrokes)
  it("should re-fetch with the raw filter expression when Enter is pressed", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(rowsResult(["id"], [["1"]]));
    renderLive();

    await screen.findByText("1");
    typeFilter("price > 10");

    // not applied yet - no Enter
    expect(mockFetch).not.toHaveBeenCalledWith(
      "db-ppp",
      "product",
      expect.objectContaining({ filter: "price > 10" }),
    );

    await user.click(screen.getByRole("textbox", { name: /filter/i }));
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(mockFetch).toHaveBeenLastCalledWith(
        "db-ppp",
        "product",
        expect.objectContaining({ filter: "price > 10" }),
      );
    });
  });

  // behavior (the run-filter button applies the filter too)
  it("should re-fetch when the run-filter button is clicked", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(rowsResult(["id"], [["1"]]));
    renderLive();

    await screen.findByText("1");
    typeFilter("price > 10");
    await user.click(screen.getByRole("button", { name: /run filter/i }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenLastCalledWith(
        "db-ppp",
        "product",
        expect.objectContaining({ filter: "price > 10" }),
      );
    });
  });

  // behavior (the Refresh button re-fetches the open table from the database)
  it("should re-fetch the table when the Refresh button is clicked", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(rowsResult(["id"], [["1"]]));
    renderLive();

    await screen.findByText("1");
    const callsBefore = mockFetch.mock.calls.length;

    await user.click(screen.getByRole("button", { name: /refresh/i }));

    await waitFor(() => {
      expect(mockFetch.mock.calls.length).toBeGreaterThan(callsBefore);
    });
    // the refetch addresses the same table (not a different one)
    expect(mockFetch).toHaveBeenLastCalledWith(
      "db-ppp",
      "product",
      expect.any(Object),
    );
  });

  // behavior (opening a table logs its SELECT to the History tab - it hit the DB)
  it("should log the table fetch to the History tab", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(rowsResult(["id"], [["1"]]));
    renderLive();

    await screen.findByText("1");
    await user.click(screen.getByRole("tab", { name: /history/i }));

    const history = screen.getByRole("list", { name: /query history/i });
    expect(history).toHaveTextContent(`SELECT * FROM "product" LIMIT 200`);
  });

  // behavior (Load more pages with OFFSET, so its logged SQL must carry the OFFSET - not read as
  // the same LIMIT 200 query as the first page)
  it("should log the next page fetch to History with its OFFSET", async () => {
    const user = userEvent.setup();
    const fullPage = Array.from({ length: 200 }, (_, index) => [
      String(index + 1),
    ]);
    mockFetch.mockResolvedValueOnce(rowsResult(["id"], fullPage));
    mockFetch.mockResolvedValueOnce(rowsResult(["id"], [["201"]]));
    renderLive();

    await screen.findByText("1");
    await user.click(await screen.findByRole("button", { name: /load more/i }));
    await screen.findByText("201");

    await user.click(screen.getByRole("tab", { name: /history/i }));
    const history = screen.getByRole("list", { name: /query history/i });
    expect(history).toHaveTextContent(
      `SELECT * FROM "product" LIMIT 200 OFFSET 200`,
    );
  });

  // behavior (applying a filter logs the WHERE'd SELECT to History)
  it("should log a filtered fetch to History with its WHERE clause", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(rowsResult(["id"], [["1"]]));
    renderLive();

    await screen.findByText("1");
    typeFilter("price > 10");
    await user.click(screen.getByRole("button", { name: /run filter/i }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenLastCalledWith(
        "db-ppp",
        "product",
        expect.objectContaining({ filter: "price > 10" }),
      );
    });
    await user.click(screen.getByRole("tab", { name: /history/i }));

    const history = screen.getByRole("list", { name: /query history/i });
    expect(history).toHaveTextContent(
      `SELECT * FROM "product" WHERE (price > 10) LIMIT 200`,
    );
  });

  // behavior (a failed fetch is logged to History as an error)
  it("should log a failed table fetch to History as an error", async () => {
    const user = userEvent.setup();
    mockFetch.mockRejectedValue("relation \"nope\" does not exist");
    renderLive();

    await screen.findByText(/relation "nope" does not exist/i);
    await user.click(screen.getByRole("tab", { name: /history/i }));

    const history = screen.getByRole("list", { name: /query history/i });
    expect(history).toHaveTextContent("ERR");
    expect(history).toHaveTextContent(`relation "nope" does not exist`);
  });
});

describe("TableCard sorting", () => {
  // behavior (the sort affordance is visible on every column before any click)
  it("should show a sort indicator on each header even when unsorted", async () => {
    mockFetch.mockResolvedValue(rowsResult(["id", "price"], [["1", "999"]]));
    renderLive();

    const idHeader = await screen.findByRole("columnheader", { name: "id" });
    const priceHeader = screen.getByRole("columnheader", { name: "price" });
    expect(idHeader).toHaveTextContent("▾");
    expect(priceHeader).toHaveTextContent("▾");
  });

  // behavior (the active sort header shows a solid directional triangle)
  it("should show a solid up triangle on the ascending-sorted column", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(rowsResult(["id", "price"], [["1", "999"]]));
    renderLive();

    await screen.findByText("999");
    await user.click(screen.getByRole("columnheader", { name: "price" }));

    await waitFor(() => {
      expect(
        screen.getByRole("columnheader", { name: "price" }),
      ).toHaveTextContent("▲");
    });
  });

  // behavior (AC-002: clicking a header re-fetches with ORDER BY that column ascending)
  it("should re-fetch sorted ascending when a column header is clicked", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(rowsResult(["id", "price"], [["1", "999"]]));
    renderLive();

    await screen.findByText("999");
    await user.click(screen.getByRole("columnheader", { name: "price" }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenLastCalledWith(
        "db-ppp",
        "product",
        expect.objectContaining({
          sort: { column: "price", descending: false },
        }),
      );
    });
  });

  // behavior (AC-002: a second click flips to descending)
  it("should re-fetch sorted descending on the second click of the same header", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(rowsResult(["id", "price"], [["1", "999"]]));
    renderLive();

    await screen.findByText("999");
    await user.click(screen.getByRole("columnheader", { name: "price" }));
    await waitFor(() => {
      expect(mockFetch).toHaveBeenLastCalledWith(
        "db-ppp",
        "product",
        expect.objectContaining({ sort: { column: "price", descending: false } }),
      );
    });
    await user.click(screen.getByRole("columnheader", { name: "price" }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenLastCalledWith(
        "db-ppp",
        "product",
        expect.objectContaining({
          sort: { column: "price", descending: true },
        }),
      );
    });
  });

  // behavior (AC-002: the header shows the direction arrow; a third click clears it)
  it("should show asc then desc arrows and clear the indicator on the third click", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(rowsResult(["id", "price"], [["1", "999"]]));
    renderLive();

    await screen.findByText("999");
    const price = () => screen.getByRole("columnheader", { name: "price" });

    await user.click(price());
    await waitFor(() => expect(price()).toHaveTextContent("▲"));

    await user.click(price());
    await waitFor(() => expect(price()).toHaveTextContent("▼"));

    await user.click(price());
    await waitFor(() => {
      expect(price()).not.toHaveTextContent("▲");
      expect(price()).not.toHaveTextContent("▼");
    });
  });
});

describe("TableCard pagination", () => {
  const PAGE = Array.from({ length: 200 }, (_, index) => [String(index + 1)]);

  // behavior (AC-001: a full page reveals Load more, which appends the next page)
  it("should show Load more for a full page and append the next page when clicked", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce(rowsResult(["id"], PAGE));
    mockFetch.mockResolvedValueOnce(rowsResult(["id"], [["201"], ["202"]]));
    renderLive();

    await screen.findByText("1");
    const loadMore = await screen.findByRole("button", { name: /load more/i });
    await user.click(loadMore);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenLastCalledWith(
        "db-ppp",
        "product",
        expect.objectContaining({ offset: 200 }),
      );
    });
    expect(await screen.findByText("201")).toBeInTheDocument();
    // first page still present (appended, not replaced)
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  // behavior (AC-001: a short page hides Load more)
  it("should not show Load more when fewer than a full page returns", async () => {
    mockFetch.mockResolvedValueOnce(rowsResult(["id"], [["1"], ["2"]]));
    renderLive();

    await screen.findByText("1");
    expect(
      screen.queryByRole("button", { name: /load more/i }),
    ).toBeNull();
  });

  // behavior (AC-003: changing the sort resets pagination to the first page)
  it("should reset to the first page when the sort changes", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce(rowsResult(["id"], PAGE));
    mockFetch.mockResolvedValueOnce(rowsResult(["id"], [["201"]]));
    mockFetch.mockResolvedValue(rowsResult(["id"], [["1"]]));
    renderLive();

    await screen.findByText("1");
    await user.click(await screen.findByRole("button", { name: /load more/i }));
    await screen.findByText("201");

    await user.click(screen.getByRole("columnheader", { name: "id" }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenLastCalledWith(
        "db-ppp",
        "product",
        expect.objectContaining({
          offset: 0,
          sort: { column: "id", descending: false },
        }),
      );
    });
    expect(screen.queryByText("201")).toBeNull();
  });

  // behavior (status bar shows the unbounded total returned by count_table)
  it("should show the loaded-vs-total row count in the status bar", async () => {
    mockFetch.mockResolvedValueOnce(rowsResult(["id"], [["1"], ["2"]]));
    mockCount.mockResolvedValue(4096);
    renderLive();

    await screen.findByText("1");
    expect(await screen.findByText(/2 of 4096 rows/i)).toBeInTheDocument();
  });

  // behavior (the unbounded total is keyed on the filter only - sorting must not recount)
  it("should not recount the table when only the sort changes", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(rowsResult(["id"], [["1"]]));
    mockCount.mockResolvedValue(10);
    renderLive();

    await screen.findByText("1");
    expect(mockCount).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("columnheader", { name: "id" }));
    await waitFor(() => {
      expect(mockFetch).toHaveBeenLastCalledWith(
        "db-ppp",
        "product",
        expect.objectContaining({ sort: { column: "id", descending: false } }),
      );
    });
    // the count query did not run again - sort does not change how many rows match
    expect(mockCount).toHaveBeenCalledTimes(1);
  });

  // behavior (typing a new page size re-fetches from offset 0 with the new limit)
  it("should re-fetch with the typed page size from the first page", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(rowsResult(["id"], [["1"]]));
    renderLive();

    await screen.findByText("1");
    const pageSize = screen.getByRole("spinbutton", { name: /page size/i });
    await user.clear(pageSize);
    await user.type(pageSize, "500");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(mockFetch).toHaveBeenLastCalledWith(
        "db-ppp",
        "product",
        expect.objectContaining({ limit: 500, offset: 0 }),
      );
    });
  });

  // behavior: Copy CSV lives in the row context menu and copies the SELECTED rows (no footer button).
  it("should copy the selected rows to the clipboard as CSV from the row menu", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    mockFetch.mockResolvedValue(
      rowsResult(["id", "name"], [["1", "Ada"]]),
    );
    renderLive();

    await screen.findByText("Ada");
    // no footer copy button anymore
    expect(screen.queryByRole("button", { name: /copy csv/i })).toBeNull();

    const row = screen.getByText("Ada").closest("tr") as HTMLElement;
    await user.click(row);
    fireEvent.contextMenu(row);
    await user.click(
      screen.queryByRole("menuitem", { name: /copy csv/i }) ??
        screen.getByText(/copy csv/i),
    );

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("id,name\n1,Ada");
    });
  });

  // behavior (F15 AC-007): Copy SQL writes engine-aware INSERT statements for the selected rows.
  it("should copy the selected rows to the clipboard as INSERT SQL from the row menu", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    mockFetch.mockResolvedValue(rowsResult(["id", "name"], [["1", "Ada"]]));
    renderLive();

    await screen.findByText("Ada");
    const row = screen.getByText("Ada").closest("tr") as HTMLElement;
    await user.click(row);
    fireEvent.contextMenu(row);
    await user.click(
      screen.queryByRole("menuitem", { name: /copy sql/i }) ??
        screen.getByText(/copy sql/i),
    );

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        `INSERT INTO "product" ("id", "name") VALUES ('1', 'Ada');`,
      );
    });
    expect(mockToast.success).toHaveBeenCalledWith("Copied 1 row(s) as SQL");
  });

  // behavior (AC-003: changing the filter resets pagination to the first page)
  it("should reset to the first page when the filter changes", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce(rowsResult(["id"], PAGE));
    mockFetch.mockResolvedValueOnce(rowsResult(["id"], [["201"]]));
    mockFetch.mockResolvedValue(rowsResult(["id"], [["5"]]));
    renderLive();

    await screen.findByText("1");
    await user.click(await screen.findByRole("button", { name: /load more/i }));
    await screen.findByText("201");

    typeFilter("id = 5");
    await user.click(screen.getByRole("button", { name: /run filter/i }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenLastCalledWith(
        "db-ppp",
        "product",
        expect.objectContaining({ offset: 0, filter: "id = 5" }),
      );
    });
    // the accumulated second page is gone after the filter reset
    expect(screen.queryByText("201")).toBeNull();
  });
});

describe("TableCard cell editing", () => {
  // behavior (double-click turns a cell into an input)
  it("should turn a cell into an editable input on double click", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(rowsResult(["id", "price"], [["1", "999"]]));
    renderLive();

    const cell = await screen.findByText("999");
    await user.dblClick(cell);

    expect(screen.getByDisplayValue("999")).toBeInTheDocument();
  });

  // behavior (no Save button until a cell is actually changed)
  it("should not show a Save button when nothing has been edited", async () => {
    mockFetch.mockResolvedValue(rowsResult(["id", "price"], [["1", "999"]]));
    renderLive();

    await screen.findByText("999");
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
  });

  // behavior (editing a cell reveals Save with the pending-change count)
  it("should reveal a Save button after a cell value is changed", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(rowsResult(["id", "price"], [["1", "999"]]));
    renderLive();

    await user.dblClick(await screen.findByText("999"));
    const input = screen.getByDisplayValue("999");
    await user.clear(input);
    await user.type(input, "1500");
    await user.keyboard("{Enter}");

    expect(screen.getByRole("button", { name: /save/i })).toBeInTheDocument();
  });

  // behavior (Save sends the edit to the backend with the pk value of that row)
  it("should send the edit with the row's primary-key value when Save is clicked", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(
      rowsResult(["id", "price"], [["1", "999"]], "id"),
    );
    mockUpdate.mockResolvedValue(1);
    renderLive();

    await user.dblClick(await screen.findByText("999"));
    const input = screen.getByDisplayValue("999");
    await user.clear(input);
    await user.type(input, "1500");
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith(
        "db-ppp",
        "product",
        [
          expect.objectContaining({
            kind: "cell",
            column: "price",
            pkValue: "1",
            newValue: "1500",
          }),
        ],
        null,
      );
    });
  });

  // behavior (a successful Save clears the pending edit and reports success)
  it("should clear the pending edit and fire a success toast when Save resolves", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(
      rowsResult(["id", "price"], [["1", "999"]], "id"),
    );
    mockUpdate.mockResolvedValue(1);
    renderLive();

    await user.dblClick(await screen.findByText("999"));
    const input = screen.getByDisplayValue("999");
    await user.clear(input);
    await user.type(input, "1500");
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledWith("Saved 1 change(s)");
    });
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
    expect(screen.queryByRole("tab", { name: /changes \(\d+\)/i })).toBeNull();
  });

  // behavior (a failed Save keeps the edit and reports the backend error)
  it("should keep the pending edit and fire an error toast when Save rejects", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(
      rowsResult(["id", "price"], [["1", "999"]], "id"),
    );
    mockUpdate.mockRejectedValue(new Error("permission denied for table"));
    renderLive();

    await user.dblClick(await screen.findByText("999"));
    const input = screen.getByDisplayValue("999");
    await user.clear(input);
    await user.type(input, "1500");
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith(
        "permission denied for table",
      );
    });
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /save/i })).toBeInTheDocument();
  });

  // behavior (the edit input opts out of browser autofill/autocomplete)
  it("should disable browser autofill on the cell editor", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(rowsResult(["id", "price"], [["1", "999"]]));
    renderLive();

    await user.dblClick(await screen.findByText("999"));
    const input = screen.getByDisplayValue("999");
    expect(input).toHaveAttribute("autocomplete", "off");
    expect(input).toHaveAttribute("data-1p-ignore");
  });

  // behavior (Discard-all clears every pending edit and restores originals)
  it("should discard all pending edits and restore the original values", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(rowsResult(["id", "price"], [["1", "999"]]));
    renderLive();

    await user.dblClick(await screen.findByText("999"));
    const input = screen.getByDisplayValue("999");
    await user.clear(input);
    await user.type(input, "1500");
    await user.keyboard("{Enter}");

    const grid = screen.getByRole("table");
    expect(within(grid).getByText("1500")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^discard$/i }));

    expect(within(grid).getByText("999")).toBeInTheDocument();
    expect(within(grid).queryByText("1500")).toBeNull();
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
  });

  // behavior (the generated SQL appears in the Console "Changes" tab, DBeaver-style)
  it("should show the generated SQL update statement in the Changes tab", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(
      rowsResult(["id", "price"], [["1", "999"]], "id"),
    );
    renderLive();

    await user.dblClick(await screen.findByText("999"));
    const input = screen.getByDisplayValue("999");
    await user.clear(input);
    await user.type(input, "1500");
    await user.keyboard("{Enter}");

    const changes = screen.getByRole("list", { name: /pending changes/i });
    expect(changes).toHaveTextContent(
      `UPDATE "product" SET "price" = '1500' WHERE "id" = '1'`,
    );
  });

  // behavior (auto-switch fires only on the first edit; later edits don't yank the tab)
  it("should not re-switch to Changes on a later edit once the user picked Console", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(
      rowsResult(
        ["id", "price"],
        [
          ["1", "999"],
          ["2", "888"],
        ],
        "id",
      ),
    );
    renderLive();

    await user.dblClick(await screen.findByText("999"));
    const first = screen.getByDisplayValue("999");
    await user.clear(first);
    await user.type(first, "1500");
    await user.keyboard("{Enter}");

    // user switches to the log on purpose
    await user.click(screen.getByRole("tab", { name: /^console$/i }));
    expect(screen.queryByRole("list", { name: /pending changes/i })).toBeNull();

    // a second edit must NOT pull focus back to Changes
    await user.dblClick(screen.getByText("888"));
    const second = screen.getByDisplayValue("888");
    await user.clear(second);
    await user.type(second, "777");
    await user.keyboard("{Enter}");

    expect(screen.queryByRole("list", { name: /pending changes/i })).toBeNull();
  });

  // behavior (the Changes tab auto-activates and badges the pending count)
  it("should label the Changes tab with the pending count", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(
      rowsResult(["id", "price"], [["1", "999"]], "id"),
    );
    renderLive();

    await user.dblClick(await screen.findByText("999"));
    const input = screen.getByDisplayValue("999");
    await user.clear(input);
    await user.type(input, "1500");
    await user.keyboard("{Enter}");

    expect(
      screen.getByRole("tab", { name: /changes \(1\)/i }),
    ).toBeInTheDocument();
  });

  // behavior (each pending edit has its own discard control)
  it("should discard a single pending edit from the Changes tab", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(
      rowsResult(["id", "price"], [["1", "999"]], "id"),
    );
    renderLive();

    await user.dblClick(await screen.findByText("999"));
    const input = screen.getByDisplayValue("999");
    await user.clear(input);
    await user.type(input, "1500");
    await user.keyboard("{Enter}");

    await user.click(
      screen.getByRole("button", { name: /discard change to price/i }),
    );

    const grid = screen.getByRole("table");
    expect(within(grid).getByText("999")).toBeInTheDocument();
    expect(within(grid).queryByText("1500")).toBeNull();
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
    expect(screen.queryByRole("tab", { name: /changes \(\d+\)/i })).toBeNull();
  });

  // behavior (an edited cell stays highlighted in the single-record view)
  it("should highlight the edited cell in the record view too", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(
      rowsResult(["id", "price"], [["1", "999"]], "id"),
    );
    renderLive();

    await user.dblClick(await screen.findByText("999"));
    const input = screen.getByDisplayValue("999");
    await user.clear(input);
    await user.type(input, "1500");
    await user.keyboard("{Enter}");

    // switch to single-record view
    await user.keyboard("{Tab}");

    const record = screen.getByRole("list", { name: /record/i });
    const editedCell = within(record).getByText("1500");
    expect(editedCell).toHaveClass("bg-amber-500/15");
  });
});

describe("TableCard filter with unsaved edits", () => {
  async function editPrice(user: ReturnType<typeof userEvent.setup>) {
    await user.dblClick(await screen.findByText("999"));
    const input = screen.getByDisplayValue("999");
    await user.clear(input);
    await user.type(input, "1500");
    await user.keyboard("{Enter}");
  }

  // Runs the filter via the Search button (Enter has the same effect; the button
  // avoids focus-routing flakiness after the cell-edit input unmounts in jsdom).
  async function runFilter(
    user: ReturnType<typeof userEvent.setup>,
    expr: string,
  ) {
    typeFilter(expr);
    await user.click(screen.getByRole("button", { name: /run filter/i }));
  }

  // behavior (filtering with pending edits prompts instead of silently filtering)
  it("should prompt before filtering when there are unsaved edits", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(
      rowsResult(["id", "price"], [["1", "999"]], "id"),
    );
    renderLive();

    await editPrice(user);
    mockFetch.mockClear();

    await runFilter(user, "price > 10");

    // a confirm dialog appears; the filter has NOT run yet
    expect(
      await screen.findByRole("dialog", { name: /discard/i }),
    ).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalledWith(
      "db-ppp",
      "product",
      expect.objectContaining({ filter: "price > 10" }),
    );
  });

  // behavior (confirming discards the edits and applies the filter)
  it("should discard the edits and run the filter when the prompt is confirmed", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(
      rowsResult(["id", "price"], [["1", "999"]], "id"),
    );
    renderLive();

    await editPrice(user);
    await runFilter(user, "price > 10");

    await user.click(
      await screen.findByRole("button", { name: /discard and filter/i }),
    );

    await waitFor(() => {
      expect(mockFetch).toHaveBeenLastCalledWith(
        "db-ppp",
        "product",
        expect.objectContaining({ filter: "price > 10" }),
      );
    });
    // edits are gone (no Save bar, no Changes tab)
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
    expect(
      screen.queryByRole("tab", { name: /changes \(\d+\)/i }),
    ).toBeNull();
  });

  // behavior (cancelling keeps edits and does not filter)
  it("should keep the edits and not filter when the prompt is cancelled", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(
      rowsResult(["id", "price"], [["1", "999"]], "id"),
    );
    renderLive();

    await editPrice(user);
    mockFetch.mockClear();

    await runFilter(user, "price > 10");

    await user.click(await screen.findByRole("button", { name: /cancel/i }));

    expect(mockFetch).not.toHaveBeenCalledWith(
      "db-ppp",
      "product",
      expect.objectContaining({ filter: "price > 10" }),
    );
    expect(screen.getByRole("button", { name: /save/i })).toBeInTheDocument();
  });

  // behavior (no prompt when there are no pending edits)
  it("should filter immediately when there are no unsaved edits", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(
      rowsResult(["id", "price"], [["1", "999"]], "id"),
    );
    renderLive();

    await screen.findByText("999");
    await runFilter(user, "price > 10");

    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => {
      expect(mockFetch).toHaveBeenLastCalledWith(
        "db-ppp",
        "product",
        expect.objectContaining({ filter: "price > 10" }),
      );
    });
  });
});

describe("TableCard filter statement guard", () => {
  // behavior (a semicolon in the filter is rejected before hitting the DB - one expression only)
  it("should not fetch when the filter contains a semicolon", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(rowsResult(["id"], [["1"]]));
    renderLive();

    await screen.findByText("1");
    mockFetch.mockClear();
    typeFilter("1=1); DROP TABLE x; --");
    await user.click(screen.getByRole("button", { name: /run filter/i }));

    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockToast.error).toHaveBeenCalledWith(
      expect.stringMatching(/one .*expression|semicolon/i),
    );
  });
});

describe("TableCard filter persistence across tab switch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCount.mockResolvedValue(0);
  });

  // Two tables under one connection, both open as tabs; the card is a singleton keyed on the active
  // node, so switching tabs unmounts/rerenders it.
  const twoTableTree: TreeNode[] = [
    {
      kind: "database",
      id: "db-ppp",
      name: "ppp",
      accentColor: null,
      readOnly: false,
      engine: "postgres",
      host: "localhost",
      port: 5432,
      database: "ppp",
      user: "postgres",
      password: "postgres",
      tables: [
        {
          kind: "table",
          id: "db-ppp::product",
          name: "product",
          schema: null,
          columns: [],
          rows: [],
        },
        {
          kind: "table",
          id: "db-ppp::orders",
          name: "orders",
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

  function TabSwitcher() {
    const { setActiveTab } = useWorkspace();
    return (
      <div>
        <button type="button" onClick={() => setActiveTab("db-ppp::orders")}>
          go orders
        </button>
        <button type="button" onClick={() => setActiveTab("db-ppp::product")}>
          go product
        </button>
      </div>
    );
  }

  function renderTwoTables() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return render(
      <QueryClientProvider client={queryClient}>
        <WorkspaceProvider
          tree={twoTableTree}
          initialActiveTabId="db-ppp::product"
          initialOpenTabIds={["db-ppp::product", "db-ppp::orders"]}
          initialConnections={[["db-ppp", config]]}
        >
          <TabSwitcher />
          <TableCard />
        </WorkspaceProvider>
      </QueryClientProvider>,
    );
  }

  // behavior (the applied filter survives leaving the table's tab and coming back - it lives in the
  // provider keyed by tableId, not in the card's local state which resets on unmount)
  it("should keep the applied filter when the table tab is left and reopened", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(rowsResult(["id"], [["1"]]));
    renderTwoTables();

    await screen.findByText("1");
    typeFilter("price > 10");
    await user.click(screen.getByRole("button", { name: /run filter/i }));
    await waitFor(() => {
      expect(mockFetch).toHaveBeenLastCalledWith(
        "db-ppp",
        "product",
        expect.objectContaining({ filter: "price > 10" }),
      );
    });

    // leave to orders, then come back to product
    await user.click(screen.getByRole("button", { name: "go orders" }));
    await user.click(screen.getByRole("button", { name: "go product" }));

    // the filter editor still shows product's applied expression (persisted in the provider, not
    // lost when the card unmounted on the tab switch)
    const filterEl = screen.getByRole("textbox", { name: /filter/i });
    expect(filterEl).toHaveTextContent("price > 10");
    // and the product rows were fetched with that filter at some point (not a bare re-fetch)
    expect(mockFetch).toHaveBeenCalledWith(
      "db-ppp",
      "product",
      expect.objectContaining({ filter: "price > 10" }),
    );
  });

  // behavior (each table keeps its OWN filter - switching does not bleed one table's filter onto the
  // other)
  it("should not carry one table's filter onto another table", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(rowsResult(["id"], [["1"]]));
    renderTwoTables();

    await screen.findByText("1");
    typeFilter("price > 10");
    await user.click(screen.getByRole("button", { name: /run filter/i }));
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "db-ppp",
        "product",
        expect.objectContaining({ filter: "price > 10" }),
      );
    });

    await user.click(screen.getByRole("button", { name: "go orders" }));

    // the orders filter editor is empty (product's filter did not leak)
    const filterEl = screen.getByRole("textbox", { name: /filter/i });
    expect(filterEl).not.toHaveTextContent("price > 10");
  });
});

describe("TableCard schema-qualified addressing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCount.mockResolvedValue(0);
  });

  // A Postgres database whose open table lives in the "analytics" schema.
  const schemaTree: TreeNode[] = [
    {
      kind: "database",
      id: "db-ppp",
      name: "ppp",
      accentColor: null,
      readOnly: false,
      engine: "postgres",
      host: "localhost",
      port: 5432,
      database: "ppp",
      user: "postgres",
      password: "postgres",
      tables: [
        {
          kind: "table",
          id: "db-ppp::analytics::events",
          name: "events",
          schema: "analytics",
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

  function renderSchemaLive() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return render(
      <QueryClientProvider client={queryClient}>
        <WorkspaceProvider
          tree={schemaTree}
          initialActiveTabId="db-ppp::analytics::events"
          initialConnections={[["db-ppp", config]]}
        >
          <TableCard />
          <Console />
        </WorkspaceProvider>
      </QueryClientProvider>,
    );
  }

  // AC-007, AC-009, TC-002 — behavior (the table's schema flows to fetch + count)
  it("should fetch and count with the table's schema for a Postgres schema table", async () => {
    mockFetch.mockResolvedValueOnce(rowsResult(["id"], [["1"]]));
    renderSchemaLive();

    await screen.findByText("1");
    expect(mockFetch).toHaveBeenCalledWith(
      "db-ppp",
      "events",
      expect.objectContaining({ schema: "analytics" }),
    );
    expect(mockCount).toHaveBeenCalledWith(
      "db-ppp",
      "events",
      undefined,
      "analytics",
    );
  });

  // AC-010, TC-002 — behavior (an edit applies against the schema-qualified table)
  it("should apply a cell edit with the table's schema", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(
      rowsResult(["id", "label"], [["1", "old"]], "id"),
    );
    mockUpdate.mockResolvedValue(1);
    renderSchemaLive();

    const cell = await screen.findByText("old");
    await user.dblClick(cell);
    const input = await screen.findByDisplayValue("old");
    await user.clear(input);
    await user.type(input, "new{Enter}");
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith(
        "db-ppp",
        "events",
        expect.arrayContaining([
          expect.objectContaining({ kind: "cell", newValue: "new" }),
        ]),
        "analytics",
      );
    });
  });
});
