import { matchesAny } from "@pziel/pureui";
import { createContext, type KeyboardEvent, useContext } from "react";

// Shared state between SidebarTree (which owns the roving anchor, the row-element
// ref map, and the keydown dispatch) and each TreeRow (which registers its element,
// sets its tabIndex from rovingId, and forwards its onKeyDown). Kept in a context so
// the rows stay thin and the dispatch logic lives in one place.
export type TreeNavState = {
  // The one row currently in the Tab order (roving tabIndex); null when the tree is empty.
  rovingId: string | null;
  // The resolved bindings for the context-menu-open action (default Shift+F10).
  contextMenuBindings: string[];
  // A row registers/unregisters its element so focus can be moved to it imperatively.
  registerRow: (id: string, element: HTMLElement | null) => void;
  // A row forwards its keydown; SidebarTree resolves it to a tree command and runs it.
  handleKeyDown: (focusedId: string, event: KeyboardEvent) => void;
};

const TreeNavContext = createContext<TreeNavState>({
  rovingId: null,
  contextMenuBindings: ["Shift+F10"],
  registerRow: () => {},
  handleKeyDown: () => {},
});

export const TreeNavProvider = TreeNavContext.Provider;

export function useTreeNav(): TreeNavState {
  return useContext(TreeNavContext);
}

// Open the focused element's context menu from the keyboard: Radix's ContextMenu
// listens for a native `contextmenu` event, which the browser does NOT synthesize
// from Shift+F10 / the Menu key, so dispatch one at the element's center. Returns
// true when it handled the key (the ContextMenu key, or any bound combo).
export function openContextMenuOnKey(
  event: KeyboardEvent,
  bindings: string[],
): boolean {
  const isMenuKey =
    event.key === "ContextMenu" || matchesAny(event.nativeEvent, bindings);
  if (!isMenuKey) {
    return false;
  }
  const element = event.currentTarget as HTMLElement;
  const rect = element.getBoundingClientRect();
  event.preventDefault();
  element.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: Math.round(rect.left + rect.width / 2),
      clientY: Math.round(rect.top + rect.height / 2),
    }),
  );
  return true;
}
