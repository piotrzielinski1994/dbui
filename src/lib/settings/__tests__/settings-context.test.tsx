import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  SettingsProvider,
  useSettings,
} from "@/lib/settings/settings-context";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { type Settings, type SettingsStore } from "@/lib/settings/settings";

const nonDefaultSettings: Settings = {
  version: 1,
  sidebarHidden: true,
  consoleHidden: true,
  splitOrientation: "vertical",
  layouts: { main: { content: 70, console: 30 } },
  expandedIds: ["folder-staging", "db-admin"],
  openTabIds: ["db-admin", "tbl-accounts"],
  activeTabId: "tbl-accounts",
  connections: {
    "db-admin": {
      engine: "postgres",
      host: "db.internal",
      port: 5433,
      database: "admin",
      user: "seed_admin",
      password: "s3cr3t-pw",
    },
  },
};

// Renders the live settings as JSON and exposes a button to persist a target
// Settings object - mirrors requi's probe style (assert on observable DOM).
function SettingsProbe({ persistTarget }: { persistTarget?: Settings }) {
  const { settings, persist } = useSettings();

  return (
    <div>
      <span data-testid="settings-json">{JSON.stringify(settings)}</span>
      <span data-testid="sidebar-hidden">{String(settings.sidebarHidden)}</span>
      <button
        type="button"
        onClick={() => persist(persistTarget ?? nonDefaultSettings)}
      >
        persist
      </button>
    </div>
  );
}

describe("SettingsProvider", () => {
  // AC-006 - behavior
  it("should expose the loaded store settings to children once load resolves", async () => {
    const store = createInMemorySettingsStore(nonDefaultSettings);

    render(
      <SettingsProvider store={store}>
        <SettingsProbe />
      </SettingsProvider>,
    );

    expect(await screen.findByTestId("settings-json")).toHaveTextContent(
      JSON.stringify(nonDefaultSettings),
    );
  });

  // AC-006 - behavior
  it("should expose default store settings to children if the store is empty", async () => {
    const store = createInMemorySettingsStore();

    render(
      <SettingsProvider store={store}>
        <SettingsProbe />
      </SettingsProvider>,
    );

    expect(await screen.findByTestId("sidebar-hidden")).toHaveTextContent(
      "false",
    );
  });

  // AC-006 - behavior (renders nothing until load resolves)
  it("should render no children until the async load resolves", () => {
    let resolveLoad: (settings: Settings) => void = () => {};
    const store: SettingsStore = {
      load: () =>
        new Promise<Settings>((resolve) => {
          resolveLoad = resolve;
        }),
      save: () => Promise.resolve(),
    };

    render(
      <SettingsProvider store={store}>
        <SettingsProbe />
      </SettingsProvider>,
    );

    expect(screen.queryByTestId("settings-json")).toBeNull();

    resolveLoad(nonDefaultSettings);
  });

  // AC-006 - behavior (persist updates the live context)
  it("should update the context settings when persist is called", async () => {
    const user = userEvent.setup();
    const store = createInMemorySettingsStore();

    render(
      <SettingsProvider store={store}>
        <SettingsProbe />
      </SettingsProvider>,
    );

    await screen.findByTestId("sidebar-hidden");
    expect(screen.getByTestId("sidebar-hidden")).toHaveTextContent("false");

    await user.click(screen.getByRole("button", { name: /persist/i }));

    await waitFor(() => {
      expect(screen.getByTestId("sidebar-hidden")).toHaveTextContent("true");
    });
  });

  // AC-006 - side-effect-contract (persist writes through store.save)
  it("should write through store.save when persist is called", async () => {
    const user = userEvent.setup();
    const inner = createInMemorySettingsStore();
    const saveSpy = vi.fn(inner.save);
    const store: SettingsStore = { load: inner.load, save: saveSpy };

    render(
      <SettingsProvider store={store}>
        <SettingsProbe />
      </SettingsProvider>,
    );

    await screen.findByTestId("sidebar-hidden");

    await user.click(screen.getByRole("button", { name: /persist/i }));

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalledTimes(1);
    });
    expect(saveSpy.mock.calls[0][0]).toEqual(nonDefaultSettings);
  });

  // AC-006, TC-005 - side-effect-contract (round-trip across remount)
  it("should round-trip persisted settings through the store to a fresh provider", async () => {
    const user = userEvent.setup();
    const store = createInMemorySettingsStore();

    const first = render(
      <SettingsProvider store={store}>
        <SettingsProbe />
      </SettingsProvider>,
    );

    await screen.findByTestId("settings-json");
    await user.click(screen.getByRole("button", { name: /persist/i }));
    await waitFor(() => {
      expect(screen.getByTestId("settings-json")).toHaveTextContent(
        JSON.stringify(nonDefaultSettings),
      );
    });

    first.unmount();

    render(
      <SettingsProvider store={store}>
        <SettingsProbe />
      </SettingsProvider>,
    );

    expect(await screen.findByTestId("settings-json")).toHaveTextContent(
      JSON.stringify(nonDefaultSettings),
    );
  });
});

describe("useSettings", () => {
  // AC-006 - behavior
  it("should throw if used outside a SettingsProvider", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    expect(() => render(<SettingsProbe />)).toThrow(
      /useSettings must be used within a SettingsProvider/i,
    );

    consoleError.mockRestore();
  });
});
