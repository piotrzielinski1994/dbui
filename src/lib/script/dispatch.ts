// The write-shaped statement keywords the read-only script guard rejects. A `db.query` whose first
// keyword (after stripping leading comments + whitespace) is one of these is blocked on the bridge -
// the statement never reaches the backend. Prefix-only, documented best-effort (misses `WITH ...
// DELETE` and `;`-chained writes); reads are the intended use of a script.
export const WRITE_KEYWORDS = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "DROP",
  "ALTER",
  "CREATE",
  "TRUNCATE",
  "REPLACE",
  "MERGE",
  "GRANT",
  "REVOKE",
] as const;

// Removes leading whitespace and leading line (`-- ...`) / block (`/* ... */`) comments, repeatedly,
// so the first real token surfaces. Only strips from the FRONT - a trailing comment (`select 1 --
// update`) is untouched, keeping the guard prefix-only.
function stripLeading(sql: string): string {
  let rest = sql;
  for (;;) {
    const trimmed = rest.replace(/^\s+/, "");
    if (trimmed.startsWith("--")) {
      const newline = trimmed.indexOf("\n");
      rest = newline === -1 ? "" : trimmed.slice(newline + 1);
      continue;
    }
    if (trimmed.startsWith("/*")) {
      const end = trimmed.indexOf("*/");
      rest = end === -1 ? "" : trimmed.slice(end + 2);
      continue;
    }
    return trimmed;
  }
}

// True when the statement's leading keyword is a write. Used by the ScriptHost to reject a
// write-shaped `db.query` before it reaches `executeSql` (read-only scripts).
export function isWriteSql(sql: string): boolean {
  const leading = stripLeading(sql);
  const match = leading.match(/^([A-Za-z]+)/);
  if (!match) {
    return false;
  }
  const keyword = match[1].toUpperCase();
  return WRITE_KEYWORDS.some((write) => write === keyword);
}

// The MongoDB Query-tab operations that mutate a collection. A `db.<coll>.<op>(...)` command whose
// op is one of these is a write - rejected on a read-only connection (F11). find/aggregate are the
// only reads, so anything in this set is the write half of the same self-contained command grammar.
export const MONGO_WRITE_OPS = [
  "insertOne",
  "insertMany",
  "updateOne",
  "updateMany",
  "deleteOne",
  "deleteMany",
  "replaceOne",
  "findOneAndUpdate",
  "findOneAndReplace",
  "findOneAndDelete",
  "bulkWrite",
  "remove",
  "save",
  "drop",
] as const;

// True when a Mongo Query-tab command is a write: matches the `.op(` after the `db.<coll>.` prefix
// against MONGO_WRITE_OPS. Prefix/leading-command best-effort (same spirit as isWriteSql) - it reads
// the FIRST command's op; a read-led multi-command buffer chaining a write is a documented gap.
export function isWriteMongo(command: string): boolean {
  const leading = stripLeading(command);
  // Grab the method name in `db.<collection>.<method>(` - the collection may be quoted (dots/dashes).
  const match = leading.match(/^db\.(?:"[^"]*"|'[^']*'|[^.(]+)\.([A-Za-z]+)\s*\(/);
  if (!match) {
    return false;
  }
  return MONGO_WRITE_OPS.some((op) => op === match[1]);
}
