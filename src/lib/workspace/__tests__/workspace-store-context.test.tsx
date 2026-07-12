import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  WorkspaceStoreProvider,
  useWorkspaceStore,
} from "@/lib/workspace/workspace-store-context";
import { createInMemoryWorkspaceStore } from "@/lib/workspace/in-memory-store";
import {
  DEFAULT_WORKSPACE,
  type PersistedWorkspace,
  type WorkspaceStore,
} from "@/lib/workspace/workspace";
import type { DatabaseNode, TreeNode } from "@/lib/workspace/model";

const seededWorkspace: PersistedWorkspace = {
  version: 1,
  tree: [
    {
      kind: "folder",
      id: "folder-prod",
      name: "prod",
      children: [
        {
          kind: "database",
          id: "db-admin",
          name: "admin_db",
          engine: "postgres",
          host: "db.internal",
          port: 5433,
          database: "admin",
          user: "seed_admin",
          password: "s3cr3t-pw",
        },
      ],
    },
  ],
};

const editedDatabaseTree: TreeNode[] = [
  {
    kind: "database",
    id: "db-edited",
    name: "edited_db",
    accentColor: null,
    readOnly: false,
    manualCommit: false,
    engine: "mysql",
    host: "edited.host",
    port: 3306,
    database: "edited",
    user: "editor",
    password: "edit-pw",
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
  },
];

// Renders the hydrated tree node names + first db host, and exposes a button to
// persist a new tree - mirrors the SettingsProbe style (assert on observable DOM).
function WorkspaceStoreProbe({
  persistTarget,
}: {
  persistTarget?: TreeNode[];
}) {
  const { tree, persistTree } = useWorkspaceStore();

  const firstDb = tree
    .flatMap((node) =>
      node.kind === "folder" ? node.children : [node],
    )
    .find((node): node is DatabaseNode => node.kind === "database");

  return (
    <div>
      <span data-testid="node-ids">{tree.map((node) => node.id).join(",")}</span>
      <span data-testid="first-db-host">
        {firstDb && firstDb.engine !== "sqlite" ? firstDb.host : "none"}
      </span>
      <button
        type="button"
        onClick={() => persistTree(persistTarget ?? editedDatabaseTree)}
      >
        persist tree
      </button>
    </div>
  );
}

describe("WorkspaceStoreProvider", () => {
  // AC-006 - behavior
  it("should expose the hydrated loaded tree to children once load resolves", async () => {
    const store = createInMemoryWorkspaceStore(seededWorkspace);

    render(
      <WorkspaceStoreProvider store={store}>
        <WorkspaceStoreProbe />
      </WorkspaceStoreProvider>,
    );

    expect(await screen.findByTestId("node-ids")).toHaveTextContent(
      "folder-prod",
    );
    expect(screen.getByTestId("first-db-host")).toHaveTextContent("db.internal");
  });

  // AC-006, AC-007 - behavior
  it("should expose an empty tree if the store is empty", async () => {
    const store = createInMemoryWorkspaceStore(DEFAULT_WORKSPACE);

    render(
      <WorkspaceStoreProvider store={store}>
        <WorkspaceStoreProbe />
      </WorkspaceStoreProvider>,
    );

    expect(await screen.findByTestId("node-ids")).toHaveTextContent("");
    expect(screen.getByTestId("first-db-host")).toHaveTextContent("none");
  });

  // AC-006 - behavior (renders nothing until load resolves)
  it("should render no children until the async load resolves", () => {
    let resolveLoad: (workspace: PersistedWorkspace) => void = () => {};
    const store: WorkspaceStore = {
      load: () =>
        new Promise<PersistedWorkspace>((resolve) => {
          resolveLoad = resolve;
        }),
      save: () => Promise.resolve(),
    };

    render(
      <WorkspaceStoreProvider store={store}>
        <WorkspaceStoreProbe />
      </WorkspaceStoreProvider>,
    );

    expect(screen.queryByTestId("node-ids")).toBeNull();

    resolveLoad(seededWorkspace);
  });

  // AC-006 - behavior (persistTree updates the live context tree)
  it("should update the context tree when persistTree is called", async () => {
    const user = userEvent.setup();
    const store = createInMemoryWorkspaceStore(seededWorkspace);

    render(
      <WorkspaceStoreProvider store={store}>
        <WorkspaceStoreProbe />
      </WorkspaceStoreProvider>,
    );

    await screen.findByTestId("node-ids");

    await user.click(screen.getByRole("button", { name: /persist tree/i }));

    await waitFor(() => {
      expect(screen.getByTestId("node-ids")).toHaveTextContent("db-edited");
      expect(screen.getByTestId("first-db-host")).toHaveTextContent(
        "edited.host",
      );
    });
  });

  // AC-006 - side-effect-contract (persistTree writes the dehydrated workspace through store.save)
  it("should write the dehydrated workspace through store.save when persistTree is called", async () => {
    const user = userEvent.setup();
    const inner = createInMemoryWorkspaceStore(seededWorkspace);
    const saveSpy = vi.fn(inner.save);
    const store: WorkspaceStore = { load: inner.load, save: saveSpy };

    render(
      <WorkspaceStoreProvider store={store}>
        <WorkspaceStoreProbe />
      </WorkspaceStoreProvider>,
    );

    await screen.findByTestId("node-ids");

    await user.click(screen.getByRole("button", { name: /persist tree/i }));

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalledTimes(1);
    });
    expect(saveSpy.mock.calls[0][0]).toEqual({
      version: 1,
      tree: [
        {
          kind: "database",
          id: "db-edited",
          name: "edited_db",
          engine: "mysql",
          host: "edited.host",
          port: 3306,
          database: "edited",
          user: "editor",
          password: "edit-pw",
        },
      ],
    });
  });

  // AC-006, TC-005 - side-effect-contract (round-trip across remount over the same store)
  it("should round-trip a persisted tree through the store to a fresh provider", async () => {
    const user = userEvent.setup();
    const store = createInMemoryWorkspaceStore(seededWorkspace);

    const first = render(
      <WorkspaceStoreProvider store={store}>
        <WorkspaceStoreProbe />
      </WorkspaceStoreProvider>,
    );

    await screen.findByTestId("node-ids");
    await user.click(screen.getByRole("button", { name: /persist tree/i }));
    await waitFor(() => {
      expect(screen.getByTestId("node-ids")).toHaveTextContent("db-edited");
    });

    first.unmount();

    render(
      <WorkspaceStoreProvider store={store}>
        <WorkspaceStoreProbe />
      </WorkspaceStoreProvider>,
    );

    expect(await screen.findByTestId("first-db-host")).toHaveTextContent(
      "edited.host",
    );
  });

  // AC-006, AC-003 - behavior (loaded workspace is hydrated, not the raw persisted shape)
  it("should hydrate the loaded workspace so the tree carries runtime defaults", async () => {
    const store = createInMemoryWorkspaceStore(seededWorkspace);

    function HydratedProbe() {
      const { tree } = useWorkspaceStore();
      const folder = tree[0] as { children: TreeNode[] } | undefined;
      const db = folder?.children?.[0] as DatabaseNode | undefined;
      return (
        <span data-testid="db-tables">
          {Array.isArray(db?.tables) ? db.tables.length : "missing"}
        </span>
      );
    }

    render(
      <WorkspaceStoreProvider store={store}>
        <HydratedProbe />
      </WorkspaceStoreProvider>,
    );

    expect(await screen.findByTestId("db-tables")).toHaveTextContent("0");
  });
});

describe("useWorkspaceStore", () => {
  // AC-006 - behavior
  it("should throw if used outside a WorkspaceStoreProvider", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    expect(() => render(<WorkspaceStoreProbe />)).toThrow(
      /useWorkspaceStore must be used within a WorkspaceStoreProvider/i,
    );

    consoleError.mockRestore();
  });
});
