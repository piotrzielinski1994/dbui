import { describe, it, expect } from "vitest";

import {
  DEFAULT_SETTINGS,
  mergeSettings,
  type Settings,
} from "@/lib/settings/settings";

describe("DEFAULT_SETTINGS", () => {
  // AC-001 - behavior
  it("should expose the documented default shape", () => {
    expect(DEFAULT_SETTINGS).toEqual({
      version: 1,
      sidebarHidden: false,
      consoleHidden: false,
      splitOrientation: "horizontal",
      layouts: {},
      expandedIds: [],
      openTabIds: [],
      activeTabId: null,
      theme: {
        mode: "system",
        colors: {
          light: { tokens: {}, editor: {} },
          dark: { tokens: {}, editor: {} },
        },
      },
      shortcuts: {},
    });
  });
});

describe("mergeSettings", () => {
  // AC-002 - behavior
  it("should pass a valid full settings object through unchanged", () => {
    const full: Settings = {
      version: 1,
      sidebarHidden: true,
      consoleHidden: true,
      splitOrientation: "vertical",
      layouts: {
        workspace: { sidebar: 22, content: 78 },
        main: { content: 70, console: 30 },
        sql: { left: 40 },
      },
      expandedIds: ["folder-staging", "db-admin"],
      openTabIds: ["db-admin", "tbl-accounts"],
      activeTabId: "tbl-accounts",
      theme: {
        mode: "dark",
        colors: {
          light: { tokens: { primary: "oklch(0.55 0.22 27)" }, editor: {} },
          dark: { tokens: {}, editor: { string: "oklch(0.74 0.15 60)" } },
        },
      },
      shortcuts: {},
    };

    expect(mergeSettings(DEFAULT_SETTINGS, full)).toEqual(full);
  });

  // AC-002, E-3 - behavior
  it("should fill missing keys from defaults if the partial omits them", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { sidebarHidden: true });

    expect(merged.sidebarHidden).toBe(true);
    expect(merged.version).toBe(1);
    expect(merged.consoleHidden).toBe(false);
    expect(merged.splitOrientation).toBe("horizontal");
    expect(merged.expandedIds).toEqual([]);
    expect(merged.openTabIds).toEqual([]);
    expect(merged.activeTabId).toBeNull();
  });

  // AC-002, E-3 - behavior
  it("should drop unknown extra keys if the partial carries them", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, {
      consoleHidden: true,
      bogus: "nope",
      extra: 42,
    });

    expect(merged).toEqual({
      version: 1,
      sidebarHidden: false,
      consoleHidden: true,
      splitOrientation: "horizontal",
      layouts: {},
      expandedIds: [],
      openTabIds: [],
      activeTabId: null,
      theme: {
        mode: "system",
        colors: {
          light: { tokens: {}, editor: {} },
          dark: { tokens: {}, editor: {} },
        },
      },
      shortcuts: {},
    });
    expect(merged).not.toHaveProperty("bogus");
    expect(merged).not.toHaveProperty("extra");
  });

  // AC-002, E-2 - behavior
  it("should fall back to the default sidebarHidden if it is not a boolean", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { sidebarHidden: "yes" });

    expect(merged.sidebarHidden).toBe(false);
  });

  // AC-002, E-2 - behavior
  it("should fall back to the default consoleHidden if it is not a boolean", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { consoleHidden: 1 });

    expect(merged.consoleHidden).toBe(false);
  });

  // AC-002, E-2 - behavior
  it("should fall back to the default splitOrientation if it is not horizontal or vertical", () => {
    expect(
      mergeSettings(DEFAULT_SETTINGS, { splitOrientation: 5 }).splitOrientation,
    ).toBe("horizontal");
    expect(
      mergeSettings(DEFAULT_SETTINGS, { splitOrientation: "diagonal" })
        .splitOrientation,
    ).toBe("horizontal");
  });

  // AC-002 - behavior
  it("should keep a valid vertical splitOrientation", () => {
    expect(
      mergeSettings(DEFAULT_SETTINGS, { splitOrientation: "vertical" })
        .splitOrientation,
    ).toBe("vertical");
  });

  // AC-002, E-2 - behavior
  it("should drop non-string entries from expandedIds", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, {
      expandedIds: ["folder-staging", 42, null, "db-admin"],
    });

    expect(merged.expandedIds).toEqual(["folder-staging", "db-admin"]);
  });

  // AC-002, E-2 - behavior
  it("should default expandedIds to empty if it is not an array", () => {
    expect(
      mergeSettings(DEFAULT_SETTINGS, { expandedIds: "nope" }).expandedIds,
    ).toEqual([]);
  });

  // AC-002, E-2 - behavior
  it("should drop non-string entries from openTabIds", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, {
      openTabIds: ["db-admin", 42, null, "tbl-accounts"],
    });

    expect(merged.openTabIds).toEqual(["db-admin", "tbl-accounts"]);
  });

  // AC-002, E-2 - behavior
  it("should default openTabIds to empty if it is not an array", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { openTabIds: 42 });

    expect(merged.openTabIds).toEqual([]);
    expect(merged.activeTabId).toBeNull();
  });

  // AC-002, E-5 - behavior
  it("should keep a valid activeTabId that is among the open tab ids", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, {
      openTabIds: ["db-admin", "tbl-accounts"],
      activeTabId: "tbl-accounts",
    });

    expect(merged.activeTabId).toBe("tbl-accounts");
  });

  // AC-002, E-5 - behavior
  it("should coerce activeTabId to null if it is not among the open tab ids", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, {
      openTabIds: ["db-admin"],
      activeTabId: "tbl-gone",
    });

    expect(merged.activeTabId).toBeNull();
  });

  // AC-002, E-5 - behavior
  it("should coerce activeTabId to null if it is not a string", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, {
      openTabIds: ["db-admin"],
      activeTabId: 42,
    });

    expect(merged.activeTabId).toBeNull();
  });

  // AC-002, E-2 - behavior
  it("should return defaults if the partial is null", () => {
    expect(mergeSettings(DEFAULT_SETTINGS, null)).toEqual(DEFAULT_SETTINGS);
  });

  // AC-002, E-2 - behavior
  it("should return defaults if the partial is undefined", () => {
    expect(mergeSettings(DEFAULT_SETTINGS, undefined)).toEqual(
      DEFAULT_SETTINGS,
    );
  });

  // AC-002, E-2 - behavior
  it("should return defaults if the partial is a string", () => {
    expect(mergeSettings(DEFAULT_SETTINGS, "garbage")).toEqual(
      DEFAULT_SETTINGS,
    );
  });

  // AC-002, E-2 - behavior
  it("should return defaults if the partial is a number", () => {
    expect(mergeSettings(DEFAULT_SETTINGS, 123)).toEqual(DEFAULT_SETTINGS);
  });

  // AC-002, E-2 - behavior
  it("should return defaults if the partial is an array", () => {
    expect(mergeSettings(DEFAULT_SETTINGS, [])).toEqual(DEFAULT_SETTINGS);
  });

  // AC-002, E-2 - behavior
  it("should not throw if the partial is garbage", () => {
    expect(() => mergeSettings(DEFAULT_SETTINGS, [])).not.toThrow();
    expect(() => mergeSettings(DEFAULT_SETTINGS, true)).not.toThrow();
    expect(() => mergeSettings(DEFAULT_SETTINGS, null)).not.toThrow();
    expect(() => mergeSettings(DEFAULT_SETTINGS, 0)).not.toThrow();
    expect(() => mergeSettings(DEFAULT_SETTINGS, "x")).not.toThrow();
  });
});

describe("mergeSettings layouts", () => {
  // AC-002 - behavior
  it("should keep valid panel layouts for known groups", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, {
      layouts: {
        workspace: { sidebar: 20, content: 80 },
        main: { content: 75, console: 25 },
        sql: { left: 60 },
      },
    });

    expect(merged.layouts).toEqual({
      workspace: { sidebar: 20, content: 80 },
      main: { content: 75, console: 25 },
      sql: { left: 60 },
    });
  });

  // AC-002 - behavior
  it("should default layouts to empty if the key is absent", () => {
    expect(
      mergeSettings(DEFAULT_SETTINGS, { sidebarHidden: true }).layouts,
    ).toEqual({});
  });

  // AC-002, E-2 - behavior
  it("should default layouts to empty if it is not an object", () => {
    expect(
      mergeSettings(DEFAULT_SETTINGS, { layouts: "nope" }).layouts,
    ).toEqual({});
  });

  // AC-002, E-3 - behavior
  it("should drop unknown layout groups", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, {
      layouts: { workspace: { sidebar: 30, content: 70 }, bogus: { a: 1 } },
    });

    expect(merged.layouts).toEqual({
      workspace: { sidebar: 30, content: 70 },
    });
    expect(merged.layouts).not.toHaveProperty("bogus");
  });

  // AC-002, E-2 - behavior
  it("should drop a layout group whose sizes are not all numbers", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, {
      layouts: {
        workspace: { sidebar: "wide", content: 70 },
        main: { content: 75, console: 25 },
      },
    });

    expect(merged.layouts).toEqual({ main: { content: 75, console: 25 } });
    expect(merged.layouts).not.toHaveProperty("workspace");
  });
});
