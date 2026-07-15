import { describe, it, expect } from "vitest";

// Pure match finder for the grid find bar. Scans every cell's text for a case-insensitive
// substring of the query, returning one {rowIndex, columnId} per match in row-major then
// column order. An empty query matches nothing; a NULL cell never matches (the "[NULL]"
// placeholder is a render-only glyph, not the cell's text).
import { findMatches } from "@/lib/workspace/grid-find";

const columns = ["id", "name", "city"];
const rows: (string | null)[][] = [
  ["1", "Ada", "Paris"],
  ["2", "Alan", "Amsterdam"],
  ["3", null, "London"],
];

describe("findMatches", () => {
  // behavior: every cell containing the query (case-insensitive) is returned (AC-005, TC-004)
  it("should return every cell whose text contains the query case-insensitively", () => {
    const matches = findMatches(columns, rows, "a");

    expect(matches).toEqual([
      { rowIndex: 0, columnId: "name" }, // Ada
      { rowIndex: 0, columnId: "city" }, // Paris
      { rowIndex: 1, columnId: "name" }, // Alan
      { rowIndex: 1, columnId: "city" }, // Amsterdam
    ]);
  });

  // behavior: matching is case-insensitive against the query (AC-005, TC-004)
  it("should match regardless of query case", () => {
    const matches = findMatches(columns, rows, "ADA");
    expect(matches).toEqual([{ rowIndex: 0, columnId: "name" }]);
  });

  // behavior: results are ordered row-major, then column order within a row (AC-005, TC-004)
  it("should return matches in row-major then column order", () => {
    const matches = findMatches(columns, rows, "am");

    // "Amsterdam" (row 1, city) comes after nothing in row 0; "London"? no. Only Amsterdam.
    expect(matches).toEqual([{ rowIndex: 1, columnId: "city" }]);
  });

  // behavior: a substring that spans multiple rows keeps document order (AC-005, TC-004)
  it("should keep document order across rows", () => {
    const matches = findMatches(columns, rows, "n");

    expect(matches).toEqual([
      { rowIndex: 1, columnId: "name" }, // Alan
      { rowIndex: 2, columnId: "city" }, // London
    ]);
  });

  // edge: an empty query matches nothing (AC-005, TC-005)
  it("should return an empty array for an empty query", () => {
    expect(findMatches(columns, rows, "")).toEqual([]);
  });

  // edge: a query matching no cell returns an empty array (AC-005, TC-005)
  it("should return an empty array when nothing matches", () => {
    expect(findMatches(columns, rows, "zzz")).toEqual([]);
  });

  // edge: a NULL cell never matches (AC-005, TC-005)
  it("should never match a NULL cell", () => {
    // Every cell of row 2 col "name" is null; searching its neighbours' text must not surface it.
    const matches = findMatches(columns, [[null, null, null]], "x");
    expect(matches).toEqual([]);
  });

  // edge: the literal "[NULL]" placeholder must NOT match a null cell (AC-005, TC-005)
  it("should not match the [NULL] placeholder against a null cell", () => {
    const matches = findMatches(["a", "b"], [[null, "keep"]], "null");
    expect(matches).toEqual([]);
  });

  // edge: a literal "[NULL]" that is the actual STRING value still matches (it is real text)
  it("should match a cell whose real text is the [NULL] string", () => {
    const matches = findMatches(["a"], [["[NULL]"]], "null");
    expect(matches).toEqual([{ rowIndex: 0, columnId: "a" }]);
  });
});
