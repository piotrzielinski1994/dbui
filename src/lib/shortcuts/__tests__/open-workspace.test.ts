import { describe, it, expect } from "vitest";

import { SHORTCUT_ACTIONS } from "@/lib/shortcuts/registry";

describe("open-workspace shortcut action", () => {
  const action = () =>
    SHORTCUT_ACTIONS.find((a) => a.id === "open-workspace");

  // AC-002 - behavior: the action is registered
  it("should be registered in SHORTCUT_ACTIONS", () => {
    expect(action()).toBeDefined();
  });

  // AC-002 - behavior: default binding is Mod+O
  it("should default to Mod+O", () => {
    expect(action()?.defaultHotkey).toBe("Mod+O");
  });

  // AC-002 - behavior: it is a global-scope action
  it("should be a global-scope action", () => {
    expect(action()?.scope).toBe("global");
  });

  // AC-002 - behavior: it carries a name and description
  it("should have a non-empty name and description", () => {
    expect(action()?.name.length ?? 0).toBeGreaterThan(0);
    expect(action()?.description.length ?? 0).toBeGreaterThan(0);
  });
});
