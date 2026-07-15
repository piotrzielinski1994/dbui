type GuardTarget = {
  addEventListener: (type: string, listener: (event: Event) => void) => void;
  removeEventListener: (type: string, listener: (event: Event) => void) => void;
};

type ReservedShortcut = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey">;

// Browser-reserved combos to swallow so the WKWebView doesn't reload, zoom, open find, print,
// save the page, or show source inside the app. OS-level combos (quit/close/minimize) and text
// editing (copy/paste/cut/select-all/undo/redo) are deliberately absent so they keep working.
// `f`/`g` also let the in-app find bar own Cmd+F instead of the native find-in-page.
const RESERVED_KEYS = new Set([
  "r",
  "=",
  "+",
  "-",
  "_",
  "0",
  "f",
  "g",
  "p",
  "s",
  "u",
]);

export function isReservedBrowserShortcut(event: ReservedShortcut): boolean {
  const hasPrimaryModifier = event.metaKey || event.ctrlKey;
  if (!hasPrimaryModifier) {
    return false;
  }
  return RESERVED_KEYS.has(event.key.toLowerCase());
}

// Suppresses the native browser context menu (Reload / Inspect Element / ...) app-wide plus the
// reserved keyboard combos above - a desktop app should never reload/zoom/print or show the native
// find-in-page. The app's own radix context menus are unaffected: they draw their menu and
// preventDefault on the trigger before this window-level (bubble-phase) guard runs, so this only
// swallows the native menu where no app menu handled the right-click. Returns a cleanup that
// detaches the listeners. Mirrors vidui's browser-defaults (context-menu + reserved-key slices).
export function installBrowserDefaultGuards(target: GuardTarget): () => void {
  const onContextMenu = (event: Event) => event.preventDefault();
  const onKeyDown = (event: Event) => {
    if (isReservedBrowserShortcut(event as KeyboardEvent)) {
      event.preventDefault();
    }
  };

  target.addEventListener("contextmenu", onContextMenu);
  target.addEventListener("keydown", onKeyDown);

  return () => {
    target.removeEventListener("contextmenu", onContextMenu);
    target.removeEventListener("keydown", onKeyDown);
  };
}
