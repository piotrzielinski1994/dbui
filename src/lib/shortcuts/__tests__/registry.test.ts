import { describe, it, expect } from "vitest";

import {
  SHORTCUT_ACTIONS,
  type ShortcutActionId,
  type ShortcutScope,
} from "@/lib/shortcuts/registry";

// The full set of action ids the spec lists, grouped by their documented scope.
const EXPECTED_BY_SCOPE: Record<ShortcutScope, ShortcutActionId[]> = {
  global: [
    "open-command-palette",
    "new-database",
    "new-folder",
    "toggle-sidebar",
    "toggle-console",
    "toggle-theme",
    "toggle-split-orientation",
  ],
  tab: ["next-tab", "prev-tab", "close-tab"],
  grid: ["toggle-record-view", "delete-rows"],
  tree: ["delete-nodes"],
  editor: ["run-query", "save-script"],
};

const EXPECTED_IDS: ShortcutActionId[] = (
  Object.keys(EXPECTED_BY_SCOPE) as ShortcutScope[]
).flatMap((scope) => EXPECTED_BY_SCOPE[scope]);

const VALID_SCOPES = new Set<string>([
  "global",
  "tab",
  "grid",
  "tree",
  "editor",
]);

describe("SHORTCUT_ACTIONS registry", () => {
  // AC-001, TC-001 - behavior
  it("should define every documented action id exactly once", () => {
    const ids = SHORTCUT_ACTIONS.map((action) => action.id).sort();
    expect(ids).toEqual([...EXPECTED_IDS].sort());
  });

  // AC-001, TC-001 - behavior
  it("should give every action a non-empty defaultHotkey", () => {
    SHORTCUT_ACTIONS.forEach((action) => {
      expect(typeof action.defaultHotkey).toBe("string");
      expect(action.defaultHotkey.length).toBeGreaterThan(0);
    });
  });

  // AC-001, TC-001 - behavior
  it("should give every action a valid scope", () => {
    SHORTCUT_ACTIONS.forEach((action) => {
      expect(VALID_SCOPES.has(action.scope)).toBe(true);
    });
  });

  // AC-001 - behavior
  it("should give every action a non-empty name and description", () => {
    SHORTCUT_ACTIONS.forEach((action) => {
      expect(action.name.length).toBeGreaterThan(0);
      expect(action.description.length).toBeGreaterThan(0);
    });
  });

  // AC-001 - behavior
  it("should place each action in the scope the spec assigns it", () => {
    (Object.keys(EXPECTED_BY_SCOPE) as ShortcutScope[]).forEach((scope) => {
      EXPECTED_BY_SCOPE[scope].forEach((id) => {
        const action = SHORTCUT_ACTIONS.find((a) => a.id === id);
        expect(action, `action ${id} must exist`).toBeDefined();
        expect(action!.scope).toBe(scope);
      });
    });
  });

  // AC-001 - behavior: the documented default bindings hold.
  it("should carry the documented default binding for the global actions", () => {
    const byId = new Map(SHORTCUT_ACTIONS.map((a) => [a.id, a.defaultHotkey]));
    expect(byId.get("open-command-palette")).toBe("Mod+K");
    expect(byId.get("new-database")).toBe("Mod+N");
    expect(byId.get("new-folder")).toBe("Mod+Shift+N");
    expect(byId.get("toggle-sidebar")).toBe("Mod+B");
    expect(byId.get("toggle-console")).toBe("Mod+J");
    expect(byId.get("toggle-theme")).toBe("Mod+Shift+L");
  });

  // AC-001 - behavior: grid/tree delete defaults plus the editor commands.
  it("should carry the documented default binding for the scoped actions", () => {
    const byId = new Map(SHORTCUT_ACTIONS.map((a) => [a.id, a.defaultHotkey]));
    expect(byId.get("delete-rows")).toBe("Backspace");
    expect(byId.get("delete-nodes")).toBe("Backspace");
    expect(byId.get("toggle-record-view")).toBe("Tab");
    expect(byId.get("run-query")).toBe("Mod+Enter");
    expect(byId.get("save-script")).toBe("Mod+S");
  });
});
