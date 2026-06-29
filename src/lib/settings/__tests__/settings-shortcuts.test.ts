import { describe, it, expect } from "vitest";

import { DEFAULT_SETTINGS, mergeSettings } from "@/lib/settings/settings";

// The `shortcuts` field is new on Settings. These tests assert it through index
// access so they fail because the field/merge behaviour is missing, not because
// of a test-file typo.
type WithShortcuts = { shortcuts?: Record<string, string> };

describe("DEFAULT_SETTINGS shortcuts", () => {
  // AC-005 - behavior
  it("should default shortcuts to an empty override map", () => {
    expect((DEFAULT_SETTINGS as WithShortcuts).shortcuts).toEqual({});
  });
});

describe("mergeSettings shortcuts", () => {
  // AC-005, TC-008 - behavior
  it("should keep only valid known-action shortcut entries", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, {
      shortcuts: { x: "y", "toggle-sidebar": "Mod+B" },
    });

    expect((merged as WithShortcuts).shortcuts).toEqual({
      "toggle-sidebar": "Mod+B",
    });
  });

  // AC-005, E - behavior: an invalid hotkey value is dropped even for a known id.
  it("should drop a known-action entry whose hotkey is invalid", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, {
      shortcuts: { "toggle-sidebar": "NotAKey++" },
    });

    // The merge must yield a shortcuts object (so this is RED until the field
    // exists) and that object must not carry the invalid entry.
    expect((merged as WithShortcuts).shortcuts).toEqual({});
  });

  // AC-005, E - behavior
  it("should default shortcuts to empty if the persisted value is not an object", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { shortcuts: "nope" });

    expect((merged as WithShortcuts).shortcuts).toEqual({});
  });

  // AC-005 - behavior
  it("should default shortcuts to empty if the key is absent", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { sidebarHidden: true });

    expect((merged as WithShortcuts).shortcuts).toEqual({});
  });
});
