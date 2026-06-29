import { describe, it, expect } from "vitest";

import {
  SHORTCUT_ACTIONS,
  type ShortcutOverrides,
} from "@/lib/shortcuts/registry";
import {
  safeNormalize,
  resolveShortcuts,
  findConflict,
} from "@/lib/shortcuts/resolve";

const defaultFor = (id: (typeof SHORTCUT_ACTIONS)[number]["id"]) =>
  SHORTCUT_ACTIONS.find((a) => a.id === id)!.defaultHotkey;

describe("safeNormalize", () => {
  // AC-002 - behavior
  it("should return a normalized string if the input is a valid hotkey", () => {
    expect(safeNormalize("Mod+J")).toBe("Mod+J");
  });

  // AC-002 - behavior
  it("should canonicalize a lower-case modifier+key into the registry form", () => {
    expect(safeNormalize("mod+j")).toBe("Mod+J");
  });

  // AC-002, E - behavior: an "Unknown key" warning is not acceptable.
  it("should return null if the input is garbage", () => {
    expect(safeNormalize("NotAKey++")).toBeNull();
  });

  // AC-002, E - behavior
  it("should return null if the input is an empty string", () => {
    expect(safeNormalize("")).toBeNull();
  });
});

describe("resolveShortcuts", () => {
  // AC-002 - behavior
  it("should return every action's registry default if no overrides are given", () => {
    const effective = resolveShortcuts({});

    SHORTCUT_ACTIONS.forEach((action) => {
      expect(effective[action.id]).toBe(action.defaultHotkey);
    });
  });

  // AC-002, TC-002 - behavior
  it("should replace toggle-sidebar with a valid override and keep other defaults", () => {
    const effective = resolveShortcuts({ "toggle-sidebar": "Mod+Shift+B" });

    expect(effective["toggle-sidebar"]).toBe("Mod+Shift+B");
    expect(effective["toggle-console"]).toBe(defaultFor("toggle-console"));
    expect(effective["open-command-palette"]).toBe(
      defaultFor("open-command-palette"),
    );
  });

  // AC-002, TC-003 - behavior
  it("should fall back to the default toggle-sidebar if the override is garbage", () => {
    const effective = resolveShortcuts({ "toggle-sidebar": "NotAKey++" });

    expect(effective["toggle-sidebar"]).toBe("Mod+B");
  });

  // AC-002, E-2 - behavior
  it("should fall back to the default if an override value is not a string", () => {
    const overrides = {
      "toggle-sidebar": 42,
    } as unknown as ShortcutOverrides;

    const effective = resolveShortcuts(overrides);

    expect(effective["toggle-sidebar"]).toBe(defaultFor("toggle-sidebar"));
  });

  // AC-002, E-3 - behavior
  it("should ignore an override for an unknown action id and keep all defaults", () => {
    const overrides = {
      bogus: "Mod+Q",
    } as unknown as ShortcutOverrides;

    const effective = resolveShortcuts(overrides);

    expect(effective).not.toHaveProperty("bogus");
    SHORTCUT_ACTIONS.forEach((action) => {
      expect(effective[action.id]).toBe(action.defaultHotkey);
    });
  });

  // AC-002 - behavior
  it("should not throw on a corrupt overrides map", () => {
    const overrides = {
      "toggle-sidebar": 42,
      bogus: "Mod+Q",
    } as unknown as ShortcutOverrides;

    expect(() => resolveShortcuts(overrides)).not.toThrow();
  });
});

describe("findConflict", () => {
  // AC-003, TC-004 - behavior: same combo, different scopes is NOT a conflict.
  it("should return null if delete-rows (grid) is rebound to Backspace already owned by delete-nodes (tree)", () => {
    const effective = resolveShortcuts({});

    const owner = findConflict("Backspace", "delete-rows", effective);

    expect(owner).toBeNull();
  });

  // AC-003, TC-005 - behavior: same combo, same scope IS a conflict.
  it("should return toggle-sidebar if toggle-console (global) is rebound to Mod+B already owned by toggle-sidebar (global)", () => {
    const effective = resolveShortcuts({});

    const owner = findConflict("Mod+B", "toggle-console", effective);

    expect(owner).toBe("toggle-sidebar");
  });

  // AC-003 - behavior
  it("should return null if the hotkey is not owned by any action in that scope", () => {
    const effective = resolveShortcuts({});

    const owner = findConflict("Mod+Shift+Q", "toggle-console", effective);

    expect(owner).toBeNull();
  });

  // AC-003 - behavior
  it("should ignore the action being edited when checking for a conflict", () => {
    const effective = resolveShortcuts({});

    const owner = findConflict("Mod+B", "toggle-sidebar", effective);

    expect(owner).toBeNull();
  });

  // AC-003 - behavior: match is on normalized equality (casing-insensitive modifiers).
  it("should match on normalized equality if the candidate differs only in casing", () => {
    const effective = resolveShortcuts({});

    const owner = findConflict("mod+b", "toggle-console", effective);

    expect(owner).toBe("toggle-sidebar");
  });

  // AC-003 - behavior
  it("should return null if the candidate hotkey is invalid", () => {
    const effective = resolveShortcuts({});

    const owner = findConflict("NotAKey++", "toggle-console", effective);

    expect(owner).toBeNull();
  });
});
