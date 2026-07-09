import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { ScriptTab } from "@/components/workspace/script-tab";
import { DatabaseCard } from "@/components/workspace/database-card";
import { createNoopRunner } from "@/lib/script/runner";
import type { ConnectionConfig, DatabaseNode, TreeNode } from "@/lib/workspace/model";

vi.mock("@/lib/tauri", () => ({
  executeSql: vi.fn(() => Promise.resolve([])),
  executeMongo: vi.fn(() => Promise.resolve([])),
  fetchSchema: vi.fn(() => Promise.resolve([])),
  connectDatabase: vi.fn(() => Promise.resolve({ tables: [], views: [] })),
  fetchTable: vi.fn(() => Promise.resolve({ columns: [], rows: [], primaryKey: null })),
  countTable: vi.fn(() => Promise.resolve(0)),
  applyRowMutations: vi.fn(),
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
  Toaster: () => null,
}));

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
    ...overrides,
  } as unknown as DatabaseNode;
}

function newClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderScript(opts: { tree: TreeNode[]; activeId: string; connected?: boolean }) {
  return render(
    <QueryClientProvider client={newClient()}>
      <WorkspaceProvider
        tree={opts.tree}
        initialActiveTabId={opts.activeId}
        initialConnections={opts.connected ? [[opts.activeId, config]] : []}
      >
        <ScriptTab runner={createNoopRunner()} />
      </WorkspaceProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

describe("ScriptTab saved-JS document tabs", () => {
  // AC-010 - behavior (a database with no JS scripts auto-creates an "untitled" document tab)
  it("should auto-create an untitled JS script tab when the database has none", async () => {
    renderScript({
      tree: [databaseNode({ id: "db-a", savedJsScripts: [] })],
      activeId: "db-a",
      connected: true,
    });

    const strip = screen.getByRole("tablist", { name: /saved scripts/i });
    const chip = await within(strip).findByRole("tab", { name: "untitled" });
    expect(chip).toHaveAttribute("aria-selected", "true");
  });

  // AC-010 - behavior (clicking "+" creates a fresh untitled document tab, no dialog)
  it("should create a new untitled JS tab on + without a dialog", async () => {
    const user = userEvent.setup();
    renderScript({
      tree: [
        databaseNode({
          id: "db-a",
          savedJsScripts: [{ name: "report", code: "return 1;" }],
        }),
      ],
      activeId: "db-a",
      connected: true,
    });

    await user.click(screen.getByRole("button", { name: /new script/i }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const strip = screen.getByRole("tablist", { name: /saved scripts/i });
    const untitled = await within(strip).findByRole("tab", { name: "untitled" });
    expect(untitled).toHaveAttribute("aria-selected", "true");
  });

  // AC-010 - behavior (a second "+" makes untitled-2, not a duplicate untitled)
  it("should name the second new JS tab untitled-2", async () => {
    const user = userEvent.setup();
    renderScript({
      tree: [databaseNode({ id: "db-a", savedJsScripts: [] })],
      activeId: "db-a",
      connected: true,
    });

    const strip = screen.getByRole("tablist", { name: /saved scripts/i });
    await within(strip).findByRole("tab", { name: "untitled" });
    await user.click(screen.getByRole("button", { name: /new script/i }));

    expect(
      await within(strip).findByRole("tab", { name: "untitled-2" }),
    ).toBeInTheDocument();
  });

  // AC-010, TC-007 - behavior (the X on a JS chip deletes that script)
  it("should delete a JS script when its chip close button is clicked", async () => {
    const user = userEvent.setup();
    renderScript({
      tree: [
        databaseNode({
          id: "db-a",
          savedJsScripts: [
            { name: "keep", code: "return 1;" },
            { name: "drop", code: "return 2;" },
          ],
        }),
      ],
      activeId: "db-a",
      connected: true,
    });

    const strip = screen.getByRole("tablist", { name: /saved scripts/i });
    expect(within(strip).getByRole("tab", { name: "drop" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /delete drop/i }));

    await waitFor(() =>
      expect(within(strip).queryByRole("tab", { name: "drop" })).toBeNull(),
    );
    expect(within(strip).getByRole("tab", { name: "keep" })).toBeInTheDocument();
  });

  // AC-010, TC-007 - behavior (Cmd/Ctrl+S on an untitled JS document opens the name dialog)
  it("should open the name dialog on Cmd/Ctrl+S for an untitled JS document", async () => {
    const user = userEvent.setup();
    const { container } = renderScript({
      tree: [databaseNode({ id: "db-a", savedJsScripts: [] })],
      activeId: "db-a",
      connected: true,
    });

    await screen.findByRole("tab", { name: "untitled" });
    const content = container.querySelector<HTMLElement>(".cm-content");
    if (!content) {
      throw new Error(".cm-content not found");
    }
    await user.click(content);
    await user.keyboard("{Control>}s{/Control}");

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});

// A MongoDB database node fixture (connected, so the card is live).
function mongoNode(): DatabaseNode {
  return {
    kind: "database",
    id: "db-mongo",
    name: "orders_mongo",
    accentColor: null,
    readOnly: false,
    engine: "mongodb",
    host: "localhost",
    port: 27017,
    database: "shop",
    user: "app_user",
    password: "m0ngo-pw",
    tables: [],
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
  } as unknown as DatabaseNode;
}

describe("DatabaseCard MongoDB Script tab (AC-001)", () => {
  // AC-001 - behavior (the Script tab is added to ALL engines, incl. MongoDB's MONGO_SECTIONS)
  it("should expose a Script tab on a mongodb database card", () => {
    const mongoConfig: ConnectionConfig = {
      engine: "mongodb",
      host: "localhost",
      port: 27017,
      database: "shop",
      user: "app_user",
      password: "m0ngo-pw",
    };
    render(
      <QueryClientProvider client={newClient()}>
        <WorkspaceProvider
          tree={[mongoNode()]}
          initialActiveTabId="db-mongo"
          initialConnections={[["db-mongo", mongoConfig]]}
          initialConnectionStatus={[["db-mongo", "connected"]]}
        >
          <DatabaseCard />
        </WorkspaceProvider>
      </QueryClientProvider>,
    );

    expect(screen.getByRole("tab", { name: "Script" })).toBeInTheDocument();
  });
});
