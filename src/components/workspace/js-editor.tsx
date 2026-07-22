import type {
  CompletionContext,
  CompletionSource,
} from "@codemirror/autocomplete";
import { javascript } from "@codemirror/lang-javascript";
import { syntaxHighlighting } from "@codemirror/language";
import { type Extension, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { classHighlighter } from "@lezer/highlight";
import { toCodeMirrorKey } from "@pziel/pureui";
import CodeMirror from "@uiw/react-codemirror";
import { useMemo } from "react";
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
import type { DbEngine, TableSchema } from "@/lib/workspace/model";

// The injected `db` read methods per engine (mirrors the worker's `db` stub + the ScriptHost's
// handleRpc). SQL: query/tables/schema; Mongo: find/aggregate/collections/schema.
const SQL_DB_METHODS = ["query", "tables", "schema"];
const MONGO_DB_METHODS = ["find", "aggregate", "collections", "schema"];
const CONSOLE_METHODS = ["log", "error"];
const GLOBALS = ["db", "console", "print", "await"];

// Completes the script runtime's injected surface: `db.` -> the engine's read methods; `console.` ->
// log/error; a bare identifier -> the globals; and, inside a `db.query("` (SQL) / `db.find("` /
// `db.aggregate("` (Mongo) string literal, the schema's table / collection names. Everything a script
// can call is discoverable - the JS editor has no other schema autocomplete.
function scriptCompletionSource(
  engine: DbEngine,
  schema: TableSchema[],
  collections: string[],
): CompletionSource {
  const isMongo = engine === "mongodb";
  const dbMethods = isMongo ? MONGO_DB_METHODS : SQL_DB_METHODS;
  const tableNames = isMongo ? collections : schema.map((table) => table.name);
  return (context: CompletionContext) => {
    const before = context.state.sliceDoc(0, context.pos);
    // Inside a db.query / db.find / db.aggregate string argument, after the opening quote: names.
    const inStringArg = /db\.(?:query|find|aggregate)\(\s*["'`][^"'`]*$/.test(
      before,
    );
    if (inStringArg) {
      const word = context.matchBefore(/[\w$.]*$/);
      return {
        from: word ? word.from : context.pos,
        options: tableNames.map((name) => ({ label: name, type: "class" })),
        validFor: /^[\w$.]*$/,
      };
    }
    if (/console\.\w*$/.test(before)) {
      const word = context.matchBefore(/\w*$/);
      return {
        from: word ? word.from : context.pos,
        options: CONSOLE_METHODS.map((label) => ({ label, type: "method" })),
        validFor: /^\w*$/,
      };
    }
    if (/\bdb\.\w*$/.test(before)) {
      const word = context.matchBefore(/\w*$/);
      return {
        from: word ? word.from : context.pos,
        options: dbMethods.map((label) => ({ label, type: "method" })),
        validFor: /^\w*$/,
      };
    }
    const word = context.matchBefore(/[\w$]+/);
    if (!word && !context.explicit) {
      return null;
    }
    return {
      from: word ? word.from : context.pos,
      options: GLOBALS.map((label) => ({ label, type: "variable" })),
      validFor: /^[\w$]*$/,
    };
  };
}

type JsEditorProps = {
  value: string;
  onChange: (value: string) => void;
  engine: DbEngine;
  schema?: TableSchema[];
  collections?: string[];
  onSubmit?: () => void;
  onSave?: () => void;
  onCreateEditor?: (view: EditorView) => void;
  ariaLabel?: string;
};

// A CodeMirror JavaScript editor for the Script tab (F7). It shares the SQL editor's theme chrome +
// syntax-highlight tokens + the run/save keymap bridge, but uses the JS language and has no
// DB-schema autocomplete (a script isn't a single SQL statement). Kept separate from SqlEditor,
// which is entirely SQL/Mongo completion.
export function JsEditor({
  value,
  onChange,
  engine,
  schema = [],
  collections,
  onSubmit,
  onSave,
  onCreateEditor,
  ariaLabel = "JavaScript editor",
}: JsEditorProps) {
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

  const shortcuts =
    useSettingsOptional()?.settings.shortcuts ?? DEFAULT_SETTINGS.shortcuts;
  const effectiveShortcuts = resolveShortcuts(shortcuts);
  const runKey =
    toCodeMirrorKey(effectiveShortcuts["run-query"][0]) ?? "Mod-Enter";
  const saveKey =
    toCodeMirrorKey(effectiveShortcuts["save-script"][0]) ?? "Mod-s";
  const findKey =
    toCodeMirrorKey(effectiveShortcuts["open-find"][0]) ?? "Mod-f";

  // Stable dep key for the completion inputs (names only) so an equal-content render reuses the
  // language instead of rebuilding it.
  const schemaKey = schema.map((table) => table.name).join(" ");
  const collectionsKey = (collections ?? []).join(" ");
  const extensions = useMemo<Extension[]>(() => {
    const js = javascript();
    return [
      js,
      js.language.data.of({
        autocomplete: scriptCompletionSource(engine, schema, collections ?? []),
      }),
      syntaxHighlighting(makeSqlHighlight(editorColors)),
      syntaxHighlighting(classHighlighter),
      makeSqlChrome(editorColors, isDark),
      EditorView.contentAttributes.of({ "aria-label": ariaLabel }),
      editorFind(findKey),
      Prec.highest(
        keymap.of([
          {
            key: runKey,
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
    // editorColors/isDark are derived from colorsKey; schema/collections from their name keys - depend
    // on the keys (the deps lint can't see through).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    engine,
    schemaKey,
    collectionsKey,
    onSubmit,
    onSave,
    ariaLabel,
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
      extensions={extensions}
      height="100%"
      className="h-full text-xs"
      onCreateEditor={(view) => onCreateEditor?.(view)}
    />
  );
}
