import { describe, it, expect } from "vitest";

// Imported even though it does not exist yet: the test must fail on the missing
// module, not on a typo. Once tree-edit.ts ships, these assertions pin the pure
// tree ops (findNode / containsId / removeNode / insertNode) that moveNode is
// built on. dbui node kinds are folder / database / table.
import {
  findNode,
  containsId,
  removeNode,
  insertNode,
} from "@/lib/workspace/tree-edit";
import type {
  DatabaseNode,
  FolderNode,
  TreeNode,
} from "@/lib/workspace/model";

const database = (id: string, name = id): DatabaseNode => ({
  kind: "database",
  id,
  name,
  engine: "postgres",
  host: "localhost",
  port: 5432,
  database: name,
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
});

const folder = (id: string, children: TreeNode[], name = id): FolderNode => ({
  kind: "folder",
  id,
  name,
  children,
});

const ids = (nodes: TreeNode[]): string[] => nodes.map((node) => node.id);

const findFolder = (nodes: TreeNode[], id: string): FolderNode => {
  const found = findNode(nodes, id);
  if (!found || found.kind !== "folder") {
    throw new Error(`folder ${id} not found`);
  }
  return found;
};

describe("findNode", () => {
  // behavior: findNode reaches a deeply nested node, recursing folders.
  it("should return a nested node if found", () => {
    const tree: TreeNode[] = [
      folder("root", [folder("mid", [database("deep")])]),
    ];

    expect(findNode(tree, "deep")?.id).toBe("deep");
  });

  // behavior: findNode reaches a folder node itself.
  it("should return a folder node if its id matches", () => {
    const tree: TreeNode[] = [folder("f1", [database("c1")])];

    expect(findNode(tree, "f1")?.kind).toBe("folder");
  });

  // behavior: findNode returns null for a missing id.
  it("should return null if the id is missing", () => {
    expect(findNode([database("db1")], "missing")).toBeNull();
  });
});

describe("containsId", () => {
  // behavior: containsId is true for the node itself and its descendants.
  it("should report a node as containing its own id", () => {
    const node = folder("root", [folder("mid", [database("deep")])]);

    expect(containsId(node, "root")).toBe(true);
  });

  it("should report a node as containing a descendant id", () => {
    const node = folder("root", [folder("mid", [database("deep")])]);

    expect(containsId(node, "deep")).toBe(true);
  });

  it("should report a node as not containing an absent id", () => {
    const node = folder("root", [folder("mid", [database("deep")])]);

    expect(containsId(node, "absent")).toBe(false);
  });

  // behavior: a leaf database contains only its own id.
  it("should report a database leaf as containing only its own id", () => {
    const node = database("db1");

    expect(containsId(node, "db1")).toBe(true);
    expect(containsId(node, "other")).toBe(false);
  });
});

describe("removeNode", () => {
  // behavior: removeNode drops the matching node, recursing folders.
  it("should remove a nested node from its parent", () => {
    const tree: TreeNode[] = [folder("f1", [database("c1"), database("c2")])];

    const result = removeNode(tree, "c1");

    expect(ids(findFolder(result, "f1").children)).toEqual(["c2"]);
  });

  // behavior: removeNode drops a root node.
  it("should remove a node at root", () => {
    const tree: TreeNode[] = [database("a"), folder("f1", [])];

    const result = removeNode(tree, "a");

    expect(ids(result)).toEqual(["f1"]);
  });

  // side-effect-contract: removeNode does not mutate the input tree.
  it("should not mutate the input tree if a node is removed", () => {
    const tree: TreeNode[] = [folder("f1", [database("c1"), database("c2")])];
    const snapshot = structuredClone(tree);

    removeNode(tree, "c1");

    expect(tree).toEqual(snapshot);
  });
});

describe("insertNode", () => {
  // behavior: insertNode at root places the node at the given index.
  it("should insert a node at the given root index", () => {
    const tree: TreeNode[] = [database("a"), database("b")];

    const result = insertNode(tree, null, 1, database("x"));

    expect(ids(result)).toEqual(["a", "x", "b"]);
  });

  // behavior: insertNode into a folder places at the given child index.
  it("should insert a node into a folder at the given child index", () => {
    const tree: TreeNode[] = [folder("f1", [database("c1")])];

    const result = insertNode(tree, "f1", 1, database("x"));

    expect(ids(findFolder(result, "f1").children)).toEqual(["c1", "x"]);
  });

  // behavior: insertNode clamps an out-of-range index to the end (E-5).
  it("should clamp an out-of-range index to the end", () => {
    const tree: TreeNode[] = [database("a")];

    const result = insertNode(tree, null, 99, database("x"));

    expect(ids(result)).toEqual(["a", "x"]);
  });

  // side-effect-contract: insertNode does not mutate the input tree.
  it("should not mutate the input tree if a node is inserted", () => {
    const tree: TreeNode[] = [folder("f1", [database("c1")])];
    const snapshot = structuredClone(tree);

    insertNode(tree, "f1", 0, database("x"));

    expect(tree).toEqual(snapshot);
  });
});
