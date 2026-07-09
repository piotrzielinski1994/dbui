import { useMemo } from "react";
import CodeMirror, { type BasicSetupOptions } from "@uiw/react-codemirror";
import { EditorView, keymap, placeholder as cmPlaceholder } from "@codemirror/view";
import {
  EditorState,
  Prec,
  type Extension,
  type Transaction,
} from "@codemirror/state";
import {
  PostgreSQL,
  MySQL,
  SQLite,
  schemaCompletionSource,
} from "@codemirror/lang-sql";
import { json as jsonLanguage } from "@codemirror/lang-json";
import {
  LanguageSupport,
  syntaxHighlighting,
} from "@codemirror/language";
import {
  completeFromList,
  type CompletionContext,
  type CompletionSource,
} from "@codemirror/autocomplete";
import { classHighlighter } from "@lezer/highlight";
import {
  makeSqlChrome,
  makeSqlHighlight,
  type EditorColors,
} from "@/components/workspace/sql-editor-theme";
import { useThemeOptional } from "@/lib/theme/theme-context";
import { applyDefaults } from "@/lib/theme/overrides";
import { DEFAULT_THEME_COLORS } from "@/lib/theme/theme-defaults";
import { useSettingsOptional } from "@/lib/settings/settings-context";
import { DEFAULT_SETTINGS } from "@/lib/settings/settings";
import { resolveShortcuts } from "@/lib/shortcuts/resolve";
import { toCodeMirrorKey } from "@/lib/shortcuts/to-codemirror-key";
import type { DbEngine, TableSchema } from "@/lib/workspace/model";

const dialects = {
  postgres: PostgreSQL,
  mysql: MySQL,
  sqlite: SQLite,
} as const;

// Curated set of common SQL keywords. lang-sql's built-in keyword source dumps the dialect's
// FULL reserved+non-reserved word list (`scale`, `scope`, `schemas`, `savepoint`, ...), which is
// noise; this is the relevant subset. Fuzzy matching is case-insensitive, so typing `sel` still
// finds SELECT.
const SQL_KEYWORDS = [
  "SELECT", "FROM", "WHERE", "AND", "OR", "NOT", "NULL", "IS", "IN", "LIKE",
  "BETWEEN", "EXISTS", "AS", "DISTINCT", "ORDER BY", "GROUP BY", "HAVING",
  "LIMIT", "OFFSET", "ASC", "DESC", "JOIN", "INNER JOIN", "LEFT JOIN",
  "RIGHT JOIN", "FULL JOIN", "ON", "USING", "UNION", "UNION ALL", "INTERSECT",
  "EXCEPT", "INSERT INTO", "VALUES", "UPDATE", "SET", "DELETE FROM", "RETURNING",
  "CREATE TABLE", "ALTER TABLE", "DROP TABLE", "TRUNCATE", "CASE", "WHEN",
  "THEN", "ELSE", "END", "COUNT", "SUM", "AVG", "MIN", "MAX", "COALESCE",
  "CAST", "TRUE", "FALSE", "WITH", "INTO",
];

// Keyword completions, suppressed in a qualified-column context (after `table.`) so column names
// from the schema are the only suggestions there.
const completeKeywords = completeFromList(
  SQL_KEYWORDS.map((label) => ({ label, type: "keyword" })),
);
function keywordSource(context: CompletionContext) {
  if (context.matchBefore(/\.\w*$/)) {
    return null;
  }
  return completeKeywords(context);
}

// Tables referenced by a FROM/JOIN/UPDATE/INTO clause in the buffer, as written (`orders`,
// `public.orders`). lang-sql only completes columns AFTER a `table.` qualifier; this lets us also
// offer the in-scope tables' columns for a BARE identifier (e.g. `WHERE id` -> `id`).
function referencedTables(sql: string): string[] {
  const matches = sql.matchAll(
    /\b(?:from|join|update|into)\s+("[^"]+"|`[^`]+`|[\w$]+(?:\.(?:"[^"]+"|`[^`]+`|[\w$]+))?)/gi,
  );
  const unquote = (part: string) => part.replace(/^["`]|["`]$/g, "");
  return [...matches].map((match) =>
    match[1].split(".").map(unquote).join("."),
  );
}

// Columns of every table the current statement pulls FROM, offered for a bare identifier. A
// reference resolves by qualified `schema.table` first, else by bare table name (any schema). Off
// in a qualified context (`table.` is lang-sql's job) and when nothing is in scope.
function columnsInScopeSource(schema: TableSchema[]): CompletionSource {
  return (context) => {
    if (context.matchBefore(/\.\w*$/)) {
      return null;
    }
    const word = context.matchBefore(/[\w$]+/);
    if (!word && !context.explicit) {
      return null;
    }
    const refs = referencedTables(context.state.doc.toString());
    if (refs.length === 0) {
      return null;
    }
    const seen = new Set<string>();
    const options = refs
      .flatMap((ref) => {
        const [maybeSchema, maybeTable] = ref.split(".");
        const table = maybeTable
          ? schema.find((t) => t.schema === maybeSchema && t.name === maybeTable)
          : schema.find((t) => t.name === ref);
        return table?.columns ?? [];
      })
      .filter((column) => !seen.has(column.name) && seen.add(column.name))
      .map((column) => ({ label: column.name, type: "property" }));
    if (options.length === 0) {
      return null;
    }
    return {
      from: word ? word.from : context.pos,
      options,
      validFor: /^[\w$]*$/,
    };
  };
}

// The shape lang-sql's `schemaCompletionSource` consumes: a flat map (table -> columns) for
// engines with no schema level, or a nested map (schema -> table -> columns) for Postgres so
// qualified `schema.table` completion works and same-named tables across schemas don't collide.
type SqlNamespace = Record<string, string[] | Record<string, string[]>>;

// MongoDB Query-tab completion: after `db.` offer the connected collection names; after
// `db.<collection>.` offer the read ops find/aggregate; INSIDE a find/aggregate body, just after a
// `"` that opens a field key, offer that collection's sampled field names (from the schema). Field
// VALUES / Mongo operators are not completed.
function mongoCommandSource(
  collections: string[],
  schema: TableSchema[],
  defaultCollection?: string,
): CompletionSource {
  return (context) => {
    const beforeCursor = context.state.sliceDoc(0, context.pos);
    const afterCollection = beforeCursor.match(/db\.[\w$-]+\.(\w*)$/);
    if (afterCollection) {
      const word = context.matchBefore(/\w*$/);
      return {
        from: word ? word.from : context.pos,
        // Reads first, then the write ops the Query tab now runs (find/aggregate + insert/update/
        // delete/replace) - blocked on a read-only connection but always offered.
        options: [
          { label: "find", type: "method" },
          { label: "aggregate", type: "method" },
          { label: "insertOne", type: "method" },
          { label: "insertMany", type: "method" },
          { label: "updateOne", type: "method" },
          { label: "updateMany", type: "method" },
          { label: "deleteOne", type: "method" },
          { label: "deleteMany", type: "method" },
          { label: "replaceOne", type: "method" },
        ],
        validFor: /^\w*$/,
      };
    }
    const afterDb = beforeCursor.match(/db\.([\w$-]*)$/);
    if (afterDb) {
      const word = context.matchBefore(/[\w$-]*$/);
      return {
        from: word ? word.from : context.pos,
        options: collections.map((name) => ({ label: name, type: "class" })),
        validFor: /^[\w$-]*$/,
      };
    }
    // After a quote opening a field key, offer the collection's fields. In the Query tab the
    // collection is the `db.<coll>.find|aggregate` in the buffer; in the filter row (a bare find
    // document, no such prefix) it is the `defaultCollection` the card scopes to. The trailing `"`
    // (no closing quote yet) marks a key position.
    const fieldKey = beforeCursor.match(/"[\w$.]*$/);
    if (fieldKey) {
      const command = beforeCursor.match(
        /db\.([\w$-]+)\.(?:find|aggregate|insertOne|insertMany|updateOne|updateMany|deleteOne|deleteMany|replaceOne)\b/,
      );
      const collectionName = command?.[1] ?? defaultCollection;
      const table = schema.find((entry) => entry.name === collectionName);
      if (!table) {
        return null;
      }
      const word = context.matchBefore(/[\w$.]*$/);
      return {
        from: word ? word.from : context.pos,
        options: table.columns.map((column) => ({
          label: column.name,
          type: "property",
        })),
        validFor: /^[\w$.]*$/,
      };
    }
    return null;
  };
}

// Builds SQL language support whose ONLY completions are schema tables/columns + curated keywords -
// nothing from the dialect's full keyword dump. When `defaultTable` is set (the filter row, which
// is a WHERE on ONE table), completion is scoped to that table's columns + keywords - no other
// table names, which would be irrelevant noise in a single-table filter.
function buildSqlLanguage(
  engine: DbEngine,
  schema: TableSchema[],
  namespace: SqlNamespace,
  defaultTableColumns: string[] | undefined,
  defaultSchema: string | undefined,
  collections: string[],
  defaultTable: string | undefined,
) {
  // MongoDB has no SQL: the filter row + Query tab edit JSON (a find document / aggregation
  // pipeline). Use the JSON language for highlighting + a command-skeleton completion source
  // (collection names after `db.`, find/aggregate after `db.<coll>.`, and field names after a
  // key-opening `"` - scoped to the command's collection in the Query tab, or `defaultTable` in the
  // filter row's bare find document).
  if (engine === "mongodb") {
    const json = jsonLanguage();
    return new LanguageSupport(json.language, [
      json.support,
      json.language.data.of({
        autocomplete: mongoCommandSource(collections, schema, defaultTable),
      }),
    ]);
  }
  const dialect = dialects[engine];
  // The filter row is a WHERE on one table - complete only its columns. The full editor offers
  // schema/table names (lang-sql) PLUS the columns of whatever tables the statement is FROM-ing
  // (our source), so a bare `id` after `from orders where` completes without a `orders.` prefix.
  const autocompletes: CompletionSource[] = defaultTableColumns
    ? [
        completeFromList(
          defaultTableColumns.map((label) => ({ label, type: "property" })),
        ),
      ]
    : [
        schemaCompletionSource({ dialect, schema: namespace, defaultSchema }),
        columnsInScopeSource(schema),
      ];
  return new LanguageSupport(dialect.language, [
    ...autocompletes.map((autocomplete) =>
      dialect.language.data.of({ autocomplete }),
    ),
    dialect.language.data.of({ autocomplete: keywordSource }),
  ]);
}

// Folds the flat per-table schema list into the namespace lang-sql wants. With Postgres schemas
// present it nests `schema -> table -> columns` (and reports `public` as the default schema so its
// tables also complete unqualified); without schemas it stays a flat `table -> columns` map.
function buildNamespace(schema: TableSchema[]): {
  namespace: SqlNamespace;
  defaultSchema: string | undefined;
} {
  const hasSchemas = schema.some((table) => table.schema !== null);
  if (!hasSchemas) {
    return {
      namespace: Object.fromEntries(
        schema.map((table) => [table.name, table.columns.map((c) => c.name)]),
      ),
      defaultSchema: undefined,
    };
  }
  const nested: Record<string, Record<string, string[]>> = {};
  for (const table of schema) {
    const schemaName = table.schema ?? "public";
    (nested[schemaName] ??= {})[table.name] = table.columns.map((c) => c.name);
  }
  return { namespace: nested, defaultSchema: "public" in nested ? "public" : undefined };
}

// Run the editor's current selection if it holds non-whitespace text, otherwise the whole buffer.
// Shared by the in-editor Mod-Enter keymap and the out-of-editor Run button.
export function selectedOrAllSql(view: EditorView | null | undefined): string {
  if (!view) {
    return "";
  }
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  if (selected.trim().length > 0) {
    return selected;
  }
  return view.state.doc.toString();
}

type SqlEditorProps = {
  value: string;
  onChange: (value: string) => void;
  engine: DbEngine;
  schema: TableSchema[];
  onSubmit?: () => void;
  // Cmd/Ctrl+S inside the editor (save the current buffer as a named script). Returns true to
  // signal handled so the browser's "save page" is suppressed.
  onSave?: () => void;
  onCreateEditor?: (view: EditorView) => void;
  // A single-line editor (filter row): Enter submits, newlines are blocked, gutter/multiline off.
  singleLine?: boolean;
  ariaLabel?: string;
  placeholder?: string;
  // Scopes completion to ONE table's columns (the filter row's WHERE). Without it, completion
  // offers all tables + their columns (the SQL tab).
  defaultTable?: string;
  // MongoDB only: the connected collection names, offered as completions after `db.`.
  collections?: string[];
};

const SINGLE_LINE_SETUP: BasicSetupOptions = {
  lineNumbers: false,
  foldGutter: false,
  highlightActiveLine: false,
  highlightActiveLineGutter: false,
};

export function SqlEditor({
  value,
  onChange,
  engine,
  schema,
  onSubmit,
  onSave,
  onCreateEditor,
  singleLine = false,
  ariaLabel = "SQL editor",
  placeholder,
  defaultTable,
  collections,
}: SqlEditorProps) {
  // Theme-driven editor colors. Outside a ThemeProvider (isolated subtree / tests) fall back to the
  // built-in defaults. Stabilize the extensions on the color VALUES + mode (not object identity) so
  // an equal-colors render reuses the same extensions and CodeMirror reconfigures in place (document
  // preserved) on a real mode/color change rather than remounting.
  const theme = useThemeOptional();
  const effectiveColors =
    theme?.effectiveColors ??
    applyDefaults(
      { light: { tokens: {}, editor: {} }, dark: { tokens: {}, editor: {} } },
      DEFAULT_THEME_COLORS,
    );
  const effectiveMode = theme?.effectiveMode ?? "light";
  const isDark = effectiveMode === "dark";
  const editorColors = effectiveColors[effectiveMode].editor as EditorColors;
  const colorsKey = `${effectiveMode}:${JSON.stringify(editorColors)}`;

  // run-query / save-script are user-rebindable; bridge their resolved bindings into the CodeMirror
  // keymap. A single-line editor (filter row) keeps its intrinsic Enter-to-submit.
  const shortcuts =
    useSettingsOptional()?.settings.shortcuts ?? DEFAULT_SETTINGS.shortcuts;
  const effectiveShortcuts = resolveShortcuts(shortcuts);
  const runKey = singleLine
    ? "Enter"
    : (toCodeMirrorKey(effectiveShortcuts["run-query"]) ?? "Mod-Enter");
  const saveKey = toCodeMirrorKey(effectiveShortcuts["save-script"]) ?? "Mod-s";

  // A stable key for the collection list so a same-content array doesn't rebuild the language; a
  // real collection change does. Kept as a simple expression for the deps lint.
  const collectionsKey = (collections ?? []).join(" ");
  const extensions = useMemo<Extension[]>(() => {
    const { namespace, defaultSchema } = buildNamespace(schema);
    // The filter row is a WHERE on ONE table: complete only that table's columns. Match by name
    // (the filter card already targets a single table; schema-qualified collisions don't surface
    // here since the editor is scoped to that one table's columns).
    const defaultTableColumns = defaultTable
      ? (schema.find((table) => table.name === defaultTable)?.columns ?? []).map(
          (c) => c.name,
        )
      : undefined;
    const submitKey = runKey;
    return [
      buildSqlLanguage(
        engine,
        schema,
        namespace,
        defaultTableColumns,
        defaultSchema,
        collections ?? [],
        defaultTable,
      ),
      syntaxHighlighting(makeSqlHighlight(editorColors)),
      syntaxHighlighting(classHighlighter),
      makeSqlChrome(editorColors, isDark),
      EditorView.contentAttributes.of({ "aria-label": ariaLabel }),
      ...(placeholder ? [cmPlaceholder(placeholder)] : []),
      ...(singleLine ? [EditorState.transactionFilter.of(blockNewlines)] : []),
      Prec.highest(
        keymap.of([
          {
            key: submitKey,
            run: () => {
              onSubmit?.();
              return true;
            },
          },
          ...(onSave
            ? [
                {
                  key: saveKey,
                  run: () => {
                    onSave();
                    return true;
                  },
                },
              ]
            : []),
        ]),
      ),
    ];
    // editorColors/isDark are derived from colorsKey, so depending on the key is correct - the deps
    // lint can't see through that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    engine,
    schema,
    onSubmit,
    onSave,
    singleLine,
    ariaLabel,
    placeholder,
    defaultTable,
    collectionsKey,
    colorsKey,
    runKey,
    saveKey,
  ]);

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      theme="none"
      basicSetup={singleLine ? SINGLE_LINE_SETUP : undefined}
      extensions={extensions}
      height={singleLine ? "auto" : "100%"}
      className={singleLine ? "w-full text-xs" : "h-full text-xs"}
      onCreateEditor={(view) => onCreateEditor?.(view)}
    />
  );
}

// Drops any transaction that would introduce a line break, keeping the filter editor one line.
function blockNewlines(tr: Transaction) {
  if (!tr.changes.empty && tr.newDoc.lines > 1) {
    return [];
  }
  return tr;
}
