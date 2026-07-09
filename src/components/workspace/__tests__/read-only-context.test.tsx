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

// Reads the readOnly flag off the target database node through a widened cast (the runtime type may
// not declare it until the field lands) and exposes the provider's setDatabaseReadOnly action.
function Probe({ dbId }: { dbId: string }) {
  const { tree, setDatabaseReadOnly } = useWorkspace();
  const node = findNode(tree, dbId);
  const readOnly =
    node?.kind === "database"
      ? (node as { readOnly?: boolean }).readOnly
      : undefined;

  return (
    <div>
      <span data-testid="ro">{String(readOnly)}</span>
      <button type="button" onClick={() => setDatabaseReadOnly(dbId, true)}>
        mark read-only
      </button>
      <button type="button" onClick={() => setDatabaseReadOnly(dbId, false)}>
        mark writable
      </button>
    </div>
  );
}

describe("WorkspaceProvider setDatabaseReadOnly (AC-001)", () => {
  // AC-001 - behavior (setDatabaseReadOnly(id, true) flips the target database's readOnly on)
  it("should flip the target database readOnly to true when setDatabaseReadOnly is called", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider tree={fixtureTree} onTreeChange={vi.fn()}>
        <Probe dbId="db-admin" />
      </WorkspaceProvider>,
    );

    expect(screen.getByTestId("ro").textContent).not.toBe("true");

    await user.click(screen.getByRole("button", { name: /mark read-only/i }));

    await waitFor(() => {
      expect(screen.getByTestId("ro")).toHaveTextContent("true");
    });
  });

  // AC-001, AC-005 - behavior (setDatabaseReadOnly(id, false) flips it back off)
  it("should flip readOnly back to false when setDatabaseReadOnly is called with false", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider tree={fixtureTree} onTreeChange={vi.fn()}>
        <Probe dbId="db-admin" />
      </WorkspaceProvider>,
    );

    await user.click(screen.getByRole("button", { name: /mark read-only/i }));
    await waitFor(() => {
      expect(screen.getByTestId("ro")).toHaveTextContent("true");
    });

    await user.click(screen.getByRole("button", { name: /mark writable/i }));
    await waitFor(() => {
      expect(screen.getByTestId("ro")).toHaveTextContent("false");
    });
  });

  // AC-002 - side-effect-contract (a readOnly flip triggers the onTreeChange persist effect)
  it("should invoke onTreeChange when setDatabaseReadOnly changes a node", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn();
    render(
      <WorkspaceProvider tree={fixtureTree} onTreeChange={onTreeChange}>
        <Probe dbId="db-admin" />
      </WorkspaceProvider>,
    );

    onTreeChange.mockClear();
    await user.click(screen.getByRole("button", { name: /mark read-only/i }));

    await waitFor(() => {
      expect(onTreeChange).toHaveBeenCalled();
    });
    const lastTree = onTreeChange.mock.calls.at(-1)?.[0];
    const persisted = findNode(lastTree, "db-admin");
    expect(
      persisted?.kind === "database"
        ? (persisted as { readOnly?: boolean }).readOnly
        : undefined,
    ).toBe(true);
  });

  // AC-001 - behavior (setDatabaseReadOnly targets only the named database, leaves siblings alone)
  it("should not touch a sibling database's readOnly when one is marked read-only", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider tree={fixtureTree} onTreeChange={vi.fn()}>
        <Probe dbId="db-admin" />
        <SiblingProbe dbId="db-scratch" />
      </WorkspaceProvider>,
    );

    await user.click(screen.getByRole("button", { name: /mark read-only/i }));

    await waitFor(() => {
      expect(screen.getByTestId("ro")).toHaveTextContent("true");
    });
    expect(screen.getByTestId("sibling-ro").textContent).not.toBe("true");
  });
});

function SiblingProbe({ dbId }: { dbId: string }) {
  const { tree } = useWorkspace();
  const node = findNode(tree, dbId);
  const readOnly =
    node?.kind === "database"
      ? (node as { readOnly?: boolean }).readOnly
      : undefined;
  return <span data-testid="sibling-ro">{String(readOnly)}</span>;
}
