import { useEffect, useMemo, useState } from "react";
import CodeMirror, { type BasicSetupOptions } from "@uiw/react-codemirror";
import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { json as jsonLanguage } from "@codemirror/lang-json";
import { syntaxHighlighting } from "@codemirror/language";
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
import { editorFind } from "@/components/workspace/editor-find";
import {
  parseJsonRows,
  rowsToJson,
  type JsonRow,
} from "@/lib/workspace/json-edit";
import type { Cell } from "@/components/workspace/data-grid";

const VIEWER_SETUP: BasicSetupOptions = {
  lineNumbers: false,
  foldGutter: true,
};

const STAGE_DEBOUNCE_MS = 400;

type JsonViewProps = {
  columns: string[];
  rows: Cell[][];
  // Stage the edited rows into the pending-edits pipeline (the Changes tab). Returns an error
  // message to surface inline (e.g. a SQL schema/PK violation from the diff), or null/void on
  // success. Editing auto-stages on a debounce - there is NO local Save/Discard; the Changes-tab
  // pending bar is the single stage/commit gate (its Save shows the SQL before touching the DB, so
  // the mass-delete footgun is bounded by that explicit commit, not the JSON buffer). Absent =>
  // read-only viewer.
  onSave?: (edited: JsonRow[]) => string | null | void;
};

export function JsonView({ columns, rows, onSave }: JsonViewProps) {
  const seed = rowsToJson(columns, rows);
  // Re-seed the draft when the underlying rows change (sort/filter/paging/refetch) by stamping it
  // with the seed it was made from - the same positional-stamp idea the grid uses, without an
  // effect. A fresh seed means the rows changed, so the stale edit is dropped, not silently kept.
  const [stamped, setStamped] = useState({ seed, draft: seed });
  const draft = stamped.seed === seed ? stamped.draft : seed;
  const [error, setError] = useState<string | null>(null);
  const isEditable = Boolean(onSave);

  // Auto-stage the edited buffer on a debounce: parse, and on success hand the rows to onSave
  // (which reconciles the staged mutations - a reverted edit un-stages). A parse failure shows
  // inline and stages nothing. Skips the initial seed (draft === seed) so opening the view never
  // stages. Debounced so a mid-keystroke partial buffer doesn't churn the Changes tab.
  useEffect(() => {
    if (!onSave || draft === seed) {
      return;
    }
    const timer = setTimeout(() => {
      const parsed = parseJsonRows(draft);
      if (!parsed.ok) {
        setError(parsed.error);
        return;
      }
      const stageError = onSave(parsed.value);
      setError(typeof stageError === "string" ? stageError : null);
    }, STAGE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft, seed, onSave]);

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
  const findKey =
    toCodeMirrorKey(resolveShortcuts(shortcuts)["open-find"][0]) ?? "Mod-f";

  const extensions = useMemo<Extension[]>(
    () => [
      jsonLanguage(),
      syntaxHighlighting(makeSqlHighlight(editorColors)),
      syntaxHighlighting(classHighlighter),
      makeSqlChrome(editorColors, isDark),
      EditorView.contentAttributes.of({ "aria-label": "Rows as JSON" }),
      editorFind(findKey),
    ],
    // editorColors/isDark derive from colorsKey; depending on the key is correct.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [colorsKey, findKey],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1">
        <CodeMirror
          value={draft}
          onChange={(value) => setStamped({ seed, draft: value })}
          editable={isEditable}
          theme="none"
          basicSetup={VIEWER_SETUP}
          extensions={extensions}
          height="100%"
          className="h-full text-xs"
        />
      </div>
      {isEditable && error ? (
        <div className="flex h-9 shrink-0 items-center border-t bg-muted/30 px-3">
          <span className="font-mono text-xs text-destructive">{error}</span>
        </div>
      ) : null}
    </div>
  );
}
