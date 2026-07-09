import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EditorView } from "@codemirror/view";
import { useRef } from "react";

import type { ReactNode } from "react";

import {
  WorkspaceProvider,
  useWorkspace,
} from "@/components/workspace/workspace-context";
import { SqlTab } from "@/components/workspace/sql-tab";
import { Content } from "@/components/workspace/content";
import {
  WorkspaceStoreProvider,
  useWorkspaceStore,
} from "@/lib/workspace/workspace-store-context";
import { createInMemoryWorkspaceStore } from "@/lib/workspace/in-memory-store";
import { executeSql } from "@/lib/tauri";
import { toast } from "sonner";
import type {
  ConnectionConfig,
  DatabaseNode,
  SavedScript,
  TreeNode,
} from "@/lib/workspace/model";
import type { WorkspaceStore } from "@/lib/workspace/workspace";

vi.mock("@/lib/tauri", () => ({
  executeSql: vi.fn(),
  disconnectDatabase: vi.fn(),
  connectDatabase: vi.fn(() => Promise.resolve({ tables: [] })),
  cancelConnect: vi.fn(),
  cancelQuery: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const mockToast = vi.mocked(toast);

// jsdom does not implement the pointer-capture / scroll APIs Radix Select relies on to open on a
// click, so polyfill them here (the standard Radix-in-jsdom shim).
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
  } as DatabaseNode;
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

function newClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderSql(opts: {
  tree: TreeNode[];
  activeId: string;
  connected?: boolean;
}) {
  return render(
    <QueryClientProvider client={newClient()}>
      <WorkspaceProvider
        tree={opts.tree}
        initialActiveTabId={opts.activeId}
        initialConnections={opts.connected ? [[opts.activeId, config]] : []}
      >
        <SqlTab />
      </WorkspaceProvider>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Context action: saveScript
// ---------------------------------------------------------------------------

describe("saveScript context action", () => {
  // A probe that calls saveScript on mount via an exposed trigger and reports the active node's
  // savedScripts + the boolean result, so we assert observable state, not internals.
  function Probe({
    databaseId,
    name,
    sql,
    onResult,
  }: {
    databaseId: string;
    name: string;
    sql: string;
    onResult: (result: boolean) => void;
  }) {
    const { saveScript, nodesById } = useWorkspace();
    const node = nodesById.get(databaseId);
    const scripts =
      node && node.kind === "database" ? node.savedScripts : [];
    const calledRef = useRef(false);
    return (
      <div>
        <button
          type="button"
          onClick={() => {
            calledRef.current = true;
            onResult(saveScript(databaseId, name, sql));
          }}
        >
          do-save
        </button>
        <ul aria-label="scripts-probe">
          {scripts.map((script: SavedScript) => (
            <li key={script.name}>{`${script.name}=${script.sql}`}</li>
          ))}
        </ul>
      </div>
    );
  }

  function renderProbe(props: {
    tree: TreeNode[];
    databaseId: string;
    name: string;
    sql: string;
    onResult?: (result: boolean) => void;
  }) {
    return render(
      <WorkspaceProvider tree={props.tree} initialActiveTabId={props.databaseId}>
        <Probe
          databaseId={props.databaseId}
          name={props.name}
          sql={props.sql}
          onResult={props.onResult ?? (() => {})}
        />
      </WorkspaceProvider>,
    );
  }

  // AC-002, TC-001 - behavior (saveScript appends {name, sql} to the target database's list)
  it("should store the {name, sql} on the target database when saveScript is called", async () => {
    const user = userEvent.setup();
    renderProbe({
      tree: [databaseNode({ id: "db-a", savedScripts: [] })],
      databaseId: "db-a",
      name: "one",
      sql: "SELECT 1",
    });

    await user.click(screen.getByText("do-save"));

    const list = screen.getByRole("list", { name: /scripts-probe/i });
    expect(within(list).getByText("one=SELECT 1")).toBeInTheDocument();
  });

  // AC-003, TC-003 - side-effect-contract (a duplicate trimmed name returns false, list unchanged)
  it("should return false and leave the list unchanged when saving a duplicate trimmed name", async () => {
    const user = userEvent.setup();
    const results: boolean[] = [];
    renderProbe({
      tree: [
        databaseNode({
          id: "db-a",
          savedScripts: [{ name: "revenue", sql: "SELECT 2" }],
        }),
      ],
      databaseId: "db-a",
      name: "  revenue  ",
      sql: "SELECT 999",
      onResult: (result) => results.push(result),
    });

    await user.click(screen.getByText("do-save"));

    expect(results).toEqual([false]);
    const list = screen.getByRole("list", { name: /scripts-probe/i });
    // the original entry survives untouched; no new "revenue" with the new sql was added
    expect(within(list).getByText("revenue=SELECT 2")).toBeInTheDocument();
    expect(within(list).queryByText("revenue=SELECT 999")).toBeNull();
    expect(within(list).getAllByText(/^revenue=/)).toHaveLength(1);
  });

  // AC-008, TC-008 - behavior (saving on database A does not add the script to database B)
  it("should keep scripts per database so a save on A does not appear on B", async () => {
    const user = userEvent.setup();

    function TwoDbProbe() {
      const { saveScript, nodesById } = useWorkspace();
      const a = nodesById.get("db-a");
      const b = nodesById.get("db-b");
      const aScripts = a && a.kind === "database" ? a.savedScripts : [];
      const bScripts = b && b.kind === "database" ? b.savedScripts : [];
      return (
        <div>
          <button type="button" onClick={() => saveScript("db-a", "only_a", "SELECT 1")}>
            save-on-a
          </button>
          <ul aria-label="a-scripts">
            {aScripts.map((s: SavedScript) => (
              <li key={s.name}>{s.name}</li>
            ))}
          </ul>
          <ul aria-label="b-scripts">
            {bScripts.map((s: SavedScript) => (
              <li key={s.name}>{s.name}</li>
            ))}
          </ul>
        </div>
      );
    }

    render(
      <WorkspaceProvider
        tree={[
          databaseNode({ id: "db-a", name: "a", savedScripts: [] }),
          databaseNode({ id: "db-b", name: "b", savedScripts: [] }),
        ]}
        initialActiveTabId="db-a"
      >
        <TwoDbProbe />
      </WorkspaceProvider>,
    );

    await user.click(screen.getByText("save-on-a"));

    const aList = screen.getByRole("list", { name: /a-scripts/i });
    const bList = screen.getByRole("list", { name: /b-scripts/i });
    expect(within(aList).getByText("only_a")).toBeInTheDocument();
    expect(within(bList).queryByText("only_a")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SQL tab toolbar UI
// ---------------------------------------------------------------------------

describe("SqlTab scripts toolbar", () => {
  // AC-001 - behavior (the toolbar shows the script chip tabs, the "+" new-script button and Run,
  // with the "+" before Run in document order)
  it("should show script chip tabs, a + new-script button and Run with + left of Run", () => {
    renderSql({
      tree: [
        databaseNode({
          id: "db-a",
          savedScripts: [{ name: "revenue", sql: "SELECT 2" }],
        }),
      ],
      activeId: "db-a",
      connected: true,
    });

    const strip = screen.getByRole("tablist", { name: /saved scripts/i });
    const scriptChip = within(strip).getByRole("tab", { name: "revenue" });
    const newButton = screen.getByRole("button", { name: /new script/i });
    const runButton = screen.getByRole("button", { name: /^run$/i });

    expect(scriptChip).toBeInTheDocument();
    expect(newButton).toBeInTheDocument();
    expect(runButton).toBeInTheDocument();

    // The "+" sits before Run in document order (+ left of Run).
    expect(
      newButton.compareDocumentPosition(runButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  // AC-004 - behavior (the "+" new-script button is always enabled: it creates a fresh untitled tab,
  // it does not save the current buffer, so an empty buffer must not disable it)
  it("should keep the + new-script button enabled even with an empty buffer", () => {
    renderSql({
      tree: [databaseNode({ id: "db-a", sql: "", savedScripts: [] })],
      activeId: "db-a",
      connected: false,
    });

    expect(screen.getByRole("button", { name: /new script/i })).toBeEnabled();
  });

  // AC-006 - behavior (a database with no saved scripts auto-creates an "untitled" document tab so
  // the user can type immediately - scripts are documents, the strip is never empty)
  it("should auto-create an untitled script tab when the database has none", async () => {
    renderSql({
      tree: [databaseNode({ id: "db-a", savedScripts: [] })],
      activeId: "db-a",
      connected: true,
    });

    const strip = screen.getByRole("tablist", { name: /saved scripts/i });
    const chip = await within(strip).findByRole("tab", { name: "untitled" });
    expect(chip).toHaveAttribute("aria-selected", "true");
  });

  // AC-005, TC-002 - behavior (clicking a script chip loads its sql into the editor)
  it("should load a clicked script chip's sql into the editor", async () => {
    const user = userEvent.setup();
    const { container } = renderSql({
      tree: [
        databaseNode({
          id: "db-a",
          savedScripts: [
            { name: "active_users", sql: "SELECT * FROM users WHERE active" },
            { name: "revenue", sql: "SELECT sum(amount) FROM sales" },
          ],
        }),
      ],
      activeId: "db-a",
      connected: true,
    });

    const strip = screen.getByRole("tablist", { name: /saved scripts/i });
    await user.click(within(strip).getByRole("tab", { name: "revenue" }));

    await waitFor(() => {
      expect(liveView(container).state.doc.toString()).toBe(
        "SELECT sum(amount) FROM sales",
      );
    });
  });

  // AC-010 - behavior (the clicked chip becomes the active tab)
  it("should mark the clicked script chip as the active tab", async () => {
    const user = userEvent.setup();
    renderSql({
      tree: [
        databaseNode({
          id: "db-a",
          savedScripts: [
            { name: "active_users", sql: "SELECT 2" },
            { name: "revenue", sql: "SELECT 3" },
          ],
        }),
      ],
      activeId: "db-a",
      connected: true,
    });

    const strip = screen.getByRole("tablist", { name: /saved scripts/i });
    const chip = within(strip).getByRole("tab", { name: "revenue" });
    expect(chip).toHaveAttribute("aria-selected", "false");

    await user.click(chip);

    expect(
      within(strip).getByRole("tab", { name: "revenue" }),
    ).toHaveAttribute("aria-selected", "true");
  });

  // AC-002 - behavior (clicking "+" creates a fresh untitled document tab immediately, NO dialog,
  // and makes it active so the user can type straight away)
  it("should create a new untitled tab on + without a dialog", async () => {
    const user = userEvent.setup();
    renderSql({
      tree: [
        databaseNode({
          id: "db-a",
          savedScripts: [{ name: "revenue", sql: "SELECT 2" }],
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

  // AC-002 - behavior (a second "+" makes "untitled-2", not a duplicate "untitled")
  it("should name the second new tab untitled-2", async () => {
    const user = userEvent.setup();
    renderSql({
      tree: [databaseNode({ id: "db-a", savedScripts: [] })],
      activeId: "db-a",
      connected: true,
    });

    const strip = screen.getByRole("tablist", { name: /saved scripts/i });
    // the auto-created untitled is already present; add one more
    await within(strip).findByRole("tab", { name: "untitled" });
    await user.click(screen.getByRole("button", { name: /new script/i }));

    expect(
      await within(strip).findByRole("tab", { name: "untitled-2" }),
    ).toBeInTheDocument();
  });

  // AC-011, TC-010 - behavior (the X on a chip deletes that script; its chip disappears)
  it("should delete a script when its chip close button is clicked", async () => {
    const user = userEvent.setup();
    renderSql({
      tree: [
        databaseNode({
          id: "db-a",
          savedScripts: [
            { name: "keep", sql: "SELECT 1" },
            { name: "drop", sql: "SELECT 2" },
          ],
        }),
      ],
      activeId: "db-a",
      connected: true,
    });

    const strip = screen.getByRole("tablist", { name: /saved scripts/i });
    expect(within(strip).getByRole("tab", { name: "drop" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /delete drop/i }));

    await waitFor(() => {
      expect(within(strip).queryByRole("tab", { name: "drop" })).toBeNull();
    });
    expect(within(strip).getByRole("tab", { name: "keep" })).toBeInTheDocument();
  });

  // AC-012 - behavior: Cmd/Ctrl+S on an UNTITLED active document opens the name dialog (its first
  // save names it). This is what the user wanted: "+" then type, Cmd+S then name.
  it("should open the name dialog on Cmd/Ctrl+S for an untitled document", async () => {
    const user = userEvent.setup();
    const { container } = renderSql({
      tree: [databaseNode({ id: "db-a", savedScripts: [] })],
      activeId: "db-a",
      connected: true,
    });

    // the auto-created untitled is active; type into it
    await screen.findByRole("tab", { name: "untitled" });
    replaceDoc(liveView(container), "SELECT new_query");

    const content = container.querySelector(".cm-content") as HTMLElement;
    await user.click(content);
    await user.keyboard("{Control>}s{/Control}");

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  // AC-012, AC-013 - behavior: naming an untitled via the dialog renames it in place (no duplicate),
  // persists its current sql, and the renamed chip is active.
  it("should rename the untitled document in place when named via the dialog", async () => {
    const user = userEvent.setup();
    const { container } = renderSql({
      tree: [databaseNode({ id: "db-a", savedScripts: [] })],
      activeId: "db-a",
      connected: true,
    });

    await screen.findByRole("tab", { name: "untitled" });
    replaceDoc(liveView(container), "SELECT 42 AS answer");
    const content = container.querySelector(".cm-content") as HTMLElement;
    await user.click(content);
    await user.keyboard("{Control>}s{/Control}");

    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByRole("textbox"), "answer");
    await user.click(within(dialog).getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    const strip = screen.getByRole("tablist", { name: /saved scripts/i });
    const chip = await within(strip).findByRole("tab", { name: "answer" });
    expect(chip).toHaveAttribute("aria-selected", "true");
    // the untitled chip is gone (renamed, not duplicated)
    expect(within(strip).queryByRole("tab", { name: "untitled" })).toBeNull();
    expect(mockToast.success).toHaveBeenCalledWith('Saved script "answer"');
  });

  // behavior (regression): after renaming an `untitled` in place, a fresh "+" `untitled` must be
  // EMPTY - the renamed document's draft must not leak back into the reused name's buffer.
  it("should open an empty editor for a new untitled after a previous untitled was renamed", async () => {
    const user = userEvent.setup();
    const { container } = renderSql({
      tree: [databaseNode({ id: "db-a", savedScripts: [] })],
      activeId: "db-a",
      connected: true,
    });

    await screen.findByRole("tab", { name: "untitled" });
    replaceDoc(liveView(container), "SELECT 42 AS answer");
    const content = container.querySelector(".cm-content") as HTMLElement;
    await user.click(content);
    await user.keyboard("{Control>}s{/Control}");
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByRole("textbox"), "answer");
    await user.click(within(dialog).getByRole("button", { name: /^save$/i }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    // New "+" untitled - reuses the freed "untitled" name; its editor must be blank.
    await user.click(screen.getByRole("button", { name: /new script/i }));
    await screen.findByRole("tab", { name: "untitled" });
    expect(liveView(container)?.state.doc.toString()).toBe("");
  });

  // AC-003 - side-effect-contract: naming an untitled with an already-taken name is rejected.
  it('should toast `Script "<name>" already exists` when the chosen name is taken', async () => {
    const user = userEvent.setup();
    const { container } = renderSql({
      tree: [
        databaseNode({
          id: "db-a",
          savedScripts: [{ name: "revenue", sql: "SELECT 2" }],
        }),
      ],
      activeId: "db-a",
      connected: true,
    });

    // new untitled, type, Cmd+S, try to name it "revenue" (already exists)
    await user.click(screen.getByRole("button", { name: /new script/i }));
    await screen.findByRole("tab", { name: "untitled" });
    replaceDoc(liveView(container), "SELECT 999");
    const content = container.querySelector(".cm-content") as HTMLElement;
    await user.click(content);
    await user.keyboard("{Control>}s{/Control}");

    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByRole("textbox"), "revenue");
    await user.click(within(dialog).getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('Script "revenue" already exists');
    });
  });

  // AC-014 - behavior: Cmd/Ctrl+S while a NAMED script is the active document overwrites it IN PLACE
  // with NO dialog (the bug: inside `asd2`, Cmd+S wrongly prompted).
  it("should overwrite a named active script on Cmd/Ctrl+S without prompting", async () => {
    const user = userEvent.setup();
    const { container } = renderSql({
      tree: [
        databaseNode({
          id: "db-a",
          savedScripts: [{ name: "asd2", sql: "select old" }],
        }),
      ],
      activeId: "db-a",
      connected: true,
    });

    const strip = screen.getByRole("tablist", { name: /saved scripts/i });
    await user.click(within(strip).getByRole("tab", { name: "asd2" }));
    replaceDoc(liveView(container), "select new_version");

    const content = container.querySelector(".cm-content") as HTMLElement;
    await user.click(content);
    await user.keyboard("{Control>}s{/Control}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledWith('Saved script "asd2"');
    });
  });

  // AC-014 - behavior: the in-place overwrite actually changes the stored sql (no duplicate chip)
  it("should persist the overwritten sql for the active named script", async () => {
    const user = userEvent.setup();
    const store = createInMemoryWorkspaceStore({
      version: 1,
      tree: [
        {
          kind: "database",
          id: "db-a",
          name: "a",
          engine: "postgres",
          host: "localhost",
          port: 5432,
          database: "app",
          user: "postgres",
          password: "postgres",
          savedScripts: [{ name: "asd2", sql: "select old" }],
        },
      ],
    });

    const { container } = render(
      <WorkspaceStoreBridge store={store}>
        {(tree, persistTree) => (
          <QueryClientProvider client={newClient()}>
            <WorkspaceProvider
              tree={tree}
              onTreeChange={persistTree}
              initialActiveTabId="db-a"
              initialConnections={[["db-a", config]]}
            >
              <SqlTab />
            </WorkspaceProvider>
          </QueryClientProvider>
        )}
      </WorkspaceStoreBridge>,
    );

    const strip = await screen.findByRole("tablist", { name: /saved scripts/i });
    await user.click(within(strip).getByRole("tab", { name: "asd2" }));
    replaceDoc(liveView(container), "select new_version");

    const content = container.querySelector(".cm-content") as HTMLElement;
    await user.click(content);
    await user.keyboard("{Control>}s{/Control}");

    await waitFor(async () => {
      const persisted = await store.load();
      const db = persisted.tree[0];
      const scripts = db.kind === "database" ? db.savedScripts : undefined;
      expect(scripts).toEqual([{ name: "asd2", sql: "select new_version" }]);
    });
  });
});

// The editor buffer lives in the provider, not local pane state, so it survives the SQL pane being
// UNMOUNTED when the user switches to a different open content tab (a different database) and back.
// The prior build kept the buffer in component-local state, so it was lost on that switch.
describe("SqlTab editor buffer survives a content-tab switch", () => {
  // AC-013 - behavior (type SQL on db-a, open db-b's tab, return to db-a -> the typed SQL is back).
  // Switching the active content tab unmounts db-a's DatabaseCard entirely (Content renders only the
  // active node), so a component-local buffer would reset to the node seed on return.
  it("should keep the typed SQL after switching to another open tab and back", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <QueryClientProvider client={newClient()}>
        <WorkspaceProvider
          tree={[
            databaseNode({ id: "db-a", name: "a", sql: "SELECT 1" }),
            databaseNode({ id: "db-b", name: "b", sql: "SELECT 2" }),
          ]}
          initialOpenTabIds={["db-a", "db-b"]}
          initialActiveTabId="db-a"
          initialConnections={[
            ["db-a", config],
            ["db-b", config],
          ]}
          initialConnectionStatus={[
            ["db-a", "connected"],
            ["db-b", "connected"],
          ]}
        >
          <Content />
        </WorkspaceProvider>
      </QueryClientProvider>,
    );

    // type a distinctive query into db-a's editor
    replaceDoc(liveView(container), "SELECT typed_on_a");
    expect(liveView(container).state.doc.toString()).toBe("SELECT typed_on_a");

    // switch to db-b's tab (db-a's DatabaseCard + SQL pane unmount), then back to db-a
    const tabs = screen.getByRole("tablist", { name: /open tabs/i });
    await user.click(within(tabs).getByRole("tab", { name: /b/i }));
    await user.click(within(tabs).getByRole("tab", { name: /a/i }));

    await waitFor(() => {
      expect(liveView(container).state.doc.toString()).toBe("SELECT typed_on_a");
    });
  });
});

// Run path (AC-009) is covered unchanged by sql-run.test.tsx; the loaded-then-run flow reuses the
// same executeSql mutation, so we only assert here that loading does not auto-run.
describe("SqlTab load does not auto-run (AC-009)", () => {
  // AC-009 - side-effect-contract (clicking a script chip loads it but does NOT execute it)
  it("should not call executeSql when a script chip is merely clicked", async () => {
    const user = userEvent.setup();
    const mockExecute = vi.mocked(executeSql);
    renderSql({
      tree: [
        databaseNode({
          id: "db-a",
          savedScripts: [{ name: "revenue", sql: "SELECT 2" }],
        }),
      ],
      activeId: "db-a",
      connected: true,
    });

    const strip = screen.getByRole("tablist", { name: /saved scripts/i });
    await user.click(within(strip).getByRole("tab", { name: "revenue" }));

    expect(mockExecute).not.toHaveBeenCalled();
  });
});

// Integration through the REAL persistence pipeline (store -> dehydrate -> mergeWorkspace ->
// hydrate). The unit tests above mock saveScript/the store, which can hide a wiring bug between the
// SqlTab, the WorkspaceProvider tree, and onTreeChange. This drives the actual store so a save that
// fails to reach disk (or a reload that drops it) is caught.
// Exposes the real store context's tree + persistTree to children via a render prop, so the
// integration tests run through the exact provider the app uses (routes/index.tsx).
function WorkspaceStoreBridge({
  store,
  children,
}: {
  store: WorkspaceStore;
  children: (
    tree: TreeNode[],
    persistTree: (tree: TreeNode[]) => void,
  ) => ReactNode;
}) {
  return (
    <WorkspaceStoreProvider store={store}>
      <StoreConsumer>{children}</StoreConsumer>
    </WorkspaceStoreProvider>
  );
}

function StoreConsumer({
  children,
}: {
  children: (
    tree: TreeNode[],
    persistTree: (tree: TreeNode[]) => void,
  ) => ReactNode;
}) {
  const { tree, persistTree } = useWorkspaceStore();
  return <>{children(tree, persistTree)}</>;
}

describe("SqlTab saved-scripts persistence integration", () => {
  function persistedDatabase(savedScripts: SavedScript[]) {
    return {
      version: 1 as const,
      tree: [
        {
          kind: "database" as const,
          id: "db-a",
          name: "a",
          engine: "postgres" as const,
          host: "localhost",
          port: 5432,
          database: "app",
          user: "postgres",
          password: "postgres",
          ...(savedScripts.length > 0 ? { savedScripts } : {}),
        },
      ],
    };
  }

  // A harness that mounts SqlTab behind the real WorkspaceStoreProvider, persisting tree changes to
  // the given in-memory store via onTreeChange (exactly like routes/index.tsx wires it in the app).
  function StoreHarness({ store }: { store: WorkspaceStore }) {
    return (
      <WorkspaceStoreBridge store={store}>
        {(tree, persistTree) => (
          <QueryClientProvider client={newClient()}>
            <WorkspaceProvider
              tree={tree}
              onTreeChange={persistTree}
              initialActiveTabId="db-a"
              initialConnections={[["db-a", config]]}
            >
              <SqlTab />
            </WorkspaceProvider>
          </QueryClientProvider>
        )}
      </WorkspaceStoreBridge>
    );
  }

  // AC-007 - behavior (a named save reaches the store AND survives a reload from that same store).
  // Flow: empty db auto-creates an untitled doc, the user types + Cmd+S + names it.
  it("should persist a named script to the store and restore it on reload", async () => {
    const user = userEvent.setup();
    const store = createInMemoryWorkspaceStore(persistedDatabase([]));

    const first = render(<StoreHarness store={store} />);
    await screen.findByRole("tab", { name: "untitled" });
    const view = await waitFor(() => liveView(first.container));
    replaceDoc(view, "SELECT 7 AS lucky");

    const content = first.container.querySelector(".cm-content") as HTMLElement;
    await user.click(content);
    await user.keyboard("{Control>}s{/Control}");
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByRole("textbox"), "lucky");
    await user.click(within(dialog).getByRole("button", { name: /^save$/i }));

    // It reached the backing store under the chosen name.
    await waitFor(async () => {
      const persisted = await store.load();
      const db = persisted.tree[0];
      expect(db.kind === "database" && db.savedScripts).toEqual([
        { name: "lucky", sql: "SELECT 7 AS lucky" },
      ]);
    });

    // And a fresh mount from that same store shows the chip (reload survives).
    first.unmount();
    render(<StoreHarness store={store} />);
    const strip = await screen.findByRole("tablist", { name: /saved scripts/i });
    expect(
      await within(strip).findByRole("tab", { name: "lucky" }),
    ).toBeInTheDocument();
  });

  // AC-011 - behavior (a delete reaches the store: the script does not come back on reload). Two
  // scripts are seeded so deleting one leaves the other (no auto-untitled re-spawn to muddy this).
  it("should persist a deletion so the script does not return on reload", async () => {
    const user = userEvent.setup();
    const store = createInMemoryWorkspaceStore(
      persistedDatabase([
        { name: "doomed", sql: "SELECT 1" },
        { name: "keep", sql: "SELECT 2" },
      ]),
    );

    const first = render(<StoreHarness store={store} />);
    const strip = await screen.findByRole("tablist", { name: /saved scripts/i });
    expect(
      await within(strip).findByRole("tab", { name: "doomed" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /delete doomed/i }));

    await waitFor(async () => {
      const persisted = await store.load();
      const db = persisted.tree[0];
      const scripts = db.kind === "database" ? db.savedScripts : undefined;
      expect(scripts).toEqual([{ name: "keep", sql: "SELECT 2" }]);
    });

    first.unmount();
    render(<StoreHarness store={store} />);
    const reloadedStrip = await screen.findByRole("tablist", {
      name: /saved scripts/i,
    });
    expect(within(reloadedStrip).queryByRole("tab", { name: "doomed" })).toBeNull();
    expect(
      within(reloadedStrip).getByRole("tab", { name: "keep" }),
    ).toBeInTheDocument();
  });
});
