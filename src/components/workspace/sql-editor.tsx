import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionSource,
  completeFromList,
} from "@codemirror/autocomplete";
import { json as jsonLanguage } from "@codemirror/lang-json";
import {
  MSSQL,
  MySQL,
  PostgreSQL,
  SQLite,
  StandardSQL,
  schemaCompletionSource,
} from "@codemirror/lang-sql";
import { LanguageSupport, syntaxHighlighting } from "@codemirror/language";
import {
  EditorState,
  type Extension,
  Prec,
  type Transaction,
} from "@codemirror/state";
import {
  placeholder as cmPlaceholder,
  Decoration,
  type DecorationSet,
  EditorView,
  hoverTooltip,
  keymap,
  MatchDecorator,
  tooltips,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { classHighlighter } from "@lezer/highlight";
import { toCodeMirrorKey } from "@pziel/pureui";
import CodeMirror, { type BasicSetupOptions } from "@uiw/react-codemirror";
import { Copy, PencilLine } from "lucide-react";
import { useMemo } from "react";
import { createRoot } from "react-dom/client";
import { toast } from "sonner";
import { editorFind } from "@/components/workspace/editor-find";
import {
  type EditorColors,
  makeSqlChrome,
  makeSqlHighlight,
} from "@/components/workspace/sql-editor-theme";
import { DEFAULT_SETTINGS } from "@/lib/settings/settings";
import { useSettingsOptional } from "@/lib/settings/settings-context";
import { resolveShortcuts } from "@/lib/shortcuts/resolve";
import { applyDefaults } from "@/lib/theme/overrides";
import { useThemeOptional } from "@/lib/theme/theme-context";
import { DEFAULT_THEME_COLORS } from "@/lib/theme/theme-defaults";
import type { DbEngine, TableSchema, Variable } from "@/lib/workspace/model";

const dialects = {
  postgres: PostgreSQL,
  mysql: MySQL,
  sqlite: SQLite,
  sqlserver: MSSQL,
  // PartiQL (DynamoDB) is SQL-shaped; the generic dialect highlights SELECT/INSERT/UPDATE/DELETE.
  dynamodb: StandardSQL,
} as const;

// The `{{name}}` query-variable grammar (F18) - the SAME as the substitution parser (word-char name,
// optional inner whitespace) so what's highlighted is exactly what's substitutable. Engine-agnostic.
const VARIABLE_TOKEN = /\{\{\s*[A-Za-z0-9_]+\s*\}\}/g;
const VARIABLE_NAME = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/;

function variableNameOf(token: string): string {
  return VARIABLE_NAME.exec(token)?.[1] ?? "";
}

// Marks every `{{name}}` placeholder DEFINED-vs-undefined: a name present in the current variable set
// gets `cm-purequery-variable` (green), an unknown name `cm-purequery-variable-undefined` (red). Rebuilt when
// the doc changes; the variable set is read live off the closure (the plugin is reconfigured when the
// set changes, see the extensions memo). Full editor only, never the single-line filter row.
function makeVariableHighlighter(definedNames: Set<string>) {
  const matcher = new MatchDecorator({
    regexp: VARIABLE_TOKEN,
    decoration: (match) =>
      Decoration.mark({
        class: definedNames.has(variableNameOf(match[0]))
          ? "cm-purequery-variable"
          : "cm-purequery-variable-undefined",
      }),
  });
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = matcher.createDeco(view);
      }
      update(update: ViewUpdate) {
        this.decorations = matcher.updateDeco(update, this.decorations);
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}

// A hover tooltip over a `{{name}}` token, mirroring requi's var-token card: shows the resolved value
// (or an "undefined variable" note) with Copy + Edit (jump to the Variables tab) actions. Vanilla DOM
// (purequery has no radix HoverCard); themed via the app CSS tokens + design.md (no rounded corners).
function makeVariableHover(
  values: Map<string, string>,
  onEdit: (name: string) => void,
) {
  return hoverTooltip((view, pos) => {
    const { text, from } = view.state.doc.lineAt(pos);
    const offset = pos - from;
    for (const match of text.matchAll(VARIABLE_TOKEN)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      if (offset < start || offset > end) {
        continue;
      }
      const name = variableNameOf(match[0]);
      return {
        pos: from + start,
        end: from + end,
        above: true,
        create: () => ({ dom: variableTooltipDom(name, values, onEdit) }),
      };
    }
    return null;
  });
}

// Exported for unit test: the hover popup body is otherwise only reachable through a real CM pointer
// hover, which jsdom can't drive (no layout/measure). Building the DOM directly asserts its content +
// the Copy/Edit wiring.
export function variableTooltipDom(
  name: string,
  values: Map<string, string>,
  onEdit: (name: string) => void,
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "cm-purequery-var-tooltip";
  const isDefined = values.has(name);
  if (!isDefined) {
    const note = document.createElement("span");
    note.className = "cm-purequery-var-tooltip-note";
    note.textContent = `undefined variable "${name}"`;
    wrap.appendChild(note);
    return wrap;
  }
  const value = values.get(name) ?? "";
  const valueEl = document.createElement("span");
  valueEl.className = "cm-purequery-var-tooltip-value";
  valueEl.textContent = value;
  const copy = actionButton("Copy value", Copy, (event) => {
    event.preventDefault();
    navigator.clipboard?.writeText(value);
    toast.success("Copied to clipboard");
  });
  const edit = actionButton("Edit variable", PencilLine, (event) => {
    event.preventDefault();
    onEdit(name);
  });
  wrap.append(valueEl, copy, edit);
  return wrap;
}

// A tooltip action button carrying a lucide ICON (not text - requi's var-token card uses the Copy /
// PencilLine glyphs). The icon component is mounted into the button via a throwaway React root, the
// same way requi renders them; `mousedown` (not click) fires before the editor blur closes the popup.
function actionButton(
  label: string,
  Icon: typeof Copy,
  onMouseDown: (event: MouseEvent) => void,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("aria-label", label);
  button.className = "cm-purequery-var-tooltip-action";
  button.addEventListener("mousedown", onMouseDown);
  createRoot(button).render(<Icon className="size-3.5" />);
  return button;
}

// Curated set of common SQL keywords. lang-sql's built-in keyword source dumps the dialect's
// FULL reserved+non-reserved word list (`scale`, `scope`, `schemas`, `savepoint`, ...), which is
// noise; this is the relevant subset. Fuzzy matching is case-insensitive, so typing `sel` still
// finds SELECT.
const SQL_KEYWORDS = [
  "SELECT",
  "FROM",
  "WHERE",
  "AND",
  "OR",
  "NOT",
  "NULL",
  "IS",
  "IN",
  "LIKE",
  "BETWEEN",
  "EXISTS",
  "AS",
  "DISTINCT",
  "ORDER BY",
  "GROUP BY",
  "HAVING",
  "LIMIT",
  "OFFSET",
  "ASC",
  "DESC",
  "JOIN",
  "INNER JOIN",
  "LEFT JOIN",
  "RIGHT JOIN",
  "FULL JOIN",
  "ON",
  "USING",
  "UNION",
  "UNION ALL",
  "INTERSECT",
  "EXCEPT",
  "INSERT INTO",
  "VALUES",
  "UPDATE",
  "SET",
  "DELETE FROM",
  "RETURNING",
  "CREATE TABLE",
  "ALTER TABLE",
  "DROP TABLE",
  "TRUNCATE",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "COUNT",
  "SUM",
  "AVG",
  "MIN",
  "MAX",
  "COALESCE",
  "CAST",
  "TRUE",
  "FALSE",
  "WITH",
  "INTO",
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
          ? schema.find(
              (t) => t.schema === maybeSchema && t.name === maybeTable,
            )
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

// Offers the defined query variables (F18) as completions once the cursor sits inside an OPEN `{{`
// (optionally after a partial name), so typing `{{` pops the variable list - engine-agnostic, works
// in the SQL editor and the Mongo Query tab. The variable value shows as the completion `detail`
// (the requi source-tag equivalent). Picking inserts the name + the closing `}}` unless one already
// follows the cursor. Returns null with no variables (nothing to offer).
// Marks a variable completion option with `cm-purequery-var-option` so the theme colors its label green +
// right-aligns the value detail (mirrors requi's token popup); non-variable options (keywords, tables,
// columns) are left unclassed so they keep their normal chrome. Merged into basicSetup's single
// `autocompletion()` (config combines via facets - one popup); `icons: false` merges as `a && b`, so
// the type-icon column turns off for the variable-enabled full editor (matches requi's bare rows).
export const variableCompletionConfig = autocompletion({
  icons: false,
  optionClass: (completion: Completion) =>
    completion.type === "variable" ? "cm-purequery-var-option" : "",
});

function variableCompletionSource(variables: Variable[]): CompletionSource {
  return (context) => {
    if (variables.length === 0) {
      return null;
    }
    const open = context.matchBefore(/\{\{\s*[A-Za-z0-9_]*$/);
    if (!open) {
      return null;
    }
    const leading = /^\{\{\s*/.exec(open.text)?.[0].length ?? 2;
    const hasClose =
      context.state.sliceDoc(context.pos, context.pos + 2) === "}}";
    return {
      from: open.from + leading,
      options: variables.map((variable) => ({
        label: variable.name,
        type: "variable",
        detail: variable.value,
        apply: hasClose ? variable.name : `${variable.name}}}`,
      })),
      validFor: /^[A-Za-z0-9_]*$/,
    };
  };
}

// Builds SQL language support whose ONLY completions are schema tables/columns + curated keywords -
// nothing from the dialect's full keyword dump. When `defaultTable` is set (the filter row, which
// is a WHERE on ONE table), completion is scoped to that table's columns + keywords - no other
// table names, which would be irrelevant noise in a single-table filter. `variables` (empty in the
// filter row) adds the `{{name}}` completion source.
function buildSqlLanguage(
  engine: DbEngine,
  schema: TableSchema[],
  namespace: SqlNamespace,
  defaultTableColumns: string[] | undefined,
  defaultSchema: string | undefined,
  collections: string[],
  defaultTable: string | undefined,
  variables: Variable[],
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
      json.language.data.of({
        autocomplete: variableCompletionSource(variables),
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
    dialect.language.data.of({
      autocomplete: variableCompletionSource(variables),
    }),
  ]);
}

// The built-in default schema per engine (used when no per-database schema is pinned): Postgres's
// `public`, SQL Server's `dbo`. Other engines have no schema level, so none.
const BUILTIN_DEFAULT_SCHEMA: Partial<Record<DbEngine, string>> = {
  postgres: "public",
  sqlserver: "dbo",
};

// Folds the flat per-table schema list into the namespace lang-sql wants. With schemas present
// (Postgres / SQL Server) it nests `schema -> table -> columns` and reports a DEFAULT schema whose
// tables also complete unqualified: the per-database `defaultSchema` pin if set (and present in the
// catalog), else the engine's built-in default (`public`/`dbo`) when it exists; without schemas it
// stays a flat `table -> columns` map.
function buildNamespace(
  schema: TableSchema[],
  pinnedSchema: string | undefined,
  engine: DbEngine,
): {
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
  const builtinDefault = BUILTIN_DEFAULT_SCHEMA[engine] ?? "public";
  const nested: Record<string, Record<string, string[]>> = {};
  for (const table of schema) {
    const schemaName = table.schema ?? builtinDefault;
    nested[schemaName] ??= {};
    nested[schemaName][table.name] = table.columns.map((c) => c.name);
  }
  const preferred =
    pinnedSchema && pinnedSchema in nested ? pinnedSchema : undefined;
  const fallback = builtinDefault in nested ? builtinDefault : undefined;
  return { namespace: nested, defaultSchema: preferred ?? fallback };
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
  // Per-database pinned schema (Postgres): when set, its tables complete UNQUALIFIED (no
  // `schema.` prefix needed), mirroring the sidebar default-schema pin. Falls back to `public`.
  defaultSchema?: string;
  // MongoDB only: the connected collection names, offered as completions after `db.`.
  collections?: string[];
  // Query variables (F18): `{{name}}` tokens are colored defined(green)/undefined(red) against this
  // set + get a hover popup (value + Copy + Edit). Full editor only; omitted -> no variable chrome.
  variables?: Variable[];
  // Called by the hover popup's Edit action - jump to the Variables tab. Optional (no Edit if absent).
  onEditVariable?: (name: string) => void;
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
  defaultSchema: pinnedSchema,
  collections,
  variables,
  onEditVariable,
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
    : (toCodeMirrorKey(effectiveShortcuts["run-query"][0]) ?? "Mod-Enter");
  const saveKey =
    toCodeMirrorKey(effectiveShortcuts["save-script"][0]) ?? "Mod-s";
  const findKey =
    toCodeMirrorKey(effectiveShortcuts["open-find"][0]) ?? "Mod-f";

  // A stable key for the collection list so a same-content array doesn't rebuild the language; a
  // real collection change does. Kept as a simple expression for the deps lint.
  const collectionsKey = (collections ?? []).join(" ");
  // A stable key over the variable name/value pairs so a same-content array doesn't rebuild the
  // extensions; a real change (add/remove/rename/revalue) reconfigures the highlight + hover so a
  // now-defined token flips red->green and its hover shows the new value.
  const variablesKey = (variables ?? [])
    .map((variable) => `${variable.name}=${variable.value}`)
    .join(" ");
  const extensions = useMemo<Extension[]>(() => {
    const { namespace, defaultSchema } = buildNamespace(
      schema,
      pinnedSchema,
      engine,
    );
    // The filter row is a WHERE on ONE table: complete only that table's columns. Match by name
    // (the filter card already targets a single table; schema-qualified collisions don't surface
    // here since the editor is scoped to that one table's columns).
    const defaultTableColumns = defaultTable
      ? (
          schema.find((table) => table.name === defaultTable)?.columns ?? []
        ).map((c) => c.name)
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
        // The filter row (single-line) never has variables; the full editor offers them after `{{`.
        singleLine ? [] : (variables ?? []),
      ),
      syntaxHighlighting(makeSqlHighlight(editorColors)),
      syntaxHighlighting(classHighlighter),
      makeSqlChrome(editorColors, isDark),
      EditorView.contentAttributes.of({ "aria-label": ariaLabel }),
      ...(placeholder ? [cmPlaceholder(placeholder)] : []),
      // `{{name}}` variable highlight + hover popup - full editor only, not the single-line filter
      // row. Coloring is defined(green)/undefined(red) against the variable set; the hover shows the
      // value with Copy + Edit (jump to the Variables tab via onEditVariable).
      ...(singleLine
        ? []
        : (() => {
            const definedNames = new Set((variables ?? []).map((v) => v.name));
            const values = new Map(
              (variables ?? []).map((v) => [v.name, v.value] as const),
            );
            return [
              makeVariableHighlighter(definedNames),
              makeVariableHover(values, (name) => onEditVariable?.(name)),
              // Icon-off + green label + right-aligned value detail for the `{{name}}` completion
              // rows (requi-style). Full editor only - the filter row has no variable completions.
              variableCompletionConfig,
              // Render the completion/hover tooltips into <body> so the tab bar / pane chrome above
              // the editor never clips or overpaints the popup (default parent is `.cm-editor`, whose
              // stacking context the tab bar sat over). CM keeps fixed positioning + flips
              // above/below by available space.
              ...(typeof document !== "undefined"
                ? [tooltips({ parent: document.body })]
                : []),
            ];
          })()),
      ...(singleLine ? [EditorState.transactionFilter.of(blockNewlines)] : []),
      // In-app find (Cmd+F): purequery-styled CM search panel. Full editor only - the single-line filter
      // row has nothing to search through.
      ...(singleLine ? [] : [editorFind(findKey)]),
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
    pinnedSchema,
    collectionsKey,
    variablesKey,
    onEditVariable,
    colorsKey,
    runKey,
    saveKey,
    findKey,
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
