import { describe, it, expect } from "vitest";

// F18 - pure structured search over parsed LogLines. Tokenizes a `field:value` / bare query
// (double-quotes allow spaces in a value), matches case-insensitive substring per field, AND-combined.
// Nothing exists yet - the import fails until log-search.ts ships, so each test fails on the
// missing feature, not a typo.
import { filterLogLines } from "@/lib/workspace/log-search";
import { parseLogLine } from "@/lib/workspace/log-line";

// A small fixture spanning the shapes/levels the filter must discriminate.
const connectOk = parseLogLine(
  "[2026-07-10T12:34:56Z][INFO] connect connection_id=db1 engine=postgres tables=12 (34ms)",
  3,
);
const connectErr = parseLogLine(
  "[2026-07-10T12:34:56Z][ERROR] connect connection_id=db1 engine=mysql failed (40ms): connection refused",
  5,
);
const queryPgOk = parseLogLine(
  "[2026-07-10T12:34:56Z][INFO] query kind=sql connection_id=db2 engine=postgres statements=3 rows=150 (42ms)",
  3,
);
const queryMongoErr = parseLogLine(
  "[2026-07-10T12:34:56Z][ERROR] query kind=mongo connection_id=db3 failed (5ms): bad filter",
  5,
);
const slowWarn = parseLogLine(
  "[2026-07-10T12:34:56Z][WARN] query kind=sql connection_id=db2 engine=mysql rows=0 (5200ms)",
  4,
);

const lines = [connectOk, connectErr, queryPgOk, queryMongoErr, slowWarn];

describe("filterLogLines - field tokens (AC-05)", () => {
  // AC-05 - behavior: level:warn returns only the warn line.
  it("should return only warn lines for level:warn", () => {
    expect(filterLogLines(lines, "level:warn")).toEqual([slowWarn]);
  });

  // AC-05 - behavior: level:error returns only the two error lines.
  it("should return only error lines for level:error", () => {
    expect(filterLogLines(lines, "level:error")).toEqual([
      connectErr,
      queryMongoErr,
    ]);
  });

  // AC-05 - behavior: kind:query matches the kv `kind` (substring) - the query lines only.
  it("should return only query lines for kind:query", () => {
    // kind kv is "sql"/"mongo"; a `kind:query` token substring-matches neither, so use the
    // literal kv value to prove field matching.
    expect(filterLogLines(lines, "kind:mongo")).toEqual([queryMongoErr]);
    expect(filterLogLines(lines, "kind:sql")).toEqual([queryPgOk, slowWarn]);
  });

  // AC-05 - behavior: connection_id:db1 matches lines whose connection_id kv CONTAINS db1 (substring), not exact.
  it("should match connection_id kv by case-insensitive substring", () => {
    expect(filterLogLines(lines, "connection_id:db1")).toEqual([
      connectOk,
      connectErr,
    ]);
    expect(filterLogLines(lines, "connection_id:DB1")).toEqual([
      connectOk,
      connectErr,
    ]);
    // "db" is a substring of every connection_id, so all lines match.
    expect(filterLogLines(lines, "connection_id:db")).toEqual(lines);
  });
});

describe("filterLogLines - quoted message term (AC-06)", () => {
  // AC-06 - behavior: message:"connection refused" (quoted, has a space) matches the error-tail
  // text that lives in `message`, returning only the failing connect line.
  it("should match a quoted message term against the error tail in message", () => {
    expect(filterLogLines(lines, 'message:"connection refused"')).toEqual([
      connectErr,
    ]);
  });

  // AC-06 - behavior: the message field is matched, not kv - a kv-only value does not leak into
  // a message search unless it is literally in the message string (it is, e.g. "connection_id=db1").
  it("should not match a quoted message term that appears nowhere in message", () => {
    expect(filterLogLines(lines, 'message:"totally absent phrase"')).toEqual([]);
  });
});

describe("filterLogLines - combining and empties (AC-07)", () => {
  // AC-07 - behavior: two field tokens are AND-combined - only the Postgres SQL query line matches
  // both kind:sql AND engine:postgres.
  it("should AND-combine multiple field tokens", () => {
    expect(filterLogLines(lines, "kind:sql engine:postgres")).toEqual([
      queryPgOk,
    ]);
  });

  // AC-07 - behavior: AND of a field token and a bare term.
  it("should AND-combine a field token with a bare term", () => {
    expect(filterLogLines(lines, "kind:sql mysql")).toEqual([slowWarn]);
  });

  // AC-07 - behavior: an empty query returns every line.
  it("should return all lines for an empty query", () => {
    expect(filterLogLines(lines, "")).toEqual(lines);
  });

  // AC-07 - behavior: a whitespace-only query returns every line.
  it("should return all lines for a whitespace-only query", () => {
    expect(filterLogLines(lines, "   ")).toEqual(lines);
  });
});

describe("filterLogLines - bare terms and unknown fields (AC-08)", () => {
  // AC-08 - behavior: a bare term is a case-insensitive substring match on the whole raw line.
  it("should match a bare term as a case-insensitive substring of raw", () => {
    expect(filterLogLines(lines, "refused")).toEqual([connectErr]);
    expect(filterLogLines(lines, "POSTGRES")).toEqual([connectOk, queryPgOk]);
  });

  // AC-08 - behavior: an unknown field prefix makes the WHOLE token a bare term matched on raw
  // (so `foo:bar` looks for the literal substring "foo:bar", found nowhere here).
  it("should treat an unknown field prefix as a bare term on raw", () => {
    expect(filterLogLines(lines, "foo:bar")).toEqual([]);
    // The literal `kind=sql` text lives in raw, so a bare term finds it even though `kind` is a
    // known FIELD - an unknown-field example proving the bare fallback searches raw.
    expect(filterLogLines(lines, "nope:whatever")).toEqual([]);
  });

  // AC-08 - behavior: matching is case-insensitive for a field value too.
  it("should match a field value case-insensitively", () => {
    expect(filterLogLines(lines, "engine:POSTGRES")).toEqual([
      connectOk,
      queryPgOk,
    ]);
  });
});
