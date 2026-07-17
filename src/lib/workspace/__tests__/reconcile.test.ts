import { describe, it, expect } from "vitest";

import {
  emptyDirsAfterRemoval,
  parentDir,
  planReconcile,
} from "@/lib/workspace/reconcile";
import type { FileMap } from "@/lib/workspace/disk-format";

describe("planReconcile write set", () => {
  // TC-008 - behavior: a new file lands in write
  it("should include a key in write if it is new in next", () => {
    const current: FileMap = {
      "dbui.workspace.json": '{"schemaVersion":1,"name":"W"}',
    };
    const next: FileMap = {
      "dbui.workspace.json": '{"schemaVersion":1,"name":"W"}',
      "app.db.json": '{"name":"App"}',
    };

    const result = planReconcile(current, next);

    expect(result.write).toEqual({ "app.db.json": '{"name":"App"}' });
  });

  // TC-008 - behavior: changed content lands in write
  it("should include a key in write if its value differs from current", () => {
    const current: FileMap = { "app.db.json": '{"name":"App"}' };
    const next: FileMap = { "app.db.json": '{"name":"App-renamed"}' };

    const result = planReconcile(current, next);

    expect(result.write).toEqual({ "app.db.json": '{"name":"App-renamed"}' });
  });

  // TC-008 - behavior: unchanged content is neither rewritten nor removed
  it("should not include a key in write if its value is identical to current", () => {
    const current: FileMap = {
      "a.db.json": '{"name":"A"}',
      "b.db.json": '{"name":"B"}',
    };
    const next: FileMap = {
      "a.db.json": '{"name":"A"}',
      "b.db.json": '{"name":"B-changed"}',
    };

    const result = planReconcile(current, next);

    expect(result.write).toEqual({ "b.db.json": '{"name":"B-changed"}' });
    expect(result.write["a.db.json"]).toBeUndefined();
    expect(result.remove).not.toContain("a.db.json");
  });
});

describe("planReconcile remove set", () => {
  // TC-008 - behavior: a managed orphan is removed
  it("should include a managed key in remove if it exists in current but not next", () => {
    const current: FileMap = {
      "gone.db.json": '{"name":"Gone"}',
      "stay.db.json": '{"name":"Stay"}',
    };
    const next: FileMap = { "stay.db.json": '{"name":"Stay"}' };

    const result = planReconcile(current, next);

    expect(result.remove).toEqual(["gone.db.json"]);
  });

  // TC-008 - behavior: folder.json and the manifest count as managed
  it("should include orphan folder.json and manifest keys in remove if managed", () => {
    const current: FileMap = {
      "dbui.workspace.json": '{"schemaVersion":1}',
      "users/folder.json": '{"name":"Users"}',
    };
    const next: FileMap = {};

    const result = planReconcile(current, next);

    expect(result.remove.sort()).toEqual(
      ["dbui.workspace.json", "users/folder.json"].sort(),
    );
  });

  // TC-008 - behavior: an unmanaged orphan is never removed
  it("should not include an unmanaged orphan in remove", () => {
    const current: FileMap = {
      "notes.txt": "scratch",
      ".git/config": "[core]",
      "gone.db.json": '{"name":"Gone"}',
    };
    const next: FileMap = {};

    const result = planReconcile(current, next);

    expect(result.remove).toEqual(["gone.db.json"]);
    expect(result.remove).not.toContain("notes.txt");
    expect(result.remove).not.toContain(".git/config");
  });

  // TC-009 - behavior: a moved folder's old managed paths are removed, the new written
  it("should include the old managed paths in remove if a folder moved", () => {
    const current: FileMap = {
      "dbui.workspace.json": '{"schemaVersion":1}',
      "src/folder.json": '{"name":"Src","order":0}',
      "src/get.db.json": '{"name":"Get","order":0}',
    };
    const next: FileMap = {
      "dbui.workspace.json": '{"schemaVersion":1}',
      "dst/src/folder.json": '{"name":"Src","order":0}',
      "dst/src/get.db.json": '{"name":"Get","order":0}',
    };

    const result = planReconcile(current, next);

    expect(result.remove.sort()).toEqual(
      ["src/folder.json", "src/get.db.json"].sort(),
    );
    expect(result.write).toEqual({
      "dst/src/folder.json": '{"name":"Src","order":0}',
      "dst/src/get.db.json": '{"name":"Get","order":0}',
    });
  });

  // TC-009 - behavior: a renamed node (slug change) removes the old file and writes the new
  it("should plan the old file removed and the new written if a node's slug changed", () => {
    const current: FileMap = {
      "dbui.workspace.json": '{"schemaVersion":1}',
      "old-name.db.json": '{"id":"db-1","name":"Old Name","order":0}',
    };
    const next: FileMap = {
      "dbui.workspace.json": '{"schemaVersion":1}',
      "new-name.db.json": '{"id":"db-1","name":"New Name","order":0}',
    };

    const result = planReconcile(current, next);

    expect(result.remove).toEqual(["old-name.db.json"]);
    expect(result.write).toEqual({
      "new-name.db.json": '{"id":"db-1","name":"New Name","order":0}',
    });
  });
});

describe("parentDir", () => {
  // behavior: the directory portion of a relative path
  it("should return the parent directory of a nested path", () => {
    expect(parentDir("a/b/c.db.json")).toBe("a/b");
  });

  // behavior: a root-level file has no parent dir
  it("should return null for a root-level path", () => {
    expect(parentDir("dbui.workspace.json")).toBeNull();
  });
});

describe("emptyDirsAfterRemoval", () => {
  // TC-009 - behavior: a dir whose only files were removed is reported, deepest-first
  it("should report a dir as empty if all its files were removed", () => {
    const next: FileMap = { "dbui.workspace.json": "{}" };
    const removed = ["src/nested/get.db.json", "src/nested/folder.json"];

    const result = emptyDirsAfterRemoval(next, removed);

    expect(result).toEqual(["src/nested", "src"]);
  });

  // TC-009 - behavior: a dir that still has a surviving file is NOT reported
  it("should not report a dir as empty if a file still lives in it", () => {
    const next: FileMap = { "src/stay.db.json": "{}" };
    const removed = ["src/gone.db.json"];

    const result = emptyDirsAfterRemoval(next, removed);

    expect(result).toEqual([]);
  });

  // TC-009 - behavior: a surviving deeper file keeps the whole ancestor chain
  it("should keep ancestor dirs alive if a surviving file is nested deeper", () => {
    const next: FileMap = { "src/sub/stay.db.json": "{}" };
    const removed = ["src/sub/gone.db.json", "src/top.db.json"];

    const result = emptyDirsAfterRemoval(next, removed);

    expect(result).toEqual([]);
  });
});
