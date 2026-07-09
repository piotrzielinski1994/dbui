import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { ScriptTab } from "@/components/workspace/script-tab";
import { Console } from "@/components/workspace/console";
import { executeMongo, executeSql } from "@/lib/tauri";
import { toast } from "sonner";
import type { ScriptRunner } from "@/lib/script/runner";
import type { ConnectionConfig, DatabaseNode, TreeNode } from "@/lib/workspace/model";

vi.mock("@/lib/tauri", () => ({
  executeSql: vi.fn(() => Promise.resolve([])),
  executeMongo: vi.fn(() => Promise.resolve([])),
  fetchSchema: vi.fn(() => Promise.resolve([])),
  connectDatabase: vi.fn(() => Promise.resolve({ tables: [], views: [] })),
  cancelQuery: vi.fn(),
  disconnectDatabase: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    dismiss: vi.fn(),
  },
}));

const mockExecuteSql = vi.mocked(executeSql);
const mockExecuteMongo = vi.mocked(executeMongo);

type Handlers = Parameters<ScriptRunner["run"]>[2];

// A controllable fake ScriptRunner injected into ScriptTab (jsdom has no real Worker, so the port
// stands in - same pattern as the WindowController fake). It captures the handlers from run() so the
// test can drive onLog/onRpc/onDone/onError like the worker would, and counts terminate().
function makeFakeRunner() {
  const state: {
    runCalls: { code: string; engine: string }[];
    handlers: Handlers | null;
    terminateCount: number;
  } = { runCalls: [], handlers: null, terminateCount: 0 };
  const runner: ScriptRunner = {
    run(code, engine, handlers) {
      state.runCalls.push({ code, engine });
      state.handlers = handlers;
    },
    terminate() {
      state.terminateCount += 1;
    },
  };
  return { runner, state };
}

const config: ConnectionConfig = {
  engine: "postgres",
  host: "localhost",
  port: 5432,
  database: "app",
  user: "postgres",
  password: "postgres",
};

function databaseNode(overrides: Partial<DatabaseNode>): DatabaseNode {
  return {
    kind: "database",
    accentColor: null,
    readOnly: false,
    id: "db-a",
    name: "a",
    engine: "postgres",
    host: "localhost",
    port: 5432,
    database: "app",
    user: "postgres",
    password: "postgres",
    tables: [],
    views: [],
    sql: "SELECT 1",
    savedScripts: [],
    savedJsScripts: [{ name: "s1", code: "return 1;" }],
    result: {
      status: "success",
      timeMs: 0,
      rowCount: 0,
      columns: [],
      rows: [],
      message: "",
    },
    ...overrides,
  } as unknown as DatabaseNode;
}

function newClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderScript(opts?: {
  connected?: boolean;
  consoleLines?: string[];
  node?: DatabaseNode;
}) {
  const { runner, state } = makeFakeRunner();
  const node = opts?.node ?? databaseNode({});
  const tree: TreeNode[] = [node];
  render(
    <QueryClientProvider client={newClient()}>
      <WorkspaceProvider
        tree={tree}
        initialActiveTabId={node.id}
        initialConnections={opts?.connected ? [[node.id, config]] : []}
        consoleLines={opts?.consoleLines ?? []}
      >
        <ScriptTab runner={runner} />
        <Console />
      </WorkspaceProvider>
    </QueryClientProvider>,
  );
  return { state };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ScriptTab layout", () => {
  // AC-001 - behavior (a real editor + Run, not the old mock <pre>)
  it("should render a JS editor and a Run button", () => {
    renderScript({ connected: true });

    expect(document.querySelector(".cm-editor")).not.toBeNull();
    expect(screen.getByRole("button", { name: /^run$/i })).toBeInTheDocument();
    // The old dead panel is gone.
    expect(screen.queryByText(/no script/i)).not.toBeInTheDocument();
  });

  // AC-001, AC-010 - behavior (saved-script document tabs, mirroring the SQL tab)
  it("should render the saved JS script as a document tab", () => {
    renderScript({ connected: true });

    expect(screen.getByRole("tab", { name: "s1" })).toBeInTheDocument();
  });
});

describe("ScriptTab connection gating", () => {
  // AC-008, TC-008 - behavior (Run disabled + connect hint when the database is not connected)
  it("should disable Run and show the connect hint when the database is disconnected", () => {
    renderScript({ connected: false });

    expect(screen.getByRole("button", { name: /^run$/i })).toBeDisabled();
    expect(screen.getByText(/connect first \(settings tab\)/i)).toBeInTheDocument();
  });

  // AC-008 - behavior (Run enabled once connected)
  it("should enable Run once the database is connected", () => {
    renderScript({ connected: true });

    expect(screen.getByRole("button", { name: /^run$/i })).toBeEnabled();
  });
});

describe("ScriptTab run drives the injected runner", () => {
  // AC-002, AC-003 - side-effect-contract (clicking Run drives the injected runner's run())
  it("should invoke the injected runner's run with the editor code and engine when Run is clicked", async () => {
    const user = userEvent.setup();
    const { state } = renderScript({ connected: true });

    await user.click(screen.getByRole("button", { name: /^run$/i }));

    await waitFor(() => expect(state.runCalls).toHaveLength(1));
    expect(state.runCalls[0].engine).toBe("postgres");
    expect(state.runCalls[0].code).toContain("return 1");
  });

  // AC-008 - side-effect-contract (the run-query shortcut Cmd/Ctrl+Enter in the editor also runs)
  it("should drive the runner on Ctrl+Enter inside the editor", async () => {
    const user = userEvent.setup();
    const { state } = renderScript({ connected: true });

    const content = document.querySelector<HTMLElement>(".cm-content");
    if (!content) {
      throw new Error(".cm-content not found");
    }
    await user.click(content);
    await user.keyboard("{Control>}{Enter}{/Control}");

    await waitFor(() => expect(state.runCalls.length).toBeGreaterThan(0));
  });
});

describe("ScriptTab console streaming", () => {
  // AC-005, TC-001 - behavior (a runner onLog line appears in the bottom Console panel)
  it("should show a console.log line in the Console panel when the runner emits onLog", async () => {
    const user = userEvent.setup();
    const { state } = renderScript({ connected: true });

    await user.click(screen.getByRole("button", { name: /^run$/i }));
    act(() => state.handlers?.onLog("log", "got 3 rows"));

    const region = screen.getByRole("region", { name: /console/i });
    expect(await within(region).findByText(/got 3 rows/)).toBeInTheDocument();
  });

  // AC-005 - behavior (the log APPENDS - a pre-existing line survives, not cleared on Run)
  it("should keep prior console lines and append the new one (not clear on Run)", async () => {
    const user = userEvent.setup();
    const { state } = renderScript({
      connected: true,
      consoleLines: ["[earlier] previous line"],
    });

    await user.click(screen.getByRole("button", { name: /^run$/i }));
    act(() => state.handlers?.onLog("log", "fresh line"));

    const region = screen.getByRole("region", { name: /console/i });
    await within(region).findByText(/fresh line/);
    expect(within(region).getByText(/previous line/)).toBeInTheDocument();
  });
});

describe("ScriptTab result rendering", () => {
  // AC-007, TC-001 - behavior (a valid {header, rows} return renders the shared read-only grid)
  it("should render a result grid when the runner returns a valid header/rows shape", async () => {
    const user = userEvent.setup();
    const { state } = renderScript({ connected: true });

    await user.click(screen.getByRole("button", { name: /^run$/i }));
    act(() =>
      state.handlers?.onDone({
        header: ["id", "name"],
        rows: [
          ["1", "Ada"],
          ["2", "Linus"],
        ],
      }),
    );

    expect(
      await screen.findByRole("columnheader", { name: "name" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("Linus")).toBeInTheDocument();
  });

  // AC-007, AC-009, TC-006 - behavior (a non-grid return shows Done and renders no grid)
  it("should show Done and render no grid for a non-header/rows return value", async () => {
    const user = userEvent.setup();
    const { state } = renderScript({ connected: true });

    await user.click(screen.getByRole("button", { name: /^run$/i }));
    act(() => state.handlers?.onDone(["users", "orders"]));

    await waitFor(() =>
      expect(screen.getByText(/^done$/i)).toBeInTheDocument(),
    );
    expect(screen.queryByRole("columnheader")).toBeNull();
  });
});

describe("ScriptTab status transitions", () => {
  // AC-009, TC-005 - behavior (an onError shows the red message and does NOT stay in Running...)
  it("should show the error message and leave Running when the runner reports onError", async () => {
    const user = userEvent.setup();
    const { state } = renderScript({ connected: true });

    await user.click(screen.getByRole("button", { name: /^run$/i }));
    act(() => state.handlers?.onError("boom"));

    // The error surfaces in BOTH the red status line and a Console error line (spec TC-005), so
    // there are two matches - assert at least one and that we're no longer stuck on Running.
    await waitFor(() =>
      expect(screen.getAllByText(/boom/).length).toBeGreaterThan(0),
    );
    expect(screen.queryByText(/running\.\.\./i)).toBeNull();
  });

  // AC-008, TC-004 - behavior (while running the button is Cancel; clicking it terminates the worker
  // and shows a neutral Cancelled status)
  it("should show Cancel while running and terminate the runner with a Cancelled status on click", async () => {
    const user = userEvent.setup();
    const { state } = renderScript({ connected: true });

    await user.click(screen.getByRole("button", { name: /^run$/i }));

    const cancel = await screen.findByRole("button", { name: /^cancel$/i });
    await user.click(cancel);

    expect(state.terminateCount).toBe(1);
    await waitFor(() =>
      expect(screen.getByText(/^cancelled$/i)).toBeInTheDocument(),
    );
  });
});

describe("ScriptTab read-only write guard", () => {
  // AC-006, TC-003 - behavior (a write-shaped query over the RPC bridge is rejected: a read-only
  // error line appears in the Console and executeSql is NEVER called)
  it("should reject a write-shaped db.query, log a read-only error, and not execute it", async () => {
    const user = userEvent.setup();
    const { state } = renderScript({ connected: true });

    await user.click(screen.getByRole("button", { name: /^run$/i }));
    await act(async () => {
      state.handlers?.onRpc("rpc-1", "query", [
        "update users set name='x' where id=1",
      ]);
    });

    const region = screen.getByRole("region", { name: /console/i });
    expect(await within(region).findByText(/read-only/i)).toBeInTheDocument();
    expect(mockExecuteSql).not.toHaveBeenCalled();
  });
});

describe("ScriptTab db API routes to the backend (AC-004)", () => {
  // AC-004 - side-effect-contract (a read-shaped db.query routes to executeSql and returns rows to
  // the script as an array-of-objects reply)
  it("should route a read db.query to executeSql and reply with row objects", async () => {
    const user = userEvent.setup();
    mockExecuteSql.mockResolvedValueOnce([
      {
        statement: "select id, name from users",
        columns: ["id", "name"],
        rows: [["1", "Ada"]],
        rowsAffected: 0,
        returnsRows: true,
        message: "1 row",
      },
    ]);
    const { state } = renderScript({ connected: true });

    await user.click(screen.getByRole("button", { name: /^run$/i }));
    let reply: unknown;
    await act(async () => {
      reply = await state.handlers?.onRpc("rpc-1", "query", [
        "select id, name from users",
      ]);
    });

    expect(mockExecuteSql).toHaveBeenCalledWith(
      "db-a",
      "select id, name from users",
      expect.any(String),
    );
    expect(reply).toEqual({ result: [{ id: "1", name: "Ada" }] });
  });

  // AC-004, TC-002 - side-effect-contract (db.find builds a db.<coll>.find(<filter>) command for
  // executeMongo, carrying the filter, not just the bare collection name)
  it("should build a db.<coll>.find(filter) command for executeMongo on db.find", async () => {
    const user = userEvent.setup();
    mockExecuteMongo.mockResolvedValueOnce([
      {
        statement: "db.orders.find({...})",
        columns: ["_id"],
        rows: [["a1"]],
        rowsAffected: 0,
        returnsRows: true,
        message: "1 doc",
      },
    ]);
    const node = databaseNode({ engine: "mongodb" });
    const { state } = renderScript({ connected: true, node });

    await user.click(screen.getByRole("button", { name: /^run$/i }));
    await act(async () => {
      await state.handlers?.onRpc("rpc-1", "find", [
        "orders",
        { status: "paid" },
      ]);
    });

    expect(mockExecuteMongo).toHaveBeenCalledWith(
      "db-a",
      'db.orders.find({"status":"paid"})',
      expect.any(String),
    );
  });

  // AC-003, TC-005 - behavior (a backend error from db.query is caught and returned as an error
  // reply, never left unresolved - a rejected reply would deadlock the worker's await)
  it("should return an error reply (not hang) when executeSql rejects", async () => {
    const user = userEvent.setup();
    mockExecuteSql.mockRejectedValueOnce(
      new Error('syntax error near "name"'),
    );
    const { state } = renderScript({ connected: true });

    await user.click(screen.getByRole("button", { name: /^run$/i }));
    let reply: unknown;
    await act(async () => {
      reply = await state.handlers?.onRpc("rpc-1", "query", [
        "select count(*) from weird name",
      ]);
    });

    expect(reply).toEqual({ error: expect.stringMatching(/syntax error/i) });
    const region = screen.getByRole("region", { name: /console/i });
    expect(
      await within(region).findByText(/syntax error/i),
    ).toBeInTheDocument();
  });
});

describe("ScriptTab ill-shaped grid return (AC-007, TC-006)", () => {
  // AC-007, TC-006 - behavior (a return that looks like a grid but is ill-shaped logs a validation
  // error and renders no grid)
  it("should log a validation error and render no grid for an ill-shaped header/rows return", async () => {
    const user = userEvent.setup();
    const { state } = renderScript({ connected: true });

    await user.click(screen.getByRole("button", { name: /^run$/i }));
    act(() => state.handlers?.onDone({ header: 1, rows: "x" }));

    const region = screen.getByRole("region", { name: /console/i });
    expect(
      await within(region).findByText(/not a valid.*grid/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("columnheader")).toBeNull();
  });
});

describe("ScriptTab long-run sticky warning (AC-011)", () => {
  // AC-011, TC-004 - behavior (a run still going after ~5s raises a sticky warning toast; no auto-kill)
  it("should raise a sticky warning toast when a run exceeds the warn threshold", async () => {
    vi.useFakeTimers();
    const mockWarning = vi.mocked(toast.warning);
    try {
      const { runner } = makeFakeRunner();
      render(
        <QueryClientProvider client={newClient()}>
          <WorkspaceProvider
            tree={[databaseNode({})]}
            initialActiveTabId="db-a"
            initialConnections={[["db-a", config]]}
          >
            <ScriptTab runner={runner} />
          </WorkspaceProvider>
        </QueryClientProvider>,
      );

      act(() => {
        screen.getByRole("button", { name: /^run$/i }).click();
      });
      expect(mockWarning).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(6000);
      });

      expect(mockWarning).toHaveBeenCalledWith(
        expect.stringMatching(/still running/i),
        expect.objectContaining({ duration: Infinity }),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
