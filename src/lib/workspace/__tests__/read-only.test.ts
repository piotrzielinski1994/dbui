import { describe, it, expect } from "vitest";

import {
  dehydrateDatabase,
  hydrateDatabase,
  mergeDatabaseFile,
  type PersistedDatabase,
} from "@/lib/workspace/workspace";
import type { DatabaseNode } from "@/lib/workspace/model";

// F11 read-only connection: a per-database `readOnly` boolean. Persisted as an OPTIONAL field on the
// three Persisted* database shapes (omitted when false, like accentColor); runtime always present.
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

describe("mergeDatabaseFile readOnly (AC-002, AC-006, TC-005)", () => {
  // AC-002 - behavior (a boolean readOnly true survives merge).
  it("should keep a boolean readOnly true on a database", () => {
    const merged = mergeDatabaseFile({ ...validDatabase, readOnly: true });

    expect(merged).toEqual({ ...validDatabase, readOnly: true });
  });

  // AC-006, TC-005 - behavior (a non-boolean readOnly is dropped, database otherwise intact). Paired
  // with the keep-true test above so the merge is proven to be type-checked, not blanket pass/drop.
  it("should drop a string readOnly but keep the rest of the database", () => {
    const merged = mergeDatabaseFile({ ...validDatabase, readOnly: "yes" });

    expect(merged).toEqual(validDatabase);
    expect(merged).not.toHaveProperty("readOnly");
  });
});

describe("hydrateDatabase readOnly (AC-002, TC-005)", () => {
  // AC-002 - behavior (a persisted db with no readOnly hydrates to a false runtime flag)
  it("should default a missing readOnly to false when hydrating", () => {
    const node = hydrateDatabase(validDatabase);

    expect(node.readOnly).toBe(false);
  });

  // AC-002 - behavior (a persisted readOnly true hydrates to a true runtime flag)
  it("should hydrate a persisted readOnly true to a true runtime flag", () => {
    const node = hydrateDatabase({
      ...validDatabase,
      readOnly: true,
    } as PersistedDatabase);

    expect(node.readOnly).toBe(true);
  });

  // AC-006, TC-005 - behavior (a non-boolean persisted readOnly is dropped on merge, then hydrates
  // to false without crashing)
  it("should hydrate a non-boolean persisted readOnly to false without throwing", () => {
    const merged = mergeDatabaseFile({ ...validDatabase, readOnly: "yes" });

    let node: DatabaseNode | undefined;
    expect(() => {
      node = hydrateDatabase(merged!);
    }).not.toThrow();
    expect(node!.readOnly).toBe(false);
  });
});

describe("dehydrateDatabase readOnly (AC-002)", () => {
  // AC-002 - behavior (a true readOnly is persisted; a false one is omitted, like accentColor)
  it("should include readOnly when true and omit it when false", () => {
    const base = hydrateDatabase(validDatabase);

    const readOnlyTrue = { ...base, readOnly: true } as DatabaseNode;
    expect(dehydrateDatabase(readOnlyTrue)).toMatchObject({ readOnly: true });

    const readOnlyFalse = { ...base, readOnly: false } as DatabaseNode;
    expect(dehydrateDatabase(readOnlyFalse)).not.toHaveProperty("readOnly");
  });

  // AC-002 - behavior (a read-only database survives a full merge/hydrate/dehydrate round trip)
  it("should round-trip a readOnly true database through merge, hydrate and dehydrate", () => {
    const record: PersistedDatabase = {
      ...validDatabase,
      readOnly: true,
    } as PersistedDatabase;

    expect(dehydrateDatabase(hydrateDatabase(mergeDatabaseFile(record)!))).toEqual(
      record,
    );
  });
});
