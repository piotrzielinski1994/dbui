import { describe, it, expect, vi, beforeEach } from "vitest";
import { useCallback, useEffect, type ReactNode } from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EditorView } from "@codemirror/view";

import {
  WorkspaceProvider,
  useChrome,
} from "@/components/workspace/workspace-context";
import { TableCard } from "@/components/workspace/table-card";
import { SqlTab } from "@/components/workspace/sql-tab";
import { __dataGridRenderCount } from "@/components/workspace/data-grid";
import { SettingsProvider, useSettings } from "@/lib/settings/settings-context";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/settings/settings";
import { fetchTable, countTable, executeSql } from "@/lib/tauri";
import type { ConnectionConfig, TableRows, TreeNode } from "@/lib/workspace/model";

vi.mock("@/lib/tauri", () => ({
  fetchTable: vi.fn(),
  countTable: vi.fn(),
  applyRowMutations: vi.fn(),
  executeSql: vi.fn(),
  disconnectDatabase: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

const mockFetch = vi.mocked(fetchTable);
const mockCount = vi.mocked(countTable);
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
    accentColor: null,
    readOnly: false,
    manualCommit: false,
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

let toggleConsoleFn: () => void;
function Grabber() {
  const { toggleConsole } = useChrome();
  useEffect(() => {
    toggleConsoleFn = toggleConsole;
  }, [toggleConsole]);
  return null;
}

// Mirror routes/index.tsx: the workspace's onPersist writes the chrome slice back through the
// SETTINGS provider's persist (setSettings -> rebuilds the settings context value). This is the
// real toggle -> persist -> rebuild path that makes a Settings-context consumer re-render.
function Harness({
  activeTabId,
  children,
}: {
  activeTabId: string;
  children: ReactNode;
}) {
  const { settings, persist } = useSettings();
  const theme = settings.theme;
  const shortcuts = settings.shortcuts;
  const onPersist = useCallback(
    (next: Omit<Settings, "theme" | "shortcuts" | "windowFullscreen">) =>
      persist({ ...next, theme, shortcuts } as Settings),
    [persist, theme, shortcuts],
  );
  return (
    <WorkspaceProvider
      tree={tree}
      initialActiveTabId={activeTabId}
      initialConnections={[["db-ppp", config]]}
      onPersist={onPersist}
    >
      {children}
    </WorkspaceProvider>
  );
}

function rowsResult(): TableRows {
  return {
    columns: [
      { name: "id", dataType: "int4", nullable: false, isPrimaryKey: true },
      { name: "name", dataType: "text", nullable: true, isPrimaryKey: false },
    ],
    rows: Array.from({ length: 50 }, (_, i) => [String(i + 1), `n${i + 1}`]),
    primaryKey: "id",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCount.mockResolvedValue(0);
});

// Regression guard for the "toggle lag on a large open table" bug: the memoized DataGrid must NOT
// re-render when an unrelated chrome toggle (sidebar/console) fires. It broke because the grid
// consumed the Settings context (for the delete-rows binding), and a chrome write rebuilds that
// value; the fix passes `shortcuts` as a stable-ref prop so memo absorbs the toggle.
describe("grid does not re-render on a chrome toggle", () => {
  it("should not re-render the table-card grid when the console toggles", async () => {
    mockFetch.mockResolvedValue(rowsResult());
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const store = createInMemorySettingsStore(DEFAULT_SETTINGS as Settings);
    render(
      <QueryClientProvider client={queryClient}>
        <SettingsProvider store={store}>
          <Harness activeTabId="db-ppp::product">
            <Grabber />
            <TableCard />
          </Harness>
        </SettingsProvider>
      </QueryClientProvider>,
    );

    await screen.findByText("n1");
    const before = __dataGridRenderCount.value;
    act(() => toggleConsoleFn());
    await waitFor(() => {});
    expect(__dataGridRenderCount.value - before).toBe(0);
  });

  it("should not re-render the SQL result grid when the console toggles", async () => {
    const user = userEvent.setup();
    mockExecute.mockResolvedValue([
      {
        statement: "stmt",
        columns: ["id", "name"],
        rows: Array.from({ length: 50 }, (_, i) => [String(i + 1), `n${i + 1}`]),
        rowsAffected: 50,
        returnsRows: true,
        message: "SELECT 50",
      },
    ]);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const store = createInMemorySettingsStore(DEFAULT_SETTINGS as Settings);
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <SettingsProvider store={store}>
          <Harness activeTabId="db-ppp">
            <Grabber />
            <SqlTab />
          </Harness>
        </SettingsProvider>
      </QueryClientProvider>,
    );

    await screen.findByRole("textbox", { name: /sql editor/i });
    const editorEl = container.querySelector<HTMLElement>(".cm-editor");
    const view = editorEl ? EditorView.findFromDOM(editorEl) : null;
    if (!view) {
      throw new Error("SQL editor not found");
    }
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: "SELECT 1" },
    });
    await user.click(screen.getByRole("button", { name: /run/i }));
    await screen.findByText("n1");

    const before = __dataGridRenderCount.value;
    act(() => toggleConsoleFn());
    await waitFor(() => {});
    expect(__dataGridRenderCount.value - before).toBe(0);
  });
});
