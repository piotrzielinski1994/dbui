import type { LogLine } from "@/lib/workspace/log-line";

const KV_FIELDS = [
  "connection_id",
  "engine",
  "kind",
  "table",
  "tables",
  "rows",
  "affected",
  "statements",
] as const;

type SearchTerm =
  | { kind: "field"; field: string; value: string }
  | { kind: "bare"; value: string };

// Split on whitespace, but a double-quoted run (which may contain spaces) glues to its token, so
// `message:"connection refused"` stays ONE token; the quotes are stripped later by stripQuotes.
function tokenize(query: string): string[] {
  return query.match(/(?:"[^"]*"|[^\s"])+/g) ?? [];
}

function isKnownField(field: string): boolean {
  return (
    field === "level" ||
    field === "message" ||
    KV_FIELDS.some((f) => f === field)
  );
}

// A `field:value` token with a known field becomes a field term (a leading quote before the colon,
// or an unknown field, falls back to a bare term matched on raw).
function parseToken(token: string): SearchTerm {
  const colon = token.indexOf(":");
  if (colon > 0) {
    const field = token.slice(0, colon).toLowerCase();
    if (isKnownField(field)) {
      return {
        kind: "field",
        field,
        value: stripQuotes(token.slice(colon + 1)),
      };
    }
  }
  return { kind: "bare", value: token };
}

function stripQuotes(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
}

function fieldValue(line: LogLine, field: string): string {
  if (field === "level") {
    return line.level;
  }
  if (field === "message") {
    return line.message;
  }
  return line.kv[field] ?? "";
}

function matches(line: LogLine, term: SearchTerm): boolean {
  const haystack =
    term.kind === "field" ? fieldValue(line, term.field) : line.raw;
  return haystack.toLowerCase().includes(term.value.toLowerCase());
}

export function filterLogLines(lines: LogLine[], query: string): LogLine[] {
  const terms = tokenize(query).map(parseToken);
  if (terms.length === 0) {
    return lines;
  }
  return lines.filter((line) => terms.every((term) => matches(line, term)));
}

// One run of the search text for the highlight overlay, tagged by role so the input can color it
// like the log lines: `key` = ANY `key:` prefix incl. its colon (a typing affordance, not a
// validity signal - not restricted to known filter fields), `value` = the text after that colon,
// `plain` = a bare term / whitespace. Concatenating the `text` of all segments reproduces the query
// verbatim (the overlay aligns 1:1 with the input).
export type HighlightSegment = { text: string; kind: "key" | "value" | "plain" };

export function highlightLogSearch(query: string): HighlightSegment[] {
  if (query === "") {
    return [];
  }
  // Split KEEPING whitespace (captured group) so the overlay preserves every space.
  const parts = query.split(/(\s+)/);
  const segments: HighlightSegment[] = [];
  for (const part of parts) {
    if (part === "") {
      continue;
    }
    const colon = part.indexOf(":");
    if (colon > 0) {
      segments.push({ text: part.slice(0, colon + 1), kind: "key" });
      const rest = part.slice(colon + 1);
      if (rest !== "") {
        segments.push({ text: rest, kind: "value" });
      }
      continue;
    }
    segments.push({ text: part, kind: "plain" });
  }
  return segments;
}
