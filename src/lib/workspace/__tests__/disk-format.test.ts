import { describe, it, expect } from "vitest";

import {
  MANIFEST,
  serialize,
  deserialize,
} from "@/lib/workspace/disk-format";
import type { FileMap } from "@/lib/workspace/disk-format";
import type {
  DatabaseNode,
  FolderNode,
  QueryResult,
  TreeNode,
} from "@/lib/workspace/model";

const EMPTY_RESULT: QueryResult = {
  status: "success",
  timeMs: 0,
  rowCount: 0,
  columns: [],
  rows: [],
  message: "",
};

// A full postgres DatabaseNode literal (every runtime + persisted field present),
// so the round-trip proves the persisted fields survive and the runtime ones reset.
function pgDatabase(overrides: Partial<DatabaseNode> = {}): DatabaseNode {
  return {
    kind: "database",
    id: "db-app",
    name: "app_db",
    engine: "postgres",
    host: "localhost",
    port: 5432,
    database: "app",
    user: "app_user",
    password: "app-secret",
    accentColor: null,
    readOnly: false,
    manualCommit: false,
    defaultSchema: null,
    tables: [],
    views: [],
    sql: "",
    savedScripts: [],
    savedJsScripts: [],
    variables: [],
    result: { ...EMPTY_RESULT },
    ...overrides,
  } as DatabaseNode;
}

function folder(
  id: string,
  name: string,
  children: TreeNode[],
): FolderNode {
  return { kind: "folder", id, name, children };
}

// Resets the runtime-only fields to their empty defaults so a populated input tree
// can be compared against a freshly deserialized (runtime-empty) tree.
function normalizeRuntime(nodes: TreeNode[]): TreeNode[] {
  return nodes.map((node) => {
    if (node.kind === "folder") {
      return { ...node, children: normalizeRuntime(node.children) };
    }
    if (node.kind === "table") {
      return node;
    }
    return {
      ...node,
      tables: [],
      views: [],
      sql: "",
      result: { ...EMPTY_RESULT },
    };
  });
}

const expectOk = (result: ReturnType<typeof deserialize>) => {
  if (!result.ok) {
    throw new Error(`expected ok result, got error: ${result.error}`);
  }
  return result;
};

describe("disk-format serialize", () => {
  // TC-002 - behavior: a manifest with schemaVersion 1 + the workspace name
  it("should emit a dbui.workspace.json manifest with schemaVersion 1 and the name", () => {
    const map = serialize([], "My Workspace");

    const raw = map[MANIFEST];
    expect(raw).toBeDefined();
    expect(JSON.parse(raw)).toMatchObject({
      schemaVersion: 1,
      name: "My Workspace",
    });
  });

  // TC-002 - behavior: a one-database tree emits the manifest + a <slug>.db.json
  it("should emit a slugged db.json for a root database carrying id/name/engine/order", () => {
    const tree: TreeNode[] = [pgDatabase({ name: "App DB" })];

    const map = serialize(tree);

    const dbEntry = Object.entries(map).find(([path]) =>
      path.endsWith(".db.json"),
    );
    expect(dbEntry).toBeDefined();
    const [dbPath, dbRaw] = dbEntry!;
    expect(dbPath).toBe("app-db.db.json");
    const parsed = JSON.parse(dbRaw) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      id: "db-app",
      name: "App DB",
      engine: "postgres",
      host: "localhost",
      port: 5432,
      database: "app",
      user: "app_user",
      password: "app-secret",
      order: 0,
    });
  });

  // TC-002 - behavior: inline scripts + variables are persisted in the db.json
  it("should inline savedScripts, savedJsScripts, and variables in the db.json", () => {
    const tree: TreeNode[] = [
      pgDatabase({
        savedScripts: [{ name: "recent", sql: "SELECT 1" }],
        savedJsScripts: [{ name: "nightly", code: "return 1;" }],
        variables: [{ name: "env", value: "prod" }],
      }),
    ];

    const map = serialize(tree);
    const parsed = JSON.parse(map["app-db.db.json"]) as Record<string, unknown>;

    expect(parsed.savedScripts).toEqual([{ name: "recent", sql: "SELECT 1" }]);
    expect(parsed.savedJsScripts).toEqual([
      { name: "nightly", code: "return 1;" },
    ]);
    expect(parsed.variables).toEqual([{ name: "env", value: "prod" }]);
  });

  // TC-002, AC-012 - behavior: runtime fields are never written to disk
  it("should never write the runtime fields (tables/views/sql/result) to the db.json", () => {
    const tree: TreeNode[] = [
      pgDatabase({
        sql: "SELECT * FROM users",
        result: { ...EMPTY_RESULT, rowCount: 3, message: "SELECT 3" },
      }),
    ];

    const map = serialize(tree);
    const parsed = JSON.parse(map["app-db.db.json"]) as Record<string, unknown>;

    expect(parsed).not.toHaveProperty("tables");
    expect(parsed).not.toHaveProperty("views");
    expect(parsed).not.toHaveProperty("sql");
    expect(parsed).not.toHaveProperty("result");
  });

  // TC-003 - behavior: a folder nests its folder.json + child db.json under its dir
  it("should emit a folder.json and a nested db.json for a folder with a child database", () => {
    const tree: TreeNode[] = [
      folder("folder-prod", "Prod", [pgDatabase({ name: "app_db" })]),
    ];

    const map = serialize(tree);

    expect(map["prod/folder.json"]).toBeDefined();
    const folderJson = JSON.parse(map["prod/folder.json"]) as Record<
      string,
      unknown
    >;
    expect(folderJson).toMatchObject({
      id: "folder-prod",
      name: "Prod",
      order: 0,
    });
    expect(map["prod/app-db.db.json"]).toBeDefined();
  });

  // TC-003 - behavior: a deeper folder nests further
  it("should nest a folder within a folder", () => {
    const tree: TreeNode[] = [
      folder("folder-prod", "prod", [
        folder("folder-team", "team", [pgDatabase({ name: "app_db" })]),
      ]),
    ];

    const map = serialize(tree);

    expect(map["prod/folder.json"]).toBeDefined();
    expect(map["prod/team/folder.json"]).toBeDefined();
    expect(map["prod/team/app-db.db.json"]).toBeDefined();
  });

  // TC-003 - behavior: order reflects sibling index
  it("should record each sibling's order as its index", () => {
    const tree: TreeNode[] = [
      pgDatabase({ id: "db-a", name: "A" }),
      pgDatabase({ id: "db-b", name: "B" }),
      pgDatabase({ id: "db-c", name: "C" }),
    ];

    const map = serialize(tree);

    expect(
      (JSON.parse(map["a.db.json"]) as { order: number }).order,
    ).toBe(0);
    expect(
      (JSON.parse(map["b.db.json"]) as { order: number }).order,
    ).toBe(1);
    expect(
      (JSON.parse(map["c.db.json"]) as { order: number }).order,
    ).toBe(2);
  });

  // AC-008 - behavior: same-named siblings get distinct slugged paths
  it("should produce distinct file paths if two siblings slug to the same string", () => {
    const tree: TreeNode[] = [
      pgDatabase({ id: "db-1", name: "App DB" }),
      pgDatabase({ id: "db-2", name: "app db" }),
    ];

    const map = serialize(tree);

    const dbPaths = Object.keys(map).filter((path) =>
      path.endsWith(".db.json"),
    );
    expect(dbPaths).toHaveLength(2);
    expect(new Set(dbPaths).size).toBe(2);
  });

  // AC-008 - behavior: two same-slug siblings both survive a round-trip, kept distinct by in-file id
  it("should keep two same-named siblings distinct by id through a round-trip", () => {
    const tree: TreeNode[] = [
      pgDatabase({ id: "db-1", name: "App DB" }),
      pgDatabase({ id: "db-2", name: "app db" }),
    ];

    const result = expectOk(deserialize(serialize(tree)));

    expect(result.tree.map((node) => node.id).sort()).toEqual([
      "db-1",
      "db-2",
    ]);
  });
});

describe("disk-format round-trip", () => {
  // TC-004 - behavior: deserialize(serialize(tree)) reproduces the tree
  it("should reproduce a nested tree (ids/names/nesting/order/db fields) through a round-trip", () => {
    const tree: TreeNode[] = [
      folder("folder-prod", "prod", [
        folder("folder-team", "team", [
          pgDatabase({
            id: "db-app",
            name: "app_db",
            accentColor: "#dc262650",
            readOnly: true,
            manualCommit: true,
            defaultSchema: "reporting",
            savedScripts: [{ name: "recent", sql: "SELECT 1" }],
            variables: [{ name: "env", value: "prod" }],
          }),
        ]),
      ]),
      pgDatabase({ id: "db-scratch", name: "scratch_db" }),
    ];

    const result = expectOk(deserialize(serialize(tree)));

    expect(result.tree).toEqual(normalizeRuntime(tree));
    expect(result.skipped).toEqual([]);
  });

  // TC-004, AC-012 - behavior: runtime fields default empty after a round-trip
  it("should default the runtime fields empty on a deserialized database", () => {
    const tree: TreeNode[] = [
      pgDatabase({
        sql: "SELECT 1",
        result: { ...EMPTY_RESULT, rowCount: 9, message: "SELECT 9" },
      }),
    ];

    const result = expectOk(deserialize(serialize(tree)));
    const db = result.tree[0] as DatabaseNode;

    expect(db.tables).toEqual([]);
    expect(db.views).toEqual([]);
    expect(db.sql).toBe("");
    expect(db.result).toEqual(EMPTY_RESULT);
  });

  // TC-004 - behavior: sibling order survives the round-trip
  it("should preserve sibling order across a round-trip", () => {
    const tree: TreeNode[] = [
      pgDatabase({ id: "db-a", name: "Alpha" }),
      pgDatabase({ id: "db-b", name: "Bravo" }),
      pgDatabase({ id: "db-c", name: "Charlie" }),
    ];

    const result = expectOk(deserialize(serialize(tree)));

    expect(result.tree.map((node) => node.name)).toEqual([
      "Alpha",
      "Bravo",
      "Charlie",
    ]);
  });

  // TC-004 - behavior: a sqlite database round-trips its file path (no network fields)
  it("should round-trip a sqlite database's file path", () => {
    const tree: TreeNode[] = [
      pgDatabase({
        id: "db-local",
        name: "local",
        engine: "sqlite",
        file: "/data/app.sqlite",
      } as unknown as Partial<DatabaseNode>),
    ];

    const result = expectOk(deserialize(serialize(tree)));
    const db = result.tree[0] as DatabaseNode;

    expect(db.engine).toBe("sqlite");
    expect(db.engine === "sqlite" ? db.file : null).toBe("/data/app.sqlite");
  });
});

describe("disk-format id read-back", () => {
  // TC-005, AC-006 - behavior: an in-file id deserializes to that exact id
  it("should read the in-file id back for a db.json that carries one", () => {
    const files: FileMap = {
      [MANIFEST]: JSON.stringify({ schemaVersion: 1, name: "W" }),
      "app.db.json": JSON.stringify({
        id: "db-stable-uuid",
        name: "App",
        engine: "postgres",
        host: "h",
        port: 5432,
        database: "d",
        user: "u",
        password: "p",
        order: 0,
      }),
    };

    const result = expectOk(deserialize(files));

    expect(result.tree[0]?.id).toBe("db-stable-uuid");
  });

  // TC-005, AC-006 - behavior: a folder.json in-file id is read back
  it("should read the in-file id back for a folder.json that carries one", () => {
    const files: FileMap = {
      [MANIFEST]: JSON.stringify({ schemaVersion: 1, name: "W" }),
      "prod/folder.json": JSON.stringify({
        id: "folder-stable-uuid",
        name: "Prod",
        order: 0,
      }),
    };

    const result = expectOk(deserialize(files));

    expect(result.tree[0]?.id).toBe("folder-stable-uuid");
  });

  // TC-005, AC-006 - behavior: a db.json WITHOUT an id falls back to a path-derived id
  it("should fall back to a non-empty deterministic id for a db.json lacking an id", () => {
    const files: FileMap = {
      [MANIFEST]: JSON.stringify({ schemaVersion: 1, name: "W" }),
      "app.db.json": JSON.stringify({
        name: "App",
        engine: "postgres",
        host: "h",
        port: 5432,
        database: "d",
        user: "u",
        password: "p",
        order: 0,
      }),
    };

    const first = expectOk(deserialize(files));
    const second = expectOk(deserialize(files));

    const id = first.tree[0]?.id;
    expect(typeof id).toBe("string");
    expect(id).not.toBe("");
    // deterministic (path-derived): re-loading the same map yields the same id.
    expect(second.tree[0]?.id).toBe(id);
  });
});

describe("disk-format malformed skip", () => {
  // TC-006, AC-009 - behavior: a malformed db.json is skipped, siblings still load
  it("should skip an invalid-JSON db.json and still load valid siblings", () => {
    const files: FileMap = {
      [MANIFEST]: JSON.stringify({ schemaVersion: 1, name: "Partial" }),
      "good.db.json": JSON.stringify({
        id: "db-good",
        name: "Good",
        engine: "postgres",
        host: "h",
        port: 5432,
        database: "d",
        user: "u",
        password: "p",
        order: 0,
      }),
      "broken.db.json": "{ this is not valid json",
    };

    const result = expectOk(deserialize(files));

    expect(result.skipped).toContain("broken.db.json");
    const names = result.tree.map((node) => node.name);
    expect(names).toContain("Good");
  });

  // TC-006, AC-009 - behavior: a db.json failing validation (missing required fields) is skipped
  it("should skip a db.json that fails validation and report it in skipped", () => {
    const files: FileMap = {
      [MANIFEST]: JSON.stringify({ schemaVersion: 1, name: "Partial" }),
      "bad.db.json": JSON.stringify({ id: "db-bad", name: "Bad" }),
      "ok.db.json": JSON.stringify({
        id: "db-ok",
        name: "Ok",
        engine: "postgres",
        host: "h",
        port: 5432,
        database: "d",
        user: "u",
        password: "p",
        order: 0,
      }),
    };

    const result = expectOk(deserialize(files));

    expect(result.skipped).toContain("bad.db.json");
    expect(result.tree.map((node) => node.name)).toContain("Ok");
  });

  // TC-006, AC-009 - behavior: a malformed folder.json is skipped, siblings still load
  it("should skip a malformed folder.json and still load sibling nodes", () => {
    const files: FileMap = {
      [MANIFEST]: JSON.stringify({ schemaVersion: 1, name: "Partial" }),
      "broken/folder.json": "not json at all",
      "ok.db.json": JSON.stringify({
        id: "db-ok",
        name: "Ok",
        engine: "postgres",
        host: "h",
        port: 5432,
        database: "d",
        user: "u",
        password: "p",
        order: 0,
      }),
    };

    const result = expectOk(deserialize(files));

    expect(result.skipped).toContain("broken/folder.json");
    expect(result.tree.map((node) => node.name)).toContain("Ok");
  });
});

describe("disk-format missing manifest", () => {
  // TC-007, AC-009 - behavior: a FileMap with no manifest is an error result
  it("should return an error result if the manifest is absent", () => {
    const files: FileMap = {
      "app.db.json": JSON.stringify({
        id: "db-app",
        name: "App",
        engine: "postgres",
        host: "h",
        port: 5432,
        database: "d",
        user: "u",
        password: "p",
        order: 0,
      }),
    };

    const result = deserialize(files);

    expect(result.ok).toBe(false);
  });

  // TC-007, AC-009 - behavior: an empty file map does not throw and is not ok
  it("should not throw and be not-ok for an empty file map", () => {
    expect(() => deserialize({})).not.toThrow();
    expect(deserialize({}).ok).toBe(false);
  });

  // AC-009 - behavior: a manifest-only workspace loads an empty tree
  it("should load an empty tree if only the manifest is present", () => {
    const files: FileMap = {
      [MANIFEST]: JSON.stringify({ schemaVersion: 1, name: "Empty" }),
    };

    const result = expectOk(deserialize(files));

    expect(result.tree).toEqual([]);
    expect(result.skipped).toEqual([]);
  });
});
