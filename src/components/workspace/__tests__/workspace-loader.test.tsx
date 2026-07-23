import { createNoopFolderPicker, type FolderPicker } from "@pziel/pureui";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceLoader } from "@/components/workspace/workspace-loader";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { DEFAULT_SETTINGS } from "@/lib/settings/settings";
import { SettingsProvider } from "@/lib/settings/settings-context";
import type { FileMap } from "@/lib/workspace/disk-format";
import { serialize } from "@/lib/workspace/disk-format";
import type { WorkspaceFs } from "@/lib/workspace/fs";
import { createInMemoryWorkspaceFs } from "@/lib/workspace/in-memory-fs";
import type {
  DatabaseNode,
  QueryResult,
  TreeNode,
} from "@/lib/workspace/model";
import { QueryWrapper } from "@/test/query-wrapper";

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

function pgDatabase(id: string, name: string): DatabaseNode {
  return {
    kind: "database",
    id,
    name,
    engine: "postgres",
    host: "localhost",
    port: 5432,
    database: "app",
    user: "app_user",
    password: "app-secret",
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
  };
}

const sampleTree: TreeNode[] = [
  {
    kind: "folder",
    id: "folder-billing",
    name: "Billing",
    children: [pgDatabase("db-invoices", "invoices_db")],
  },
];

function renderLoader({
  workspacePath,
  workspaces = {},
  picker = createNoopFolderPicker(),
  fs,
}: {
  workspacePath?: string;
  workspaces?: Record<string, FileMap>;
  picker?: FolderPicker;
  fs?: WorkspaceFs;
}) {
  const settingsStore = createInMemorySettingsStore({
    ...DEFAULT_SETTINGS,
    workspacePath,
  });
  const workspaceFs = fs ?? createInMemoryWorkspaceFs(workspaces);
  render(
    <QueryWrapper>
      <SettingsProvider store={settingsStore}>
        <WorkspaceLoader fs={workspaceFs} picker={picker} />
      </SettingsProvider>
    </QueryWrapper>,
  );
  return { workspaces, fs: workspaceFs };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("WorkspaceLoader loaded workspace (TC-004)", () => {
  // AC-004 - behavior: a workspacePath pointing at a workspace loads its tree
  it("should render the loaded workspace tree if workspacePath points to a workspace", async () => {
    renderLoader({
      workspacePath: "/ws/demo",
      workspaces: { "/ws/demo": serialize(sampleTree, "Demo") },
    });

    expect(await screen.findByText("Billing")).toBeInTheDocument();
  });

  // AC-009 - behavior: a partial load surfaces the skipped file in the console
  it("should load the good nodes and surface a skipped malformed file", async () => {
    const files: FileMap = {
      "purequery.workspace.json": JSON.stringify({
        schemaVersion: 1,
        name: "Partial",
      }),
      "good.db.json": JSON.stringify({
        id: "db-good",
        name: "good_db",
        engine: "postgres",
        host: "h",
        port: 5432,
        database: "d",
        user: "u",
        password: "p",
        order: 0,
      }),
      "broken.db.json": "{ not valid json",
    };

    renderLoader({
      workspacePath: "/ws/partial",
      workspaces: { "/ws/partial": files },
    });

    expect(await screen.findByText("good_db")).toBeInTheDocument();
    expect(screen.getByText(/broken\.db\.json/)).toBeInTheDocument();
  });
});

describe("WorkspaceLoader empty state (TC-014)", () => {
  // AC-001 - behavior: no workspacePath renders an Open workspace folder prompt, no tree
  it("should render an Open workspace folder prompt and no tree if no workspacePath is set", async () => {
    renderLoader({ workspacePath: undefined });

    expect(
      await screen.findByRole("button", { name: /open workspace folder/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Billing")).not.toBeInTheDocument();
  });

  // AC-001, TC-014 - behavior: the empty-state button triggers the picker and loads the picked folder
  it("should call the picker and load the chosen folder when the empty-state button is clicked", async () => {
    const user = userEvent.setup();
    const pick = vi.fn(() => Promise.resolve<string | null>("/ws/picked"));
    renderLoader({
      workspacePath: undefined,
      workspaces: { "/ws/picked": serialize(sampleTree, "Picked") },
      picker: { pick },
    });

    await user.click(
      await screen.findByRole("button", { name: /open workspace folder/i }),
    );

    expect(pick).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Billing")).toBeInTheDocument();
  });

  // TC-015 - side-effect-contract: an empty (no-path) workspace never writes to disk
  it("should never write to the fs if there is no workspacePath", async () => {
    const writeWorkspace = vi.fn(() => Promise.resolve({ ok: true as const }));
    const fs: WorkspaceFs = {
      readWorkspace: () => Promise.resolve({ ok: false, error: "no path" }),
      writeWorkspace,
    };

    renderLoader({ workspacePath: undefined, fs });

    await screen.findByRole("button", { name: /open workspace folder/i });
    // Give any mount effects a chance to fire.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(writeWorkspace).not.toHaveBeenCalled();
  });
});

describe("WorkspaceLoader fresh writable (TC-016)", () => {
  // AC-010 - behavior: an unreadable path mounts a writable empty tree (not the read-only prompt)
  it("should mount a writable empty tree if the workspacePath cannot be read", async () => {
    renderLoader({ workspacePath: "/ws/missing", workspaces: {} });

    // The empty tree renders (Navigator), NOT the read-only Open-workspace prompt.
    expect(
      await screen.findByRole("tree", { name: /navigator/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Billing")).not.toBeInTheDocument();
  });

  // AC-010, TC-016 - behavior: the first create bootstraps a manifest + file on disk
  it("should persist a manifest and a new file to a fresh workspacePath on the first create", async () => {
    const user = userEvent.setup();
    const workspaces: Record<string, FileMap> = {};
    renderLoader({ workspacePath: "/ws/fresh", workspaces });

    const tree = await screen.findByRole("tree", { name: /navigator/i });
    await user.pointer({ keys: "[MouseRight>]", target: tree });
    await user.click(
      await screen.findByRole("menuitem", { name: /new database/i }),
    );

    await waitFor(() =>
      expect(
        workspaces["/ws/fresh"]?.["purequery.workspace.json"],
      ).toBeDefined(),
    );
    const written = Object.keys(workspaces["/ws/fresh"] ?? {});
    expect(written.some((path) => path.endsWith(".db.json"))).toBe(true);
  });
});

describe("WorkspaceLoader loaded persist (TC-015)", () => {
  // AC-007, TC-015 - side-effect-contract: editing a loaded tree writes serialize(tree) to the path
  it("should write the reconciled workspace when the loaded tree is edited", async () => {
    const user = userEvent.setup();
    const workspaces: Record<string, FileMap> = {
      "/ws/loaded": serialize(sampleTree, "Loaded"),
    };
    renderLoader({ workspacePath: "/ws/loaded", workspaces });

    await screen.findByText("Billing");
    const seedKeys = Object.keys(workspaces["/ws/loaded"]);

    const tree = screen.getByRole("tree", { name: /navigator/i });
    await user.pointer({ keys: "[MouseRight>]", target: tree });
    await user.click(
      await screen.findByRole("menuitem", { name: /new database/i }),
    );

    await waitFor(() => {
      const afterKeys = Object.keys(workspaces["/ws/loaded"]);
      expect(afterKeys.length).toBeGreaterThan(seedKeys.length);
    });
  });
});
