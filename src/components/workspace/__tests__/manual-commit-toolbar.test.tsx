import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { ContentHeader } from "@/components/workspace/content-header";
import {
  commitTransaction,
  rollbackTransaction,
  transactionState,
} from "@/lib/tauri";
import type { TreeNode } from "@/lib/workspace/model";

// F12 content-header Commit/Rollback toolbar. The four transaction bindings are NEW in @/lib/tauri;
// this suite mocks them and asserts the toolbar only appears for a manual-commit db with an open tx.
// The toolbar + these bindings do NOT exist yet, so this whole file is RED until F12 lands.
vi.mock("@/lib/tauri", () => ({
  connectDatabase: vi.fn(),
  fetchSchema: vi.fn(() => Promise.resolve([])),
  disconnectDatabase: vi.fn(),
  cancelConnect: vi.fn(),
  beginTransaction: vi.fn(() => Promise.resolve()),
  commitTransaction: vi.fn(() => Promise.resolve()),
  rollbackTransaction: vi.fn(() => Promise.resolve()),
  transactionState: vi.fn(() => Promise.resolve(false)),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

const mockTxState = vi.mocked(transactionState);
const mockCommit = vi.mocked(commitTransaction);
const mockRollback = vi.mocked(rollbackTransaction);

const DB_ID = "db-mc";

// A single database node whose manualCommit flag the test controls, opened as the active tab. Built
// inline (cast) so the runtime type edit isn't a prerequisite for the behaviour under test.
function tree(manualCommit: boolean): TreeNode[] {
  return [
    {
      kind: "database",
      accentColor: null,
      readOnly: false,
      manualCommit,
      id: DB_ID,
      name: "mc_db",
      engine: "postgres",
      host: "localhost",
      port: 5432,
      database: "mc",
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

function renderHeader(manualCommit: boolean) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceProvider
        tree={tree(manualCommit)}
        initialActiveTabId={DB_ID}
        initialConnectionStatus={[[DB_ID, "connected"]]}
      >
        <ContentHeader />
      </WorkspaceProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockTxState.mockResolvedValue(false);
});

describe("Content-header manual-commit toolbar (AC-008, TC-010)", () => {
  // AC-008, TC-010 - behavior (manual-commit db + open tx -> Commit and Rollback controls render)
  it("should show Commit and Rollback buttons when the active db is manual-commit with an open tx", async () => {
    mockTxState.mockResolvedValue(true);
    renderHeader(true);

    expect(
      await screen.findByRole("button", { name: /commit/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /rollback/i }),
    ).toBeInTheDocument();
  });

  // AC-008 - behavior (an "uncommitted" cue is visible while a tx is open)
  it("should show an uncommitted-changes cue while the tx is open", async () => {
    mockTxState.mockResolvedValue(true);
    renderHeader(true);

    await screen.findByRole("button", { name: /commit/i });
    expect(screen.getByText(/uncommitted/i)).toBeInTheDocument();
  });

  // AC-008, TC-010 - behavior (manual-commit db but NO open tx -> no Commit/Rollback controls)
  it("should not show Commit/Rollback when the manual-commit db has no open tx", async () => {
    mockTxState.mockResolvedValue(false);
    renderHeader(true);

    // Let the tx-state query settle before asserting the negative.
    await waitFor(() => {
      expect(mockTxState).toHaveBeenCalled();
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(
      screen.queryByRole("button", { name: /rollback/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/uncommitted/i)).not.toBeInTheDocument();
  });

  // AC-008, TC-011 - behavior (a non-manual-commit db never shows the toolbar even if a stray
  // tx-state came back true; the flag gates it)
  it("should not show Commit/Rollback when the active db is not in manual-commit mode", async () => {
    mockTxState.mockResolvedValue(true);
    renderHeader(false);

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(
      screen.queryByRole("button", { name: /rollback/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/uncommitted/i)).not.toBeInTheDocument();
  });
});

describe("Content-header manual-commit commit flow (AC-004, TC-012)", () => {
  // AC-004, TC-012 - side-effect-contract (clicking Commit opens a confirm modal listing the tx
  // statements; confirming in the modal calls commitTransaction once for the active db)
  it("should call commitTransaction once with the active db id when the Commit modal is confirmed", async () => {
    const user = userEvent.setup();
    mockTxState.mockResolvedValue(true);
    renderHeader(true);

    // The toolbar Commit opens the modal (does NOT commit yet).
    await user.click(await screen.findByRole("button", { name: /^commit$/i }));
    expect(mockCommit).not.toHaveBeenCalled();

    // Confirm inside the dialog.
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: /^commit$/i,
      }),
    );

    await waitFor(() => {
      expect(mockCommit).toHaveBeenCalledTimes(1);
    });
    expect(mockCommit).toHaveBeenCalledWith(DB_ID);
  });

  // AC-004 - behavior (the Commit modal cancels without committing)
  it("should not call commitTransaction when the Commit modal is cancelled", async () => {
    const user = userEvent.setup();
    mockTxState.mockResolvedValue(true);
    renderHeader(true);

    await user.click(await screen.findByRole("button", { name: /^commit$/i }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: /^cancel$/i,
      }),
    );

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(mockCommit).not.toHaveBeenCalled();
  });

  // AC-005, TC-010 - side-effect-contract (clicking Rollback calls rollbackTransaction once for the
  // active db)
  it("should call rollbackTransaction once with the active db id when Rollback is clicked", async () => {
    const user = userEvent.setup();
    mockTxState.mockResolvedValue(true);
    renderHeader(true);

    await user.click(await screen.findByRole("button", { name: /rollback/i }));

    await waitFor(() => {
      expect(mockRollback).toHaveBeenCalledTimes(1);
    });
    expect(mockRollback).toHaveBeenCalledWith(DB_ID);
  });

  // AC-004, AC-008, TC-012 - behavior (after Commit the tx-state query is invalidated; once it
  // reports closed the Commit/Rollback controls disappear - the toolbar disables)
  it("should hide the toolbar after a commit resolves the tx closed", async () => {
    const user = userEvent.setup();
    mockTxState.mockResolvedValue(true);
    renderHeader(true);

    await user.click(await screen.findByRole("button", { name: /^commit$/i }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: /^commit$/i,
      }),
    );

    // The tx is now closed; the commit sets tx-state false authoritatively.
    mockTxState.mockResolvedValue(false);

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /rollback/i }),
      ).not.toBeInTheDocument();
    });
  });
});
