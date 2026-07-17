import { describe, it, expect } from "vitest";

import {
  dehydrateDatabase,
  hydrateDatabase,
  mergeDatabaseFile,
  type PersistedDatabase,
} from "@/lib/workspace/workspace";
import type { SavedJsScript } from "@/lib/workspace/model";

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

// F7 adds a per-database `savedJsScripts` array (JS document tabs) mirroring `savedScripts`.
// A SavedJsScript is `{ name, code }` (code, not sql).
const sample: SavedJsScript = { name: "count_users", code: "return await db.tables();" };

describe("savedJsScripts persistence (AC-010)", () => {
  // AC-010 - behavior (a persisted savedJsScripts array seeds the runtime node, not a hardcoded [])
  it("should hydrate savedJsScripts from the persisted array", () => {
    const db = hydrateDatabase({
      ...validDatabase,
      savedJsScripts: [
        { name: "a", code: "return 1;" },
        { name: "b", code: "return 2;" },
      ],
    } as PersistedDatabase);

    expect(db.savedJsScripts).toEqual([
      { name: "a", code: "return 1;" },
      { name: "b", code: "return 2;" },
    ]);
  });

  // AC-010 - behavior (a database with no persisted savedJsScripts hydrates to an empty list)
  it("should hydrate savedJsScripts to an empty array when the persisted node has none", () => {
    const db = hydrateDatabase(validDatabase);

    expect(db.savedJsScripts).toEqual([]);
  });

  // AC-010 - behavior (a non-empty list survives a full merge/hydrate/dehydrate round trip)
  it("should round-trip a non-empty savedJsScripts list through merge, hydrate and dehydrate", () => {
    const record: PersistedDatabase = {
      ...validDatabase,
      savedJsScripts: [sample],
    } as PersistedDatabase;

    expect(dehydrateDatabase(hydrateDatabase(mergeDatabaseFile(record)!))).toEqual(
      record,
    );
  });

  // AC-010 - behavior (an empty savedJsScripts list is omitted from the dehydrated form, like savedScripts)
  it("should omit savedJsScripts from a dehydrated database whose list is empty", () => {
    const persisted = dehydrateDatabase(hydrateDatabase(validDatabase));

    expect(persisted).not.toHaveProperty("savedJsScripts");
  });

  // AC-010 - behavior (an entry missing its code is dropped on merge, valid siblings kept)
  it("should drop a savedJsScripts entry that is missing its code while keeping the valid ones", () => {
    const merged = mergeDatabaseFile({
      ...validDatabase,
      savedJsScripts: [{ name: "good", code: "return 1;" }, { name: "no_code" }],
    }) as PersistedDatabase & { savedJsScripts?: SavedJsScript[] };

    expect(merged.savedJsScripts).toEqual([{ name: "good", code: "return 1;" }]);
  });

  // AC-010 - behavior (non-record entries are dropped on merge, valid siblings kept)
  it("should drop non-record savedJsScripts entries while keeping the valid ones", () => {
    const merged = mergeDatabaseFile({
      ...validDatabase,
      savedJsScripts: ["just a string", { name: "good", code: "return 1;" }, 42],
    }) as PersistedDatabase & { savedJsScripts?: SavedJsScript[] };

    expect(merged.savedJsScripts).toEqual([{ name: "good", code: "return 1;" }]);
  });

  // AC-010 - behavior (a savedJsScripts value that is not an array is dropped, db otherwise intact)
  it("should drop a savedJsScripts value that is not an array but keep the rest of the database", () => {
    const merged = mergeDatabaseFile({ ...validDatabase, savedJsScripts: "nope" });

    expect(merged).toEqual(validDatabase);
    expect(merged).not.toHaveProperty("savedJsScripts");
  });

  // AC-010 - behavior (a malformed savedJsScripts payload never throws on merge)
  it("should not throw when merging a database with a malformed savedJsScripts payload", () => {
    expect(() =>
      mergeDatabaseFile({
        ...validDatabase,
        savedJsScripts: [null, 1, "x", { name: 5, code: 6 }],
      }),
    ).not.toThrow();
  });

  // AC-010 - behavior (savedScripts (SQL) and savedJsScripts (JS) are separate arrays, both preserved)
  it("should keep savedScripts and savedJsScripts as separate arrays on the same database", () => {
    const merged = mergeDatabaseFile({
      ...validDatabase,
      savedScripts: [{ name: "sql_one", sql: "SELECT 1" }],
      savedJsScripts: [{ name: "js_one", code: "return 1;" }],
    }) as PersistedDatabase & {
      savedScripts?: { name: string; sql: string }[];
      savedJsScripts?: SavedJsScript[];
    };

    expect(merged.savedScripts).toEqual([{ name: "sql_one", sql: "SELECT 1" }]);
    expect(merged.savedJsScripts).toEqual([{ name: "js_one", code: "return 1;" }]);
  });
});
