import { describe, it, expect } from "vitest";

import {
  dehydrateDatabase,
  hydrateDatabase,
  mergeDatabaseFile,
  type PersistedDatabase,
} from "@/lib/workspace/workspace";
import type { DatabaseNode } from "@/lib/workspace/model";

// Per-database "Default schema" (sidebar filter + bare label). A `defaultSchema: string | null` on
// the database node, persisted as an OPTIONAL string on the three Persisted* shapes (mirrors
// readOnly/accentColor): mergeDefaultSchema keeps only a NON-EMPTY string, hydrate defaults null,
// dehydrate OMITS null/empty.
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

describe("mergeDatabaseFile defaultSchema (AC-001, TC-001)", () => {
  // AC-001 - behavior (a non-empty string defaultSchema survives merge).
  it("should keep a non-empty string defaultSchema on a database", () => {
    const merged = mergeDatabaseFile({
      ...validDatabase,
      defaultSchema: "public",
    });

    expect(merged).toEqual({ ...validDatabase, defaultSchema: "public" });
  });

  // AC-001, TC-001 - behavior (an empty-string defaultSchema is dropped, database otherwise intact)
  it("should drop an empty-string defaultSchema but keep the rest of the database", () => {
    const merged = mergeDatabaseFile({ ...validDatabase, defaultSchema: "" });

    expect(merged).toEqual(validDatabase);
    expect(merged).not.toHaveProperty("defaultSchema");
  });

  // AC-001, TC-001 - behavior (a null defaultSchema is dropped, database otherwise intact)
  it("should drop a null defaultSchema but keep the rest of the database", () => {
    const merged = mergeDatabaseFile({ ...validDatabase, defaultSchema: null });

    expect(merged).toEqual(validDatabase);
    expect(merged).not.toHaveProperty("defaultSchema");
  });

  // AC-001, TC-001 - behavior (a non-string defaultSchema is dropped, database otherwise intact)
  it("should drop a numeric defaultSchema but keep the rest of the database", () => {
    const merged = mergeDatabaseFile({ ...validDatabase, defaultSchema: 42 });

    expect(merged).toEqual(validDatabase);
    expect(merged).not.toHaveProperty("defaultSchema");
  });
});

describe("hydrateDatabase defaultSchema (AC-001, TC-001)", () => {
  // AC-001, TC-001 - behavior (a persisted db with no defaultSchema hydrates to null)
  it("should default a missing defaultSchema to null when hydrating", () => {
    const node = hydrateDatabase(validDatabase);

    expect(node.defaultSchema).toBeNull();
  });

  // AC-001 - behavior (a persisted defaultSchema hydrates to that string on the runtime node)
  it("should hydrate a persisted defaultSchema to that string", () => {
    const node = hydrateDatabase({
      ...validDatabase,
      defaultSchema: "quartz",
    } as PersistedDatabase);

    expect(node.defaultSchema).toBe("quartz");
  });

  // AC-001, TC-001 - behavior (a dropped garbage defaultSchema hydrates to null without throwing)
  it("should hydrate a merged non-string defaultSchema to null without throwing", () => {
    const merged = mergeDatabaseFile({ ...validDatabase, defaultSchema: 42 });

    let node: DatabaseNode | undefined;
    expect(() => {
      node = hydrateDatabase(merged!);
    }).not.toThrow();
    expect(node!.defaultSchema).toBeNull();
  });
});

describe("dehydrateDatabase defaultSchema (AC-001, TC-001)", () => {
  // AC-001, TC-001 - behavior (a set defaultSchema is persisted; a null one is omitted)
  it("should include defaultSchema when set and omit it when null", () => {
    const base = hydrateDatabase(validDatabase);

    const withSchema = { ...base, defaultSchema: "public" } as DatabaseNode;
    expect(dehydrateDatabase(withSchema)).toMatchObject({
      defaultSchema: "public",
    });

    const withNull = { ...base, defaultSchema: null } as DatabaseNode;
    expect(dehydrateDatabase(withNull)).not.toHaveProperty("defaultSchema");
  });

  // AC-001, TC-001 - behavior (a database with a defaultSchema survives a full merge/hydrate/
  // dehydrate round trip).
  it("should round-trip a defaultSchema database through merge, hydrate and dehydrate", () => {
    const record: PersistedDatabase = {
      ...validDatabase,
      defaultSchema: "quartz",
    } as PersistedDatabase;

    expect(dehydrateDatabase(hydrateDatabase(mergeDatabaseFile(record)!))).toEqual(
      record,
    );
  });
});
