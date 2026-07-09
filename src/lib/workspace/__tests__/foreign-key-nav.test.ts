import { describe, it, expect } from "vitest";

import {
  navigableForeignKeys,
  fkTargetTableId,
} from "@/lib/workspace/foreign-key-nav";
import type { ForeignKey } from "@/lib/workspace/model";

// A single-column FK (orders.customer_id -> customers.id) with a Postgres referenced schema.
const customerFk: ForeignKey = {
  name: "orders_customer_fk",
  columns: ["customer_id"],
  referencedTable: "customers",
  referencedSchema: "public",
  referencedColumns: ["id"],
};

// A two-column composite FK (t2.(a, b) -> t.(x, y)), no referenced schema (MySQL/SQLite shape).
const compositeFk: ForeignKey = {
  name: "t2_composite_fk",
  columns: ["a", "b"],
  referencedTable: "t",
  referencedSchema: null,
  referencedColumns: ["x", "y"],
};

describe("navigableForeignKeys", () => {
  // AC-001, TC-001 - pure-logic: a single FK with a non-null local value yields one entry whose label
  // and values reflect the source row.
  it("should return one entry with the label and local value for a single non-null FK", () => {
    const result = navigableForeignKeys(
      [customerFk],
      ["id", "customer_id"],
      ["1", "42"],
    );

    expect(result).toHaveLength(1);
    expect(result[0].label).toBe("Go to customers (customer_id=42)");
    expect(result[0].values).toEqual(["42"]);
    expect(result[0].fk).toBe(customerFk);
  });

  // AC-003, TC-002 - pure-logic: a composite FK produces ONE entry whose label lists every column=value
  // pair (comma-joined) and whose values follow fk.columns order.
  it("should return one entry listing both pairs for a composite FK", () => {
    const result = navigableForeignKeys(
      [compositeFk],
      ["a", "b", "c"],
      ["1", "2", "3"],
    );

    expect(result).toHaveLength(1);
    expect(result[0].label).toBe("Go to t (a=1, b=2)");
    expect(result[0].values).toEqual(["1", "2"]);
  });

  // AC-004, TC-003 - pure-logic: an FK whose local column value is null references nothing, so it is
  // excluded from the navigable set.
  it("should exclude an FK if its local value is null", () => {
    const result = navigableForeignKeys(
      [customerFk],
      ["id", "customer_id"],
      ["2", null],
    );

    expect(result).toEqual([]);
  });
});

describe("fkTargetTableId", () => {
  // TC-010 - pure-logic: with a referenced schema the id is db::schema::table.
  it("should build the target id with the referenced schema", () => {
    expect(fkTargetTableId("db-ppp", customerFk)).toBe(
      "db-ppp::public::customers",
    );
  });

  // AC-008, TC-010 - pure-logic: a null referenced schema yields the empty-schema-segment shape.
  it("should build the target id with an empty schema segment if the referenced schema is null", () => {
    expect(fkTargetTableId("db-ppp", compositeFk)).toBe("db-ppp::::t");
  });
});
