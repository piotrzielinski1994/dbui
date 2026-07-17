import { describe, it, expect } from "vitest";

import {
  dehydrateDatabase,
  hydrateDatabase,
  mergeDatabaseFile,
  type PersistedDatabase,
} from "@/lib/workspace/workspace";
import type { DatabaseNode } from "@/lib/workspace/model";

// F12 manual-commit mode: a per-database `manualCommit` boolean, persisted as an OPTIONAL field on
// the Persisted* database shapes (omitted when false, like readOnly/accentColor); runtime always
// present. Mirrors the F11 readOnly persistence byte-for-byte (this field REPLACED confirmWrites).
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

describe("mergeDatabaseFile manualCommit (AC-001, AC-010, TC-007, TC-008)", () => {
  // AC-001, TC-007 - behavior (a boolean manualCommit true survives merge, like readOnly true)
  it("should keep a boolean manualCommit true on a database", () => {
    const merged = mergeDatabaseFile({ ...validDatabase, manualCommit: true });

    expect(merged).toEqual({ ...validDatabase, manualCommit: true });
  });

  // AC-010, TC-008 - behavior (a non-boolean manualCommit is dropped, database otherwise intact)
  it("should drop a string manualCommit but keep the rest of the database", () => {
    const merged = mergeDatabaseFile({ ...validDatabase, manualCommit: "yes" });

    expect(merged).toEqual(validDatabase);
    expect(merged).not.toHaveProperty("manualCommit");
  });

  // AC-010 - behavior (an explicit boolean false is dropped too, so it never persists a default)
  it("should drop a manualCommit of false", () => {
    const merged = mergeDatabaseFile({ ...validDatabase, manualCommit: false });

    expect(merged).not.toHaveProperty("manualCommit");
  });
});

describe("hydrateDatabase manualCommit (AC-001, AC-010, TC-008)", () => {
  // AC-001 - behavior (a persisted db with no manualCommit hydrates to a false runtime flag)
  it("should default a missing manualCommit to false when hydrating", () => {
    const node = hydrateDatabase(validDatabase);

    expect(node.manualCommit).toBe(false);
  });

  // AC-001 - behavior (a persisted manualCommit true hydrates to a true runtime flag)
  it("should hydrate a persisted manualCommit true to a true runtime flag", () => {
    const node = hydrateDatabase({
      ...validDatabase,
      manualCommit: true,
    } as PersistedDatabase);

    expect(node.manualCommit).toBe(true);
  });

  // AC-010, TC-008 - behavior (a non-boolean persisted manualCommit is dropped on merge, then
  // hydrates to false without crashing)
  it("should hydrate a non-boolean persisted manualCommit to false without throwing", () => {
    const merged = mergeDatabaseFile({ ...validDatabase, manualCommit: "yes" });

    let node: DatabaseNode | undefined;
    expect(() => {
      node = hydrateDatabase(merged!);
    }).not.toThrow();
    expect(node!.manualCommit).toBe(false);
  });
});

describe("dehydrateDatabase manualCommit (AC-001, TC-007)", () => {
  // AC-001, TC-007 - behavior (a true manualCommit is persisted; a false one is omitted)
  it("should include manualCommit when true and omit it when false", () => {
    const base = hydrateDatabase(validDatabase);

    const manualTrue = { ...base, manualCommit: true } as DatabaseNode;
    expect(dehydrateDatabase(manualTrue)).toMatchObject({
      manualCommit: true,
    });

    const manualFalse = { ...base, manualCommit: false } as DatabaseNode;
    expect(dehydrateDatabase(manualFalse)).not.toHaveProperty("manualCommit");
  });

  // AC-001, TC-007 - behavior (a manual-commit database survives a full merge/hydrate/dehydrate
  // round trip)
  it("should round-trip a manualCommit true database through merge, hydrate and dehydrate", () => {
    const record: PersistedDatabase = {
      ...validDatabase,
      manualCommit: true,
    } as PersistedDatabase;

    expect(dehydrateDatabase(hydrateDatabase(mergeDatabaseFile(record)!))).toEqual(
      record,
    );
  });
});
