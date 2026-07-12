import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EditorView } from "@codemirror/view";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { SqlTab } from "@/components/workspace/sql-tab";
import { ContentHeader } from "@/components/workspace/content-header";
import { beginTransaction, executeSql } from "@/lib/tauri";
import type { ConnectionConfig, TreeNode } from "@/lib/workspace/model";

// F12 manual-commit begin-before-write on the SQL Run path. A write must call beginTransaction and
// have it RESOLVE before executeSql fires, so the write lands inside the transaction (not on a fresh
// pool connection). Reads and non-manual-commit dbs must never call beginTransaction.
vi.mock("@/lib/tauri", () => ({
  executeSql: vi.fn(),
  executeMongo: vi.fn(),
  beginTransaction: vi.fn(() => Promise.resolve()),
  commitTransaction: vi.fn(() => Promise.resolve()),
  rollbackTransaction: vi.fn(() => Promise.resolve()),
  transactionState: vi.fn(() => Promise.resolve(true)),
  disconnectDatabase: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
}));

const mockBegin = vi.mocked(beginTransaction);
const mockExecute = vi.mocked(executeSql);

const config: ConnectionConfig = {
  engine: "postgres",
  host: "localhost",
  port: 5432,
  database: "ppp",
  user: "postgres",
  password: "postgres",
};

function tree(manualCommit: boolean): TreeNode[] {
  return [
    {
      kind: "database",
      accentColor: null,
      readOnly: false,
      manualCommit,
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
    } as unknown as TreeNode,
  ];
}

function renderSql(manualCommit: boolean) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceProvider
        tree={tree(manualCommit)}
        initialActiveTabId="db-ppp"
        initialConnections={[["db-ppp", config]]}
      >
        <ContentHeader />
        <SqlTab />
      </WorkspaceProvider>
    </QueryClientProvider>,
  );
}

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
  // clearAllMocks resets calls but KEEPS a mockImplementation - the gated-begin test installs a
  // never-resolving begin, so restore the default resolved begin here or later tests hang on it.
  mockBegin.mockImplementation(() => Promise.resolve());
  mockExecute.mockResolvedValue([
    {
      statement: "",
      columns: [],
      rows: [],
      rowsAffected: 1,
      returnsRows: false,
      message: "OK",
    },
  ]);
});

describe("Manual-commit SQL Run begin-before-write (AC-002)", () => {
  // AC-002 - side-effect-contract (a write on a manual-commit db opens the tx before running)
  it("should call beginTransaction before executeSql for a write when manualCommit is on", async () => {
    const user = userEvent.setup();
    // Gate begin so we can prove executeSql does not fire until begin resolves (the race the fix closes).
    let releaseBegin: () => void = () => {};
    mockBegin.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseBegin = resolve;
        }),
    );
    const { container } = renderSql(true);

    replaceDoc(liveView(container), "DELETE FROM users");
    await user.click(screen.getByRole("button", { name: /^run$/i }));

    await waitFor(() => {
      expect(mockBegin).toHaveBeenCalledWith("db-ppp");
    });
    // begin has not resolved yet - the write must be held.
    expect(mockExecute).not.toHaveBeenCalled();

    releaseBegin();
    await waitFor(() => {
      expect(mockExecute).toHaveBeenCalledWith(
        "db-ppp",
        "DELETE FROM users",
        expect.any(String),
      );
    });
  });

  // AC-002 - side-effect-contract (reads never open a transaction, even on a manual-commit db)
  it("should not call beginTransaction for a SELECT when manualCommit is on", async () => {
    const user = userEvent.setup();
    const { container } = renderSql(true);

    replaceDoc(liveView(container), "SELECT * FROM users");
    await user.click(screen.getByRole("button", { name: /^run$/i }));

    await waitFor(() => {
      expect(mockExecute).toHaveBeenCalled();
    });
    expect(mockBegin).not.toHaveBeenCalled();
  });

  // AC-006 - side-effect-contract (a write on a non-manual-commit db never opens a transaction)
  it("should not call beginTransaction for a write when manualCommit is off", async () => {
    const user = userEvent.setup();
    const { container } = renderSql(false);

    replaceDoc(liveView(container), "DELETE FROM users");
    await user.click(screen.getByRole("button", { name: /^run$/i }));

    await waitFor(() => {
      expect(mockExecute).toHaveBeenCalled();
    });
    expect(mockBegin).not.toHaveBeenCalled();
  });
});

describe("Manual-commit Commit modal shows the transaction statements (AC-008)", () => {
  // AC-008 - behavior (after a write, the content-header Commit modal lists the exact statement that
  // COMMIT will persist - the recorded tx statement, not a guess)
  it("should list the executed write statement in the Commit modal", async () => {
    const user = userEvent.setup();
    const { container } = renderSql(true);

    replaceDoc(liveView(container), "DELETE FROM users WHERE id = 7");
    await user.click(screen.getByRole("button", { name: /^run$/i }));

    // Wait for the write to reach the backend - the statement is recorded (appendTxStatement) right
    // before executeSql, so once execute fired the tx-statement list is populated.
    await waitFor(() => {
      expect(mockExecute).toHaveBeenCalled();
    });

    // The tx-state query resolves true, so the toolbar Commit appears; opening it shows the modal
    // listing the recorded statement.
    await user.click(await screen.findByRole("button", { name: /^commit$/i }));

    const dialog = await screen.findByRole("dialog");
    // SqlText splits the statement across per-token spans, so assert on the
    // dialog's normalized textContent rather than a single text node.
    expect(dialogText(dialog)).toMatch(/DELETE FROM users WHERE id = 7/i);
  });

  // AC-008 - behavior (a FAILED write must NOT appear in the Commit modal - only statements that
  // actually succeeded are recorded, so a rejected/retried attempt is never listed)
  it("should not list a failed write statement in the Commit modal", async () => {
    const user = userEvent.setup();
    // The first write fails (e.g. constraint violation aborts the tx); a later successful write is
    // the only one that should show.
    mockExecute
      .mockRejectedValueOnce(new Error("duplicate key value violates unique constraint"))
      .mockResolvedValueOnce([
        {
          statement: "",
          columns: [],
          rows: [],
          rowsAffected: 1,
          returnsRows: false,
          message: "OK",
        },
      ]);
    const { container } = renderSql(true);

    replaceDoc(liveView(container), "INSERT INTO warehouses VALUES ('W1')");
    await user.click(screen.getByRole("button", { name: /^run$/i }));
    await waitFor(() => {
      expect(mockExecute).toHaveBeenCalledTimes(1);
    });

    replaceDoc(liveView(container), "INSERT INTO regions VALUES ('EU')");
    await user.click(screen.getByRole("button", { name: /^run$/i }));
    await waitFor(() => {
      expect(mockExecute).toHaveBeenCalledTimes(2);
    });

    await user.click(await screen.findByRole("button", { name: /^commit$/i }));
    const dialog = await screen.findByRole("dialog");
    // Only the succeeded write is listed; the failed one is absent (normalized textContent because
    // SqlText splits each statement across token spans).
    const text = dialogText(dialog);
    expect(text).toMatch(/INSERT INTO regions/i);
    expect(text).not.toMatch(/INSERT INTO warehouses/i);
  });
});

// SqlText wraps each SQL token in its own span, so a plain
// getByText on the whole statement fails. Collapse the dialog's text to single spaces and assert on
// that instead.
function dialogText(dialog: HTMLElement): string {
  return (dialog.textContent ?? "").replace(/\s+/g, " ");
}
