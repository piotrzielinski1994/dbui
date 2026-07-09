import { describe, it, expect } from "vitest";

// Imported even though it does not exist yet: the test must fail on the missing
// module, not on a typo. Once tree-locate.ts ships, these assertions pin the
// pointer-relative drop projection and the over -> MoveTarget resolution that
// drives the tree DnD. dbui node kinds are folder / database / table; only a
// folder is a container (inside band), a database/table is a leaf (no inside).
import {
  locateNode,
  findNode,
  dropTarget,
  projectDropPosition,
  emptyZoneId,
  parseEmptyZoneId,
} from "@/lib/workspace/tree-locate";
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

const tree: TreeNode[] = [
  folder("f1", [database("c1"), database("c2")]),
  database("r1"),
];

describe("locateNode", () => {
  // behavior: a root node returns parentId null and its root index.
  it("should return root parent null and the index if the node is at root", () => {
    expect(locateNode(tree, "r1")).toEqual({ parentId: null, index: 1 });
  });

  // behavior: a nested node returns its folder id and child index.
  it("should return the folder id and child index if the node is nested", () => {
    expect(locateNode(tree, "c2")).toEqual({ parentId: "f1", index: 1 });
  });

  // behavior: a missing node returns null.
  it("should return null if the node is not in the tree", () => {
    expect(locateNode(tree, "missing")).toBeNull();
  });
});

describe("findNode", () => {
  // behavior: findNode reaches a nested node by id.
  it("should find a nested node by id", () => {
    expect(findNode(tree, "c1")?.id).toBe("c1");
  });

  // behavior: findNode returns null for an unknown id.
  it("should return null for an unknown id", () => {
    expect(findNode(tree, "nope")).toBeNull();
  });
});

describe("dropTarget inside (AC-001, AC-002, AC-006)", () => {
  // behavior: inside a folder appends to its children.
  it("should target the end of a folder's children if position is inside", () => {
    expect(dropTarget(tree, "r1", "f1", "inside")).toEqual({
      parentId: "f1",
      index: 2,
    });
  });

  // AC-006 - behavior: inside a database is illegal (a database is not a container).
  it("should return null if position is inside a database", () => {
    expect(dropTarget(tree, "f1", "r1", "inside")).toBeNull();
  });

  // AC-007 - behavior: inside a table is illegal.
  it("should return null if position is inside a table", () => {
    const withTable: TreeNode[] = [
      folder("f1", [table("tbl1")]),
      database("r1"),
    ];
    expect(dropTarget(withTable, "r1", "tbl1", "inside")).toBeNull();
  });
});

describe("dropTarget before/after across parents (AC-004)", () => {
  // behavior: before a node (dragged from another parent) targets its index.
  it("should target the node's index if position is before from another parent", () => {
    expect(dropTarget(tree, "r1", "c2", "before")).toEqual({
      parentId: "f1",
      index: 1,
    });
  });

  // behavior: after a node (dragged from another parent) targets index + 1.
  it("should target index plus one if position is after from another parent", () => {
    expect(dropTarget(tree, "r1", "c1", "after")).toEqual({
      parentId: "f1",
      index: 1,
    });
  });

  // behavior: an unknown over node returns null.
  it("should return null if the over node is unknown", () => {
    expect(dropTarget(tree, "r1", "ghost", "before")).toBeNull();
  });
});

describe("dropTarget same-parent index compensation (E-4)", () => {
  // E-4 - behavior: same-parent down-drag compensates for the post-removal shift.
  it("should drop one slot lower if dragging a node down past a later sibling", () => {
    // Drag c1 (index 0) to AFTER c2 (index 1) within f1. Pre-removal "after c2"
    // = index 2, but after removing c1 the siblings are [c2], so the post-
    // removal index must be 1 to land c1 at the end: [c2, c1].
    expect(dropTarget(tree, "c1", "c2", "after")).toEqual({
      parentId: "f1",
      index: 1,
    });
  });

  // E-4 - behavior: same-parent up-drag keeps the raw index (no shift).
  it("should keep the raw index if dragging a node up before an earlier sibling", () => {
    expect(dropTarget(tree, "c2", "c1", "before")).toEqual({
      parentId: "f1",
      index: 0,
    });
  });
});

describe("empty-zone id (AC-011)", () => {
  // behavior: a folder id round-trips through the empty-zone id encoding.
  it("should round-trip a folder id through emptyZoneId/parseEmptyZoneId", () => {
    const id = emptyZoneId("folder-x");
    expect(id).not.toBe("folder-x");
    expect(parseEmptyZoneId(id)).toBe("folder-x");
  });

  // behavior: a plain node id is not an empty-zone id.
  it("should return null if the id is not an empty-zone id", () => {
    expect(parseEmptyZoneId("folder-x")).toBeNull();
  });
});

describe("dropTarget empty-zone (AC-011, TC-008)", () => {
  const emptyTree: TreeNode[] = [folder("empty", []), database("r1")];

  // behavior: dropping on an empty folder's zone targets inside that folder.
  it("should target inside the folder if the over id is its empty-zone id", () => {
    expect(
      dropTarget(emptyTree, "r1", emptyZoneId("empty"), "inside"),
    ).toEqual({ parentId: "empty", index: 0 });
  });

  // behavior: an empty-zone id for a database / missing id is rejected.
  it("should return null if the empty-zone id maps to a database", () => {
    expect(
      dropTarget(emptyTree, "empty", emptyZoneId("r1"), "inside"),
    ).toBeNull();
  });

  it("should return null if the empty-zone id maps to a missing node", () => {
    expect(
      dropTarget(emptyTree, "r1", emptyZoneId("ghost"), "inside"),
    ).toBeNull();
  });
});

describe("projectDropPosition (AC-009, AC-010)", () => {
  const overFolder = (pointerY: number) =>
    projectDropPosition({
      pointerY,
      rectTop: 100,
      rectHeight: 20,
      isOverFolder: true,
    });
  const overDatabase = (pointerY: number) =>
    projectDropPosition({
      pointerY,
      rectTop: 100,
      rectHeight: 20,
      isOverFolder: false,
    });

  // behavior: a collapsed folder's middle 50% reparents (drop inside).
  it("should drop inside if the pointer is in a collapsed folder's middle band", () => {
    expect(overFolder(110)).toBe("inside"); // dead center
    expect(overFolder(106)).toBe("inside"); // ~30% down
    expect(overFolder(114)).toBe("inside"); // ~70% down
  });

  // behavior: top/bottom quarters of a collapsed folder reorder around it.
  it("should reorder around a collapsed folder if the pointer is near its top or bottom edge", () => {
    expect(overFolder(102)).toBe("before"); // top 10%
    expect(overFolder(118)).toBe("after"); // bottom 10%
  });

  // behavior: an empty/collapsed folder still gets the full inside band.
  it("should drop inside an empty folder if the pointer is in its middle", () => {
    expect(overFolder(111)).toBe("inside");
  });

  // AC-006 - behavior: a database row never accepts inside - just 50/50 before/after.
  it("should split a database row before/after at its midpoint", () => {
    expect(overDatabase(104)).toBe("before");
    expect(overDatabase(116)).toBe("after");
    expect(overDatabase(111)).toBe("after");
  });

  // behavior: a database row never yields inside anywhere along its height.
  it("should never project inside for a database row", () => {
    expect(overDatabase(100)).not.toBe("inside");
    expect(overDatabase(110)).not.toBe("inside");
    expect(overDatabase(120)).not.toBe("inside");
  });

  // behavior: a zero-height rect degrades gracefully.
  it("should fall back to before if the row has no height", () => {
    expect(
      projectDropPosition({
        pointerY: 50,
        rectTop: 50,
        rectHeight: 0,
        isOverFolder: true,
      }),
    ).toBe("before");
  });

  const overExpandedFolder = (pointerY: number) =>
    projectDropPosition({
      pointerY,
      rectTop: 100,
      rectHeight: 20,
      isOverFolder: true,
      isExpandedFolder: true,
    });

  // behavior: an EXPANDED folder reparents across almost its whole row.
  it("should drop inside an expanded folder across most of its row", () => {
    expect(overExpandedFolder(110)).toBe("inside"); // center
    expect(overExpandedFolder(118)).toBe("inside"); // bottom 10%
    expect(overExpandedFolder(108)).toBe("inside"); // ~40% down
  });

  // behavior: only a thin top strip of an expanded folder reorders above it.
  it("should reorder above an expanded folder only near its top edge", () => {
    expect(overExpandedFolder(102)).toBe("before"); // top 10%
    expect(overExpandedFolder(116)).not.toBe("after"); // bottom is inside now
  });
});
