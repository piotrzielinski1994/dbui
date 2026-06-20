import { describe, it, expect } from "vitest";

import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/settings/settings";

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

describe("createInMemorySettingsStore", () => {
  // AC-004 - behavior
  it("should return DEFAULT_SETTINGS if the store was created empty", async () => {
    const store = createInMemorySettingsStore();

    expect(await store.load()).toEqual(DEFAULT_SETTINGS);
  });

  // AC-004 - behavior
  it("should return the seeded initial settings if one was provided", async () => {
    const store = createInMemorySettingsStore(nonDefaultSettings);

    expect(await store.load()).toEqual(nonDefaultSettings);
  });

  // AC-004, TC-005 - behavior
  it("should return the last-saved settings on a subsequent load", async () => {
    const store = createInMemorySettingsStore();

    await store.save(nonDefaultSettings);

    expect(await store.load()).toEqual(nonDefaultSettings);
  });

  // AC-004, TC-005 - behavior
  it("should overwrite the previous settings if save is called again", async () => {
    const store = createInMemorySettingsStore();

    await store.save(nonDefaultSettings);
    await store.save(DEFAULT_SETTINGS);

    expect(await store.load()).toEqual(DEFAULT_SETTINGS);
  });
});
