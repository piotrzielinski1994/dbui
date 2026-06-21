import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { SqlTab } from "@/components/workspace/sql-tab";
import { Console } from "@/components/workspace/console";
import { executeSql } from "@/lib/tauri";
import type {
  ConnectionConfig,
  TreeNode,
} from "@/lib/workspace/model";

vi.mock("@/lib/tauri", () => ({
  executeSql: vi.fn(),
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SqlTab run", () => {
  // behavior (the editor is editable, not a read-only pre)
  it("should let the user edit the SQL text", async () => {
    const user = userEvent.setup();
    renderSql({ connected: true });

    const editor = screen.getByRole("textbox", { name: /sql editor/i });
    await user.clear(editor);
    await user.type(editor, "SELECT 42");

    expect(editor).toHaveValue("SELECT 42");
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

  // behavior (Run executes the editor SQL against the stored connection)
  it("should execute the editor SQL with the stored connection config when Run is clicked", async () => {
    const user = userEvent.setup();
    mockExecute.mockResolvedValue({
      columns: ["n"],
      rows: [["42"]],
      rowsAffected: 1,
      returnsRows: true,
      message: "SELECT 1",
    });
    renderSql({ connected: true });

    const editor = screen.getByRole("textbox", { name: /sql editor/i });
    await user.clear(editor);
    await user.type(editor, "SELECT 42 AS n");
    await user.click(screen.getByRole("button", { name: /run/i }));

    await waitFor(() => {
      expect(mockExecute).toHaveBeenCalledWith(config, "SELECT 42 AS n");
    });
  });

  // behavior (a row-returning result renders a grid)
  it("should render the result columns and rows after a successful run", async () => {
    const user = userEvent.setup();
    mockExecute.mockResolvedValue({
      columns: ["id", "name"],
      rows: [
        ["1", "Ada"],
        ["2", "Linus"],
      ],
      rowsAffected: 2,
      returnsRows: true,
      message: "SELECT 2",
    });
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
    mockExecute.mockResolvedValue({
      columns: [],
      rows: [],
      rowsAffected: 3,
      returnsRows: false,
      message: "OK - 3 row(s) affected",
    });
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

  // behavior (Cmd/Ctrl+Enter in the editor runs the query)
  it("should run the query on Ctrl+Enter in the editor", async () => {
    const user = userEvent.setup();
    mockExecute.mockResolvedValue({
      columns: ["n"],
      rows: [["1"]],
      rowsAffected: 1,
      returnsRows: true,
      message: "SELECT 1",
    });
    renderSql({ connected: true });

    const editor = screen.getByRole("textbox", { name: /sql editor/i });
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
    mockExecute.mockResolvedValue({
      columns: ["n"],
      rows: [["1"]],
      rowsAffected: 1,
      returnsRows: true,
      message: "SELECT 1",
    });
    renderSql({ connected: true });

    const editor = screen.getByRole("textbox", { name: /sql editor/i });
    await user.clear(editor);
    await user.type(editor, "SELECT 1 AS n");
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

  // behavior (AC-006: clicking a result header sorts the rows in memory, no re-run)
  it("should sort the result rows client-side when a header is clicked", async () => {
    const user = userEvent.setup();
    mockExecute.mockResolvedValue({
      columns: ["id", "name"],
      rows: [
        ["3", "Cleo"],
        ["1", "Ada"],
        ["2", "Bob"],
      ],
      rowsAffected: 3,
      returnsRows: true,
      message: "SELECT 3",
    });
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

  // behavior (AC-008, TC-010: copy the result rows to the clipboard as CSV)
  it("should copy the result rows to the clipboard as CSV", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    mockExecute.mockResolvedValue({
      columns: ["id", "name"],
      rows: [["1", "Ada"]],
      rowsAffected: 1,
      returnsRows: true,
      message: "SELECT 1",
    });
    renderSql({ connected: true });

    await user.click(screen.getByRole("button", { name: /run/i }));
    await screen.findByText("Ada");
    await user.click(screen.getByRole("button", { name: /copy csv/i }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("id,name\n1,Ada");
    });
  });
});
