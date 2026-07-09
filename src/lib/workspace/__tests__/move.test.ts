import { describe, it, expect } from "vitest";

// Imported even though it does not exist yet: the test must fail on the missing
// module, not on a typo. Once move.ts ships, these assertions pin the immutable
// tree move (AC-001..AC-006, AC-012; edge cases E-1..E-6). dbui node kinds are
// folder / database / table; only folder is a container, a database is NOT.
import { moveNode } from "@/lib/workspace/move";
import type {
  DatabaseNode,
  FolderNode,
  TableNode,
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

const table = (id: string, name = id): TableNode => ({
  kind: "table",
  id,
  name,
  schema: null,
  columns: [],
  rows: [],
});

const folder = (id: string, children: TreeNode[], name = id): FolderNode => ({
  kind: "folder",
  id,
  name,
  children,
});

const ids = (nodes: TreeNode[]): string[] => nodes.map((node) => node.id);

const findFolder = (nodes: TreeNode[], id: string): FolderNode => {
  const found = nodes.find(
    (node): node is FolderNode => node.kind === "folder" && node.id === id,
  );
  if (!found) {
    throw new Error(`folder ${id} not found at this level`);
  }
  return found;
};

describe("moveNode reparenting (AC-001, AC-002)", () => {
  // AC-001, TC-001 - behavior: a database moves into a folder at the given index.
  it("should move a database into a folder at the given index if reparented", () => {
    const tree: TreeNode[] = [
      database("scratch_db"),
      folder("staging", [database("c1"), database("c2")]),
    ];

    const result = moveNode(tree, "scratch_db", {
      parentId: "staging",
      index: 1,
    });

    expect(ids(result)).toEqual(["staging"]);
    const staging = findFolder(result, "staging");
    expect(ids(staging.children)).toEqual(["c1", "scratch_db", "c2"]);
  });

  // AC-002, TC-002 - behavior: a folder moves with its whole subtree intact.
  it("should move a folder with its whole subtree intact if reparented into another folder", () => {
    const subtree = folder("staging", [
      database("admin_db"),
      folder("nested", [database("deep_db")]),
    ]);
    const tree: TreeNode[] = [subtree, folder("prod", [database("d1")])];

    const result = moveNode(tree, "staging", { parentId: "prod", index: 0 });

    expect(ids(result)).toEqual(["prod"]);
    const prod = findFolder(result, "prod");
    expect(ids(prod.children)).toEqual(["staging", "d1"]);
    const moved = prod.children[0] as FolderNode;
    expect(moved.kind).toBe("folder");
    expect(ids(moved.children)).toEqual(["admin_db", "nested"]);
    const nested = moved.children[1] as FolderNode;
    expect(ids(nested.children)).toEqual(["deep_db"]);
  });

  // AC-001 - behavior: the node is removed from its old parent.
  it("should remove the node from its old parent if reparented", () => {
    const tree: TreeNode[] = [
      folder("from", [database("x"), database("y")]),
      folder("to", []),
    ];

    const result = moveNode(tree, "x", { parentId: "to", index: 0 });

    expect(ids(findFolder(result, "from").children)).toEqual(["y"]);
    expect(ids(findFolder(result, "to").children)).toEqual(["x"]);
  });

  // AC-004, TC-004 - behavior: reparent + position in one drop.
  it("should land at the target index in the target's parent if reparented across parents", () => {
    const tree: TreeNode[] = [
      folder("prod", [folder("team", [database("app_db")])]),
      folder("staging", [database("admin_db")]),
    ];

    // app_db moves to after admin_db inside staging -> staging = [admin_db, app_db].
    const result = moveNode(tree, "app_db", { parentId: "staging", index: 1 });

    const team = findFolder(findFolder(result, "prod").children, "team");
    expect(ids(team.children)).toEqual([]);
    expect(ids(findFolder(result, "staging").children)).toEqual([
      "admin_db",
      "app_db",
    ]);
  });
});

describe("moveNode reordering siblings (AC-003)", () => {
  // AC-003, TC-003 - behavior: a node moved to index 0 of its parent goes first.
  it("should put the third child first if moved to index 0 within root", () => {
    const tree: TreeNode[] = [
      folder("prod", []),
      folder("staging", []),
      database("scratch_db"),
    ];

    const result = moveNode(tree, "scratch_db", { parentId: null, index: 0 });

    expect(ids(result)).toEqual(["scratch_db", "prod", "staging"]);
  });

  // AC-003, E-4 - behavior: the index is evaluated AFTER removal of the dragged node.
  it("should evaluate the index after removal of the dragged node if moved within the same parent", () => {
    const tree: TreeNode[] = [database("a"), database("b"), database("c")];

    // After removing "a", siblings are [b, c]; index 1 places "a" between them.
    const result = moveNode(tree, "a", { parentId: null, index: 1 });

    expect(ids(result)).toEqual(["b", "a", "c"]);
  });

  // AC-003 - behavior: sibling reorder inside a folder.
  it("should reorder siblings inside a folder", () => {
    const tree: TreeNode[] = [
      folder("f1", [database("c1"), database("c2"), database("c3")]),
    ];

    const result = moveNode(tree, "c3", { parentId: "f1", index: 0 });

    expect(ids(findFolder(result, "f1").children)).toEqual([
      "c3",
      "c1",
      "c2",
    ]);
  });

  // AC-003, E-5 - behavior: clamp an out-of-range index to the end.
  it("should clamp an out-of-range index to the end of the target siblings", () => {
    const tree: TreeNode[] = [database("a"), database("b"), database("c")];

    const result = moveNode(tree, "a", { parentId: null, index: 99 });

    expect(ids(result)).toEqual(["b", "c", "a"]);
  });
});

describe("moveNode illegal moves (AC-005, AC-006)", () => {
  // AC-005, E-2, TC-005 - behavior: a folder dropped into itself is rejected.
  it("should return the original tree unchanged if a folder is dropped into itself", () => {
    const tree: TreeNode[] = [
      folder("f1", [database("c1")]),
      database("r1"),
    ];

    const result = moveNode(tree, "f1", { parentId: "f1", index: 0 });

    expect(result).toEqual(tree);
  });

  // AC-005, E-1, TC-005 - behavior: a folder dropped into its descendant is rejected.
  it("should return the original tree unchanged if a folder is dropped into its own descendant", () => {
    const tree: TreeNode[] = [
      folder("parent", [folder("child", [folder("grandchild", [])])]),
    ];

    const result = moveNode(tree, "parent", {
      parentId: "grandchild",
      index: 0,
    });

    expect(result).toEqual(tree);
  });

  // AC-006, E-3, TC-006 - behavior: a database is NOT a container; dropping into one is rejected.
  it("should return the original tree unchanged if the target parentId points at a database", () => {
    const tree: TreeNode[] = [database("scratch_db"), folder("staging", [])];

    const result = moveNode(tree, "staging", {
      parentId: "scratch_db",
      index: 0,
    });

    expect(result).toEqual(tree);
  });

  // AC-006 - behavior: reparenting a database into another database is rejected.
  it("should return the original tree unchanged if a database is dropped into a database", () => {
    const tree: TreeNode[] = [database("a"), database("b")];

    const result = moveNode(tree, "a", { parentId: "b", index: 0 });

    expect(result).toEqual(tree);
  });

  // AC-007 - behavior: a table is never a container; dropping into one is rejected.
  it("should return the original tree unchanged if the target parentId points at a table", () => {
    const tree: TreeNode[] = [
      database("db1"),
      folder("staging", [table("tbl1")]),
    ];

    const result = moveNode(tree, "db1", { parentId: "tbl1", index: 0 });

    expect(result).toEqual(tree);
  });

  // behavior: an unknown dragId leaves the tree unchanged.
  it("should return the original tree unchanged if the dragId is unknown", () => {
    const tree: TreeNode[] = [database("a"), folder("f1", [database("c1")])];

    const result = moveNode(tree, "does-not-exist", {
      parentId: "f1",
      index: 0,
    });

    expect(result).toEqual(tree);
  });
});

describe("moveNode no-op (AC-012, E-6)", () => {
  // AC-012, E-6, TC-009 - behavior: dropping a node where it already sits is a no-op.
  it("should return a value-equal tree if a root node is dropped at its own location", () => {
    const tree: TreeNode[] = [
      database("a"),
      database("b"),
      database("c"),
    ];

    // dropTarget compensates the same-parent shift, so "stay put" arrives as
    // index 1 for the node already at index 1.
    const result = moveNode(tree, "b", { parentId: null, index: 1 });

    expect(ids(result)).toEqual(["a", "b", "c"]);
    expect(result).toEqual(tree);
  });
});

describe("moveNode purity", () => {
  // side-effect-contract: the input tree is not mutated on a legal reparent.
  it("should not mutate the input tree if a legal move is performed", () => {
    const tree: TreeNode[] = [
      folder("f1", [database("c1"), database("c2")]),
      database("r1"),
    ];
    const snapshot = structuredClone(tree);

    moveNode(tree, "r1", { parentId: "f1", index: 0 });

    expect(tree).toEqual(snapshot);
  });

  // side-effect-contract: a reparented folder subtree's objects are not mutated.
  it("should not mutate the input tree if a folder subtree is reparented", () => {
    const tree: TreeNode[] = [
      folder("src", [
        database("inner"),
        folder("nested", [database("deep")]),
      ]),
      folder("dst", []),
    ];
    const snapshot = structuredClone(tree);

    moveNode(tree, "src", { parentId: "dst", index: 0 });

    expect(tree).toEqual(snapshot);
  });
});
