import { describe, it, expect } from "vitest";

import {
  dehydrateDatabase,
  hydrateDatabase,
  mergeDatabaseFile,
  type PersistedDatabase,
} from "@/lib/workspace/workspace";

// F18 (AC-005 / TC-010): a DatabaseNode's `variables: Variable[]` must round-trip through the
// persistence layer exactly like `savedScripts` - a non-empty list survives merge/hydrate/dehydrate,
// an empty list is omitted from the persisted shape, and garbage entries are dropped by merge.

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

type PersistedWithVars = PersistedDatabase & {
  variables?: { name: string; value: string }[];
};

describe("variables persistence (AC-005, TC-010)", () => {
  // TC-010 - behavior: a persisted variables array seeds the runtime node (not a hardcoded []).
  it("should hydrate variables from the persisted array", () => {
    const db = hydrateDatabase({
      ...validDatabase,
      variables: [{ name: "userId", value: "42" }],
    } as PersistedDatabase);

    expect(db.variables).toEqual([{ name: "userId", value: "42" }]);
  });

  // AC-005 - behavior: a missing variables field hydrates to an empty array.
  it("should default missing variables to an empty array on hydrate", () => {
    const db = hydrateDatabase(validDatabase);

    expect(db.variables).toEqual([]);
  });

  // TC-010 - behavior: a non-empty variables list survives a full merge/hydrate/dehydrate round trip.
  it("should round-trip a non-empty variables list through merge, hydrate and dehydrate", () => {
    const record: PersistedDatabase = {
      ...validDatabase,
      variables: [{ name: "userId", value: "42" }],
    } as PersistedDatabase;

    expect(dehydrateDatabase(hydrateDatabase(mergeDatabaseFile(record)!))).toEqual(
      record,
    );
  });

  // TC-010 - behavior: an empty variables list is omitted from the dehydrated form (like savedScripts).
  it("should omit variables from a dehydrated database whose list is empty", () => {
    const persisted = dehydrateDatabase(hydrateDatabase(validDatabase));

    expect(persisted).not.toHaveProperty("variables");
  });

  // AC-005 - behavior: a persisted empty variables array is dropped by merge (omitted, not kept).
  it("should omit an empty variables array on merge", () => {
    const merged = mergeDatabaseFile({ ...validDatabase, variables: [] });

    expect(merged).toEqual(validDatabase);
    expect(merged).not.toHaveProperty("variables");
  });

  // TC-010 - behavior: a garbage entry (`{ name: 1 }`, no string name/value) is dropped by merge,
  // the valid sibling entry kept.
  it("should drop a garbage variables entry while keeping the valid ones", () => {
    const merged = mergeDatabaseFile({
      ...validDatabase,
      variables: [{ name: 1 }, { name: "userId", value: "42" }],
    }) as PersistedWithVars;

    expect(merged.variables).toEqual([{ name: "userId", value: "42" }]);
  });

  // AC-005 - behavior: a variables value that is not an array is dropped entirely, db otherwise intact.
  it("should drop a non-array variables value but keep the rest of the database", () => {
    const merged = mergeDatabaseFile({ ...validDatabase, variables: "nope" });

    expect(merged).toEqual(validDatabase);
    expect(merged).not.toHaveProperty("variables");
  });

  // AC-005 - behavior: a malformed variables payload never throws on merge.
  it("should not throw when merging a database with a malformed variables payload", () => {
    expect(() =>
      mergeDatabaseFile({
        ...validDatabase,
        variables: [null, 1, "x", { name: 5, value: 6 }],
      }),
    ).not.toThrow();
  });
});
