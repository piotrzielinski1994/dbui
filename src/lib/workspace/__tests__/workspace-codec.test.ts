import { describe, it, expect } from "vitest";

import {
  dehydrateDatabase,
  hydrateDatabase,
  mergeDatabaseFile,
  type PersistedDatabase,
} from "@/lib/workspace/workspace";
import type { DatabaseNode, QueryResult } from "@/lib/workspace/model";

const EMPTY_RESULT: QueryResult = {
  status: "success",
  timeMs: 0,
  rowCount: 0,
  columns: [],
  rows: [],
  message: "",
};

const validPersistedPg: PersistedDatabase = {
  kind: "database",
  id: "db-admin",
  name: "admin_db",
  engine: "postgres",
  host: "db.internal",
  port: 5433,
  database: "admin",
  user: "seed_admin",
  password: "s3cr3t-pw",
};

function pgNode(overrides: Partial<DatabaseNode> = {}): DatabaseNode {
  return {
    kind: "database",
    id: "db-admin",
    name: "admin_db",
    engine: "postgres",
    host: "db.internal",
    port: 5433,
    database: "admin",
    user: "seed_admin",
    password: "s3cr3t-pw",
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

describe("mergeDatabaseFile", () => {
  // AC-005 - behavior: a valid postgres record passes through
  it("should keep a valid network database record", () => {
    expect(mergeDatabaseFile({ ...validPersistedPg })).toEqual(validPersistedPg);
  });

  // AC-005, AC-006 - behavior: a missing id/name yields null
  it("should return null if id is missing", () => {
    const rest: Record<string, unknown> = { ...validPersistedPg };
    delete rest.id;
    expect(mergeDatabaseFile(rest)).toBeNull();
  });

  // AC-005 - behavior: an unknown engine yields null
  it("should return null if the engine is not a supported one", () => {
    expect(
      mergeDatabaseFile({ ...validPersistedPg, engine: "oracle" }),
    ).toBeNull();
  });

  // AC-005 - behavior: a non-record input yields null and does not throw
  it("should return null and not throw for a non-record input", () => {
    expect(mergeDatabaseFile("garbage")).toBeNull();
    expect(mergeDatabaseFile(null)).toBeNull();
    expect(mergeDatabaseFile(42)).toBeNull();
    expect(mergeDatabaseFile([validPersistedPg])).toBeNull();
    expect(() => mergeDatabaseFile(undefined)).not.toThrow();
  });

  // AC-005 - behavior: valid optional flags/collections are kept
  it("should keep valid accentColor, readOnly, manualCommit, defaultSchema, scripts, and variables", () => {
    const merged = mergeDatabaseFile({
      ...validPersistedPg,
      accentColor: "#DC262650",
      readOnly: true,
      manualCommit: true,
      defaultSchema: "reporting",
      savedScripts: [{ name: "recent", sql: "SELECT 1" }],
      savedJsScripts: [{ name: "nightly", code: "return 1;" }],
      variables: [{ name: "env", value: "prod" }],
    });

    expect(merged).toMatchObject({
      accentColor: "#dc262650",
      readOnly: true,
      manualCommit: true,
      defaultSchema: "reporting",
      savedScripts: [{ name: "recent", sql: "SELECT 1" }],
      savedJsScripts: [{ name: "nightly", code: "return 1;" }],
      variables: [{ name: "env", value: "prod" }],
    });
  });

  // AC-005 - behavior: garbage optional values are dropped (readOnly false omitted)
  it("should drop a false readOnly and garbage optional values", () => {
    const merged = mergeDatabaseFile({
      ...validPersistedPg,
      readOnly: false,
      accentColor: "red",
      defaultSchema: "",
      savedScripts: "nope",
    });

    expect(merged).not.toBeNull();
    expect(merged).not.toHaveProperty("readOnly");
    expect(merged).not.toHaveProperty("accentColor");
    expect(merged).not.toHaveProperty("defaultSchema");
    expect(merged).not.toHaveProperty("savedScripts");
  });

  // AC-005 - behavior: a sqlite record keeps its file, drops network fields
  it("should keep a valid sqlite record with its file path", () => {
    const merged = mergeDatabaseFile({
      kind: "database",
      id: "db-local",
      name: "local",
      engine: "sqlite",
      file: "/data/app.sqlite",
    });

    expect(merged).toEqual({
      kind: "database",
      id: "db-local",
      name: "local",
      engine: "sqlite",
      file: "/data/app.sqlite",
    });
  });
});

describe("hydrateDatabase", () => {
  // AC-005, AC-012 - behavior: runtime fields default empty, flags default off
  it("should build a runtime node with empty tables/views/sql/result and default flags", () => {
    const node = hydrateDatabase(validPersistedPg);

    expect(node).toEqual(pgNode());
  });

  // AC-005 - behavior: optional persisted fields carry through to the node
  it("should carry the persisted optional fields onto the node", () => {
    const node = hydrateDatabase({
      ...validPersistedPg,
      accentColor: "#dc262650",
      readOnly: true,
      manualCommit: true,
      defaultSchema: "reporting",
      savedScripts: [{ name: "recent", sql: "SELECT 1" }],
      variables: [{ name: "env", value: "prod" }],
    });

    expect(node.accentColor).toBe("#dc262650");
    expect(node.readOnly).toBe(true);
    expect(node.manualCommit).toBe(true);
    expect(node.defaultSchema).toBe("reporting");
    expect(node.savedScripts).toEqual([{ name: "recent", sql: "SELECT 1" }]);
    expect(node.variables).toEqual([{ name: "env", value: "prod" }]);
  });
});

describe("dehydrateDatabase", () => {
  // AC-005, AC-012 - behavior: a default node omits its default flags and runtime fields
  it("should emit only the required fields for a default node", () => {
    expect(dehydrateDatabase(pgNode())).toEqual(validPersistedPg);
  });

  // AC-005 - behavior: non-default flags/collections are emitted
  it("should emit non-default flags and non-empty collections", () => {
    const persisted = dehydrateDatabase(
      pgNode({
        accentColor: "#dc262650",
        readOnly: true,
        manualCommit: true,
        defaultSchema: "reporting",
        savedScripts: [{ name: "recent", sql: "SELECT 1" }],
        savedJsScripts: [{ name: "nightly", code: "return 1;" }],
        variables: [{ name: "env", value: "prod" }],
      }),
    );

    expect(persisted).toMatchObject({
      accentColor: "#dc262650",
      readOnly: true,
      manualCommit: true,
      defaultSchema: "reporting",
      savedScripts: [{ name: "recent", sql: "SELECT 1" }],
      savedJsScripts: [{ name: "nightly", code: "return 1;" }],
      variables: [{ name: "env", value: "prod" }],
    });
  });

  // AC-012 - behavior: runtime fields never appear in the persisted shape
  it("should never emit the runtime fields", () => {
    const persisted = dehydrateDatabase(
      pgNode({
        sql: "SELECT 1",
        result: { ...EMPTY_RESULT, rowCount: 3, message: "SELECT 3" },
      }),
    );

    expect(persisted).not.toHaveProperty("tables");
    expect(persisted).not.toHaveProperty("views");
    expect(persisted).not.toHaveProperty("sql");
    expect(persisted).not.toHaveProperty("result");
  });
});
