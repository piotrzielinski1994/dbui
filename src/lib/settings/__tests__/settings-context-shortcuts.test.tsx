import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  SettingsProvider,
  useSettings,
} from "@/lib/settings/settings-context";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";

// saveShortcut / resetShortcut are new on the context value, and settings gains
// a `shortcuts` map. Both are accessed through narrow casts so these tests fail
// because the behaviour is missing, not because of a test-file typo.
type ShortcutContext = {
  saveShortcut: (id: string, hotkey: string) => void;
  resetShortcut: (id: string) => void;
};

function ShortcutProbe() {
  const value = useSettings();
  const { saveShortcut, resetShortcut } = value as unknown as ShortcutContext;
  const shortcuts =
    (value.settings as unknown as { shortcuts?: Record<string, string> })
      .shortcuts ?? {};

  return (
    <div>
      <span data-testid="has-save">{String(typeof saveShortcut === "function")}</span>
      <span data-testid="override">
        {"toggle-sidebar" in shortcuts ? shortcuts["toggle-sidebar"] : "none"}
      </span>
      <button
        type="button"
        onClick={() => saveShortcut?.("toggle-sidebar", "Mod+Shift+B")}
      >
        save
      </button>
      <button type="button" onClick={() => resetShortcut?.("toggle-sidebar")}>
        reset
      </button>
    </div>
  );
}

function renderProbe() {
  const store = createInMemorySettingsStore();
  return render(
    <SettingsProvider store={store}>
      <ShortcutProbe />
    </SettingsProvider>,
  );
}

describe("settings-context shortcuts", () => {
  // AC-007, TC-009 - side-effect-contract
  it("should add the override key if saveShortcut is called and remove it if resetShortcut is called", async () => {
    const user = userEvent.setup();
    renderProbe();

    const override = await screen.findByTestId("override");
    expect(override).toHaveTextContent("none");
    expect(screen.getByTestId("has-save")).toHaveTextContent("true");

    await user.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => {
      expect(screen.getByTestId("override")).toHaveTextContent("Mod+Shift+B");
    });

    await user.click(screen.getByRole("button", { name: /reset/i }));
    await waitFor(() => {
      expect(screen.getByTestId("override")).toHaveTextContent("none");
    });
  });
});
