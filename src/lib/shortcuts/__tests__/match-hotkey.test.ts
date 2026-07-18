import { describe, it, expect } from "vitest";

import { matchesHotkey, matchesAny } from "@/lib/shortcuts/match-hotkey";

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

  // macOS Option composes punctuation into a symbol: Option+= emits key "≠" and
  // Option+- emits "–", so a key-only match would miss the binding. Match the
  // physical event.code (Equal/Minus) so Mod+Alt+= / Mod+Alt+- still fire.
  it("should match Mod+Alt+= if key is the Option-composed symbol but code is Equal", () => {
    expect(
      matchesHotkey(
        ev({ key: "≠", code: "Equal", metaKey: true, altKey: true }),
        "Mod+Alt+=",
      ),
    ).toBe(true);
  });

  it("should match Mod+Alt+- if key is the Option-composed symbol but code is Minus", () => {
    expect(
      matchesHotkey(
        ev({ key: "–", code: "Minus", metaKey: true, altKey: true }),
        "Mod+Alt+-",
      ),
    ).toBe(true);
  });

  // The plain event.key path still works when no layout composition happened
  // (non-Mac, or the literal key jsdom/userEvent fires).
  it("should match Mod+Alt+= via the literal key when no composition happened", () => {
    expect(
      matchesHotkey(
        ev({ key: "=", code: "Equal", metaKey: true, altKey: true }),
        "Mod+Alt+=",
      ),
    ).toBe(true);
  });

  // code only rescues the match; the modifiers must still line up.
  it("should not match Mod+Alt+= via code if alt is not held", () => {
    expect(
      matchesHotkey(ev({ key: "≠", code: "Equal", metaKey: true }), "Mod+Alt+="),
    ).toBe(false);
  });
});

describe("matchesAny", () => {
  // C-02, TC-C2 - behavior: an event matching the FIRST binding fires.
  it("should return true if the event matches the first binding in the list", () => {
    expect(matchesAny(ev({ key: "j", metaKey: true }), ["Mod+J", "Mod+K"])).toBe(
      true,
    );
  });

  // C-02, TC-C2 - behavior: an event matching a LATER binding fires (proves the whole list scans).
  it("should return true if the event matches a later binding in the list", () => {
    expect(matchesAny(ev({ key: "k", ctrlKey: true }), ["Mod+J", "Mod+K"])).toBe(
      true,
    );
  });

  // C-02 - behavior: an event matching none of the bindings does not fire.
  it("should return false if the event matches no binding in the list", () => {
    expect(matchesAny(ev({ key: "q", metaKey: true }), ["Mod+J", "Mod+K"])).toBe(
      false,
    );
  });

  // C-04 - behavior: an empty list (disabled action) never fires.
  it("should return false for an empty list", () => {
    expect(matchesAny(ev({ key: "j", metaKey: true }), [])).toBe(false);
  });
});
