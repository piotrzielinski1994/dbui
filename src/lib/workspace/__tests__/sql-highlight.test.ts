import { describe, it, expect } from "vitest";

import { highlightSql, type SqlSegment } from "@/lib/workspace/sql-highlight";

// Reassembling the segments must always reproduce the input exactly (no dropped/added chars).
function reassemble(segments: SqlSegment[]): string {
  return segments.map((segment) => segment.text).join("");
}

function kindsOf(sql: string, matcher: RegExp): SqlSegment["kind"][] {
  return highlightSql(sql)
    .filter((segment) => matcher.test(segment.text))
    .map((segment) => segment.kind);
}

describe("highlightSql", () => {
  // behavior (round-trips: the concatenated segment text equals the input for a range of statements)
  it("should reproduce the input exactly when segments are reassembled", () => {
    const inputs = [
      `INSERT INTO "public"."weird name" ("col;with;semis", "id") VALUES ('plain', 123)`,
      "SELECT * FROM users WHERE age > 30 AND name = 'O''Brien'",
      "UPDATE t SET active = true WHERE id = 42",
      "-- a comment\nSELECT 1 /* block */ FROM t",
      "",
    ];
    inputs.forEach((input) => {
      expect(reassemble(highlightSql(input))).toBe(input);
    });
  });

  // behavior (SQL keywords are classified as keyword, case-insensitively)
  it("should classify keywords as keyword regardless of case", () => {
    expect(kindsOf("select From WHERE", /^(select|From|WHERE)$/)).toEqual([
      "keyword",
      "keyword",
      "keyword",
    ]);
  });

  // behavior (a single-quoted literal is one string segment, embedded '' kept inside)
  it("should classify a single-quoted literal as string", () => {
    const segments = highlightSql("SELECT 'O''Brien'");
    const strings = segments.filter((s) => s.kind === "string");
    expect(strings).toHaveLength(1);
    expect(strings[0].text).toBe("'O''Brien'");
  });

  // behavior (a bare number is a number segment; a quoted number is a string, not a number)
  it("should classify a bare number as number and a quoted number as string", () => {
    expect(kindsOf("VALUES (123)", /^123$/)).toEqual(["number"]);
    expect(kindsOf("VALUES ('123')", /^'123'$/)).toEqual(["string"]);
  });

  // behavior (a double-quoted or backtick name is an identifier, NOT a string - so it is not
  // coloured like a string literal; this is the whole point of the request)
  it("should classify a quoted identifier as identifier", () => {
    expect(kindsOf('INSERT INTO "weird name"', /^"weird name"$/)).toEqual([
      "identifier",
    ]);
    expect(kindsOf("INSERT INTO `weird name`", /^`weird name`$/)).toEqual([
      "identifier",
    ]);
  });

  // behavior (a bare table/column word that is not a keyword is an identifier)
  it("should classify a non-keyword word as identifier", () => {
    expect(kindsOf("SELECT foo FROM bar", /^(foo|bar)$/)).toEqual([
      "identifier",
      "identifier",
    ]);
  });

  // behavior (line + block comments are comment segments)
  it("should classify line and block comments as comment", () => {
    const line = highlightSql("-- hi\nSELECT 1").filter(
      (s) => s.kind === "comment",
    );
    expect(line[0].text).toBe("-- hi");
    const block = highlightSql("SELECT /* x */ 1").filter(
      (s) => s.kind === "comment",
    );
    expect(block[0].text).toBe("/* x */");
  });

  // behavior (a semicolon inside a quoted identifier does NOT break tokenizing - the whole quoted
  // name stays one identifier segment, matching the "weird name" column in the screenshot)
  it("should keep a semicolon inside a quoted identifier in one segment", () => {
    const segments = highlightSql('"col;with;semis"');
    expect(segments).toHaveLength(1);
    expect(segments[0]).toEqual({ text: '"col;with;semis"', kind: "identifier" });
  });

  // behavior (adjacent plain characters - spaces, parens, commas - merge into one plain segment)
  it("should merge runs of plain characters", () => {
    const segments = highlightSql("a , b");
    const plains = segments.filter((s) => s.kind === "plain");
    expect(plains.some((s) => s.text === " , ")).toBe(true);
  });
});
