import { describe, it, expect } from "vitest";

import {
  queryPreview,
  rowsToInsertSql,
  fkFilter,
} from "@/components/workspace/query-preview";

describe("queryPreview SQL strategy", () => {
  // behavior (postgres fetch builds a schema-qualified SELECT with WHERE/ORDER/LIMIT/OFFSET)
  it("should build a schema-qualified SELECT for postgres", () => {
    const preview = queryPreview("postgres", "analytics");
    expect(
      preview.fetch("users", "age > 30", { column: "age", descending: true }, 200, 200),
    ).toBe(
      'SELECT * FROM "analytics"."users" WHERE (age > 30) ORDER BY "age" DESC LIMIT 200 OFFSET 200',
    );
  });

  // behavior (the SQL filter rejects a semicolon - a second-statement attempt)
  it("should reject a SQL filter containing a semicolon", () => {
    const preview = queryPreview("postgres", null);
    expect(preview.validateFilter("a = 1; DROP TABLE x")).toMatch(/semicolon/i);
    expect(preview.validateFilter("a = 1")).toBeNull();
  });
});

describe("queryPreview SQL type-aware value quoting", () => {
  // A resolver mapping the demo columns to their SQL types.
  const resolveType = (column: string): string | undefined =>
    ({
      id: "int4",
      count: "bigint",
      price: "numeric(10,2)",
      active: "bool",
      name: "text",
      created: "timestamp",
    })[column];

  // behavior (a numeric column's value is a BARE literal - no quotes - so the editor highlights it
  // as a number, matching the typed bind actually sent)
  it("should emit numeric column values without quotes", () => {
    const preview = queryPreview("postgres", "public", resolveType);
    expect(
      preview.insert("t", { id: "123", count: "9", price: "19.99" }),
    ).toBe(
      'INSERT INTO "public"."t" ("id", "count", "price") VALUES (123, 9, 19.99)',
    );
  });

  // behavior (a boolean column emits bare true/false, normalising t/f/1/0)
  it("should emit boolean column values as bare true/false", () => {
    const preview = queryPreview("postgres", null, resolveType);
    expect(preview.insert("t", { active: "true" })).toBe(
      'INSERT INTO "t" ("active") VALUES (true)',
    );
    expect(preview.insert("t", { active: "f" })).toBe(
      'INSERT INTO "t" ("active") VALUES (false)',
    );
  });

  // behavior (non-numeric / text / timestamp columns stay quoted; a NULL is bare NULL)
  it("should keep text and timestamp values quoted and NULL bare", () => {
    const preview = queryPreview("postgres", null, resolveType);
    expect(
      preview.insert("t", { name: "Ada", created: "2026-07-12", id: null }),
    ).toBe(
      'INSERT INTO "t" ("name", "created", "id") VALUES (\'Ada\', \'2026-07-12\', NULL)',
    );
  });

  // behavior (a numeric column whose value is NOT a valid number falls back to a quoted literal, so
  // the preview never emits invalid SQL for a stray value)
  it("should quote a non-numeric value even for a numeric column", () => {
    const preview = queryPreview("postgres", null, resolveType);
    expect(preview.insert("t", { id: "not-a-number" })).toBe(
      'INSERT INTO "t" ("id") VALUES (\'not-a-number\')',
    );
  });

  // behavior (an UPDATE uses the same type-aware quoting for the SET value and the pk match)
  it("should type-quote the UPDATE SET value and pk", () => {
    const preview = queryPreview("postgres", null, resolveType);
    expect(preview.update("t", "count", "5", "id", "42")).toBe(
      'UPDATE "t" SET "count" = 5 WHERE "id" = 42',
    );
  });

  // behavior (without a resolver every value stays quoted - the prior default, so existing callers
  // and the Copy-as-SQL path are unchanged)
  it("should quote every value when no type resolver is given", () => {
    const preview = queryPreview("postgres", null);
    expect(preview.insert("t", { id: "1" })).toBe(
      'INSERT INTO "t" ("id") VALUES (\'1\')',
    );
  });
});

describe("queryPreview MongoDB strategy (TC-013)", () => {
  const preview = queryPreview("mongodb", null);

  // TC-013 - behavior (fetch reads as a db.coll.find(...).limit(...) string, not SQL)
  it("should build a db.collection.find preview string for a mongo collection", () => {
    expect(
      preview.fetch("orders", '{ "status": "paid" }', { column: "total", descending: false }, 200, 0),
    ).toBe('db.orders.find({ "status": "paid" }).sort({ total: 1 }).limit(200)');
  });

  // TC-013 - behavior (an empty filter previews as find({}))
  it("should preview an empty filter as find({})", () => {
    expect(preview.fetch("orders", undefined, null, 200, 0)).toBe(
      "db.orders.find({}).limit(200)",
    );
  });

  // TC-013, AC-011 - behavior (a cell update reads as updateOne with $set, value as JSON literal)
  it("should build an updateOne $set preview with the value as a JSON literal", () => {
    expect(preview.update("orders", "total", "120", "_id", "65f")).toBe(
      "db.orders.updateOne({ _id: \"65f\" }, { $set: { total: 120 } })",
    );
  });

  // AC-012 - behavior (insert reads as insertOne; delete as deleteOne keyed on _id)
  it("should build insertOne and deleteOne previews", () => {
    expect(preview.insert("orders", { status: "paid", total: "99" })).toBe(
      'db.orders.insertOne({ status: "paid", total: 99 })',
    );
    expect(preview.remove("orders", "_id", "65f")).toBe(
      'db.orders.deleteOne({ _id: "65f" })',
    );
  });

  // AC-008 - behavior (the mongo filter accepts valid JSON objects, rejects bad JSON / non-objects)
  it("should validate the mongo filter as a JSON object", () => {
    expect(preview.validateFilter("")).toBeNull();
    expect(preview.validateFilter('{ "age": { "$gt": 30 } }')).toBeNull();
    expect(preview.validateFilter("{ not json")).toMatch(/valid json/i);
    expect(preview.validateFilter("[1,2,3]")).toMatch(/json object/i);
  });
});

describe("rowsToInsertSql (F15 Copy as SQL)", () => {
  const columns = ["id", "name"];
  const rows: (string | null)[][] = [
    ["1", "Ada"],
    ["2", "Linus"],
  ];

  // behavior: one INSERT per row, schema-qualified, double-quoted idents, `;`-terminated, \n-joined.
  it("should build one schema-qualified INSERT per row for a postgres preview", () => {
    const preview = queryPreview("postgres", "public");
    expect(rowsToInsertSql(preview, "users", columns, rows)).toBe(
      [
        'INSERT INTO "public"."users" ("id", "name") VALUES (\'1\', \'Ada\');',
        'INSERT INTO "public"."users" ("id", "name") VALUES (\'2\', \'Linus\');',
      ].join("\n"),
    );
  });

  // behavior: with no schema the table is not qualified but still double-quoted.
  it("should omit the schema qualifier when the postgres preview has no schema", () => {
    const preview = queryPreview("postgres", null);
    expect(rowsToInsertSql(preview, "users", columns, [["1", "Ada"]])).toBe(
      'INSERT INTO "users" ("id", "name") VALUES (\'1\', \'Ada\');',
    );
  });

  // behavior: SQLite uses the same double-quote identifier quoting as postgres.
  it("should double-quote identifiers for a sqlite preview", () => {
    const preview = queryPreview("sqlite", null);
    expect(rowsToInsertSql(preview, "users", columns, [["1", "Ada"]])).toBe(
      'INSERT INTO "users" ("id", "name") VALUES (\'1\', \'Ada\');',
    );
  });

  // AC-002 - behavior: MySQL quotes identifiers with backticks.
  it("should backtick-quote identifiers for a mysql preview", () => {
    const preview = queryPreview("mysql", null);
    expect(rowsToInsertSql(preview, "users", columns, [["1", "Ada"]])).toBe(
      "INSERT INTO `users` (`id`, `name`) VALUES ('1', 'Ada');",
    );
  });

  // behavior: columns appear in the given order in each row's value list.
  it("should preserve the column order in the VALUES list", () => {
    const preview = queryPreview("postgres", null);
    expect(
      rowsToInsertSql(preview, "t", ["b", "a"], [["2", "1"]]),
    ).toBe('INSERT INTO "t" ("b", "a") VALUES (\'2\', \'1\');');
  });

  // AC-003 - behavior: a null cell renders NULL unquoted, an embedded single quote is doubled.
  it("should render NULL unquoted and double an embedded single quote", () => {
    const preview = queryPreview("postgres", null);
    expect(
      rowsToInsertSql(preview, "users", columns, [[null, "O'Brien"]]),
    ).toBe(
      'INSERT INTO "users" ("id", "name") VALUES (NULL, \'O\'\'Brien\');',
    );
  });

  // AC-004 - behavior: a mongo preview emits db.<coll>.insertOne({ ... }) per document, \n-joined.
  it("should build a db.coll.insertOne per document for a mongodb preview", () => {
    const preview = queryPreview("mongodb", null);
    expect(
      rowsToInsertSql(preview, "orders", ["status", "total"], [
        ["paid", "99"],
        ["open", "10"],
      ]),
    ).toBe(
      [
        "db.orders.insertOne({ status: \"paid\", total: 99 });",
        "db.orders.insertOne({ status: \"open\", total: 10 });",
      ].join("\n"),
    );
  });

  // edge - behavior: an empty rows array produces an empty string.
  it("should return an empty string for no rows", () => {
    const preview = queryPreview("postgres", "public");
    expect(rowsToInsertSql(preview, "users", columns, [])).toBe("");
  });
});

describe("fkFilter (F13 FK navigation filter)", () => {
  // AC-009, TC-009 - behavior: a single column builds `"<ident>" = '<literal>'` with double-quoted
  // identifiers for postgres.
  it("should build a double-quoted equality fragment for a single postgres column", () => {
    expect(fkFilter("postgres", ["id"], ["42"])).toBe(`"id" = '42'`);
  });

  // AC-003, TC-002 - behavior: multiple referenced columns are AND-joined in order.
  it("should AND-join a composite referenced-column fragment", () => {
    expect(fkFilter("postgres", ["x", "y"], ["1", "2"])).toBe(
      `"x" = '1' AND "y" = '2'`,
    );
  });

  // AC-009, TC-009 - behavior: an embedded single quote in the value is doubled so the SQL literal
  // stays valid.
  it("should double an embedded single quote in the value", () => {
    expect(fkFilter("postgres", ["name"], ["O'Brien"])).toBe(
      `"name" = 'O''Brien'`,
    );
  });

  // AC-009, TC-009 - behavior: MySQL quotes identifiers with backticks.
  it("should backtick-quote identifiers for a mysql fragment", () => {
    expect(fkFilter("mysql", ["id"], ["42"])).toBe("`id` = '42'");
  });
});
