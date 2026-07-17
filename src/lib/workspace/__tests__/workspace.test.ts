import { describe, it, expect } from "vitest";

import {
  dehydrateDatabase,
  hydrateDatabase,
  mergeDatabaseFile,
  type PersistedDatabase,
} from "@/lib/workspace/workspace";
import type { DatabaseNode } from "@/lib/workspace/model";

const validDatabase: PersistedDatabase = {
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

// SQLite persisted database: engine + a single file path, no network fields.
const validSqliteDatabase: PersistedDatabase = {
  kind: "database",
  id: "db-local",
  name: "my_local_db",
  engine: "sqlite",
  file: "/Users/me/data/app.sqlite",
};

// MongoDB persisted database: discrete network fields PLUS an optional uri override.
const validMongoDatabase: PersistedDatabase = {
  kind: "database",
  id: "db-mongo",
  name: "orders_mongo",
  engine: "mongodb",
  host: "localhost",
  port: 27017,
  database: "shop",
  user: "app_user",
  password: "m0ngo-pw",
};

describe("mergeDatabaseFile engine variants", () => {
  // AC-002 - behavior
  it("should keep a mysql engine database node", () => {
    const mysqlDb: PersistedDatabase = { ...validDatabase, engine: "mysql" };

    expect(mergeDatabaseFile(mysqlDb)).toEqual(mysqlDb);
  });

  // TC-003, AC-005 - behavior (a sqlserver node is a network engine and survives merge unchanged)
  it("should keep a sqlserver engine database node", () => {
    const mssqlDb: PersistedDatabase = { ...validDatabase, engine: "sqlserver" };

    expect(mergeDatabaseFile(mssqlDb)).toEqual(mssqlDb);
  });

  // TC-003, AC-005 - behavior (a sqlserver node round-trips through hydrate/dehydrate)
  it("should round-trip a sqlserver database through hydrate/dehydrate", () => {
    const mssqlDb: PersistedDatabase = { ...validDatabase, engine: "sqlserver" };

    expect(dehydrateDatabase(hydrateDatabase(mssqlDb))).toEqual(mssqlDb);
  });
});

describe("mergeDatabaseFile malformed database", () => {
  // AC-002, E-3 - behavior
  it("should return null for a database whose port is not a number", () => {
    expect(mergeDatabaseFile({ ...validDatabase, port: "5432" })).toBeNull();
  });

  // AC-002, E-3 - behavior
  it("should return null for a database with a missing host", () => {
    const noHost = {
      kind: validDatabase.kind,
      id: validDatabase.id,
      name: validDatabase.name,
      engine: validDatabase.engine,
      port: validDatabase.port,
      database: validDatabase.database,
      user: validDatabase.user,
      password: validDatabase.password,
    };

    expect(mergeDatabaseFile(noHost)).toBeNull();
  });

  // AC-002, E-3 - behavior
  it("should return null for a database whose id is not a string", () => {
    expect(mergeDatabaseFile({ ...validDatabase, id: 42 })).toBeNull();
  });
});

describe("mergeDatabaseFile accent color (TC-004, TC-009)", () => {
  // AC-003, TC-004, E-4 - behavior (a valid lowercase #rrggbb accent survives merge)
  it("should keep a valid lowercase #rrggbb accentColor on a database", () => {
    const merged = mergeDatabaseFile({
      ...validDatabase,
      accentColor: "#dc2626",
    });

    expect(merged).toEqual({ ...validDatabase, accentColor: "#dc2626" });
  });

  // AC-003, E-4 - behavior (an uppercase hex is normalised to lowercase on merge)
  it("should lowercase an uppercase #RRGGBB accentColor", () => {
    const merged = mergeDatabaseFile({
      ...validDatabase,
      accentColor: "#DC2626",
    });

    expect(merged).toEqual({ ...validDatabase, accentColor: "#dc2626" });
  });

  // AC-003, E-4 - behavior (an 8-digit #rrggbbaa accentColor with alpha is kept for opacity control)
  it("should keep a valid #rrggbbaa accentColor carrying an alpha pair", () => {
    const merged = mergeDatabaseFile({
      ...validDatabase,
      accentColor: "#dc262640",
    });

    expect(merged).toEqual({ ...validDatabase, accentColor: "#dc262640" });
  });

  // AC-008, TC-009, E-2 - behavior (a numeric accentColor is dropped, db otherwise intact)
  it("should drop a numeric accentColor but keep the rest of the database", () => {
    const merged = mergeDatabaseFile({ ...validDatabase, accentColor: 123 });

    expect(merged).toEqual(validDatabase);
    expect(merged).not.toHaveProperty("accentColor");
  });

  // AC-008, TC-009, E-2 - behavior (a non-hex colour name is dropped)
  it('should drop the accentColor "red" but keep the rest of the database', () => {
    const merged = mergeDatabaseFile({ ...validDatabase, accentColor: "red" });

    expect(merged).toEqual(validDatabase);
    expect(merged).not.toHaveProperty("accentColor");
  });

  // AC-008, TC-009, E-2 - behavior (a 3-digit shorthand hex is dropped)
  it('should drop a 3-digit "#abc" accentColor but keep the rest of the database', () => {
    const merged = mergeDatabaseFile({ ...validDatabase, accentColor: "#abc" });

    expect(merged).toEqual(validDatabase);
    expect(merged).not.toHaveProperty("accentColor");
  });

  // AC-008, TC-009, E-2 - behavior (a 5-digit hex is dropped)
  it('should drop a 5-digit "#12345" accentColor but keep the rest of the database', () => {
    const merged = mergeDatabaseFile({ ...validDatabase, accentColor: "#12345" });

    expect(merged).toEqual(validDatabase);
    expect(merged).not.toHaveProperty("accentColor");
  });

  // AC-008, TC-009, E-2 - behavior (a 7-digit hex is dropped)
  it('should drop a 7-digit "#1234567" accentColor but keep the rest of the database', () => {
    const merged = mergeDatabaseFile({
      ...validDatabase,
      accentColor: "#1234567",
    });

    expect(merged).toEqual(validDatabase);
    expect(merged).not.toHaveProperty("accentColor");
  });
});

describe("savedScripts persistence (AC-007, TC-006, TC-007)", () => {
  // AC-007 - behavior (a persisted savedScripts array seeds the runtime node, not a hardcoded [])
  it("should hydrate savedScripts from the persisted array", () => {
    const db = hydrateDatabase({
      ...validDatabase,
      savedScripts: [
        { name: "active_users", sql: "SELECT 1" },
        { name: "revenue", sql: "SELECT 2" },
      ],
    } as PersistedDatabase);

    expect(db.savedScripts).toEqual([
      { name: "active_users", sql: "SELECT 1" },
      { name: "revenue", sql: "SELECT 2" },
    ]);
  });

  // AC-007, TC-006 - behavior (a non-empty savedScripts list survives a full merge/hydrate/dehydrate round trip with name + sql intact)
  it("should round-trip a non-empty savedScripts list through merge, hydrate and dehydrate", () => {
    const record: PersistedDatabase = {
      ...validDatabase,
      savedScripts: [{ name: "revenue", sql: "SELECT sum(amount) FROM sales" }],
    } as PersistedDatabase;

    expect(
      dehydrateDatabase(hydrateDatabase(mergeDatabaseFile(record)!)),
    ).toEqual(record);
  });

  // AC-007 - behavior (an empty savedScripts list is omitted from the dehydrated form, like accentColor)
  it("should omit savedScripts from a dehydrated database whose list is empty", () => {
    const persisted = dehydrateDatabase(hydrateDatabase(validDatabase));

    expect(persisted).not.toHaveProperty("savedScripts");
  });

  // AC-007, TC-007 - behavior (an entry missing its sql is dropped on merge, valid siblings kept, no throw)
  it("should drop a savedScripts entry that is missing its sql while keeping the valid ones", () => {
    const merged = mergeDatabaseFile({
      ...validDatabase,
      savedScripts: [{ name: "good", sql: "SELECT 1" }, { name: "no_sql" }],
    }) as PersistedDatabase & { savedScripts?: { name: string; sql: string }[] };

    expect(merged.savedScripts).toEqual([{ name: "good", sql: "SELECT 1" }]);
  });

  // AC-007, TC-007 - behavior (a non-record entry is dropped on merge, valid siblings kept)
  it("should drop a non-record savedScripts entry while keeping the valid ones", () => {
    const merged = mergeDatabaseFile({
      ...validDatabase,
      savedScripts: ["just a string", { name: "good", sql: "SELECT 1" }, 42],
    }) as PersistedDatabase & { savedScripts?: { name: string; sql: string }[] };

    expect(merged.savedScripts).toEqual([{ name: "good", sql: "SELECT 1" }]);
  });

  // AC-007, TC-007 - behavior (savedScripts that is not an array is dropped entirely, db otherwise intact)
  it("should drop a savedScripts value that is not an array but keep the rest of the database", () => {
    const merged = mergeDatabaseFile({ ...validDatabase, savedScripts: "nope" });

    expect(merged).toEqual(validDatabase);
    expect(merged).not.toHaveProperty("savedScripts");
  });

  // AC-007, TC-007 - behavior (a malformed savedScripts payload never throws on merge)
  it("should not throw when merging a database with a malformed savedScripts payload", () => {
    expect(() =>
      mergeDatabaseFile({
        ...validDatabase,
        savedScripts: [null, 1, "x", { name: 5, sql: 6 }],
      }),
    ).not.toThrow();
  });
});

describe("SQLite persistence (TC-010)", () => {
  // TC-010, AC-008, E-1 - behavior (a sqlite entry missing its file path is dropped)
  it("should return null for a sqlite database node that is missing its file path", () => {
    const noFile = {
      kind: "database",
      id: "db-local",
      name: "my_local_db",
      engine: "sqlite",
    };

    expect(mergeDatabaseFile(noFile)).toBeNull();
  });

  // TC-010, AC-008 - behavior (a sqlite database round-trips keeping its file path)
  it("should round-trip a sqlite database through hydrate/dehydrate keeping its file", () => {
    expect(dehydrateDatabase(hydrateDatabase(validSqliteDatabase))).toEqual(
      validSqliteDatabase,
    );
  });

  // TC-010, AC-008 - behavior (a sqlite hydrated node exposes engine + file)
  it("should hydrate a sqlite database into a runtime node carrying engine and file", () => {
    const db = hydrateDatabase(validSqliteDatabase);

    expect(db.kind).toBe("database");
    expect(db.engine).toBe("sqlite");
    expect((db as DatabaseNode & { file: string }).file).toBe(
      "/Users/me/data/app.sqlite",
    );
  });
});

describe("MongoDB persistence (TC-003)", () => {
  // TC-003, AC-005 - behavior (a valid mongodb database is kept with its network fields)
  it("should keep a valid mongodb database node carrying its network fields", () => {
    expect(mergeDatabaseFile(validMongoDatabase)).toEqual(validMongoDatabase);
  });

  // TC-003, AC-002, AC-005 - behavior (an optional uri override survives merge)
  it("should keep a mongodb database's uri override when present", () => {
    const withUri = {
      ...validMongoDatabase,
      uri: "mongodb+srv://app_user:m0ngo-pw@cluster0.example.net/shop",
    };

    expect(mergeDatabaseFile(withUri)).toEqual(withUri);
  });

  // TC-003, AC-005, E-3 - behavior (a mongodb entry missing its host is dropped)
  it("should return null for a mongodb database node that is missing its host", () => {
    const noHost = {
      kind: "database",
      id: "db-mongo",
      name: "orders_mongo",
      engine: "mongodb",
      port: 27017,
      database: "shop",
      user: "app_user",
      password: "m0ngo-pw",
    };

    expect(mergeDatabaseFile(noHost)).toBeNull();
  });

  // TC-003, AC-005, E-3 - behavior (a non-string uri is dropped, db otherwise intact)
  it("should drop a non-string uri but keep the rest of the mongodb database", () => {
    const merged = mergeDatabaseFile({ ...validMongoDatabase, uri: 42 });

    expect(merged).toEqual(validMongoDatabase);
    expect(merged).not.toHaveProperty("uri");
  });

  // TC-003, AC-005 - behavior (a mongodb database round-trips through hydrate/dehydrate)
  it("should round-trip a mongodb database through hydrate/dehydrate keeping its fields", () => {
    expect(dehydrateDatabase(hydrateDatabase(validMongoDatabase))).toEqual(
      validMongoDatabase,
    );
  });

  // TC-003, AC-002, AC-005 - behavior (a mongodb database with a uri round-trips keeping the uri)
  it("should round-trip a mongodb database carrying a uri override", () => {
    const record: PersistedDatabase = {
      ...validMongoDatabase,
      uri: "mongodb://app_user:m0ngo-pw@localhost:27017/shop?authSource=admin",
    };

    expect(dehydrateDatabase(hydrateDatabase(record))).toEqual(record);
  });

  // TC-003, AC-004 - behavior (a mongodb hydrated node exposes engine + network fields)
  it("should hydrate a mongodb database into a runtime node carrying engine and fields", () => {
    const db = hydrateDatabase(validMongoDatabase) as Extract<
      DatabaseNode,
      { engine: "mongodb" }
    >;

    expect(db.kind).toBe("database");
    expect(db.engine).toBe("mongodb");
    expect(db.host).toBe("localhost");
    expect(db.port).toBe(27017);
    expect(db.database).toBe("shop");
  });
});
