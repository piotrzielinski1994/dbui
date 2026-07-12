import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { SettingsTab } from "@/components/workspace/settings-tab";
import { __resetInFlightConnects } from "@/components/workspace/use-connection";
import { fixtureTree } from "@/components/workspace/__tests__/fixtures";
import type { TreeNode } from "@/lib/workspace/model";

vi.mock("@/lib/tauri", () => ({
  connectDatabase: vi.fn(),
  fetchSchema: vi.fn(() => Promise.resolve([])),
  disconnectDatabase: vi.fn(),
  cancelConnect: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// A tree seeded with a database whose manualCommit flag we control, so the switch's initial checked
// state can be asserted against the node value (AC-001).
function treeWithManualCommit(manualCommit: boolean): TreeNode[] {
  return fixtureTree.map((node) => {
    if (node.kind === "folder" && node.id === "folder-staging") {
      return {
        ...node,
        children: node.children.map((child) =>
          child.id === "db-admin"
            ? ({ ...child, manualCommit } as TreeNode)
            : child,
        ),
      };
    }
    return node;
  });
}

function renderSettings(manualCommit = false) {
  return render(
    <WorkspaceProvider
      tree={treeWithManualCommit(manualCommit)}
      initialActiveTabId="db-admin"
    >
      <SettingsTab />
    </WorkspaceProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetInFlightConnects();
});

describe("SettingsTab manual-commit switch (AC-001, TC-009)", () => {
  // AC-001 - behavior (the Settings tab exposes a manual-commit switch)
  it("should render a manual-commit switch", () => {
    renderSettings(false);
    expect(
      screen.getByRole("switch", { name: /manual commit/i }),
    ).toBeInTheDocument();
  });

  // AC-001 - behavior (the switch reflects a false node manualCommit as unchecked)
  it("should render the manual-commit switch unchecked when the database is auto-commit", () => {
    renderSettings(false);
    expect(
      screen.getByRole("switch", { name: /manual commit/i }),
    ).toHaveAttribute("aria-checked", "false");
  });

  // AC-001 - behavior (the switch reflects a true node manualCommit as checked)
  it("should render the manual-commit switch checked when the database is in manual-commit mode", () => {
    renderSettings(true);
    expect(
      screen.getByRole("switch", { name: /manual commit/i }),
    ).toHaveAttribute("aria-checked", "true");
  });

  // AC-001, TC-009 - behavior (toggling the switch flips the node manualCommit, reflected back on
  // the control since the provider re-renders the form from the updated node)
  it("should flip the switch to checked when it is toggled on an auto-commit database", async () => {
    const user = userEvent.setup();
    renderSettings(false);

    const toggle = screen.getByRole("switch", { name: /manual commit/i });
    expect(toggle).toHaveAttribute("aria-checked", "false");

    await user.click(toggle);

    await waitFor(() => {
      expect(
        screen.getByRole("switch", { name: /manual commit/i }),
      ).toHaveAttribute("aria-checked", "true");
    });
  });

  // AC-001, TC-009 - behavior (toggling an already manual-commit database flips it back off)
  it("should flip the switch to unchecked when it is toggled on a manual-commit database", async () => {
    const user = userEvent.setup();
    renderSettings(true);

    const toggle = screen.getByRole("switch", { name: /manual commit/i });
    expect(toggle).toHaveAttribute("aria-checked", "true");

    await user.click(toggle);

    await waitFor(() => {
      expect(
        screen.getByRole("switch", { name: /manual commit/i }),
      ).toHaveAttribute("aria-checked", "false");
    });
  });
});
