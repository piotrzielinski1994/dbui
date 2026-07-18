import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { QueryWrapper } from "@/test/query-wrapper";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { WorkspaceLayout } from "@/components/workspace/workspace-layout";
import { SettingsProvider, useSettings } from "@/lib/settings/settings-context";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/settings/settings";
import { fixtureTree } from "@/components/workspace/__tests__/fixtures";

// react-resizable-panels measures the group/panels via offsetWidth/offsetHeight,
// which jsdom reports as 0 (so getLayout() returns {} and setLayout() no-ops).
// Faking a real measured size makes the imperative group API functional: the
// seeded defaultLayout resolves, setLayout clamps + applies, and each panel's
// style.flexGrow reflects its live percentage. (Technique from purerequest.)
let sizeDescriptors: Array<[string, PropertyDescriptor | undefined]> = [];

beforeEach(() => {
  sizeDescriptors = [
    [
      "offsetWidth",
      Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth"),
    ],
    [
      "offsetHeight",
      Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight"),
    ],
  ];
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get() {
      return 1000;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get() {
      return 500;
    },
  });
});

afterEach(() => {
  sizeDescriptors.forEach(([prop, descriptor]) => {
    if (descriptor) {
      Object.defineProperty(HTMLElement.prototype, prop, descriptor);
    }
  });
});

// Mirrors WorkspaceLoader's wiring: reads the loaded Settings and feeds the
// chrome slice back through saveChrome as onPersist, and seeds initialLayouts /
// visibility from Settings - the seam a programmatic resize persists through.
function PersistBridge() {
  const { settings, saveChrome } = useSettings();
  return (
    <WorkspaceProvider
      tree={fixtureTree}
      consoleLines={["[12:00:00] Ready."]}
      initialExpandedIds={["folder-prod", "folder-team"]}
      initialSidebarHidden={settings.sidebarHidden}
      initialConsoleHidden={settings.consoleHidden}
      initialLayouts={settings.layouts}
      onPersist={saveChrome}
    >
      <WorkspaceLayout />
    </WorkspaceProvider>
  );
}

function renderShell(overrides: Partial<Settings> = {}) {
  const seeded: Settings = {
    ...DEFAULT_SETTINGS,
    shortcuts: {},
    layouts: {
      workspace: { sidebar: 20, content: 80 },
      main: { content: 75, console: 25 },
    },
    ...overrides,
  };
  const store = createInMemorySettingsStore(seeded);
  const saveSpy = vi.spyOn(store, "save");
  render(
    <QueryWrapper>
      <SettingsProvider store={store}>
        <PersistBridge />
      </SettingsProvider>
    </QueryWrapper>,
  );
  return { store, saveSpy };
}

function flexGrowOf(id: string): number {
  const el = document.getElementById(id) as HTMLElement | null;
  return Number((el?.style.flexGrow ?? "") || "NaN");
}

const EXPAND = "{Control>}{Alt>}={/Alt}{/Control}";
const SHRINK = "{Control>}{Alt>}-{/Alt}{/Control}";

describe("panel resize actions - sidebar focus", () => {
  // AC-002, AC-006, TC-002 - behavior
  it("should grow the sidebar panel by 5% and persist if panel-expand fires with focus in the tree", async () => {
    const user = userEvent.setup();
    const { store } = renderShell();
    await screen.findByRole("region", { name: /console/i });
    await waitFor(() => expect(flexGrowOf("sidebar")).toBe(20));

    const tree = screen.getByRole("tree", { name: /navigator/i });
    within(tree).getAllByRole("treeitem")[0].focus();

    await user.keyboard(EXPAND);

    await waitFor(() => expect(flexGrowOf("sidebar")).toBe(25));
    const persisted = await store.load();
    expect(persisted.layouts.workspace!.sidebar).toBe(25);
  });

  // AC-002, TC-003 - behavior
  it("should shrink the sidebar panel by 5% if panel-shrink fires with focus in the tree", async () => {
    const user = userEvent.setup();
    const { store } = renderShell();
    await screen.findByRole("region", { name: /console/i });
    await waitFor(() => expect(flexGrowOf("sidebar")).toBe(20));

    const tree = screen.getByRole("tree", { name: /navigator/i });
    within(tree).getAllByRole("treeitem")[0].focus();

    await user.keyboard(SHRINK);

    await waitFor(() => expect(flexGrowOf("sidebar")).toBe(15));
    const persisted = await store.load();
    expect(persisted.layouts.workspace!.sidebar).toBe(15);
  });

  // AC-004, TC-005 - behavior: from 38% a full +5% step would reach 43% but is
  // clamped to the 40% max. Landing exactly on 40 (not 43, not 38) proves fire + clamp.
  it("should clamp the sidebar at its 40% max if panel-expand fires near the max", async () => {
    const user = userEvent.setup();
    const { store } = renderShell({
      layouts: {
        workspace: { sidebar: 38, content: 62 },
        main: { content: 75, console: 25 },
      },
    });
    await screen.findByRole("region", { name: /console/i });
    await waitFor(() => expect(flexGrowOf("sidebar")).toBe(38));

    const tree = screen.getByRole("tree", { name: /navigator/i });
    within(tree).getAllByRole("treeitem")[0].focus();

    await user.keyboard(EXPAND);

    await waitFor(() => expect(flexGrowOf("sidebar")).toBe(40));
    const persisted = await store.load();
    expect(persisted.layouts.workspace!.sidebar).toBe(40);
  });

  // AC-004, TC-006 - behavior: from 14% a full -5% step would reach 9% but is
  // clamped to the 12% min. Landing exactly on 12 proves fire + clamp.
  it("should clamp the sidebar at its 12% min if panel-shrink fires near the min", async () => {
    const user = userEvent.setup();
    const { store } = renderShell({
      layouts: {
        workspace: { sidebar: 14, content: 86 },
        main: { content: 75, console: 25 },
      },
    });
    await screen.findByRole("region", { name: /console/i });
    await waitFor(() => expect(flexGrowOf("sidebar")).toBe(14));

    const tree = screen.getByRole("tree", { name: /navigator/i });
    within(tree).getAllByRole("treeitem")[0].focus();

    await user.keyboard(SHRINK);

    await waitFor(() => expect(flexGrowOf("sidebar")).toBe(12));
    const persisted = await store.load();
    expect(persisted.layouts.workspace!.sidebar).toBe(12);
  });
});

describe("panel resize actions - console focus", () => {
  // AC-003, AC-006, TC-004 - behavior
  it("should grow the console panel by 5% and persist if panel-expand fires with focus in the console", async () => {
    const user = userEvent.setup();
    const { store } = renderShell();
    const consoleRegion = await screen.findByRole("region", {
      name: /console/i,
    });
    await waitFor(() => expect(flexGrowOf("console")).toBe(25));

    consoleRegion.focus();

    await user.keyboard(EXPAND);

    await waitFor(() => expect(flexGrowOf("console")).toBe(30));
    const persisted = await store.load();
    expect(persisted.layouts.main!.console).toBe(30);
  });
});

describe("panel resize actions - pointer target", () => {
  // AC-002, TC-008 - behavior: clicking a blank (non-focusable) area of the
  // sidebar does not move DOM focus into it, but must still mark it the active
  // resize target so a following expand grows the sidebar.
  it("should grow the sidebar if it was last clicked, even without a focused element inside it", async () => {
    const user = userEvent.setup();
    const { store } = renderShell();
    await screen.findByRole("region", { name: /console/i });
    await waitFor(() => expect(flexGrowOf("sidebar")).toBe(20));

    (document.activeElement as HTMLElement | null)?.blur();
    await user.click(document.getElementById("sidebar")!);

    await user.keyboard(EXPAND);

    await waitFor(() => expect(flexGrowOf("sidebar")).toBe(25));
    const persisted = await store.load();
    expect(persisted.layouts.workspace!.sidebar).toBe(25);
  });
});

describe("panel resize actions - content no-op", () => {
  // AC-005, TC-007 - side-effect-contract: clicking the sidebar then the content
  // region clears the active target, so a resize is a no-op and nothing persists.
  it("should not resize or persist if the last click was in the content region", async () => {
    const user = userEvent.setup();
    const { saveSpy } = renderShell();
    await screen.findByRole("region", { name: /console/i });
    await waitFor(() => expect(flexGrowOf("sidebar")).toBe(20));

    await user.click(document.getElementById("sidebar")!);
    await user.click(document.getElementById("content")!);
    const savesBefore = saveSpy.mock.calls.length;

    await user.keyboard(EXPAND);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(saveSpy.mock.calls.length).toBe(savesBefore);
    expect(flexGrowOf("sidebar")).toBe(20);
  });
});

describe("panel resize actions - command palette", () => {
  // AC-007, TC-009 - behavior: both actions are listed in the View group.
  it("should list Expand panel and Shrink panel in the command palette", async () => {
    const user = userEvent.setup();
    renderShell();
    await screen.findByRole("region", { name: /console/i });

    await user.keyboard("{Control>}k{/Control}");
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByText("Expand panel")).toBeInTheDocument();
    expect(within(dialog).getByText("Shrink panel")).toBeInTheDocument();
  });

  // AC-007, TC-009 - behavior: running Expand panel from the palette resizes the
  // panel that was focused when the palette opened (focus is trapped in the modal
  // at run time, so the handler must fall back to the pre-palette focus snapshot).
  it("should resize the panel focused when the palette opened if run from the palette", async () => {
    const user = userEvent.setup();
    const { store } = renderShell();
    await screen.findByRole("region", { name: /console/i });
    await waitFor(() => expect(flexGrowOf("sidebar")).toBe(20));

    const tree = screen.getByRole("tree", { name: /navigator/i });
    within(tree).getAllByRole("treeitem")[0].focus();

    await user.keyboard("{Control>}k{/Control}");
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByText("Expand panel"));

    await waitFor(() => expect(flexGrowOf("sidebar")).toBe(25));
    const persisted = await store.load();
    expect(persisted.layouts.workspace!.sidebar).toBe(25);
  });
});
