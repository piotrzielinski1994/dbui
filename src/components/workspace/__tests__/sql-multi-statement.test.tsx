import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EditorView } from "@codemirror/view";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { SqlTab } from "@/components/workspace/sql-tab";
import { Console } from "@/components/workspace/console";
import {
  executeSql,
  cancelQuery,
  connectDatabase,
  disconnectDatabase,
  fetchTable,
  countTable,
  applyRowMutations,
  type QueryOutcome,
} from "@/lib/tauri";
import type { ConnectionConfig, TreeNode } from "@/lib/workspace/model";

// F5 reverses the stateless boundary: commands are id-first, executeSql returns an ARRAY of
// per-statement outcomes, and a run is cancellable by request id.
vi.mock("@/lib/tauri", () => ({
  executeSql: vi.fn(),
  cancelQuery: vi.fn(),
  connectDatabase: vi.fn(),
  disconnectDatabase: vi.fn(),
  fetchTable: vi.fn(),
  countTable: vi.fn(),
  applyRowMutations: vi.fn(),
  fetchSchema: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const mockExecute = vi.mocked(executeSql);
const mockCancel = vi.mocked(cancelQuery);

const config: ConnectionConfig = {
  engine: "postgres",
  host: "localhost",
  port: 5432,
  database: "ppp",
  user: "postgres",
  password: "postgres",
};

const CONNECTION_ID = "db-ppp";

const tree: TreeNode[] = [
  {
    kind: "database",
    accentColor: null,
    readOnly: false,
    manualCommit: false,
    id: CONNECTION_ID,
    name: "ppp",
    engine: "postgres",
    host: "localhost",
    port: 5432,
    database: "ppp",
    user: "postgres",
    password: "postgres",
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

function renderSql(opts?: { connected?: boolean }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceProvider
        tree={tree}
        initialActiveTabId={CONNECTION_ID}
        initialConnections={opts?.connected ? [[CONNECTION_ID, config]] : []}
      >
        <SqlTab />
        <Console />
      </WorkspaceProvider>
    </QueryClientProvider>,
  );
}

// jsdom cannot simulate CodeMirror keystroke typing, so reach the live EditorView and dispatch
// document transactions directly (same approach as sql-run.test.tsx).
function liveView(container: HTMLElement): EditorView {
  const editorEl = container.querySelector<HTMLElement>(".cm-editor");
  if (!editorEl) {
    throw new Error(".cm-editor not found");
  }
  const view = EditorView.findFromDOM(editorEl);
  if (!view) {
    throw new Error("live EditorView not found");
  }
  return view;
}

function replaceDoc(view: EditorView, text: string) {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
  });
}

function outcome(overrides: Partial<QueryOutcome>): QueryOutcome {
  return {
    statement: "",
    columns: [],
    rows: [],
    rowsAffected: 0,
    returnsRows: false,
    message: "",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SqlTab multi-statement / cancel (F5)", () => {
  // TC-011, AC-006 - behavior (a two-statement run where the SECOND returns rows shows that
  // result set in the grid and logs one History entry per statement)
  it("should show the last row-returning result and log two History entries when running two statements", async () => {
    const user = userEvent.setup();
    mockExecute.mockResolvedValue([
      outcome({
        statement: "UPDATE t SET x = 1",
        rowsAffected: 1,
        returnsRows: false,
        message: "OK - 1 row(s) affected",
      }),
      outcome({
        statement: "SELECT id, name FROM users",
        columns: ["id", "name"],
        rows: [
          ["1", "Ada"],
          ["2", "Linus"],
        ],
        rowsAffected: 2,
        returnsRows: true,
        message: "SELECT 2",
      }),
    ]);
    const { container } = renderSql({ connected: true });

    replaceDoc(liveView(container), "UPDATE t SET x = 1;\nSELECT id, name FROM users");
    await user.click(screen.getByRole("button", { name: /run/i }));

    // grid shows the SECOND (row-returning) statement's result
    expect(
      await screen.findByRole("columnheader", { name: "name" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("Linus")).toBeInTheDocument();

    // each statement is logged to History (two entries), each showing ITS OWN statement text
    const historyList = await screen.findByRole("list", {
      name: /query history/i,
    });
    const entries = within(historyList).getAllByRole("listitem");
    expect(entries.length).toBe(2);
    // SqlText splits each statement across per-token spans, so match on each entry's textContent.
    const entryText = entries.map((entry) => entry.textContent ?? "");
    expect(entryText.some((text) => text.includes("UPDATE t SET x = 1"))).toBe(
      true,
    );
    expect(
      entryText.some((text) => text.includes("SELECT id, name FROM users")),
    ).toBe(true);
  });

  // TC-012, AC-007 - behavior + side-effect-contract (while pending the control reads "Cancel";
  // clicking it invokes cancelQuery(requestId) - the same id passed to executeSql)
  it("should read Cancel while pending and call cancelQuery with the run's request id", async () => {
    const user = userEvent.setup();
    // Never-resolving promise holds the pending state so the control stays "Cancel".
    mockExecute.mockReturnValueOnce(new Promise(() => {}));
    const { container } = renderSql({ connected: true });

    replaceDoc(liveView(container), "SELECT pg_sleep(10)");
    await user.click(screen.getByRole("button", { name: /run/i }));

    const cancelButton = await screen.findByRole("button", { name: /cancel/i });
    expect(cancelButton).toBeEnabled();

    await user.click(cancelButton);

    await waitFor(() => {
      expect(mockCancel).toHaveBeenCalledTimes(1);
    });
    // executeSql(connectionId, sql, requestId) - cancelQuery must use that SAME requestId.
    const requestId = mockExecute.mock.calls[0]?.[2];
    expect(requestId).toBeTruthy();
    expect(mockCancel).toHaveBeenCalledWith(requestId);
  });

  // TC-012, AC-007 - behavior (a cancelled run surfaces a neutral "Cancelled" status, NOT a red
  // error, and is NOT logged to History as an error). The raw sentinel must never leak to the UI.
  it("should show a neutral Cancelled status and no error entry when the run is cancelled", async () => {
    const user = userEvent.setup();
    // The backend rejects a cancelled run with the cancel sentinel (a tagged rejection).
    mockExecute.mockRejectedValue("__cancelled__");
    renderSql({ connected: true });

    await user.click(screen.getByRole("button", { name: /run/i }));

    // a neutral "Cancelled" status appears...
    const cancelled = await screen.findAllByText(/^cancelled$/i);
    expect(cancelled.length).toBeGreaterThan(0);
    // ...rendered with muted styling, NOT a red error.
    cancelled.forEach((node) => {
      expect(node.className).not.toMatch(/red/);
    });

    // the raw sentinel must never be shown to the user
    expect(screen.queryByText(/__cancelled__/)).not.toBeInTheDocument();

    // History does not gain an error entry for a cancel.
    const historyList = screen.queryByRole("list", { name: /query history/i });
    if (historyList) {
      expect(historyList).not.toHaveTextContent("ERR");
    }
  });

  // TC-013, AC-002 - side-effect-contract (executeSql is called id-first with the run's request
  // id: executeSql(connectionId, sql, requestId))
  it("should call executeSql id-first as (connectionId, sql, requestId)", async () => {
    const user = userEvent.setup();
    mockExecute.mockResolvedValue([outcome({ message: "OK" })]);
    const { container } = renderSql({ connected: true });

    replaceDoc(liveView(container), "SELECT 42 AS n");
    await user.click(screen.getByRole("button", { name: /run/i }));

    await waitFor(() => {
      expect(mockExecute).toHaveBeenCalledWith(
        CONNECTION_ID,
        "SELECT 42 AS n",
        expect.any(String),
      );
    });
  });

  // TC-014, AC-008 - behavior (a single-statement SELECT still renders rows + a `SELECT N`
  // message; executeSql now returns an array of length 1)
  it("should render rows and a SELECT N message for a single-statement SELECT", async () => {
    const user = userEvent.setup();
    mockExecute.mockResolvedValue([
      outcome({
        columns: ["id", "name"],
        rows: [["1", "Ada"]],
        rowsAffected: 1,
        returnsRows: true,
        message: "SELECT 1",
      }),
    ]);
    const { container } = renderSql({ connected: true });

    replaceDoc(liveView(container), "SELECT id, name FROM users");
    await user.click(screen.getByRole("button", { name: /run/i }));

    expect(await screen.findByText("Ada")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getAllByText(/SELECT 1/).length).toBeGreaterThan(0);
    });
  });

  // AC-005, AC-006 - behavior (a comment-only buffer is runnable - non-empty trimmed text - but
  // the backend splits it to zero statements and returns an empty array; the UI shows neither a
  // grid nor an error for the empty result)
  it("should show no grid and no error when the buffer yields zero statements", async () => {
    const user = userEvent.setup();
    mockExecute.mockResolvedValue([]);
    const { container } = renderSql({ connected: true });

    replaceDoc(liveView(container), "-- just a comment");
    await user.click(screen.getByRole("button", { name: /run/i }));

    await waitFor(() => {
      expect(mockExecute).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByRole("columnheader")).not.toBeInTheDocument();
    expect(screen.queryByText(/error/i)).not.toBeInTheDocument();
  });

  // TC-014, AC-008 - behavior (a single UPDATE still reports rows-affected; array of length 1)
  it("should report rows-affected for a single UPDATE statement", async () => {
    const user = userEvent.setup();
    mockExecute.mockResolvedValue([
      outcome({
        rowsAffected: 3,
        returnsRows: false,
        message: "OK - 3 row(s) affected",
      }),
    ]);
    const { container } = renderSql({ connected: true });

    replaceDoc(liveView(container), "UPDATE product SET price = 1");
    await user.click(screen.getByRole("button", { name: /run/i }));

    await waitFor(() => {
      expect(
        screen.getAllByText(/3 row\(s\) affected/i).length,
      ).toBeGreaterThan(0);
    });
  });
});

// TC-013, AC-002 - side-effect-contract: the boundary functions are declared id-first. These pin
// the tauri.ts wrapper signatures (connectionId / requestId first) without rendering. They use
// the REAL module, so they assert against the production wrappers, not the mock above.
describe("tauri boundary signatures (F5, TC-013)", () => {
  it("should expose connect/disconnect/cancel and id-first command wrappers", async () => {
    const real = await vi.importActual<typeof import("@/lib/tauri")>(
      "@/lib/tauri",
    );

    // new commands exist
    expect(typeof real.disconnectDatabase).toBe("function");
    expect(typeof real.cancelQuery).toBe("function");

    // connect still takes config (id-first: connectionId, config)
    expect(real.connectDatabase.length).toBeGreaterThanOrEqual(2);
    // disconnect takes the id
    expect(real.disconnectDatabase.length).toBeGreaterThanOrEqual(1);
    // cancel takes the request id
    expect(real.cancelQuery.length).toBeGreaterThanOrEqual(1);
    // executeSql(connectionId, sql, requestId)
    expect(real.executeSql.length).toBeGreaterThanOrEqual(3);
    // fetchTable / countTable / applyRowMutations are id-first (connectionId, table, ...)
    expect(real.fetchTable.length).toBeGreaterThanOrEqual(2);
    expect(real.countTable.length).toBeGreaterThanOrEqual(2);
    expect(real.applyRowMutations.length).toBeGreaterThanOrEqual(3);
  });
});

// silence unused-import lints for the boundary symbols only referenced via the real module
void connectDatabase;
void disconnectDatabase;
void fetchTable;
void countTable;
void applyRowMutations;
