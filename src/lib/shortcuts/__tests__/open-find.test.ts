import { describe, it, expect } from "vitest";

import { SHORTCUT_ACTIONS } from "@/lib/shortcuts/registry";
import { resolveShortcuts } from "@/lib/shortcuts/resolve";

describe("open-find shortcut action", () => {
  // behavior: the action is registered so it appears in the keymap editor (AC-003, TC-003)
  it("should be registered in the shortcut registry", () => {
    const action = SHORTCUT_ACTIONS.find((a) => a.id === "open-find");
    expect(action).toBeDefined();
  });

  // behavior: its default binding is Mod+F, in the grid scope (AC-003)
  it("should default to Mod+F in the grid scope", () => {
    const action = SHORTCUT_ACTIONS.find((a) => a.id === "open-find");
    expect(action?.defaultHotkey).toBe("Mod+F");
    expect(action?.scope).toBe("grid");
  });

  // behavior: an absent override resolves to the single default binding (AC-003, TC-003)
  it("should resolve to [Mod+F] with no overrides", () => {
    const effective = resolveShortcuts({});
    expect(effective["open-find"]).toEqual(["Mod+F"]);
  });

  // behavior: it is rebindable like every other action (AC-003, TC-003)
  it("should honor an override", () => {
    const effective = resolveShortcuts({ "open-find": ["Mod+Shift+F"] });
    expect(effective["open-find"]).toEqual(["Mod+Shift+F"]);
  });
});
