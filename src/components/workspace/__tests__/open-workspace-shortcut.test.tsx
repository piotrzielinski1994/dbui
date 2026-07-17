import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { QueryWrapper } from "@/test/query-wrapper";
import { WorkspaceLoader } from "@/components/workspace/workspace-loader";
import { SettingsProvider } from "@/lib/settings/settings-context";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { DEFAULT_SETTINGS } from "@/lib/settings/settings";
import { createInMemoryWorkspaceFs } from "@/lib/workspace/in-memory-fs";
import { createNoopFolderPicker } from "@/lib/workspace/folder-picker";
import { serialize } from "@/lib/workspace/disk-format";
import type { FolderPicker } from "@/lib/workspace/folder-picker";
import type { DatabaseNode, QueryResult, TreeNode } from "@/lib/workspace/model";

vi.mock("@/lib/tauri", () => ({
  connectDatabase: vi.fn(() => Promise.resolve({ tables: [], views: [] })),
  fetchSchema: vi.fn(() => Promise.resolve([])),
  cancelConnect: vi.fn(),
  disconnectDatabase: vi.fn(),
}));

vi.mock("sonner", () => ({
  Toaster: () => null,
  toast: { success: vi.fn(), error: vi.fn() },
}));

const EMPTY_RESULT: QueryResult = {
  status: "success",
  timeMs: 0,
  rowCount: 0,
  columns: [],
  rows: [],
  message: "",
};

const pickedTree: TreeNode[] = [
  {
    kind: "folder",
    id: "folder-picked",
    name: "PickedCollection",
    children: [
      {
        kind: "database",
        id: "db-picked",
        name: "picked_db",
        engine: "postgres",
        host: "localhost",
        port: 5432,
        database: "app",
        user: "u",
        password: "p",
        accentColor: null,
        readOnly: false,
        manualCommit: false,
        defaultSchema: null,
        tables: [],
        views: [],
        sql: "",
        savedScripts: [],
        savedJsScripts: [],
        variables: [],
        result: { ...EMPTY_RESULT },
      } satisfies DatabaseNode,
    ],
  },
];

function renderLoader(picker: FolderPicker) {
  const settingsStore = createInMemorySettingsStore({ ...DEFAULT_SETTINGS });
  const fs = createInMemoryWorkspaceFs({
    "/ws/picked": serialize(pickedTree, "Picked"),
  });
  render(
    <QueryWrapper>
      <SettingsProvider store={settingsStore}>
        <WorkspaceLoader fs={fs} picker={picker} />
      </SettingsProvider>
    </QueryWrapper>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("open-workspace (Mod+O)", () => {
  // AC-002, TC-013 - behavior: Mod+O resolves a folder -> saved + loaded
  it("should save the picked path and load that workspace if Mod+O resolves a folder", async () => {
    const user = userEvent.setup();
    const picker: FolderPicker = { pick: () => Promise.resolve("/ws/picked") };
    renderLoader(picker);

    await screen.findByRole("button", { name: /open workspace folder/i });

    await user.keyboard("{Control>}o{/Control}");

    expect(await screen.findByText("PickedCollection")).toBeInTheDocument();
  });

  // AC-003, TC-013 - behavior: a cancelled pick (null) changes nothing
  it("should not change the workspace if Mod+O is cancelled (picker resolves null)", async () => {
    const user = userEvent.setup();
    const picker: FolderPicker = { pick: () => Promise.resolve(null) };
    renderLoader(picker);

    await screen.findByRole("button", { name: /open workspace folder/i });

    await user.keyboard("{Control>}o{/Control}");

    await waitFor(() => {
      expect(screen.queryByText("PickedCollection")).not.toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: /open workspace folder/i }),
    ).toBeInTheDocument();
  });

  // AC-003, TC-013 - behavior: a noop picker (Tauri absent) is a safe no-op
  it("should be a safe no-op if Mod+O fires with a noop picker", async () => {
    const user = userEvent.setup();
    renderLoader(createNoopFolderPicker());

    await screen.findByRole("button", { name: /open workspace folder/i });

    await user.keyboard("{Control>}o{/Control}");

    await waitFor(() => {
      expect(screen.queryByText("PickedCollection")).not.toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: /open workspace folder/i }),
    ).toBeInTheDocument();
  });
});
