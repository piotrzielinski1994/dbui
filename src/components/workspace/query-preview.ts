import type { ConnectionConfig, Sort } from "@/lib/workspace/model";

type Cell = string | null;

// A per-engine strategy for the History-log "what ran" strings and the filter-row validation.
// The grid, paging, sort and Save pipeline are engine-agnostic; only these human-facing previews
// and the filter syntax differ (SQL `WHERE` expression vs MongoDB JSON find filter), so they live
// behind one strategy instead of `engine === ...` branches sprinkled through the table card.
export type QueryPreview = {
  fetch: (
    table: string,
    filter: string | undefined,
    sort: Sort | null,
    limit: number,
    offset: number,
  ) => string;
  update: (
    table: string,
    column: string,
    newValue: Cell,
    pkColumn: string,
    pkValue: Cell,
  ) => string;
  insert: (table: string, values: Record<string, Cell>) => string;
  remove: (table: string, pkColumn: string, pkValue: Cell) => string;
  // Validates the filter-row text. Returns an error message when invalid, or null when it can run.
  validateFilter: (text: string) => string | null;
  filterPlaceholder: string;
};

function quoteIdent(engine: ConnectionConfig["engine"], name: string): string {
  return engine === "mysql"
    ? `\`${name.replace(/`/g, "``")}\``
    : `"${name.replace(/"/g, '""')}"`;
}

function qualifiedIdent(
  engine: ConnectionConfig["engine"],
  schema: string | null,
  table: string,
): string {
  return schema
    ? `${quoteIdent(engine, schema)}.${quoteIdent(engine, table)}`
    : quoteIdent(engine, table);
}

function sqlLiteral(value: Cell): string {
  return value === null ? "NULL" : `'${value.replace(/'/g, "''")}'`;
}

// SQL types whose values are written as bare literals (no quotes) in the preview, so the editor
// colours them as numbers/keywords instead of strings - matching how the value is actually sent
// (a typed bind, not a quoted string). Matched as a substring of the lower-cased data type so
// `int4`, `bigint`, `numeric(10,2)`, `double precision`, `bool` all hit. Everything else (text,
// varchar, uuid, timestamp, json, ...) stays quoted, which is the correct SQL literal form.
const UNQUOTED_TYPE_PATTERNS = [
  "int",
  "serial",
  "numeric",
  "decimal",
  "real",
  "double",
  "float",
  "bool",
];

function isUnquotedType(dataType: string | undefined): boolean {
  if (!dataType) {
    return false;
  }
  const lower = dataType.toLowerCase();
  return UNQUOTED_TYPE_PATTERNS.some((pattern) => lower.includes(pattern));
}

// A boolean column's value only ever emits bare `true`/`false`/NULL; a numeric column emits its
// value verbatim ONLY when it is a well-formed number, else it falls back to a quoted literal so a
// stray/edited non-numeric value never produces invalid SQL in the preview.
function isNumericText(value: string): boolean {
  return value.trim() !== "" && Number.isFinite(Number(value));
}

// Formats a cell for the preview, quoting by the column's SQL type: numeric/boolean types emit a
// bare literal (so the editor highlights them as a number/keyword), every other type is a quoted
// string. Without a resolved type (Mongo path, or a value whose column is unknown) it falls back to
// the always-quote `sqlLiteral`, preserving the prior behaviour.
function sqlValue(
  value: Cell,
  dataType: string | undefined,
): string {
  if (value === null) {
    return "NULL";
  }
  if (!isUnquotedType(dataType)) {
    return sqlLiteral(value);
  }
  const lower = (dataType ?? "").toLowerCase();
  if (lower.includes("bool")) {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "t" || normalized === "1") {
      return "true";
    }
    if (normalized === "false" || normalized === "f" || normalized === "0") {
      return "false";
    }
    return sqlLiteral(value);
  }
  return isNumericText(value) ? value.trim() : sqlLiteral(value);
}

// Resolves a column's SQL data type by name (null/undefined = unknown -> the value is quoted). The
// table card supplies this from the fetched column metadata; the filter-only / Mongo callers omit it.
export type ColumnTypeResolver = (column: string) => string | undefined;

function sqlPreview(
  engine: ConnectionConfig["engine"],
  schema: string | null,
  resolveType: ColumnTypeResolver,
): QueryPreview {
  return {
    fetch: (table, filter, sort, limit, offset) => {
      const where = filter ? ` WHERE (${filter})` : "";
      const order = sort
        ? ` ORDER BY ${quoteIdent(engine, sort.column)}${sort.descending ? " DESC" : ""}`
        : "";
      const offsetClause = offset > 0 ? ` OFFSET ${offset}` : "";
      return `SELECT * FROM ${qualifiedIdent(engine, schema, table)}${where}${order} LIMIT ${limit}${offsetClause}`;
    },
    update: (table, column, newValue, pkColumn, pkValue) =>
      `UPDATE ${qualifiedIdent(engine, schema, table)} SET ${quoteIdent(engine, column)} = ${sqlValue(newValue, resolveType(column))} WHERE ${quoteIdent(engine, pkColumn)} = ${sqlValue(pkValue, resolveType(pkColumn))}`,
    insert: (table, values) => {
      const entries = Object.entries(values);
      const columns = entries
        .map(([column]) => quoteIdent(engine, column))
        .join(", ");
      const cells = entries
        .map(([column, value]) => sqlValue(value, resolveType(column)))
        .join(", ");
      return `INSERT INTO ${qualifiedIdent(engine, schema, table)} (${columns}) VALUES (${cells})`;
    },
    remove: (table, pkColumn, pkValue) =>
      `DELETE FROM ${qualifiedIdent(engine, schema, table)} WHERE ${quoteIdent(engine, pkColumn)} = ${sqlValue(pkValue, resolveType(pkColumn))}`,
    // The filter is wrapped as a single `WHERE (<expr>)`; a `;` would be a second statement.
    validateFilter: (text) =>
      text.includes(";")
        ? "Filter is one SQL expression - remove the semicolon"
        : null,
    filterPlaceholder: "WHERE ... (raw SQL) - Enter to run",
  };
}

// Renders a cell as a MongoDB value for the preview strings: a value that parses as JSON is shown
// as compact JSON (so `42` stays a number, `{"a":1}` a document); anything else is a quoted string
// (mirrors the backend's JSON-literal-or-string interpretation). null -> `null`.
function mongoLiteral(value: Cell): string {
  if (value === null) {
    return "null";
  }
  try {
    return JSON.stringify(JSON.parse(value));
  } catch {
    return JSON.stringify(value);
  }
}

function mongoPreview(): QueryPreview {
  const idFilter = (pkValue: Cell) => `{ _id: ${mongoLiteral(pkValue)} }`;
  return {
    fetch: (collection, filter, sort, limit, offset) => {
      const find = filter && filter.trim() ? filter.trim() : "{}";
      const sortClause = sort
        ? `.sort({ ${sort.column}: ${sort.descending ? -1 : 1} })`
        : "";
      const skipClause = offset > 0 ? `.skip(${offset})` : "";
      return `db.${collection}.find(${find})${sortClause}${skipClause}.limit(${limit})`;
    },
    update: (collection, column, newValue, _pkColumn, pkValue) =>
      `db.${collection}.updateOne(${idFilter(pkValue)}, { $set: { ${column}: ${mongoLiteral(newValue)} } })`,
    insert: (collection, values) => {
      const fields = Object.entries(values)
        .map(([key, value]) => `${key}: ${mongoLiteral(value)}`)
        .join(", ");
      return `db.${collection}.insertOne({ ${fields} })`;
    },
    remove: (collection, _pkColumn, pkValue) =>
      `db.${collection}.deleteOne(${idFilter(pkValue)})`,
    // The filter is a MongoDB find document - it must be valid JSON (empty = match all).
    validateFilter: (text) => {
      const trimmed = text.trim();
      if (trimmed === "") {
        return null;
      }
      try {
        const parsed: unknown = JSON.parse(trimmed);
        const isObject =
          typeof parsed === "object" &&
          parsed !== null &&
          !Array.isArray(parsed);
        return isObject ? null : "Filter must be a JSON object";
      } catch {
        return "Filter must be valid JSON";
      }
    },
    filterPlaceholder: '{ } find filter (JSON) - Enter to run',
  };
}

// Picks the strategy for the engine. MongoDB gets the document-shaped previews + JSON filter; every
// SQL engine shares the SQL strategy (quoting/qualification differ by engine, handled inside it).
export function queryPreview(
  engine: ConnectionConfig["engine"],
  schema: string | null,
  resolveType: ColumnTypeResolver = () => undefined,
): QueryPreview {
  return engine === "mongodb"
    ? mongoPreview()
    : sqlPreview(engine, schema, resolveType);
}

// Builds the WHERE fragment that pins a foreign-key target row: `<refCol> = <value>` per referenced
// column, AND-joined, with engine-correct identifier quoting and value escaping. Consumed by FK
// navigation as the applied filter on the referenced table.
export function fkFilter(
  engine: ConnectionConfig["engine"],
  referencedColumns: string[],
  values: Cell[],
): string {
  return referencedColumns
    .map(
      (column, index) =>
        `${quoteIdent(engine, column)} = ${sqlLiteral(values[index] ?? null)}`,
    )
    .join(" AND ");
}

// Serialises the given rows as one insert statement per row via the engine's preview strategy - a
// SQL `INSERT INTO ... VALUES (...)` for the SQL engines, a `db.<coll>.insertOne({...})` for
// MongoDB - each terminated with `;` and newline-joined. Every column is included per row (column
// order preserved). No rows -> "".
export function rowsToInsertSql(
  preview: QueryPreview,
  table: string,
  columns: string[],
  rows: Cell[][],
): string {
  return rows
    .map((row) => {
      const values = Object.fromEntries(
        columns.map((column, index) => [column, row[index] ?? null]),
      );
      return `${preview.insert(table, values)};`;
    })
    .join("\n");
}
