import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  WorkspaceProvider,
  useWorkspace,
} from "@/components/workspace/workspace-context";
import { fixtureTree } from "@/components/workspace/__tests__/fixtures";
import { findNode } from "@/lib/workspace/tree-edit";

vi.mock("@/lib/tauri", () => ({
  connectDatabase: vi.fn(),
  fetchSchema: vi.fn(() => Promise.resolve([])),
  cancelConnect: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Reads the manualCommit flag off the target database node and exposes the provider's
// setDatabaseManualCommit action.
function Probe({ dbId }: { dbId: string }) {
  const { tree, setDatabaseManualCommit } = useWorkspace();
  const node = findNode(tree, dbId);
  const manualCommit =
    node?.kind === "database"
      ? (node as { manualCommit?: boolean }).manualCommit
      : undefined;

  return (
    <div>
      <span data-testid="mc">{String(manualCommit)}</span>
      <button
        type="button"
        onClick={() => setDatabaseManualCommit(dbId, true)}
      >
        enable manual commit
      </button>
      <button
        type="button"
        onClick={() => setDatabaseManualCommit(dbId, false)}
      >
        disable manual commit
      </button>
    </div>
  );
}

function SiblingProbe({ dbId }: { dbId: string }) {
  const { tree } = useWorkspace();
  const node = findNode(tree, dbId);
  const manualCommit =
    node?.kind === "database"
      ? (node as { manualCommit?: boolean }).manualCommit
      : undefined;
  return <span data-testid="sibling-mc">{String(manualCommit)}</span>;
}

describe("WorkspaceProvider setDatabaseManualCommit (AC-001, TC-009)", () => {
  // AC-001 - behavior (setDatabaseManualCommit(id, true) flips the target database's flag on)
  it("should flip the target database manualCommit to true when set", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider tree={fixtureTree} onTreeChange={vi.fn()}>
        <Probe dbId="db-admin" />
      </WorkspaceProvider>,
    );

    expect(screen.getByTestId("mc").textContent).not.toBe("true");

    await user.click(
      screen.getByRole("button", { name: /enable manual commit/i }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("mc")).toHaveTextContent("true");
    });
  });

  // AC-001 - behavior (setDatabaseManualCommit(id, false) flips it back off)
  it("should flip manualCommit back to false when set with false", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider tree={fixtureTree} onTreeChange={vi.fn()}>
        <Probe dbId="db-admin" />
      </WorkspaceProvider>,
    );

    await user.click(
      screen.getByRole("button", { name: /enable manual commit/i }),
    );
    await waitFor(() => {
      expect(screen.getByTestId("mc")).toHaveTextContent("true");
    });

    await user.click(
      screen.getByRole("button", { name: /disable manual commit/i }),
    );
    await waitFor(() => {
      expect(screen.getByTestId("mc")).toHaveTextContent("false");
    });
  });

  // AC-001 - side-effect-contract (a manualCommit flip triggers the onTreeChange persist effect,
  // carrying the new flag on the persisted node)
  it("should invoke onTreeChange when setDatabaseManualCommit changes a node", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn();
    render(
      <WorkspaceProvider tree={fixtureTree} onTreeChange={onTreeChange}>
        <Probe dbId="db-admin" />
      </WorkspaceProvider>,
    );

    onTreeChange.mockClear();
    await user.click(
      screen.getByRole("button", { name: /enable manual commit/i }),
    );

    await waitFor(() => {
      expect(onTreeChange).toHaveBeenCalled();
    });
    const lastTree = onTreeChange.mock.calls.at(-1)?.[0];
    const persisted = findNode(lastTree, "db-admin");
    expect(
      persisted?.kind === "database"
        ? (persisted as { manualCommit?: boolean }).manualCommit
        : undefined,
    ).toBe(true);
  });

  // AC-001, TC-009 - behavior (setDatabaseManualCommit targets only the named database, leaves
  // siblings alone)
  it("should not touch a sibling database's manualCommit when one is enabled", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider tree={fixtureTree} onTreeChange={vi.fn()}>
        <Probe dbId="db-admin" />
        <SiblingProbe dbId="db-scratch" />
      </WorkspaceProvider>,
    );

    await user.click(
      screen.getByRole("button", { name: /enable manual commit/i }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("mc")).toHaveTextContent("true");
    });
    expect(screen.getByTestId("sibling-mc").textContent).not.toBe("true");
  });
});
