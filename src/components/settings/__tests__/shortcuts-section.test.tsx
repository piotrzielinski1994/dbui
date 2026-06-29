import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HotkeysProvider } from "@tanstack/react-hotkeys";
import { formatForDisplay } from "@tanstack/react-hotkeys";

import { SettingsProvider } from "@/lib/settings/settings-context";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/settings/settings";
import { ShortcutsSection } from "@/components/settings/shortcuts-section";
import { SHORTCUT_ACTIONS } from "@/lib/shortcuts/registry";

// `shortcuts` is a new Settings field; seed it through a cast so the test fails
// because the section/field is missing, not because of a test-file typo.
function renderSection(overrides: Record<string, string> = {}) {
  const seeded = {
    ...DEFAULT_SETTINGS,
    shortcuts: overrides,
  } as unknown as Settings;
  const store = createInMemorySettingsStore(seeded);

  return render(
    <HotkeysProvider>
      <SettingsProvider store={store}>
        <ShortcutsSection />
      </SettingsProvider>
    </HotkeysProvider>,
  );
}

const TOGGLE_SIDEBAR = SHORTCUT_ACTIONS.find((a) => a.id === "toggle-sidebar")!;

describe("ShortcutsSection", () => {
  // AC-008, TC-010 - behavior
  it("should render a Keyboard Shortcuts heading", async () => {
    renderSection();

    expect(
      await screen.findByText(/keyboard shortcuts/i),
    ).toBeInTheDocument();
  });

  // AC-008, TC-010 - behavior
  it("should render a row whose text includes an action name and its formatted binding", async () => {
    renderSection();

    expect(await screen.findByText(TOGGLE_SIDEBAR.name)).toBeInTheDocument();
    expect(
      screen.getByText(formatForDisplay(TOGGLE_SIDEBAR.defaultHotkey)),
    ).toBeInTheDocument();
  });

  // AC-008 - behavior: one row per action.
  it("should render a row for every registry action", async () => {
    renderSection();

    for (const action of SHORTCUT_ACTIONS) {
      expect(await screen.findByText(action.name)).toBeInTheDocument();
    }
  });

  // AC-009, TC-011 - behavior: a Reset control appears only when an override exists.
  it("should render a Reset control for an action that has an override", async () => {
    renderSection({ "toggle-sidebar": "Mod+Shift+B" });

    expect(
      await screen.findByRole("button", {
        name: new RegExp(`reset.*${TOGGLE_SIDEBAR.name}`, "i"),
      }),
    ).toBeInTheDocument();
  });

  // AC-009, TC-011 - behavior
  it("should not render a Reset control for an action at its default binding", async () => {
    renderSection();

    await screen.findByText(TOGGLE_SIDEBAR.name);
    expect(
      screen.queryByRole("button", {
        name: new RegExp(`reset.*${TOGGLE_SIDEBAR.name}`, "i"),
      }),
    ).toBeNull();
  });

  // AC-009, TC-011 - behavior: an overridden row shows the custom binding label.
  it("should show the override binding label if an override is set", async () => {
    renderSection({ "toggle-sidebar": "Mod+Shift+B" });

    expect(
      await screen.findByText(formatForDisplay("Mod+Shift+B")),
    ).toBeInTheDocument();
  });
});
