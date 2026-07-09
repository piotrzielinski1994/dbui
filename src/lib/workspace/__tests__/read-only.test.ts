import { describe, it, expect } from "vitest";

import {
  dehydrate,
  hydrate,
  mergeWorkspace,
  type PersistedDatabase,
  type PersistedWorkspace,
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

// The runtime node type does not (yet) declare `readOnly`; read it through a widened cast so the
// tests observe behaviour without depending on the type edit landing first.
type WithReadOnly = DatabaseNode & { readOnly?: boolean };

describe("mergeWorkspace readOnly (AC-002, AC-006, TC-005)", () => {
  // AC-002 - behavior (a boolean readOnly true survives merge). This is the RED anchor: today an
  // unrecognised `readOnly` is dropped like any unknown field, so a true value is NOT preserved.
  it("should keep a boolean readOnly true on a database", () => {
    const merged = mergeWorkspace({
      version: 1,
      tree: [{ ...validDatabase, readOnly: true }],
    });

    expect(merged.tree).toEqual([{ ...validDatabase, readOnly: true }]);
  });

  // AC-006, TC-005 - behavior (a non-boolean readOnly is dropped, database otherwise intact). Paired
  // with the keep-true test above so the merge is proven to be type-checked, not blanket pass/drop.
  it("should drop a string readOnly but keep the rest of the database", () => {
    const merged = mergeWorkspace({
      version: 1,
      tree: [{ ...validDatabase, readOnly: "yes" }],
    });

    expect(merged.tree).toEqual([validDatabase]);
    expect(merged.tree[0]).not.toHaveProperty("readOnly");
  });
});

describe("hydrate readOnly (AC-002, TC-005)", () => {
  // AC-002 - behavior (a persisted db with no readOnly hydrates to a false runtime flag)
  it("should default a missing readOnly to false when hydrating", () => {
    const [node] = hydrate([validDatabase]);

    expect((node as WithReadOnly).readOnly).toBe(false);
  });

  // AC-002 - behavior (a persisted readOnly true hydrates to a true runtime flag)
  it("should hydrate a persisted readOnly true to a true runtime flag", () => {
    const [node] = hydrate([
      { ...validDatabase, readOnly: true } as PersistedDatabase,
    ]);

    expect((node as WithReadOnly).readOnly).toBe(true);
  });

  // AC-006, TC-005 - behavior (a non-boolean persisted readOnly is dropped on merge, then hydrates
  // to false without crashing)
  it("should hydrate a non-boolean persisted readOnly to false without throwing", () => {
    const merged = mergeWorkspace({
      version: 1,
      tree: [{ ...validDatabase, readOnly: "yes" }],
    });

    let node: DatabaseNode | undefined;
    expect(() => {
      node = hydrate(merged.tree)[0] as DatabaseNode;
    }).not.toThrow();
    expect((node as WithReadOnly).readOnly).toBe(false);
  });
});

describe("dehydrate readOnly (AC-002)", () => {
  // AC-002 - behavior (a true readOnly is persisted; a false one is omitted, like accentColor)
  it("should include readOnly when true and omit it when false", () => {
    const base = hydrate([validDatabase])[0] as DatabaseNode;

    const readOnlyTrue = { ...base, readOnly: true } as DatabaseNode;
    expect(dehydrate([readOnlyTrue]).tree[0]).toMatchObject({ readOnly: true });

    const readOnlyFalse = { ...base, readOnly: false } as DatabaseNode;
    expect(dehydrate([readOnlyFalse]).tree[0]).not.toHaveProperty("readOnly");
  });

  // AC-002 - behavior (a read-only database survives a full merge/hydrate/dehydrate round trip)
  it("should round-trip a readOnly true database through merge, hydrate and dehydrate", () => {
    const persisted: PersistedWorkspace = {
      version: 1,
      tree: [{ ...validDatabase, readOnly: true } as PersistedDatabase],
    };

    expect(dehydrate(hydrate(mergeWorkspace(persisted).tree))).toEqual(
      persisted,
    );
  });
});
