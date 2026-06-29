import { describe, it, expect } from "vitest";
import {
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { formatForDisplay } from "@tanstack/react-hotkeys";

import { QueryWrapper } from "@/test/query-wrapper";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { WorkspaceLayout } from "@/components/workspace/workspace-layout";
import { fixtureTree } from "@/components/workspace/__tests__/fixtures";
import { SettingsProvider } from "@/lib/settings/settings-context";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/settings/settings";
import { resolveShortcuts } from "@/lib/shortcuts/resolve";

function openPalette() {
  fireEvent.keyDown(window, { key: "k", metaKey: true });
}

function renderLayout(overrides: Record<string, string> = {}) {
  const seeded = {
    ...DEFAULT_SETTINGS,
    shortcuts: overrides,
  } as unknown as Settings;
  const store = createInMemorySettingsStore(seeded);

  return render(
    <QueryWrapper>
      <SettingsProvider store={store}>
        <WorkspaceProvider tree={fixtureTree} initialActiveTabId="db-admin">
          <WorkspaceLayout />
        </WorkspaceProvider>
      </SettingsProvider>
    </QueryWrapper>,
  );
}

function hintFor(commandName: string): string | null {
  const item = screen.getByText(commandName).closest("[data-slot='command-item']");
  if (item === null) {
    return null;
  }
  return (
    within(item as HTMLElement)
      .queryByText((_, node) => node?.getAttribute("data-slot") === "command-shortcut")
      ?.textContent ?? null
  );
}

describe("CommandPalette derived hints", () => {
  // AC-011, TC-012 - behavior: hint comes from resolveShortcuts + formatForDisplay.
  it("should show the Toggle sidebar hint derived from the default binding", async () => {
    renderLayout();
    // SettingsProvider gates children on store.load(); wait for the tree to mount.
    await screen.findByText("admin_db");

    openPalette();

    const expected = formatForDisplay(resolveShortcuts({})["toggle-sidebar"]);
    expect(hintFor("Toggle sidebar")).toBe(expected);
  });

  // AC-011, TC-012 - behavior: the hint reflects an override when one is set.
  it("should show the Toggle sidebar hint derived from an override binding", async () => {
    const overrides = { "toggle-sidebar": "Mod+Shift+B" };
    renderLayout(overrides);
    await screen.findByText("admin_db");

    openPalette();

    const expected = formatForDisplay(
      resolveShortcuts(overrides)["toggle-sidebar"],
    );
    expect(hintFor("Toggle sidebar")).toBe(expected);
  });

  // AC-011 - behavior: a command with no registry action shows no hint.
  it("should show no hint for a command without a registry action", async () => {
    renderLayout();
    await screen.findByText("admin_db");

    openPalette();

    expect(hintFor("New tab")).toBeNull();
  });
});
