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

// A tree seeded with a database whose readOnly flag we control, so the switch's initial checked
// state can be asserted against the node value (AC-001). `readOnly` is spread on via a cast because
// the runtime type may not declare it until the field lands.
function treeWithReadOnly(readOnly: boolean): TreeNode[] {
  return fixtureTree.map((node) => {
    if (node.kind === "folder" && node.id === "folder-staging") {
      return {
        ...node,
        children: node.children.map((child) =>
          child.id === "db-admin"
            ? ({ ...child, readOnly } as TreeNode)
            : child,
        ),
      };
    }
    return node;
  });
}

function renderSettings(readOnly = false) {
  return render(
    <WorkspaceProvider tree={treeWithReadOnly(readOnly)} initialActiveTabId="db-admin">
      <SettingsTab />
    </WorkspaceProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetInFlightConnects();
});

describe("SettingsTab read-only switch (AC-001)", () => {
  // AC-001 - behavior (the Settings tab exposes a read-only switch)
  it("should render a read-only switch", () => {
    renderSettings(false);
    expect(
      screen.getByRole("switch", { name: /read-only/i }),
    ).toBeInTheDocument();
  });

  // AC-001 - behavior (the switch reflects a false node readOnly as unchecked)
  it("should render the read-only switch unchecked when the database is writable", () => {
    renderSettings(false);
    expect(screen.getByRole("switch", { name: /read-only/i })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  // AC-001 - behavior (the switch reflects a true node readOnly as checked)
  it("should render the read-only switch checked when the database is read-only", () => {
    renderSettings(true);
    expect(screen.getByRole("switch", { name: /read-only/i })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  // AC-001, TC-003 - behavior (toggling the switch flips the node readOnly, reflected back on the
  // control since the provider re-renders the form from the updated node)
  it("should flip the switch to checked when it is toggled on a writable database", async () => {
    const user = userEvent.setup();
    renderSettings(false);

    const toggle = screen.getByRole("switch", { name: /read-only/i });
    expect(toggle).toHaveAttribute("aria-checked", "false");

    await user.click(toggle);

    await waitFor(() => {
      expect(
        screen.getByRole("switch", { name: /read-only/i }),
      ).toHaveAttribute("aria-checked", "true");
    });
  });

  // AC-001, AC-005 - behavior (toggling an already read-only database flips it back off)
  it("should flip the switch to unchecked when it is toggled on a read-only database", async () => {
    const user = userEvent.setup();
    renderSettings(true);

    const toggle = screen.getByRole("switch", { name: /read-only/i });
    expect(toggle).toHaveAttribute("aria-checked", "true");

    await user.click(toggle);

    await waitFor(() => {
      expect(
        screen.getByRole("switch", { name: /read-only/i }),
      ).toHaveAttribute("aria-checked", "false");
    });
  });
});
