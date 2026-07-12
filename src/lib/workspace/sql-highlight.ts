// A tiny SQL tokenizer for READ-ONLY display highlighting (History log, Changes list, the manual-
// commit Commit modal - everywhere a stored SQL string is shown). It is NOT a parser: it splits a
// string into coarse coloured segments (keyword / string / number / comment / identifier / plain)
// cheaply so a long list of statements renders as spans, without mounting a CodeMirror per row.
// Engine-agnostic: it handles single-quoted strings, double-quoted + backtick identifiers, `--` and
// `/* */` comments, numbers, and a shared keyword set (dialect keyword differences don't matter for
// colouring). Anything it doesn't recognise stays `plain`, so it never throws or drops characters.

export type SqlSegmentKind =
  | "keyword"
  | "string"
  | "number"
  | "comment"
  | "identifier"
  | "plain";

export type SqlSegment = { text: string; kind: SqlSegmentKind };

// Common SQL keywords + the literal keywords (NULL/TRUE/FALSE) coloured like keywords. Matched
// case-insensitively against a whole word. A curated set (not a full dialect dump) - an unknown word
// simply renders as an identifier, which is the correct fallback for table/column names.
const KEYWORDS = new Set(
  [
    "select", "from", "where", "and", "or", "not", "null", "is", "in", "like",
    "between", "exists", "as", "distinct", "order", "by", "group", "having",
    "limit", "offset", "asc", "desc", "join", "inner", "left", "right", "full",
    "outer", "cross", "on", "using", "union", "all", "intersect", "except",
    "insert", "into", "values", "update", "set", "delete", "returning",
    "create", "alter", "drop", "truncate", "table", "view", "index", "column",
    "add", "rename", "to", "case", "when", "then", "else", "end", "cast",
    "true", "false", "begin", "commit", "rollback", "savepoint", "release",
    "with", "primary", "key", "foreign", "references", "constraint", "unique",
    "default", "check", "if", "exists",
  ],
);

const WORD_START = /[A-Za-z_]/;
const WORD_PART = /[A-Za-z0-9_$]/;
const DIGIT = /[0-9]/;

// Scans `sql` into coloured segments. A single left-to-right pass with a tiny lexer state; adjacent
// same-kind runs (e.g. whitespace + punctuation) are emitted as separate `plain` chars but merged at
// the end so the span count stays small.
export function highlightSql(sql: string): SqlSegment[] {
  const segments: SqlSegment[] = [];
  const chars = [...sql];
  const length = chars.length;
  let index = 0;

  const push = (text: string, kind: SqlSegmentKind) => {
    segments.push({ text, kind });
  };

  while (index < length) {
    const char = chars[index];
    const next = chars[index + 1];

    // Line comment: -- to end of line.
    if (char === "-" && next === "-") {
      let end = index;
      while (end < length && chars[end] !== "\n") {
        end += 1;
      }
      push(chars.slice(index, end).join(""), "comment");
      index = end;
      continue;
    }

    // Block comment: /* ... */ (unterminated runs to end of input).
    if (char === "/" && next === "*") {
      let end = index + 2;
      while (end < length && !(chars[end] === "*" && chars[end + 1] === "/")) {
        end += 1;
      }
      end = Math.min(end + 2, length);
      push(chars.slice(index, end).join(""), "comment");
      index = end;
      continue;
    }

    // Single-quoted string literal; '' is an escaped quote, not a terminator.
    if (char === "'") {
      let end = index + 1;
      while (end < length) {
        if (chars[end] === "'" && chars[end + 1] === "'") {
          end += 2;
          continue;
        }
        if (chars[end] === "'") {
          end += 1;
          break;
        }
        end += 1;
      }
      push(chars.slice(index, end).join(""), "string");
      index = end;
      continue;
    }

    // Quoted identifier: "..." (Postgres/SQLite) or `...` (MySQL). "" / `` are escaped quotes.
    if (char === '"' || char === "`") {
      let end = index + 1;
      while (end < length) {
        if (chars[end] === char && chars[end + 1] === char) {
          end += 2;
          continue;
        }
        if (chars[end] === char) {
          end += 1;
          break;
        }
        end += 1;
      }
      push(chars.slice(index, end).join(""), "identifier");
      index = end;
      continue;
    }

    // Number: an integer or decimal run. A leading `-`/`+` is left as plain (it's an operator).
    if (DIGIT.test(char)) {
      let end = index;
      while (end < length && (DIGIT.test(chars[end]) || chars[end] === ".")) {
        end += 1;
      }
      push(chars.slice(index, end).join(""), "number");
      index = end;
      continue;
    }

    // Word: keyword (case-insensitive) or a bare identifier.
    if (WORD_START.test(char)) {
      let end = index;
      while (end < length && WORD_PART.test(chars[end])) {
        end += 1;
      }
      const word = chars.slice(index, end).join("");
      push(word, KEYWORDS.has(word.toLowerCase()) ? "keyword" : "identifier");
      index = end;
      continue;
    }

    // Anything else (whitespace, punctuation, operators) is plain.
    push(char, "plain");
    index += 1;
  }

  return mergeAdjacent(segments);
}

// Collapses consecutive same-kind segments into one, so a run of plain chars (spaces, commas,
// parens) becomes a single span instead of one per char.
function mergeAdjacent(segments: SqlSegment[]): SqlSegment[] {
  return segments.reduce<SqlSegment[]>((merged, segment) => {
    const last = merged[merged.length - 1];
    if (last && last.kind === segment.kind) {
      last.text += segment.text;
      return merged;
    }
    merged.push({ ...segment });
    return merged;
  }, []);
}
