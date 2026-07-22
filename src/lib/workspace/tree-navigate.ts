import { matchesAny } from "@pziel/pureui";
import type { ShortcutActionId } from "@/lib/shortcuts/registry";
import type { TreeNode } from "@/lib/workspace/model";
import type { MoveTarget } from "@/lib/workspace/move";
import { findNode, locateNode } from "@/lib/workspace/tree-locate";
import { flattenSelectable } from "@/lib/workspace/tree-select";

// The visible rows in DFS order INCLUDING table leaves: a folder's children (and a
// database's tables) are listed only when that node is expanded. This is the basis
// for arrow FOCUS movement (which lands on tables so a table's tab can be opened) -
// distinct from `flattenSelectable`, which excludes tables and stays the basis for
// shift-range SELECTION.
export function flattenVisible(
  nodes: TreeNode[],
  expandedIds: Set<string>,
): string[] {
  return nodes.flatMap((node) => {
    if (node.kind === "folder") {
      const children = expandedIds.has(node.id)
        ? flattenVisible(node.children, expandedIds)
        : [];
      return [node.id, ...children];
    }
    if (node.kind === "database") {
      const tables = expandedIds.has(node.id)
        ? node.tables.map((table) => table.id)
        : [];
      return [node.id, ...tables];
    }
    return [node.id];
  });
}

// The id of a node's first visible child: a folder's first child, or an expanded
// database's first table. Null for a leaf / childless / collapsed node.
function firstChildId(node: TreeNode): string | null {
  if (node.kind === "folder") {
    return node.children[0]?.id ?? null;
  }
  if (node.kind === "database") {
    return node.tables[0]?.id ?? null;
  }
  return null;
}

export type TreeKeyCommand =
  | { type: "focus"; id: string }
  | { type: "activate"; id: string }
  | { type: "toggle"; id: string }
  | { type: "expand"; id: string }
  | { type: "collapse"; id: string }
  | { type: "extend"; id: string }
  | { type: "move"; id: string; target: MoveTarget }
  | { type: "none" };

export type TreeMoveDirection = "up" | "down" | "outdent" | "nest";

// The effective bindings for each tree action (from resolveShortcuts). Only the
// tree-scoped ids are read here; the map may carry every action. Each id maps to a
// LIST of hotkeys (empty = disabled).
export type TreeBindings = Partial<Record<ShortcutActionId, string[]>>;

const NONE: TreeKeyCommand = { type: "none" };

// The shared findNode/locateNode only recurse folder children, so they never see a
// table (tables live on `database.tables`). Nav must resolve a focused table row and
// its owning database, so these table-aware lookups extend the folder-only ones.
function findNodeWithTables(nodes: TreeNode[], id: string): TreeNode | null {
  const direct = findNode(nodes, id);
  if (direct) {
    return direct;
  }
  const walk = (list: TreeNode[]): TreeNode | null => {
    for (const node of list) {
      if (node.kind === "folder") {
        const found = walk(node.children);
        if (found) {
          return found;
        }
      }
      if (node.kind === "database") {
        const table = node.tables.find((candidate) => candidate.id === id);
        if (table) {
          return table;
        }
      }
    }
    return null;
  };
  return walk(nodes);
}

// The id of a focused row's parent, resolving a table's owning database (which
// locateNode, folder-only, cannot see). Null for a root node.
function parentIdOf(tree: TreeNode[], id: string): string | null {
  const location = locateNode(tree, id);
  if (location) {
    return location.parentId;
  }
  const owner = (function findOwner(list: TreeNode[]): string | null {
    for (const node of list) {
      if (node.kind === "folder") {
        const found = findOwner(node.children);
        if (found) {
          return found;
        }
      }
      if (
        node.kind === "database" &&
        node.tables.some((table) => table.id === id)
      ) {
        return node.id;
      }
    }
    return null;
  })(tree);
  return owner;
}

function childrenOf(tree: TreeNode[], parentId: string | null): TreeNode[] {
  if (parentId === null) {
    return tree;
  }
  const parent = findNode(tree, parentId);
  return parent && parent.kind === "folder" ? parent.children : [];
}

// The MoveTarget for a reorder, in `moveNode`'s post-removal index basis (it removes
// the node first, then inserts at target.index). Null when the move is impossible
// (no sibling / already root / no preceding sibling folder).
export function treeMoveTarget(
  tree: TreeNode[],
  id: string,
  direction: TreeMoveDirection,
): MoveTarget | null {
  const location = locateNode(tree, id);
  if (!location) {
    return null;
  }
  const siblings = childrenOf(tree, location.parentId);

  if (direction === "up") {
    if (location.index === 0) {
      return null;
    }
    return { parentId: location.parentId, index: location.index - 1 };
  }

  if (direction === "down") {
    if (location.index >= siblings.length - 1) {
      return null;
    }
    return { parentId: location.parentId, index: location.index + 1 };
  }

  if (direction === "outdent") {
    if (location.parentId === null) {
      return null;
    }
    const parentLocation = locateNode(tree, location.parentId);
    if (!parentLocation) {
      return null;
    }
    return {
      parentId: parentLocation.parentId,
      index: parentLocation.index + 1,
    };
  }

  // nest: append into the immediately-preceding sibling, which must be a folder.
  const preceding = siblings[location.index - 1];
  if (preceding?.kind !== "folder") {
    return null;
  }
  return { parentId: preceding.id, index: preceding.children.length };
}

// The tree actions, in resolution priority. A reorder (Alt+*) is checked before
// plain nav so a move wins even if a user binds overlapping keys; in practice
// findConflict keeps bindings distinct per scope.
const TREE_ACTION_ORDER: ShortcutActionId[] = [
  "tree-move-up",
  "tree-move-down",
  "tree-outdent",
  "tree-nest",
  "tree-extend-up",
  "tree-extend-down",
  "tree-nav-up",
  "tree-nav-down",
  "tree-nav-first",
  "tree-nav-last",
  "tree-activate",
  "tree-expand",
  "tree-collapse",
];

function moveCommand(
  tree: TreeNode[],
  node: TreeNode,
  focusedId: string,
  direction: TreeMoveDirection,
): TreeKeyCommand {
  // Tables are ephemeral leaves - never movable (moveNode rejects them anyway).
  if (node.kind === "table") {
    return NONE;
  }
  const target = treeMoveTarget(tree, focusedId, direction);
  return target ? { type: "move", id: focusedId, target } : NONE;
}

function commandFor(
  action: ShortcutActionId,
  tree: TreeNode[],
  expandedIds: Set<string>,
  focusedId: string,
  node: TreeNode,
): TreeKeyCommand {
  // Focus/nav moves over the VISIBLE rows (tables included); selection extend moves
  // over the SELECTABLE rows (tables excluded).
  const visible = flattenVisible(tree, expandedIds);
  const visibleIndex = visible.indexOf(focusedId);
  const selectable = flattenSelectable(tree, expandedIds);
  const selectableIndex = selectable.indexOf(focusedId);

  if (action === "tree-move-up") {
    return moveCommand(tree, node, focusedId, "up");
  }
  if (action === "tree-move-down") {
    return moveCommand(tree, node, focusedId, "down");
  }
  if (action === "tree-outdent") {
    return moveCommand(tree, node, focusedId, "outdent");
  }
  if (action === "tree-nest") {
    return moveCommand(tree, node, focusedId, "nest");
  }
  if (action === "tree-extend-down") {
    const next = selectable[selectableIndex + 1];
    return next ? { type: "extend", id: next } : NONE;
  }
  if (action === "tree-extend-up") {
    const prev =
      selectableIndex > 0 ? selectable[selectableIndex - 1] : undefined;
    return prev ? { type: "extend", id: prev } : NONE;
  }
  if (action === "tree-nav-down") {
    const next = visible[visibleIndex + 1];
    return next ? { type: "focus", id: next } : NONE;
  }
  if (action === "tree-nav-up") {
    const prev = visibleIndex > 0 ? visible[visibleIndex - 1] : undefined;
    return prev ? { type: "focus", id: prev } : NONE;
  }
  if (action === "tree-nav-first") {
    const first = visible[0];
    return first ? { type: "focus", id: first } : NONE;
  }
  if (action === "tree-nav-last") {
    const last = visible[visible.length - 1];
    return last ? { type: "focus", id: last } : NONE;
  }
  if (action === "tree-activate") {
    // A table opens its tab; a folder/database toggles its expansion (expanding an
    // idle database connects it, via the row's own toggle handler).
    return node.kind === "table"
      ? { type: "activate", id: focusedId }
      : { type: "toggle", id: focusedId };
  }
  if (action === "tree-expand") {
    if (node.kind === "table") {
      return NONE;
    }
    if (!expandedIds.has(focusedId)) {
      return { type: "expand", id: focusedId };
    }
    const child = firstChildId(node);
    return child ? { type: "focus", id: child } : NONE;
  }
  if (action === "tree-collapse") {
    // Only a folder collapses in place; a database or a leaf moves focus to its
    // parent (an expanded database's ArrowLeft steps out, it does not collapse).
    if (node.kind === "folder" && expandedIds.has(focusedId)) {
      return { type: "collapse", id: focusedId };
    }
    const parentId = parentIdOf(tree, focusedId);
    return parentId ? { type: "focus", id: parentId } : NONE;
  }
  return NONE;
}

// Resolve a tree-row keydown into a command by matching the event against the user's
// effective bindings (not hardcoded keys), so every tree shortcut is reconfigurable.
// An event matching no tree binding - including a stray Cmd/Ctrl+Arrow - is `none`.
export function resolveTreeKey(input: {
  tree: TreeNode[];
  expandedIds: Set<string>;
  focusedId: string;
  event: KeyboardEvent;
  bindings: TreeBindings;
}): TreeKeyCommand {
  const { tree, expandedIds, focusedId, event, bindings } = input;
  const node = findNodeWithTables(tree, focusedId);
  if (!node) {
    return NONE;
  }
  const action = TREE_ACTION_ORDER.find((id) => {
    const actionBindings = bindings[id];
    return Array.isArray(actionBindings) && matchesAny(event, actionBindings);
  });
  if (!action) {
    return NONE;
  }
  return commandFor(action, tree, expandedIds, focusedId, node);
}
