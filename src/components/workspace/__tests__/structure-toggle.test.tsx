import { describe, it, expect, vi, beforeEach } from "vitest";
import { useEffect } from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import {
  WorkspaceProvider,
  useStructureView,
} from "@/components/workspace/workspace-context";
import { TableCard } from "@/components/workspace/table-card";
import { SettingsProvider } from "@/lib/settings/settings-context";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/settings/settings";
import { fetchTable, countTable, fetchTableStructure } from "@/lib/tauri";
import type {
  ConnectionConfig,
  TableRows,
  TableStructure,
  TreeNode,
} from "@/lib/workspace/model";

vi.mock("@/lib/tauri", () => ({
  fetchTable: vi.fn(),
  countTable: vi.fn(),
  fetchTableStructure: vi.fn(),
  applyRowMutations: vi.fn(),
  disconnectDatabase: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

const mockFetch = vi.mocked(fetchTable);
const mockCount = vi.mocked(countTable);
const mockStructure = vi.mocked(fetchTableStructure);

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
    accentColor: null,
    readOnly: false,
    engine: "postgres",
    host: "localhost",
    port: 5432,
    database: "ppp",
    user: "postgres",
    password: "postgres",
    tables: [
      {
        kind: "table",
        id: "db-ppp::product",
        name: "product",
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
  },
];

function rowsResult(): TableRows {
  return {
    columns: [
      { name: "id", dataType: "int4", nullable: false, isPrimaryKey: true },
    ],
    rows: [["1"], ["2"]],
    primaryKey: "id",
  };
}

const structure: TableStructure = {
  columns: [
    {
      name: "id",
      dataType: "int4",
      nullable: false,
      isPrimaryKey: true,
      defaultValue: null,
      ordinal: 1,
    },
  ],
  indexes: [
    { name: "product_pkey", columns: ["id"], isUnique: true, isPrimary: true },
  ],
  foreignKeys: [],
  constraints: [],
};

// Reaches into the isolated structure-view context to toggle it programmatically, so the test
// exercises the LiveTable render branch + fetch without simulating the keyboard combo (which
// varies by platform under jsdom). A holder object (not a reassigned module var) keeps the
// react-compiler lint happy.
const toggleRef: { current: () => void } = { current: () => {} };
function Toggler() {
  const { toggleStructureView } = useStructureView();
  useEffect(() => {
    toggleRef.current = toggleStructureView;
  }, [toggleStructureView]);
  return null;
}

// Fires the real toggle-structure-view combo (Mod+Shift+I) on the window, matching how the app's
// keydown listener resolves `Mod` = metaKey || ctrlKey. Used to prove the shortcut works BOTH ways.
function pressToggleShortcut() {
  fireEvent.keyDown(window, {
    key: "i",
    metaKey: true,
    ctrlKey: true,
    shiftKey: true,
  });
}

function renderCard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const store = createInMemorySettingsStore(DEFAULT_SETTINGS as Settings);
  return render(
    <QueryClientProvider client={queryClient}>
      <SettingsProvider store={store}>
        <WorkspaceProvider
          tree={tree}
          initialActiveTabId="db-ppp::product"
          initialConnections={[["db-ppp", config]]}
        >
          <Toggler />
          <TableCard />
        </WorkspaceProvider>
      </SettingsProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCount.mockResolvedValue(0);
  mockFetch.mockResolvedValue(rowsResult());
  mockStructure.mockResolvedValue(structure);
});

describe("TableCard structure view", () => {
  // AC-010 - behavior: structure is NOT fetched until the view is opened (lazy).
  it("should not fetch structure until the view is opened", async () => {
    renderCard();
    await screen.findAllByText("id");
    expect(mockStructure).not.toHaveBeenCalled();

    toggleRef.current();

    await waitFor(() => expect(mockStructure).toHaveBeenCalledTimes(1));
  });

  // AC-009 - behavior: opening the structure view shows the metadata sections over the grid.
  it("should render the structure sections when opened", async () => {
    renderCard();
    await screen.findAllByText("id");
    toggleRef.current();

    expect(await screen.findByText(/^indexes$/i)).toBeInTheDocument();
    expect(screen.getByText("product_pkey")).toBeInTheDocument();
    expect(screen.getByText(/^foreign keys$/i)).toBeInTheDocument();
  });

  // AC-009 regression (verifier finding #1): the KEYBOARD shortcut must work BOTH ways. Opening
  // structure view unmounts TableView; if its listener lived there, a second press would be a
  // no-op. Firing the real combo twice must open then close - so the listener must live on the
  // always-mounted LiveTable.
  it("should toggle the structure view both ways via the keyboard shortcut", async () => {
    renderCard();
    await screen.findAllByText("id");

    pressToggleShortcut();
    expect(await screen.findByText(/^indexes$/i)).toBeInTheDocument();

    pressToggleShortcut();
    await waitFor(() => expect(screen.queryByText(/^indexes$/i)).toBeNull());
    // The grid header is back.
    expect(screen.getAllByText("id").length).toBeGreaterThan(0);
  });

  // AC-010, E-8 - behavior: a structure fetch failure shows the DB message inline, no partial view.
  it("should show the error message when the structure fetch fails", async () => {
    mockStructure.mockRejectedValue(new Error("permission denied for table"));
    renderCard();
    await screen.findAllByText("id");
    toggleRef.current();

    expect(
      await screen.findByText(/permission denied for table/i),
    ).toBeInTheDocument();
  });
});
