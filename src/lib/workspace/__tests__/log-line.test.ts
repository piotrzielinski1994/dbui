import { describe, it, expect } from "vitest";

// F18 - pure parser for the Session Logs tab. Turns a pre-formatted plugin message
// (`[ts][LEVEL] msg`) + an optional numeric plugin level into a structured LogLine.
// Nothing exists yet - the import fails until log-line.ts ships, so each test fails on
// the missing feature, not a typo.
import { parseLogLine } from "@/lib/workspace/log-line";

// The six formatter shapes the backend emits (connect ok/err, disconnect, query ok/err, mutations),
// exactly as tauri-plugin-log delivers them in the `message` field.
const CONNECT_OK =
  "[2026-07-10T12:34:56Z][INFO] connect connection_id=db1 engine=postgres tables=12 (34ms)";
const CONNECT_ERR =
  "[2026-07-10T12:34:56Z][ERROR] connect connection_id=db1 engine=mysql failed (40ms): connection refused";
const DISCONNECT = "[2026-07-10T12:34:56Z][INFO] disconnect connection_id=db1";
const QUERY_OK =
  "[2026-07-10T12:34:56Z][INFO] query kind=sql connection_id=db1 statements=3 rows=150 (42ms)";
const QUERY_ERR =
  "[2026-07-10T12:34:56Z][ERROR] query kind=mongo connection_id=db1 failed (5ms): bad filter";
const MUTATIONS =
  "[2026-07-10T12:34:56Z][INFO] mutations connection_id=db1 table=public.users affected=4 (7ms)";

const TS = "2026-07-10T12:34:56Z";

describe("parseLogLine - formatter shapes (AC-03)", () => {
  // AC-03 - behavior: a successful connect line splits into timestamp/level/message + kv, and
  // the trailing `(34ms)` timing (no `=`) is NOT captured as kv.
  it("should parse a connect-ok line into timestamp, info level, message and kv", () => {
    const line = parseLogLine(CONNECT_OK, 3);

    expect(line.raw).toBe(CONNECT_OK);
    expect(line.timestamp).toBe(TS);
    expect(line.level).toBe("info");
    expect(line.message).toBe("connect connection_id=db1 engine=postgres tables=12 (34ms)");
    expect(line.kv).toEqual({ connection_id: "db1", engine: "postgres", tables: "12" });
  });

  // AC-03 - behavior: a connect-error line is error level; the space-bearing error tail
  // (`failed (40ms): connection refused`) stays in message and is NOT captured into kv.
  it("should parse a connect-error line and keep the error tail in message, not kv", () => {
    const line = parseLogLine(CONNECT_ERR, 5);

    expect(line.timestamp).toBe(TS);
    expect(line.level).toBe("error");
    expect(line.message).toBe(
      "connect connection_id=db1 engine=mysql failed (40ms): connection refused",
    );
    expect(line.message).toContain("connection refused");
    expect(line.kv).toEqual({ connection_id: "db1", engine: "mysql" });
    expect(line.kv).not.toHaveProperty("connection");
    expect(line.kv).not.toHaveProperty("refused");
  });

  // AC-03 - behavior: a disconnect line carries a single id kv.
  it("should parse a disconnect line with an id kv", () => {
    const line = parseLogLine(DISCONNECT, 3);

    expect(line.level).toBe("info");
    expect(line.message).toBe("disconnect connection_id=db1");
    expect(line.kv).toEqual({ connection_id: "db1" });
  });

  // AC-03 - behavior: a query-ok line captures kind/id/statements/rows kv, timing dropped.
  it("should parse a query-ok line into kind/id/statements/rows kv", () => {
    const line = parseLogLine(QUERY_OK, 3);

    expect(line.level).toBe("info");
    expect(line.message).toBe("query kind=sql connection_id=db1 statements=3 rows=150 (42ms)");
    expect(line.kv).toEqual({
      kind: "sql",
      connection_id: "db1",
      statements: "3",
      rows: "150",
    });
  });

  // AC-03 - behavior: a query-error line is error level; the `bad filter` tail stays in message.
  it("should parse a query-error line and keep the failure tail in message, not kv", () => {
    const line = parseLogLine(QUERY_ERR, 5);

    expect(line.level).toBe("error");
    expect(line.message).toBe("query kind=mongo connection_id=db1 failed (5ms): bad filter");
    expect(line.message).toContain("bad filter");
    expect(line.kv).toEqual({ kind: "mongo", connection_id: "db1" });
    expect(line.kv).not.toHaveProperty("filter");
  });

  // AC-03 - behavior: a mutations line captures id/table/affected; a dotted table value is one token.
  it("should parse a mutations line into id/table/affected kv", () => {
    const line = parseLogLine(MUTATIONS, 3);

    expect(line.level).toBe("info");
    expect(line.message).toBe("mutations connection_id=db1 table=public.users affected=4 (7ms)");
    expect(line.kv).toEqual({
      connection_id: "db1",
      table: "public.users",
      affected: "4",
    });
  });
});

describe("parseLogLine - unparseable fallback (AC-03)", () => {
  // AC-03 - behavior: a line not matching the `[ts][LEVEL] msg` shape falls back to an info line
  // whose message is the raw text, empty timestamp, empty kv.
  it("should fall back to an info line with raw message and empty kv when the shape does not match", () => {
    const raw = "some line that does not match the shape at all";
    const line = parseLogLine(raw);

    expect(line).toEqual({
      raw,
      timestamp: "",
      level: "info",
      message: raw,
      kv: {},
    });
  });

  // AC-03 - side-effect-contract: the parser NEVER throws, on any input.
  it("should never throw on empty or malformed input", () => {
    expect(() => parseLogLine("")).not.toThrow();
    expect(() => parseLogLine("[unterminated bracket")).not.toThrow();
    expect(() => parseLogLine("][")).not.toThrow();

    const empty = parseLogLine("");
    expect(empty.level).toBe("info");
    expect(empty.timestamp).toBe("");
    expect(empty.kv).toEqual({});
  });
});

describe("parseLogLine - level source precedence (AC-04)", () => {
  // AC-04 - behavior: the numeric plugin level wins over the [LEVEL] token (INFO token + numeric 5
  // -> error).
  it("should take the level from the numeric plugin level over the token", () => {
    expect(parseLogLine(CONNECT_OK, 5).level).toBe("error");
  });

  // AC-04 - behavior: with no numeric level, the [LEVEL] token is used.
  it("should take the level from the [LEVEL] token when no numeric level is given", () => {
    expect(parseLogLine(CONNECT_ERR).level).toBe("error");
    expect(
      parseLogLine("[2026-07-10T12:34:56Z][WARN] slow query connection_id=db2 (5200ms)").level,
    ).toBe("warn");
  });

  // AC-04 - behavior: the full numeric mapping 1=trace,2=debug,3=info,4=warn,5=error.
  it("should map each numeric plugin level to its LogLevel", () => {
    const base = "[2026-07-10T12:34:56Z][INFO] disconnect connection_id=db1";
    expect(parseLogLine(base, 1).level).toBe("trace");
    expect(parseLogLine(base, 2).level).toBe("debug");
    expect(parseLogLine(base, 3).level).toBe("info");
    expect(parseLogLine(base, 4).level).toBe("warn");
    expect(parseLogLine(base, 5).level).toBe("error");
  });
});
