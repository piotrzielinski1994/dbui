import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EditorView } from "@codemirror/view";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { SqlTab } from "@/components/workspace/sql-tab";
import { Console } from "@/components/workspace/console";
import { executeSql, executeMongo } from "@/lib/tauri";
import { toast } from "sonner";
import type { ConnectionConfig, TreeNode } from "@/lib/workspace/model";

vi.mock("@/lib/tauri", () => ({
  executeSql: vi.fn(),
  executeMongo: vi.fn(),
  disconnectDatabase: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
}));

const mockExecute = vi.mocked(executeSql);
const mockExecuteMongo = vi.mocked(executeMongo);
const mockWarning = vi.mocked(toast.warning);

const mongoConfig: ConnectionConfig = {
  engine: "mongodb",
  host: "localhost",
  port: 27017,
  database: "m",
  user: "",
  password: "",
};

function mongoTree(readOnly: boolean): TreeNode[] {
  return [
    {
      kind: "database",
      accentColor: null,
      readOnly,
      id: "db-m",
      name: "m",
      engine: "mongodb",
      host: "localhost",
      port: 27017,
      database: "m",
      user: "",
      password: "",
      tables: [],
      views: [],
      sql: "db.users.find({})",
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

function renderMongo(readOnly: boolean) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceProvider
        tree={mongoTree(readOnly)}
        initialActiveTabId="db-m"
        initialConnections={[["db-m", mongoConfig]]}
      >
        <SqlTab />
        <Console />
      </WorkspaceProvider>
    </QueryClientProvider>,
  );
}

const config: ConnectionConfig = {
  engine: "postgres",
  host: "localhost",
  port: 5432,
  database: "ppp",
  user: "postgres",
  password: "postgres",
};

// `readOnly` is spread via a cast because the runtime DatabaseNode type may not declare it until the
// field lands; the SQL submit gate behaviour is what these tests observe.
function tree(readOnly: boolean): TreeNode[] {
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

function renderSql(readOnly: boolean) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceProvider
        tree={tree(readOnly)}
        initialActiveTabId="db-ppp"
        initialConnections={[["db-ppp", config]]}
      >
        <SqlTab />
        <Console />
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
});

describe("Read-only SQL gate - write blocked (AC-004, TC-002)", () => {
  // AC-004, TC-002 - side-effect-contract (a write-shaped statement in a read-only database is NOT
  // sent to the backend)
  it("should not call executeSql for a DELETE when the database is read-only", async () => {
    const user = userEvent.setup();
    const { container } = renderSql(true);

    replaceDoc(liveView(container), "DELETE FROM users");
    await user.click(screen.getByRole("button", { name: /run/i }));

    // Give any (erroneous) async submit a tick to fire before asserting the negative.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mockExecute).not.toHaveBeenCalled();
  });

  // AC-004, TC-002 - side-effect-contract (blocking a write raises a sticky warning toast)
  it("should fire a warning toast when a write statement is blocked on a read-only database", async () => {
    const user = userEvent.setup();
    const { container } = renderSql(true);

    replaceDoc(liveView(container), "DELETE FROM users");
    await user.click(screen.getByRole("button", { name: /run/i }));

    await waitFor(() => {
      expect(mockWarning).toHaveBeenCalled();
    });
    expect(mockWarning).toHaveBeenCalledWith(
      expect.stringMatching(/read-only/i),
      expect.anything(),
    );
  });

  // AC-004, TC-002 - behavior (a blocked write records an error line in the History tab)
  it("should add a History error entry when a write statement is blocked", async () => {
    const user = userEvent.setup();
    const { container } = renderSql(true);

    replaceDoc(liveView(container), "DELETE FROM users");
    await user.click(screen.getByRole("button", { name: /run/i }));

    const historyList = await screen.findByRole("list", {
      name: /query history/i,
    });
    expect(historyList).toHaveTextContent("ERR");
    expect(historyList).toHaveTextContent(/read-only/i);
  });
});

describe("Read-only SQL gate - reads still run (AC-004)", () => {
  // AC-004, TC-002 - side-effect-contract (a SELECT in a read-only database is sent as usual)
  it("should still call executeSql for a SELECT when the database is read-only", async () => {
    const user = userEvent.setup();
    mockExecute.mockResolvedValue([
      {
        statement: "SELECT * FROM users",
        columns: ["id"],
        rows: [["1"]],
        rowsAffected: 0,
        returnsRows: true,
        message: "SELECT 1",
      },
    ]);
    const { container } = renderSql(true);

    replaceDoc(liveView(container), "SELECT * FROM users");
    await user.click(screen.getByRole("button", { name: /run/i }));

    await waitFor(() => {
      expect(mockExecute).toHaveBeenCalledWith(
        "db-ppp",
        "SELECT * FROM users",
        expect.any(String),
      );
    });
    expect(mockWarning).not.toHaveBeenCalled();
  });
});

describe("Read-only OFF - writes run (AC-005, TC-004)", () => {
  // AC-005, TC-004 - side-effect-contract (a writable database sends a write statement, no block)
  it("should call executeSql for an UPDATE when the database is not read-only", async () => {
    const user = userEvent.setup();
    mockExecute.mockResolvedValue([
      {
        statement: "UPDATE users SET name = 'x'",
        columns: [],
        rows: [],
        rowsAffected: 1,
        returnsRows: false,
        message: "OK - 1 row(s) affected",
      },
    ]);
    const { container } = renderSql(false);

    replaceDoc(liveView(container), "UPDATE users SET name = 'x'");
    await user.click(screen.getByRole("button", { name: /run/i }));

    await waitFor(() => {
      expect(mockExecute).toHaveBeenCalledWith(
        "db-ppp",
        "UPDATE users SET name = 'x'",
        expect.any(String),
      );
    });
    expect(mockWarning).not.toHaveBeenCalled();
  });
});

describe("Read-only Mongo Query gate - write blocked, reads run (AC-004)", () => {
  // AC-004 - side-effect-contract (a Mongo write command - updateOne - is NOT sent on a read-only
  // database; the Query tab now runs writes, so the guard must cover Mongo too)
  it("should not call executeMongo for an updateOne when the database is read-only", async () => {
    const user = userEvent.setup();
    const { container } = renderMongo(true);

    replaceDoc(
      liveView(container),
      'db.users.updateOne({ "_id": 1 }, { "$set": { "age": 9 } })',
    );
    await user.click(screen.getByRole("button", { name: /run/i }));

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mockExecuteMongo).not.toHaveBeenCalled();
    expect(mockWarning).toHaveBeenCalledWith(
      expect.stringMatching(/read-only/i),
      expect.anything(),
    );
  });

  // AC-004 - side-effect-contract (a Mongo find still runs on a read-only database)
  it("should still call executeMongo for a find when the database is read-only", async () => {
    const user = userEvent.setup();
    mockExecuteMongo.mockResolvedValue([
      {
        statement: "db.users.find(...)",
        columns: ["_id"],
        rows: [["1"]],
        rowsAffected: 0,
        returnsRows: true,
        message: "1 document(s)",
      },
    ]);
    const { container } = renderMongo(true);

    replaceDoc(liveView(container), "db.users.find({})");
    await user.click(screen.getByRole("button", { name: /run/i }));

    await waitFor(() => {
      expect(mockExecuteMongo).toHaveBeenCalledWith(
        "db-m",
        "db.users.find({})",
        expect.any(String),
      );
    });
    expect(mockWarning).not.toHaveBeenCalled();
  });
});

describe("Read-only SQL gate - read-led multi-statement gap (AC-004, TC-006)", () => {
  // AC-004, TC-006 - behavior (documented best-effort limitation: a buffer whose FIRST keyword is a
  // read is NOT caught by the prefix-only guard, so a chained write still reaches the backend - same
  // gap the Script tab documents). Pins the accepted behaviour so a future "fix" is a deliberate
  // choice, not an accident.
  it("should NOT block a read-led buffer that chains a write on a read-only database", async () => {
    const user = userEvent.setup();
    mockExecute.mockResolvedValue([
      {
        statement: "SELECT 1",
        columns: ["n"],
        rows: [["1"]],
        rowsAffected: 0,
        returnsRows: true,
        message: "SELECT 1",
      },
    ]);
    const { container } = renderSql(true);

    replaceDoc(liveView(container), "SELECT 1; DELETE FROM t");
    await user.click(screen.getByRole("button", { name: /run/i }));

    await waitFor(() => {
      expect(mockExecute).toHaveBeenCalledWith(
        "db-ppp",
        "SELECT 1; DELETE FROM t",
        expect.any(String),
      );
    });
  });
});
