import { describe, it, expect } from "vitest";

import { matchesHotkey } from "@/lib/shortcuts/match-hotkey";

const ev = (over: Partial<Parameters<typeof matchesHotkey>[0]>) => ({
  key: "",
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...over,
});

describe("matchesHotkey", () => {
  // AC-010 - behavior: Mod matches Cmd...
  it("should match Mod+K if metaKey is held", () => {
    expect(matchesHotkey(ev({ key: "k", metaKey: true }), "Mod+K")).toBe(true);
  });

  // AC-010 - behavior: ...and Mod matches Ctrl.
  it("should match Mod+K if ctrlKey is held", () => {
    expect(matchesHotkey(ev({ key: "k", ctrlKey: true }), "Mod+K")).toBe(true);
  });

  // AC-010 - behavior
  it("should not match Mod+K if no modifier is held", () => {
    expect(matchesHotkey(ev({ key: "k" }), "Mod+K")).toBe(false);
  });

  // AC-010 - behavior: shift must match exactly.
  it("should match Mod+Shift+N only if shift is also held", () => {
    expect(
      matchesHotkey(ev({ key: "n", metaKey: true, shiftKey: true }), "Mod+Shift+N"),
    ).toBe(true);
    expect(matchesHotkey(ev({ key: "n", metaKey: true }), "Mod+Shift+N")).toBe(
      false,
    );
  });

  // AC-010 - behavior: a plain Mod+N must not fire when shift is also down.
  it("should not match Mod+N if shift is held", () => {
    expect(
      matchesHotkey(ev({ key: "n", metaKey: true, shiftKey: true }), "Mod+N"),
    ).toBe(false);
  });

  // AC-010 - behavior: a bare key matches only with no modifiers.
  it("should match a bare Backspace only if no modifier is held", () => {
    expect(matchesHotkey(ev({ key: "Backspace" }), "Backspace")).toBe(true);
    expect(matchesHotkey(ev({ key: "Backspace", metaKey: true }), "Backspace")).toBe(
      false,
    );
  });

  // AC-010 - behavior: explicit Ctrl binding requires Ctrl specifically (Ctrl+Tab).
  it("should match Ctrl+Tab if ctrlKey is held", () => {
    expect(matchesHotkey(ev({ key: "Tab", ctrlKey: true }), "Ctrl+Tab")).toBe(
      true,
    );
  });

  // AC-010 - behavior
  it("should not match an invalid hotkey string", () => {
    expect(matchesHotkey(ev({ key: "k", metaKey: true }), "###")).toBe(false);
  });
});
