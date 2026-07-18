import { describe, it, expect } from "vitest";
import {
  exportExtension,
  exportFileName,
  exportFilters,
} from "@/lib/export-file";

// A fixed local-time instant so the stamp is deterministic WITHOUT stubbing global time.
// July is month index 6; minute 01 and month 07 exercise the zero-padding.
const FIXED = new Date(2026, 6, 18, 23, 1, 31);
const STAMP = "20260718-230131";

describe("exportExtension", () => {
  // behavior (TC-007): each format maps to its lowercase file extension.
  it("should map CSV to csv and JSON to json", () => {
    expect(exportExtension("CSV")).toBe("csv");
    expect(exportExtension("JSON")).toBe("json");
  });
});

describe("exportFileName", () => {
  // behavior (TC-007, AC-006): a table base + CSV -> `<base>-<YYYYMMDD-HHmmss>.csv`.
  it("should build a CSV filename from the base and a zero-padded local stamp", () => {
    expect(exportFileName("users", "CSV", FIXED)).toBe(`users-${STAMP}.csv`);
  });

  // behavior (TC-007, AC-006): the JSON format swaps only the extension.
  it("should build a JSON filename with the json extension", () => {
    expect(exportFileName("users", "JSON", FIXED)).toBe(`users-${STAMP}.json`);
  });

  // behavior (TC-007, AC-007): the SQL result grid passes the caller default base "results".
  it("should honour a results base for the SQL result grid", () => {
    expect(exportFileName("results", "CSV", FIXED)).toBe(`results-${STAMP}.csv`);
  });
});

describe("exportFilters", () => {
  // behavior (TC-008, AC-006): JSON -> a JSON filter then an All-files fallback.
  it("should return a JSON filter followed by All files", () => {
    expect(exportFilters("JSON")).toEqual([
      { name: "JSON", extensions: ["json"] },
      { name: "All files", extensions: ["*"] },
    ]);
  });

  // behavior (TC-008, AC-006): CSV -> a CSV filter then an All-files fallback.
  it("should return a CSV filter followed by All files", () => {
    expect(exportFilters("CSV")).toEqual([
      { name: "CSV", extensions: ["csv"] },
      { name: "All files", extensions: ["*"] },
    ]);
  });
});
