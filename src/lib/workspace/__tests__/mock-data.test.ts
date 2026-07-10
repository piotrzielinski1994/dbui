import { describe, it, expect } from "vitest";

// Pure lib for the mock data generator (F17): auto-detect a per-column strategy from its type/name/PK,
// and deterministically generate rows for a set of column configs. None of this exists yet - the
// import fails until mock-data.ts ships, so each test fails on the missing feature, not a typo.
import {
  autoStrategy,
  generateRows,
  MAX_MOCK_ROWS,
  type MockColumnConfig,
} from "@/lib/workspace/mock-data";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ok<T>(result: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!result.ok) {
    throw new Error(`expected Ok, got Err: ${result.error}`);
  }
  return result.value;
}

describe("autoStrategy (AC-003)", () => {
  // AC-003, TC-002 - behavior: an integer PK defaults to a sequence.
  it("should default an integer primary key to a sequence", () => {
    expect(
      autoStrategy({ name: "id", dataType: "int8", isPrimaryKey: true }).kind,
    ).toBe("sequence");
  });

  // AC-003, TC-002 - behavior: a non-PK integer column defaults to an integer range.
  it("should default a non-key integer column to an integer range", () => {
    expect(
      autoStrategy({ name: "age", dataType: "int4", isPrimaryKey: false }).kind,
    ).toBe("integer");
  });

  // AC-003 - behavior: numeric/decimal types default to decimal.
  it("should default a numeric column to a decimal", () => {
    expect(
      autoStrategy({ name: "total", dataType: "numeric", isPrimaryKey: false })
        .kind,
    ).toBe("decimal");
  });

  // AC-003, TC-002 - behavior: a boolean column defaults to boolean.
  it("should default a boolean column to boolean", () => {
    expect(
      autoStrategy({ name: "active", dataType: "bool", isPrimaryKey: false })
        .kind,
    ).toBe("boolean");
  });

  // AC-003, TC-002 - behavior: a uuid column defaults to uuid.
  it("should default a uuid column to uuid", () => {
    expect(
      autoStrategy({ name: "uid", dataType: "uuid", isPrimaryKey: false }).kind,
    ).toBe("uuid");
  });

  // AC-003, TC-002 - behavior: a date/timestamp column defaults to date.
  it("should default a timestamp column to date", () => {
    expect(
      autoStrategy({
        name: "created_at",
        dataType: "timestamp",
        isPrimaryKey: false,
      }).kind,
    ).toBe("date");
  });

  // AC-003, TC-002 - behavior: a text column defaults to words.
  it("should default a text column to words", () => {
    expect(
      autoStrategy({ name: "note", dataType: "text", isPrimaryKey: false }).kind,
    ).toBe("words");
  });

  // AC-003, TC-002 - behavior: a column named email defaults to email regardless of its (text) type.
  it("should default a column named email to email", () => {
    expect(
      autoStrategy({ name: "email", dataType: "varchar", isPrimaryKey: false })
        .kind,
    ).toBe("email");
  });

  // AC-003 - behavior: a name-like column defaults to fullName.
  it("should default a name-like column to fullName", () => {
    expect(
      autoStrategy({ name: "name", dataType: "varchar", isPrimaryKey: false })
        .kind,
    ).toBe("fullName");
  });

  // AC-003/AC-009 - behavior: a Mongo _id column defaults to skip (server-assigned).
  it("should default a Mongo _id column to skip", () => {
    expect(
      autoStrategy({ name: "_id", dataType: "objectId", isPrimaryKey: true })
        .kind,
    ).toBe("skip");
  });
});

describe("generateRows determinism + value kinds (AC-005)", () => {
  const configs: MockColumnConfig[] = [
    { column: "id", kind: "sequence", params: { start: 100 } },
    { column: "age", kind: "integer", params: { min: 10, max: 20 } },
    { column: "active", kind: "boolean", params: {} },
    { column: "email", kind: "email", params: {} },
    { column: "uid", kind: "uuid", params: {} },
  ];

  // AC-005, TC-004 - behavior: the same configs + seed produce identical rows (seeded PRNG).
  it("should produce identical rows for the same seed", () => {
    const a = ok(generateRows(configs, 8, 42));
    const b = ok(generateRows(configs, 8, 42));
    expect(a).toEqual(b);
  });

  // AC-005, TC-004 - behavior: a different seed produces different rows (not a constant).
  it("should produce different rows for a different seed", () => {
    const a = ok(generateRows(configs, 8, 42));
    const b = ok(generateRows(configs, 8, 43));
    expect(a).not.toEqual(b);
  });

  // AC-005, TC-004 - behavior: a sequence value is start + row index.
  it("should generate a sequence as start plus the row index", () => {
    const rows = ok(generateRows(configs, 4, 1));
    expect(rows.map((row) => row.id)).toEqual(["100", "101", "102", "103"]);
  });

  // AC-005, TC-004 - behavior: an integer value stays within [min, max].
  it("should keep an integer value within its min/max range", () => {
    const rows = ok(generateRows(configs, 50, 7));
    for (const row of rows) {
      const value = Number(row.age);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(10);
      expect(value).toBeLessThanOrEqual(20);
    }
  });

  // AC-005 - behavior: a boolean value is the string "true" or "false".
  it("should generate a boolean as true or false", () => {
    const rows = ok(generateRows(configs, 20, 3));
    for (const row of rows) {
      expect(["true", "false"]).toContain(row.active);
    }
  });

  // AC-005 - behavior: an email value contains an @.
  it("should generate an email containing an @", () => {
    const rows = ok(generateRows(configs, 10, 9));
    for (const row of rows) {
      expect(row.email).toContain("@");
    }
  });

  // AC-005 - behavior: a uuid value matches the uuid shape.
  it("should generate a uuid matching the uuid shape", () => {
    const rows = ok(generateRows(configs, 10, 5));
    for (const row of rows) {
      expect(row.uid).toMatch(UUID_RE);
    }
  });
});

describe("generateRows skip vs null (AC-006)", () => {
  const configs: MockColumnConfig[] = [
    { column: "id", kind: "sequence", params: { start: 1 } },
    { column: "gone", kind: "skip", params: {} },
    { column: "empty", kind: "null", params: {} },
  ];

  // AC-006, TC-005 - behavior: a skip column is OMITTED from each row object entirely.
  it("should omit a skip column from every generated row", () => {
    const rows = ok(generateRows(configs, 3, 1));
    for (const row of rows) {
      expect("gone" in row).toBe(false);
    }
  });

  // AC-006, TC-005 - behavior: a null column is PRESENT in each row with value null.
  it("should include a null column with a null value", () => {
    const rows = ok(generateRows(configs, 3, 1));
    for (const row of rows) {
      expect("empty" in row).toBe(true);
      expect(row.empty).toBeNull();
    }
  });
});

describe("generateRows row-count bounds (AC-004)", () => {
  const configs: MockColumnConfig[] = [
    { column: "id", kind: "sequence", params: { start: 1 } },
  ];

  // AC-004, TC-003 - behavior: the max is exposed as a constant and is 200.
  it("should expose MAX_MOCK_ROWS as 200", () => {
    expect(MAX_MOCK_ROWS).toBe(200);
  });

  // AC-004, TC-003 - behavior: a count of zero cannot generate (Err).
  it("should reject a count of zero", () => {
    expect(generateRows(configs, 0, 1).ok).toBe(false);
  });

  // AC-004, TC-003 - behavior: a count above the max cannot generate (Err).
  it("should reject a count above the max", () => {
    expect(generateRows(configs, MAX_MOCK_ROWS + 1, 1).ok).toBe(false);
  });

  // AC-004, TC-003 - behavior: the max itself is allowed and yields exactly that many rows.
  it("should allow exactly the max count", () => {
    const rows = ok(generateRows(configs, MAX_MOCK_ROWS, 1));
    expect(rows).toHaveLength(MAX_MOCK_ROWS);
  });
});

describe("generateRows enum + fixed params (AC-010)", () => {
  // AC-010, TC-009 - behavior: an enum value is always a member of its list.
  it("should draw an enum value from its list", () => {
    const configs: MockColumnConfig[] = [
      { column: "status", kind: "enum", params: { values: ["a", "b", "c"] } },
    ];
    const rows = ok(generateRows(configs, 30, 11));
    for (const row of rows) {
      expect(["a", "b", "c"]).toContain(row.status);
    }
  });

  // AC-010, TC-009 - behavior: an empty enum list is a validation error (nothing generated).
  it("should reject an enum with an empty value list", () => {
    const configs: MockColumnConfig[] = [
      { column: "status", kind: "enum", params: { values: [] } },
    ];
    expect(generateRows(configs, 3, 1).ok).toBe(false);
  });

  // AC-010 - behavior: a fixed value is emitted verbatim on every row.
  it("should emit a fixed value verbatim", () => {
    const configs: MockColumnConfig[] = [
      { column: "tag", kind: "fixed", params: { value: "CONST" } },
    ];
    const rows = ok(generateRows(configs, 5, 1));
    for (const row of rows) {
      expect(row.tag).toBe("CONST");
    }
  });
});
