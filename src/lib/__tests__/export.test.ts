import { describe, it, expect } from "vitest";
import { toCsv, toJson } from "@/lib/export";

describe("toCsv", () => {
  // behavior (AC-007: header row + data rows)
  it("should emit a header row followed by the data rows", () => {
    const csv = toCsv(["id", "name"], [["1", "Ada"], ["2", "Linus"]]);
    expect(csv).toBe("id,name\n1,Ada\n2,Linus");
  });

  // behavior (TC-009: a field with a comma, quote, or newline is quoted and escaped)
  it("should quote and escape fields containing commas, quotes, or newlines", () => {
    const csv = toCsv(
      ["text"],
      [['a,b'], ['say "hi"'], ["line1\nline2"]],
    );
    expect(csv).toBe('text\n"a,b"\n"say ""hi"""\n"line1\nline2"');
  });

  // behavior (TC-009: NULL serializes as an empty CSV field)
  it("should render a NULL cell as an empty field", () => {
    const csv = toCsv(["a", "b"], [["x", null]]);
    expect(csv).toBe("a,b\nx,");
  });
});

describe("toJson", () => {
  // behavior (AC-007: array of row objects keyed by column)
  it("should emit an array of row objects keyed by column", () => {
    const json = toJson(["id", "name"], [["1", "Ada"]]);
    expect(JSON.parse(json)).toEqual([{ id: "1", name: "Ada" }]);
  });

  // behavior (TC-009: NULL serializes as JSON null)
  it("should serialize a NULL cell as null", () => {
    const json = toJson(["a", "b"], [["x", null]]);
    expect(JSON.parse(json)).toEqual([{ a: "x", b: null }]);
  });
});
