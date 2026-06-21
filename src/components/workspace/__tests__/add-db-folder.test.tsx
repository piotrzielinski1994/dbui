import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fireEvent,
  render as rtlRender,
  screen,
  waitFor,
  within,
  type RenderOptions,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

import { QueryWrapper } from "@/test/query-wrapper";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { WorkspaceLayout } from "@/components/workspace/workspace-layout";
import { SettingsTab } from "@/components/workspace/settings-tab";
import { SidebarTree } from "@/components/workspace/sidebar-tree";
import { ContentHeader } from "@/components/workspace/content-header";
import { fixtureTree } from "@/components/workspace/__tests__/fixtures";
import { connectDatabase } from "@/lib/tauri";
import { toast } from "sonner";

// Opening a database tab mounts useAutoConnect; mock the backend + toast like
// settings-tab.test.tsx so a freshly-created database never hits the network.
vi.mock("@/lib/tauri", () => ({
  connectDatabase: vi.fn(),
}));

vi.mock("sonner", () => ({
  // WorkspaceLayout renders <Toaster />, so the mock must also export it.
  Toaster: () => null,
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const mockConnect = vi.mocked(connectDatabase);
const mockToast = vi.mocked(toast);

function render(ui: ReactNode, options?: RenderOptions) {
  return rtlRender(ui, { wrapper: QueryWrapper, ...options });
}

function openPalette(modifier: "metaKey" | "ctrlKey" = "metaKey") {
  fireEvent.keyDown(window, { key: "k", [modifier]: true });
}

function getPalette(): HTMLElement {
  return screen.getByRole("dialog");
}

beforeEach(() => {
  vi.clearAllMocks();
  mockConnect.mockResolvedValue([]);
});

describe("WorkspaceLayout - New database / New folder commands", () => {
  // AC-001, E-1 - behavior (command listed even with an empty tree)
  it("should list a 'New database' command in the palette even if the tree is empty", () => {
    render(
      <WorkspaceProvider tree={[]}>
        <WorkspaceLayout />
      </WorkspaceProvider>,
    );

    openPalette();

    expect(
      within(getPalette()).getByText("New database"),
    ).toBeInTheDocument();
  });

  // AC-004, E-1 - behavior (command listed even with an empty tree)
  it("should list a 'New folder' command in the palette even if the tree is empty", () => {
    render(
      <WorkspaceProvider tree={[]}>
        <WorkspaceLayout />
      </WorkspaceProvider>,
    );

    openPalette();

    expect(within(getPalette()).getByText("New folder")).toBeInTheDocument();
  });

  // AC-002, TC-001 - behavior (a database tab opens on the Settings sub-tab + sidebar row)
  it("should open an active database tab on the Settings sub-tab and add a sidebar row if 'New database' is selected", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider tree={[]}>
        <WorkspaceLayout />
      </WorkspaceProvider>,
    );

    openPalette();
    await user.click(within(getPalette()).getByText("New database"));

    // palette closed, an open tab exists
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      within(
        screen.getByRole("tablist", { name: /open tabs/i }),
      ).getAllByRole("tab"),
    ).toHaveLength(1);

    // the Settings sub-tab is the selected one
    const settingsSubTab = within(
      screen.getByRole("tablist", { name: /database sections/i }),
    ).getByRole("tab", { name: /^settings$/i });
    expect(settingsSubTab).toHaveAttribute("aria-selected", "true");

    // the Settings form is visible (Connect button + engine combobox)
    expect(
      screen.getByRole("button", { name: /^connect$/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toBeInTheDocument();

    // the sidebar gained a database row
    expect(
      within(screen.getByRole("tree", { name: /navigator/i })).getByRole(
        "treeitem",
        { name: "new_database" },
      ),
    ).toBeInTheDocument();
  });

  // AC-003, E-7, TC-002 - side-effect-contract (no auto-connect on create)
  it("should not call connectDatabase or fire an error toast if a database is created via 'New database'", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider tree={[]}>
        <WorkspaceLayout />
      </WorkspaceProvider>,
    );

    openPalette();
    await user.click(within(getPalette()).getByText("New database"));

    // give any stray effect/promise a chance to fire before asserting absence
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /^connect$/i }),
      ).toBeInTheDocument();
    });
    expect(mockConnect).not.toHaveBeenCalled();
    expect(mockToast.error).not.toHaveBeenCalled();
  });

  // E-5 - behavior (two creates yield two sidebar database rows)
  it("should add two database rows if 'New database' is selected twice", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider tree={[]}>
        <WorkspaceLayout />
      </WorkspaceProvider>,
    );

    openPalette();
    await user.click(within(getPalette()).getByText("New database"));
    openPalette();
    await user.click(within(getPalette()).getByText("New database"));

    expect(
      within(screen.getByRole("tree", { name: /navigator/i })).getAllByRole(
        "treeitem",
        { name: "new_database" },
      ),
    ).toHaveLength(2);
  });

  // AC-005, TC-003 - behavior (folder dialog opens with a name input + Add button)
  it("should open a dialog with a name textbox and an Add button if 'New folder' is selected", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider tree={[]}>
        <WorkspaceLayout />
      </WorkspaceProvider>,
    );

    openPalette();
    await user.click(within(getPalette()).getByText("New folder"));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("textbox")).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: /^add$/i }),
    ).toBeInTheDocument();
  });

  // AC-006, TC-003 - behavior (typing a name + Add creates a root folder and closes)
  it("should create a root folder named 'reports' and close the dialog if a name is typed and Add is clicked", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider tree={[]}>
        <WorkspaceLayout />
      </WorkspaceProvider>,
    );

    openPalette();
    await user.click(within(getPalette()).getByText("New folder"));

    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByRole("textbox"), "reports");
    await user.click(within(dialog).getByRole("button", { name: /^add$/i }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(
      within(screen.getByRole("tree", { name: /navigator/i })).getByRole(
        "treeitem",
        { name: /reports/i },
      ),
    ).toBeInTheDocument();
  });

  // AC-006, E-2, TC-004 - behavior (Add disabled while name blank)
  it("should keep the Add button disabled if the folder name is empty", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider tree={[]}>
        <WorkspaceLayout />
      </WorkspaceProvider>,
    );

    openPalette();
    await user.click(within(getPalette()).getByText("New folder"));

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("button", { name: /^add$/i }),
    ).toBeDisabled();
  });

  // AC-006, E-2 - behavior (Add disabled for whitespace-only name)
  it("should keep the Add button disabled if the folder name is whitespace only", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider tree={[]}>
        <WorkspaceLayout />
      </WorkspaceProvider>,
    );

    openPalette();
    await user.click(within(getPalette()).getByText("New folder"));

    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByRole("textbox"), "   ");

    expect(
      within(dialog).getByRole("button", { name: /^add$/i }),
    ).toBeDisabled();
  });

  // E-3 - behavior (Esc closes the folder dialog without creating)
  it("should close the folder dialog without creating a folder if Escape is pressed", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider tree={[]}>
        <WorkspaceLayout />
      </WorkspaceProvider>,
    );

    openPalette();
    await user.click(within(getPalette()).getByText("New folder"));

    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByRole("textbox"), "scratch");
    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(
      within(screen.getByRole("tree", { name: /navigator/i })).queryByRole(
        "treeitem",
        { name: /scratch/i },
      ),
    ).not.toBeInTheDocument();
  });

  // E-3 - behavior (Cancel closes the folder dialog without creating)
  it("should close the folder dialog without creating a folder if Cancel is clicked", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider tree={[]}>
        <WorkspaceLayout />
      </WorkspaceProvider>,
    );

    openPalette();
    await user.click(within(getPalette()).getByText("New folder"));

    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByRole("textbox"), "scratch");
    await user.click(within(dialog).getByRole("button", { name: /cancel/i }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(
      within(screen.getByRole("tree", { name: /navigator/i })).queryByRole(
        "treeitem",
        { name: /scratch/i },
      ),
    ).not.toBeInTheDocument();
  });
});

describe("WorkspaceLayout - New database / New folder shortcuts", () => {
  // AC-007, TC-005 - behavior (Cmd/Ctrl+N opens a database tab on Settings)
  it("should open a database tab on the Settings sub-tab if Ctrl+N is pressed", async () => {
    render(
      <WorkspaceProvider tree={[]}>
        <WorkspaceLayout />
      </WorkspaceProvider>,
    );

    fireEvent.keyDown(window, { key: "n", ctrlKey: true });

    const settingsSubTab = within(
      await screen.findByRole("tablist", { name: /database sections/i }),
    ).getByRole("tab", { name: /^settings$/i });
    expect(settingsSubTab).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // AC-007 - event contract (the OS/browser default is suppressed)
  it("should suppress the default action if Cmd+N is pressed", () => {
    render(
      <WorkspaceProvider tree={[]}>
        <WorkspaceLayout />
      </WorkspaceProvider>,
    );

    const event = new KeyboardEvent("keydown", {
      key: "n",
      metaKey: true,
      cancelable: true,
      bubbles: true,
    });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  // AC-008, TC-006 - behavior (Cmd/Ctrl+Shift+N opens the New folder dialog)
  it("should open the New folder dialog if Ctrl+Shift+N is pressed", async () => {
    render(
      <WorkspaceProvider tree={[]}>
        <WorkspaceLayout />
      </WorkspaceProvider>,
    );

    fireEvent.keyDown(window, { key: "n", ctrlKey: true, shiftKey: true });

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("textbox")).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: /^add$/i }),
    ).toBeInTheDocument();
  });

  // AC-008 - event contract (the OS/browser default is suppressed)
  it("should suppress the default action if Cmd+Shift+N is pressed", () => {
    render(
      <WorkspaceProvider tree={[]}>
        <WorkspaceLayout />
      </WorkspaceProvider>,
    );

    const event = new KeyboardEvent("keydown", {
      key: "n",
      metaKey: true,
      shiftKey: true,
      cancelable: true,
      bubbles: true,
    });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  // AC-008 - behavior (Shift+N opens the dialog, not the command palette)
  it("should not open the command palette if Ctrl+Shift+N is pressed", async () => {
    render(
      <WorkspaceProvider tree={[]}>
        <WorkspaceLayout />
      </WorkspaceProvider>,
    );

    fireEvent.keyDown(window, { key: "n", ctrlKey: true, shiftKey: true });

    const dialog = await screen.findByRole("dialog");
    // the open dialog is the folder dialog, not the command palette
    expect(
      within(dialog).queryByPlaceholderText(/type a command/i),
    ).not.toBeInTheDocument();
  });
});

describe("Settings Name field renames the database", () => {
  // AC-009, TC-007 - behavior (editing Name updates the sidebar row + open-tab title)
  // Rendered as SettingsTab + SidebarTree + ContentHeader siblings (the settings-tab.test.tsx
  // pattern) rather than the full WorkspaceLayout: the shell's react-resizable-panels groups
  // swallow sub-tab pointer clicks in jsdom (a documented limitation in docs/design.md), so the
  // Settings sub-tab can't be reached by clicking through WorkspaceLayout in a test.
  it("should rename the sidebar row and the open-tab title if the Settings Name field is edited", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider
        tree={fixtureTree}
        initialActiveTabId="db-admin"
        initialOpenTabIds={["db-admin"]}
        initialExpandedIds={["folder-staging"]}
        initialConnectionStatus={[["db-admin", "connected"]]}
      >
        <ContentHeader />
        <SettingsTab />
        <SidebarTree />
      </WorkspaceProvider>,
    );

    const nameField = screen.getByRole("textbox", { name: /name/i });
    await user.clear(nameField);
    await user.type(nameField, "billing");

    // sidebar database row reflects the new name
    expect(
      within(screen.getByRole("tree", { name: /navigator/i })).getByRole(
        "treeitem",
        { name: "billing" },
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("tree", { name: /navigator/i })).queryByRole(
        "treeitem",
        { name: "admin_db" },
      ),
    ).not.toBeInTheDocument();

    // the open tab title reflects the new name
    expect(
      within(
        screen.getByRole("tablist", { name: /open tabs/i }),
      ).getByRole("tab", { name: "billing" }),
    ).toBeInTheDocument();
  });
});
