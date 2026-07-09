import { describe, it, expect } from "vitest";

// Imported before the module exists so RED fails on the missing module, not a
// typo. flattenSelectable lists the selectable (folder/database) ids in visible
// DFS order (children only under expanded folders; tables are never selectable);
// rangeBetween slices the inclusive range used by shift-click.
import {
  flattenSelectable,
  rangeBetween,
} from "@/lib/workspace/tree-select";
import type {
  DatabaseNode,
  FolderNode,
  TableNode,
  TreeNode,
} from "@/lib/workspace/model";

const database = (id: string, tables: TableNode[] = []): DatabaseNode => ({
  kind: "database",
  id,
  name: id,
  engine: "postgres",
  host: "localhost",
  port: 5432,
  database: id,
  user: "u",
  password: "",
  tables,
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

const table = (id: string): TableNode => ({
  kind: "table",
  id,
  name: id,
  schema: null,
  columns: [],
  rows: [],
});

const folder = (id: string, children: TreeNode[]): FolderNode => ({
  kind: "folder",
  id,
  name: id,
  children,
});

describe("flattenSelectable", () => {
  // behavior: only folders + databases are listed, in DFS display order.
  it("should list folders and databases in display order", () => {
    const tree: TreeNode[] = [
      folder("f1", [database("d1"), database("d2")]),
      database("d3"),
    ];

    expect(flattenSelectable(tree, new Set(["f1"]))).toEqual([
      "f1",
      "d1",
      "d2",
      "d3",
    ]);
  });

  // behavior: a collapsed folder's children are not visible, so they are skipped.
  it("should skip the children of a collapsed folder", () => {
    const tree: TreeNode[] = [
      folder("f1", [database("d1"), database("d2")]),
      database("d3"),
    ];

    expect(flattenSelectable(tree, new Set())).toEqual(["f1", "d3"]);
  });

  // behavior: tables are never selectable, even under a connected database.
  it("should never list table leaves", () => {
    const tree: TreeNode[] = [
      database("d1", [table("t1"), table("t2")]),
    ];

    expect(flattenSelectable(tree, new Set(["d1"]))).toEqual(["d1"]);
  });

  // behavior: nested expanded folders contribute their selectable descendants.
  it("should descend nested expanded folders", () => {
    const tree: TreeNode[] = [
      folder("f1", [folder("f2", [database("d1")]), database("d2")]),
    ];

    expect(flattenSelectable(tree, new Set(["f1", "f2"]))).toEqual([
      "f1",
      "f2",
      "d1",
      "d2",
    ]);
  });
});

describe("rangeBetween", () => {
  const ordered = ["a", "b", "c", "d", "e"];

  // behavior: an inclusive forward range between two ids.
  it("should return the inclusive range if the anchor precedes the target", () => {
    expect(rangeBetween(ordered, "b", "d")).toEqual(["b", "c", "d"]);
  });

  // behavior: the range is direction-independent (anchor after target).
  it("should return the inclusive range if the anchor follows the target", () => {
    expect(rangeBetween(ordered, "d", "b")).toEqual(["b", "c", "d"]);
  });

  // behavior: a single id if anchor and target are the same.
  it("should return a single id if the anchor equals the target", () => {
    expect(rangeBetween(ordered, "c", "c")).toEqual(["c"]);
  });

  // behavior: only the target if the anchor is not in the visible order.
  it("should fall back to just the target if the anchor is missing", () => {
    expect(rangeBetween(ordered, "missing", "c")).toEqual(["c"]);
  });

  // behavior: only the target if the target is not in the visible order.
  it("should fall back to just the target if the target is missing", () => {
    expect(rangeBetween(ordered, "a", "missing")).toEqual(["missing"]);
  });
});
