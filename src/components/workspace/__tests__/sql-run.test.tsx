import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EditorView } from "@codemirror/view";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { SqlTab } from "@/components/workspace/sql-tab";
import { Console } from "@/components/workspace/console";
import { executeSql } from "@/lib/tauri";
import type { ConnectionConfig, TreeNode } from "@/lib/workspace/model";

vi.mock("@/lib/tauri", () => ({
  executeSql: vi.fn(),
  disconnectDatabase: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const mockExecute = vi.mocked(executeSql);

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
        initialActiveTabId="db-ppp"
        initialConnections={opts?.connected ? [["db-ppp", config]] : []}
      >
        <SqlTab />
        <Console />
      </WorkspaceProvider>
    </QueryClientProvider>,
  );
}

// jsdom cannot reliably simulate CodeMirror keystroke typing, so reach the live
// EditorView and dispatch document/selection transactions directly.
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SqlTab run", () => {
  // TC-002 — behavior (the editor is editable: dispatched edits flow into the buffer)
  it("should let the user edit the SQL text", () => {
    const { container } = renderSql({ connected: true });

    const view = liveView(container);
    replaceDoc(view, "SELECT 42");

    expect(view.state.doc.toString()).toBe("SELECT 42");
  });

  // behavior (Run is disabled until the database has a live connection)
  it("should disable Run when the database is not connected", () => {
    renderSql({ connected: false });
    expect(screen.getByRole("button", { name: /run/i })).toBeDisabled();
  });

  it("should enable Run once the database is connected", () => {
    renderSql({ connected: true });
    expect(screen.getByRole("button", { name: /run/i })).toBeEnabled();
  });

  // TC-004 — behavior (Run executes the editor SQL against the stored connection)
  it("should execute the editor SQL with the stored connection config when Run is clicked", async () => {
    const user = userEvent.setup();
    mockExecute.mockResolvedValue([{
      statement: "stmt",
      columns: ["n"],
      rows: [["42"]],
      rowsAffected: 1,
      returnsRows: true,
      message: "SELECT 1",
    }]);
    const { container } = renderSql({ connected: true });

    replaceDoc(liveView(container), "SELECT 42 AS n");
    await user.click(screen.getByRole("button", { name: /run/i }));

    await waitFor(() => {
      expect(mockExecute).toHaveBeenCalledWith("db-ppp", "SELECT 42 AS n", expect.any(String));
    });
  });

  // TC-006 / AC-004 — behavior (a non-empty selection runs only the selected text)
  it("should run only the selected text when a selection is set", async () => {
    const user = userEvent.setup();
    mockExecute.mockResolvedValue([{
      statement: "stmt",
      columns: ["n"],
      rows: [["2"]],
      rowsAffected: 1,
      returnsRows: true,
      message: "SELECT 1",
    }]);
    const { container } = renderSql({ connected: true });

    const view = liveView(container);
    const buffer = "SELECT 1;\nSELECT 2";
    replaceDoc(view, buffer);
    const anchor = buffer.indexOf("SELECT 2");
    view.dispatch({ selection: { anchor, head: buffer.length } });

    await user.click(screen.getByRole("button", { name: /run/i }));

    await waitFor(() => {
      expect(mockExecute).toHaveBeenCalledWith("db-ppp", "SELECT 2", expect.any(String));
    });
  });

  // TC-007 / AC-004 — behavior (cursor only, empty range, runs the whole buffer)
  it("should run the whole buffer when there is no selection", async () => {
    const user = userEvent.setup();
    mockExecute.mockResolvedValue([{
      statement: "stmt",
      columns: ["n"],
      rows: [["1"]],
      rowsAffected: 1,
      returnsRows: true,
      message: "SELECT 1",
    }]);
    const { container } = renderSql({ connected: true });

    const view = liveView(container);
    const buffer = "SELECT 1;\nSELECT 2";
    replaceDoc(view, buffer);
    view.dispatch({ selection: { anchor: 0, head: 0 } });

    await user.click(screen.getByRole("button", { name: /run/i }));

    await waitFor(() => {
      expect(mockExecute).toHaveBeenCalledWith("db-ppp", buffer, expect.any(String));
    });
  });

  // TC-008 / AC-004 — behavior (a whitespace-only selection is treated as no selection)
  it("should run the whole buffer when the selection is whitespace only", async () => {
    const user = userEvent.setup();
    mockExecute.mockResolvedValue([{
      statement: "stmt",
      columns: ["n"],
      rows: [["1"]],
      rowsAffected: 1,
      returnsRows: true,
      message: "SELECT 1",
    }]);
    const { container } = renderSql({ connected: true });

    const view = liveView(container);
    const buffer = "SELECT 1;\n   \nSELECT 2";
    replaceDoc(view, buffer);
    const wsStart = buffer.indexOf(";") + 1;
    const wsEnd = buffer.indexOf("SELECT 2");
    view.dispatch({ selection: { anchor: wsStart, head: wsEnd } });

    await user.click(screen.getByRole("button", { name: /run/i }));

    await waitFor(() => {
      expect(mockExecute).toHaveBeenCalledWith("db-ppp", buffer, expect.any(String));
    });
  });

  // behavior (a row-returning result renders a grid)
  it("should render the result columns and rows after a successful run", async () => {
    const user = userEvent.setup();
    mockExecute.mockResolvedValue([{
      statement: "stmt",
      columns: ["id", "name"],
      rows: [
        ["1", "Ada"],
        ["2", "Linus"],
      ],
      rowsAffected: 2,
      returnsRows: true,
      message: "SELECT 2",
    }]);
    renderSql({ connected: true });

    await user.click(screen.getByRole("button", { name: /run/i }));

    expect(
      await screen.findByRole("columnheader", { name: "name" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("Linus")).toBeInTheDocument();
  });

  // behavior (a non-row statement shows its rows-affected message, no grid)
  it("should show the rows-affected message for a write statement", async () => {
    const user = userEvent.setup();
    mockExecute.mockResolvedValue([{
      statement: "stmt",
      columns: [],
      rows: [],
      rowsAffected: 3,
      returnsRows: false,
      message: "OK - 3 row(s) affected",
    }]);
    renderSql({ connected: true });

    await user.click(screen.getByRole("button", { name: /run/i }));

    await waitFor(() => {
      expect(
        screen.getAllByText(/3 row\(s\) affected/i).length,
      ).toBeGreaterThan(0);
    });
  });

  // behavior (a failed run surfaces the backend error)
  it("should show the backend error when the run fails", async () => {
    const user = userEvent.setup();
    mockExecute.mockRejectedValue(new Error('syntax error at or near "SELCT"'));
    renderSql({ connected: true });

    await user.click(screen.getByRole("button", { name: /run/i }));

    await waitFor(() => {
      expect(screen.getAllByText(/syntax error/i).length).toBeGreaterThan(0);
    });
  });

  // TC-005 — behavior (Cmd/Ctrl+Enter in the editor runs the query)
  it("should run the query on Ctrl+Enter in the editor", async () => {
    const user = userEvent.setup();
    mockExecute.mockResolvedValue([{
      statement: "stmt",
      columns: ["n"],
      rows: [["1"]],
      rowsAffected: 1,
      returnsRows: true,
      message: "SELECT 1",
    }]);
    const { container } = renderSql({ connected: true });

    const editor = container.querySelector<HTMLElement>(".cm-content");
    if (!editor) {
      throw new Error(".cm-content not found");
    }
    await user.click(editor);
    await user.keyboard("{Control>}{Enter}{/Control}");

    await waitFor(() => {
      expect(mockExecute).toHaveBeenCalled();
    });
  });

  // behavior (a Tauri string rejection - not an Error - still shows its message)
  it("should surface a plain-string backend rejection", async () => {
    const user = userEvent.setup();
    // Tauri commands returning Result<_, String> reject with the raw string.
    mockExecute.mockRejectedValue('relation "nope" does not exist');
    renderSql({ connected: true });

    await user.click(screen.getByRole("button", { name: /run/i }));

    await waitFor(() => {
      expect(
        screen.getAllByText(/relation "nope" does not exist/i).length,
      ).toBeGreaterThan(0);
    });
  });

  // behavior (a successful run is logged to the History tab)
  it("should log a run to the History tab", async () => {
    const user = userEvent.setup();
    mockExecute.mockResolvedValue([{
      statement: "SELECT 1 AS n",
      columns: ["n"],
      rows: [["1"]],
      rowsAffected: 1,
      returnsRows: true,
      message: "SELECT 1",
    }]);
    const { container } = renderSql({ connected: true });

    replaceDoc(liveView(container), "SELECT 1 AS n");
    await user.click(screen.getByRole("button", { name: /run/i }));

    const historyList = await screen.findByRole("list", {
      name: /query history/i,
    });
    expect(historyList).toHaveTextContent("SELECT 1 AS n");
    expect(historyList).toHaveTextContent("SELECT 1");
  });

  // behavior (a failed run is logged to History as an error)
  it("should log a failed run to History as an error", async () => {
    const user = userEvent.setup();
    mockExecute.mockRejectedValue("boom");
    renderSql({ connected: true });

    await user.click(screen.getByRole("button", { name: /run/i }));

    const historyList = await screen.findByRole("list", {
      name: /query history/i,
    });
    expect(historyList).toHaveTextContent("ERR");
    expect(historyList).toHaveTextContent("boom");
  });

  // behavior (AC-008: clicking a result header sorts the rows in memory, no re-run)
  it("should sort the result rows client-side when a header is clicked", async () => {
    const user = userEvent.setup();
    mockExecute.mockResolvedValue([{
      statement: "stmt",
      columns: ["id", "name"],
      rows: [
        ["3", "Cleo"],
        ["1", "Ada"],
        ["2", "Bob"],
      ],
      rowsAffected: 3,
      returnsRows: true,
      message: "SELECT 3",
    }]);
    renderSql({ connected: true });

    await user.click(screen.getByRole("button", { name: /run/i }));
    await screen.findByText("Ada");

    mockExecute.mockClear();
    await user.click(screen.getByRole("columnheader", { name: "id" }));

    // rows reordered ascending by id without another executeSql
    await waitFor(() => {
      const cells = screen.getAllByRole("cell");
      expect(cells[0]).toHaveTextContent("1");
    });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  // behavior: the SQL result grid is selectable, and Copy CSV in the row menu copies the selection.
  it("should copy the selected result row to the clipboard as CSV from the row menu", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    mockExecute.mockResolvedValue([{
      statement: "stmt",
      columns: ["id", "name"],
      rows: [["1", "Ada"]],
      rowsAffected: 1,
      returnsRows: true,
      message: "SELECT 1",
    }]);
    renderSql({ connected: true });

    await user.click(screen.getByRole("button", { name: /run/i }));
    await screen.findByText("Ada");
    // no footer copy button on the result pane anymore
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
});
