import { describe, it, expect } from "vitest";

// Imported before it exists so RED fails on the missing export. moveNodes moves
// a SET of nodes (a sidebar multi-selection) in one drop: descendants of a moved
// folder ride along (deduped), order follows the tree's document order, and a
// drop into the selection itself (cycle) is rejected. `target.index` is the
// RAW pre-removal slot in the destination parent's original children; moveNodes
// compensates for any dragged siblings removed before it.
import { moveNodes } from "@/lib/workspace/move";
import type {
  DatabaseNode,
  FolderNode,
  TreeNode,
} from "@/lib/workspace/model";

const database = (id: string): DatabaseNode => ({
  kind: "database",
  id,
  name: id,
  engine: "postgres",
  host: "localhost",
  port: 5432,
  database: id,
  user: "u",
  password: "",
  tables: [],
  views: [],
  sql: "",
  savedScripts: [],
  savedJsScripts: [],
  result: {
    status: "success",
    timeMs: 0,
    rowCount: 0,
    columns: [],
    rows: [],
    message: "",
  },
  accentColor: null,
  readOnly: false,
  manualCommit: false,
});

const folder = (id: string, children: TreeNode[]): FolderNode => ({
  kind: "folder",
  id,
  name: id,
  children,
});

const ids = (nodes: TreeNode[]): string[] => nodes.map((node) => node.id);

const findFolder = (nodes: TreeNode[], id: string): FolderNode => {
  const found = nodes.find(
    (node): node is FolderNode => node.kind === "folder" && node.id === id,
  );
  if (!found) {
    throw new Error(`folder ${id} not found`);
  }
  return found;
};

describe("moveNodes reparenting a selection", () => {
  // behavior: two root databases move into a folder together, in document order.
  it("should move multiple selected nodes into a folder in document order", () => {
    const tree: TreeNode[] = [
      folder("f1", [database("d1"), database("d2")]),
      database("d3"),
      database("d4"),
    ];

    // inside f1 -> raw index = f1's original children length (2).
    const result = moveNodes(tree, ["d3", "d4"], { parentId: "f1", index: 2 });

    expect(ids(result)).toEqual(["f1"]);
    expect(ids(findFolder(result, "f1").children)).toEqual([
      "d1",
      "d2",
      "d3",
      "d4",
    ]);
  });

  // behavior: dragged ids given out of order still insert in document order.
  it("should insert the moved nodes in document order regardless of the drag-id order", () => {
    const tree: TreeNode[] = [
      database("a"),
      database("b"),
      folder("dst", []),
    ];

    const result = moveNodes(tree, ["b", "a"], { parentId: "dst", index: 0 });

    expect(ids(findFolder(result, "dst").children)).toEqual(["a", "b"]);
  });

  // behavior: a selected folder AND its selected child -> only the folder moves,
  // the child rides along (deduped, not moved twice).
  it("should move only the ancestor when both an ancestor and its descendant are selected", () => {
    const tree: TreeNode[] = [
      folder("A", [database("d1")]),
      folder("C", []),
    ];

    const result = moveNodes(tree, ["A", "d1"], { parentId: "C", index: 0 });

    expect(ids(result)).toEqual(["C"]);
    const c = findFolder(result, "C");
    expect(ids(c.children)).toEqual(["A"]);
    expect(ids(findFolder(c.children, "A").children)).toEqual(["d1"]);
  });
});

describe("moveNodes reordering siblings", () => {
  // behavior: moving a multi-selection before a later sibling reorders them
  // contiguously (raw index compensated for the removed earlier siblings).
  it("should reorder a multi-selection before a later sibling", () => {
    const tree: TreeNode[] = [
      database("a"),
      database("b"),
      database("c"),
      database("d"),
    ];

    // before d -> raw index 3; a(0) and c(2) sit before it, so they land after b.
    const result = moveNodes(tree, ["a", "c"], { parentId: null, index: 3 });

    expect(ids(result)).toEqual(["b", "a", "c", "d"]);
  });
});

describe("moveNodes illegal moves", () => {
  // behavior: dropping the selection into one of the dragged folders is a cycle.
  it("should return the tree unchanged if the target is inside a dragged folder", () => {
    const tree: TreeNode[] = [
      folder("A", [folder("B", [])]),
      database("d1"),
    ];

    const result = moveNodes(tree, ["A", "d1"], { parentId: "B", index: 0 });

    expect(result).toEqual(tree);
  });

  // behavior: a non-folder parent is rejected.
  it("should return the tree unchanged if the target parent is a database", () => {
    const tree: TreeNode[] = [database("a"), database("b"), database("c")];

    const result = moveNodes(tree, ["a", "b"], { parentId: "c", index: 0 });

    expect(result).toEqual(tree);
  });

  // behavior: an empty drag set leaves the tree unchanged.
  it("should return the tree unchanged if no dragged id exists", () => {
    const tree: TreeNode[] = [database("a")];

    const result = moveNodes(tree, ["ghost"], { parentId: null, index: 0 });

    expect(result).toEqual(tree);
  });
});

describe("moveNodes purity", () => {
  // side-effect-contract: the input tree is not mutated.
  it("should not mutate the input tree on a legal multi-move", () => {
    const tree: TreeNode[] = [
      folder("f1", [database("d1")]),
      database("d2"),
      database("d3"),
    ];
    const snapshot = structuredClone(tree);

    moveNodes(tree, ["d2", "d3"], { parentId: "f1", index: 1 });

    expect(tree).toEqual(snapshot);
  });
});
