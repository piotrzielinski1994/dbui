import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  SettingsProvider,
  useSettings,
} from "@/lib/settings/settings-context";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import type { Settings, SettingsStore } from "@/lib/settings/settings";

// The chrome slice the workspace persists - workspacePath is EXCLUDED (written
// separately by saveWorkspacePath), so saveChrome must merge it from current
// settings, same hazard as theme/shortcuts/windowFullscreen/rowLimit.
const chromeSlice: Omit<
  Settings,
  "theme" | "shortcuts" | "windowFullscreen" | "rowLimit" | "workspacePath"
> = {
  version: 1,
  sidebarHidden: true,
  consoleHidden: false,
  splitOrientation: "horizontal",
  layouts: {},
  expandedIds: [],
  openTabIds: [],
  activeTabId: null,
};

function WorkspacePathProbe() {
  const { settings, saveWorkspacePath, saveChrome } = useSettings();

  return (
    <div>
      <span data-testid="workspace-path">
        {settings.workspacePath ?? "none"}
      </span>
      <button
        type="button"
        onClick={() => saveWorkspacePath("/ws/picked")}
      >
        save path
      </button>
      <button type="button" onClick={() => saveChrome(chromeSlice)}>
        save chrome
      </button>
    </div>
  );
}

describe("saveWorkspacePath", () => {
  // TC-013 / AC-002 - behavior: saveWorkspacePath updates the live context
  it("should update the context workspacePath when saveWorkspacePath is called", async () => {
    const user = userEvent.setup();
    const store = createInMemorySettingsStore();

    render(
      <SettingsProvider store={store}>
        <WorkspacePathProbe />
      </SettingsProvider>,
    );

    await screen.findByTestId("workspace-path");
    expect(screen.getByTestId("workspace-path")).toHaveTextContent("none");

    await user.click(screen.getByRole("button", { name: /save path/i }));

    await waitFor(() => {
      expect(screen.getByTestId("workspace-path")).toHaveTextContent(
        "/ws/picked",
      );
    });
  });

  // TC-013 / AC-002 - side-effect-contract: saveWorkspacePath writes through store.save
  it("should write the workspacePath through store.save", async () => {
    const user = userEvent.setup();
    const inner = createInMemorySettingsStore();
    const saveSpy = vi.fn(inner.save);
    const store: SettingsStore = { load: inner.load, save: saveSpy };

    render(
      <SettingsProvider store={store}>
        <WorkspacePathProbe />
      </SettingsProvider>,
    );

    await screen.findByTestId("workspace-path");
    await user.click(screen.getByRole("button", { name: /save path/i }));

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalled();
    });
    expect(saveSpy.mock.calls.at(-1)?.[0].workspacePath).toBe("/ws/picked");
  });
});

describe("saveChrome preserves workspacePath (TC-012)", () => {
  // TC-012 / AC-011 - side-effect-contract: a workspacePath set via saveWorkspacePath
  // survives a later chrome write that carries no workspacePath (like theme/shortcuts).
  it("should keep a saveWorkspacePath-set path when a later saveChrome carries none", async () => {
    const user = userEvent.setup();
    const inner = createInMemorySettingsStore();
    const saveSpy = vi.fn(inner.save);
    const store: SettingsStore = { load: inner.load, save: saveSpy };

    render(
      <SettingsProvider store={store}>
        <WorkspacePathProbe />
      </SettingsProvider>,
    );

    await screen.findByTestId("workspace-path");

    // 1) persist a path
    await user.click(screen.getByRole("button", { name: /save path/i }));
    await waitFor(() =>
      expect(screen.getByTestId("workspace-path")).toHaveTextContent(
        "/ws/picked",
      ),
    );

    // 2) a chrome write (no workspacePath in its slice) must not wipe it
    await user.click(screen.getByRole("button", { name: /save chrome/i }));

    await waitFor(() => {
      const saved = saveSpy.mock.calls.at(-1)?.[0];
      expect(saved?.sidebarHidden).toBe(true);
      expect(saved?.workspacePath).toBe("/ws/picked");
    });
  });
});
