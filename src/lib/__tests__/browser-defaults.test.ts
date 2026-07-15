import { describe, it, expect, vi } from "vitest";

import {
  isReservedBrowserShortcut,
  installBrowserDefaultGuards,
} from "@/lib/browser-defaults";

type KeyArgs = {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
};

const key = (args: KeyArgs) => ({
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...args,
});

describe("isReservedBrowserShortcut", () => {
  const reserved: [string, KeyArgs][] = [
    ["reload (Mod+R)", { key: "r", metaKey: true }],
    ["reload (Ctrl+R)", { key: "r", ctrlKey: true }],
    ["zoom in (Mod+=)", { key: "=", metaKey: true }],
    ["zoom in (Mod++)", { key: "+", metaKey: true, shiftKey: true }],
    ["zoom out (Mod+-)", { key: "-", metaKey: true }],
    ["zoom out (Mod+_)", { key: "_", metaKey: true, shiftKey: true }],
    ["zoom reset (Mod+0)", { key: "0", metaKey: true }],
    ["find (Mod+F)", { key: "f", metaKey: true }],
    ["find next (Mod+G)", { key: "g", metaKey: true }],
    ["find prev (Mod+Shift+G)", { key: "g", metaKey: true, shiftKey: true }],
    ["print (Mod+P)", { key: "p", metaKey: true }],
    ["save (Mod+S)", { key: "s", metaKey: true }],
    ["view source (Mod+U)", { key: "u", metaKey: true }],
  ];

  reserved.forEach(([label, args]) => {
    // behavior: every browser-reserved combo is flagged for suppression (AC-001, AC-002)
    it(`should return true if the combo is ${label}`, () => {
      expect(isReservedBrowserShortcut(key(args))).toBe(true);
    });
  });

  const kept: [string, KeyArgs][] = [
    ["copy (Mod+C)", { key: "c", metaKey: true }],
    ["paste (Mod+V)", { key: "v", metaKey: true }],
    ["cut (Mod+X)", { key: "x", metaKey: true }],
    ["select all (Mod+A)", { key: "a", metaKey: true }],
    ["undo (Mod+Z)", { key: "z", metaKey: true }],
    ["redo (Mod+Shift+Z)", { key: "z", metaKey: true, shiftKey: true }],
    ["quit (Mod+Q)", { key: "q", metaKey: true }],
    ["close window (Mod+W)", { key: "w", metaKey: true }],
    ["minimize (Mod+M)", { key: "m", metaKey: true }],
    ["hide (Mod+H)", { key: "h", metaKey: true }],
  ];

  kept.forEach(([label, args]) => {
    // behavior: text-editing and OS combos are NOT suppressed (AC-002 negative, TC-002)
    it(`should return false if the combo is ${label}`, () => {
      expect(isReservedBrowserShortcut(key(args))).toBe(false);
    });
  });

  // behavior: a bare reserved key (no modifier) is an app hotkey, not a browser default (TC-002)
  it("should return false if the reserved key has no modifier", () => {
    expect(isReservedBrowserShortcut(key({ key: "r" }))).toBe(false);
    expect(isReservedBrowserShortcut(key({ key: "f" }))).toBe(false);
    expect(isReservedBrowserShortcut(key({ key: "=" }))).toBe(false);
  });
});

describe("installBrowserDefaultGuards", () => {
  // side-effect-contract: a right-click context menu is suppressed app-wide
  it("should prevent the default context menu if one is requested", () => {
    const cleanup = installBrowserDefaultGuards(window);

    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    cleanup();
  });

  // side-effect-contract: Cmd+F never reaches the native WKWebView find-in-page (AC-001, TC-001)
  it("should prevent the default if Cmd+F fires", () => {
    const cleanup = installBrowserDefaultGuards(window);

    const event = new KeyboardEvent("keydown", {
      key: "f",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    cleanup();
  });

  // side-effect-contract: the other reserved combos (reload/zoom) are blocked too (AC-002, TC-001)
  it("should prevent the default if a reserved browser shortcut fires", () => {
    const cleanup = installBrowserDefaultGuards(window);

    const reload = new KeyboardEvent("keydown", {
      key: "r",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(reload);
    expect(reload.defaultPrevented).toBe(true);

    const zoom = new KeyboardEvent("keydown", {
      key: "=",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(zoom);
    expect(zoom.defaultPrevented).toBe(true);

    cleanup();
  });

  // side-effect-contract: a text-editing shortcut passes through untouched (TC-002)
  it("should not prevent the default if a text-editing shortcut fires", () => {
    const cleanup = installBrowserDefaultGuards(window);

    const event = new KeyboardEvent("keydown", {
      key: "c",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    cleanup();
  });

  // side-effect-contract: a bare key with no modifier passes through untouched (TC-002)
  it("should not prevent the default if a bare f (no modifier) fires", () => {
    const cleanup = installBrowserDefaultGuards(window);

    const event = new KeyboardEvent("keydown", {
      key: "f",
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    cleanup();
  });

  // side-effect-contract: cleanup detaches the listeners so events flow normally again
  it("should stop suppressing once cleanup runs", () => {
    const cleanup = installBrowserDefaultGuards(window);
    cleanup();

    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  // side-effect-contract: install/cleanup balance their add/remove listener calls (contextmenu + keydown)
  it("should remove exactly the listeners it added on cleanup", () => {
    const target = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    const cleanup = installBrowserDefaultGuards(target);
    expect(target.addEventListener).toHaveBeenCalledTimes(2);

    cleanup();
    expect(target.removeEventListener).toHaveBeenCalledTimes(2);
  });
});
