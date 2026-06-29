import { describe, it, expect } from "vitest";

import { toCodeMirrorKey } from "@/lib/shortcuts/to-codemirror-key";

describe("toCodeMirrorKey", () => {
  // AC-004, TC-006 - behavior
  it("should convert Mod+Enter to the CodeMirror Mod-Enter key", () => {
    expect(toCodeMirrorKey("Mod+Enter")).toBe("Mod-Enter");
  });

  // AC-004, TC-006 - behavior: a single trailing alphabetic key lowercases.
  it("should convert Mod+S to the lower-cased CodeMirror Mod-s key", () => {
    expect(toCodeMirrorKey("Mod+S")).toBe("Mod-s");
  });

  // AC-004, TC-006 - behavior: modifiers join with - and the trailing key lowercases.
  it("should convert Mod+Shift+L to Mod-Shift-l", () => {
    expect(toCodeMirrorKey("Mod+Shift+L")).toBe("Mod-Shift-l");
  });

  // AC-004, TC-006 - behavior: a named bare key is kept as-is.
  it("should keep a named key like Backspace unchanged", () => {
    expect(toCodeMirrorKey("Backspace")).toBe("Backspace");
  });

  // AC-004, TC-007 - behavior
  it("should return null if the hotkey is invalid", () => {
    expect(toCodeMirrorKey("###")).toBeNull();
  });
});
