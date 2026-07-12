import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditorView } from "@codemirror/view";

import { QueryWrapper } from "@/test/query-wrapper";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { DatabaseCard } from "@/components/workspace/database-card";
import { fixtureTree } from "@/components/workspace/__tests__/fixtures";
import type {
  ConnectionConfig,
  DatabaseNode,
  TreeNode,
} from "@/lib/workspace/model";
import { connectDatabase, executeMongo } from "@/lib/tauri";

vi.mock("@/lib/tauri", () => ({
  connectDatabase: vi.fn(),
  fetchSchema: vi.fn(() => Promise.resolve([])),
  fetchTable: vi.fn(() => Promise.resolve({ columns: [], rows: [], primaryKey: null })),
  countTable: vi.fn(() => Promise.resolve(0)),
  applyRowMutations: vi.fn(),
  executeSql: vi.fn(() => Promise.resolve([])),
  executeMongo: vi.fn(() => Promise.resolve([])),
  cancelQuery: vi.fn(),
  disconnectDatabase: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const mockConnect = vi.mocked(connectDatabase);

beforeEach(() => {
  vi.clearAllMocks();
  mockConnect.mockResolvedValue({ tables: [], views: [] });
});

function renderCard(
  activeTabId?: string,
  initialConnections?: [string, ConnectionConfig][],
) {
  return render(
    <QueryWrapper>
      <WorkspaceProvider
        tree={fixtureTree}
        initialActiveTabId={activeTabId}
        initialConnections={initialConnections}
      >
        <DatabaseCard />
      </WorkspaceProvider>
    </QueryWrapper>,
  );
}

describe("DatabaseCard", () => {
  // AC-008, TC-006 — behavior (the four sub-tabs)
  it("should expose a database-sections tablist with SQL, Views, Script and Settings tabs", () => {
    renderCard("db-app");
    expect(
      screen.getByRole("tablist", { name: /database sections|workbench/i }),
    ).toBeInTheDocument();
    for (const name of ["SQL", "Views", "Script", "Settings"]) {
      expect(screen.getByRole("tab", { name })).toBeInTheDocument();
    }
  });

  // AC-008, TC-006 — behavior (the removed Tables sub-tab is gone)
  it("should not expose a Tables sub-tab", () => {
    renderCard("db-app");
    expect(
      screen.queryByRole("tab", { name: "Tables" }),
    ).not.toBeInTheDocument();
  });

  // AC-008 — behavior (SQL is the default active sub-tab; the editor shows the first saved script,
  // since scripts are document tabs and the first one is the active document)
  it("should render the SQL panel by default editing the first saved script", () => {
    const { container } = renderCard("db-app");
    expect(
      screen.getByRole("textbox", { name: /sql editor/i }),
    ).toBeInTheDocument();
    const editorEl = container.querySelector<HTMLElement>(".cm-editor");
    const view = editorEl ? EditorView.findFromDOM(editorEl) : null;
    // appDb's first saved script is "active_users_script" (sql "SELECT 1").
    expect(view?.state.doc.toString()).toBe("SELECT 1");
  });

  // AC-008, AC-012, TC-006 — behavior (switching to Views). Views now come from the connect
  // catalog (F6 #15): auto-connect populates them, so the mock returns them here.
  it("should render the Views panel when the Views sub-tab is clicked", async () => {
    const user = userEvent.setup();
    mockConnect.mockResolvedValue({
      tables: [],
      views: [
        { schema: null, name: "active_users" },
        { schema: null, name: "daily_signups" },
      ],
    });
    renderCard("db-app");

    await user.click(screen.getByRole("tab", { name: "Views" }));
    expect(await screen.findByText("active_users")).toBeInTheDocument();
    expect(screen.getByText("daily_signups")).toBeInTheDocument();
  });

  // AC-001 — behavior (switching to Script renders the JS editor + saved-script doc tabs)
  it("should render the Script panel when the Script sub-tab is clicked", async () => {
    const user = userEvent.setup();
    renderCard("db-app");

    await user.click(screen.getByRole("tab", { name: "Script" }));
    // The Script tab mounts a JS editor (the SQL pane also stays mounted hidden with its own
    // "Saved scripts" tablist, so target the JS editor by its aria-label).
    expect(
      screen.getByRole("textbox", { name: /javascript editor/i }),
    ).toBeInTheDocument();
  });

  // AC-008, AC-014, TC-006 — behavior (switching to Settings)
  it("should render the Settings panel when the Settings sub-tab is clicked", async () => {
    const user = userEvent.setup();
    renderCard("db-app");

    await user.click(screen.getByRole("tab", { name: "Settings" }));
    expect(screen.getByRole("textbox", { name: /host/i })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /user/i })).toBeInTheDocument();
  });

  // AC-019, E-1 — behavior (no active tab -> no sub-tab tablist)
  it("should not render a database-sections tablist when no tab is active", () => {
    renderCard(undefined);
    expect(
      screen.queryByRole("tablist", { name: /database sections|workbench/i }),
    ).not.toBeInTheDocument();
  });
});

// A MongoDB database node fixture (connected, so the Query tab is live).
function mongoNode(): DatabaseNode {
  return {
    kind: "database",
    id: "db-mongo",
    name: "orders_mongo",
    accentColor: null,
    readOnly: false,
    manualCommit: false,
    engine: "mongodb",
    host: "localhost",
    port: 27017,
    database: "shop",
    user: "app_user",
    password: "m0ngo-pw",
    tables: [
      {
        kind: "table",
        id: "db-mongo::orders",
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
  };
}

function renderMongoCard() {
  const tree: TreeNode[] = [mongoNode()];
  const mongoConfig: ConnectionConfig = {
    engine: "mongodb",
    host: "localhost",
    port: 27017,
    database: "shop",
    user: "app_user",
    password: "m0ngo-pw",
  };
  return render(
    <QueryWrapper>
      <WorkspaceProvider
        tree={tree}
        initialActiveTabId="db-mongo"
        initialConnections={[["db-mongo", mongoConfig]]}
        initialConnectionStatus={[["db-mongo", "connected"]]}
      >
        <DatabaseCard />
      </WorkspaceProvider>
    </QueryWrapper>,
  );
}

describe("DatabaseCard MongoDB engine (TC-012)", () => {
  // TC-012, AC-001 - behavior (a mongodb card shows Query + Script + Settings; no SQL/Views)
  it("should expose Query, Script and Settings tabs for a mongodb database", () => {
    renderMongoCard();
    expect(screen.getByRole("tab", { name: "Query" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Script" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Settings" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Views" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "SQL" })).toBeNull();
  });

  // TC-011, AC-009 - behavior (the Query tab IS the shared SQL editor pane: a JSON editor + Run +
  // the same saved-script document tabs, NOT a bespoke picker/toggle)
  it("should render the shared editor pane with a Run button in the Query tab", () => {
    renderMongoCard();
    expect(
      screen.getByRole("textbox", { name: /sql editor/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^run$/i })).toBeInTheDocument();
    // No bespoke Mongo controls - parity with the SQL tab.
    expect(screen.queryByRole("button", { name: /aggregate/i })).toBeNull();
  });

  // TC-011, AC-009 - behavior (Run routes the buffer to executeMongo, NOT executeSql)
  it("should invoke executeMongo with the editor buffer when Run is clicked", async () => {
    const user = userEvent.setup();
    const mockMongo = vi.mocked(executeMongo);
    renderMongoCard();

    const editor = screen.getByRole("textbox", { name: /sql editor/i });
    await user.click(editor);
    // `{`, `}`, `(`, `)` are userEvent.keyboard meta-chars - type them literally with [[ ]] / escapes.
    await user.keyboard("db.users.find({{}})");
    await user.click(screen.getByRole("button", { name: /^run$/i }));

    await waitFor(() => {
      expect(mockMongo).toHaveBeenCalledTimes(1);
    });
    expect(mockMongo).toHaveBeenCalledWith(
      "db-mongo",
      expect.stringContaining("db.users.find"),
      expect.any(String),
    );
  });
});

describe("DatabaseCard auto-connect", () => {
  // behavior (opening a database view connects it automatically, no manual Connect)
  it("should auto-connect the database when its view is opened", async () => {
    mockConnect.mockResolvedValue({ tables: [{ schema: null, name: "product" }], views: [] });
    renderCard("db-app");

    await waitFor(() => {
      expect(mockConnect).toHaveBeenCalledWith(
        "db-app",
        expect.objectContaining({
          host: "localhost",
          database: "app",
          user: "app_user",
        }),
      );
    });
  });

  // behavior (auto-connect fires once, not on every render)
  it("should auto-connect only once for the same database", async () => {
    mockConnect.mockResolvedValue({ tables: [{ schema: null, name: "product" }], views: [] });
    renderCard("db-app");

    await waitFor(() => {
      expect(mockConnect).toHaveBeenCalledTimes(1);
    });
    // give any stray re-render effects a chance to (wrongly) re-fire
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  // behavior (no auto-connect when there is no active database)
  it("should not auto-connect when no database tab is active", async () => {
    renderCard(undefined);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(mockConnect).not.toHaveBeenCalled();
  });

  // behavior (restored connection still re-fetches its catalog on open)
  it("should auto-connect a restored connection with its saved config when its view is opened", async () => {
    const saved: ConnectionConfig = {
      engine: "postgres",
      host: "saved-host",
      port: 5432,
      database: "saved_db",
      user: "saved_user",
      password: "saved_pw",
    };
    mockConnect.mockResolvedValue({ tables: [{ schema: null, name: "restored_table" }], views: [] });
    renderCard("db-app", [["db-app", saved]]);

    await waitFor(() => {
      expect(mockConnect).toHaveBeenCalledWith("db-app", saved);
    });
  });
});
