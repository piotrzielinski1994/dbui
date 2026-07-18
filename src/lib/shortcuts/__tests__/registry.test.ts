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
    "open-quick-open",
    "open-workspace",
    "new-database",
    "new-folder",
    "toggle-sidebar",
    "toggle-console",
    "toggle-theme",
    "toggle-split-orientation",
    "nav-back",
    "nav-forward",
    "panel-expand",
    "panel-shrink",
  ],
  tab: ["next-tab", "prev-tab", "close-tab", "close-other-tabs"],
  grid: [
    "toggle-record-view",
    "delete-rows",
    "toggle-json-view",
    "toggle-structure-view",
    "open-find",
    "refresh-table",
  ],
  tree: [
    "delete-nodes",
    "tree-nav-up",
    "tree-nav-down",
    "tree-nav-first",
    "tree-nav-last",
    "tree-expand",
    "tree-collapse",
    "tree-activate",
    "tree-extend-up",
    "tree-extend-down",
    "tree-move-up",
    "tree-move-down",
    "tree-outdent",
    "tree-nest",
    "open-context-menu",
  ],
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

  // AC-001, TC-001 - behavior: the JSON view toggle is a grid action bound to Mod+Shift+J.
  it("should carry the documented default binding for the JSON view toggle", () => {
    const byId = new Map(SHORTCUT_ACTIONS.map((a) => [a.id, a.defaultHotkey]));
    expect(byId.get("toggle-json-view")).toBe("Mod+Shift+J");
  });

  // behavior: close-other-tabs is a tab action bound to Mod+Alt+W (mirrors requi).
  it("should carry the documented default binding for close other tabs", () => {
    const byId = new Map(SHORTCUT_ACTIONS.map((a) => [a.id, a.defaultHotkey]));
    expect(byId.get("close-other-tabs")).toBe("Mod+Alt+W");
  });

  // AC-001, TC-001 - behavior: the panel resize actions are global and bound to
  // Mod+Alt+= (expand) / Mod+Alt+- (shrink).
  it("should carry the documented default binding for the panel resize actions", () => {
    const byId = new Map(SHORTCUT_ACTIONS.map((a) => [a.id, a.defaultHotkey]));
    expect(byId.get("panel-expand")).toBe("Mod+Alt+=");
    expect(byId.get("panel-shrink")).toBe("Mod+Alt+-");
  });
});
