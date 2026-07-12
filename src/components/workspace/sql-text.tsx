import { useMemo } from "react";
import { highlightSql, type SqlSegmentKind } from "@/lib/workspace/sql-highlight";
import type { EditorColors } from "@/components/workspace/sql-editor-theme";
import { useThemeOptional } from "@/lib/theme/theme-context";
import { applyDefaults } from "@/lib/theme/overrides";
import { DEFAULT_THEME_COLORS } from "@/lib/theme/theme-defaults";

// Inline read-only SQL highlighter for every place a stored SQL string is shown (History log,
// Changes list, the manual-commit Commit modal) - the same token COLOURS as the SQL editor (theme
// `editorColors`) applied to the pure `highlightSql` segments, WITHOUT a CodeMirror instance per row
// (a list of dozens of statements can't each mount an editor). Renders inline (a `<span>`), so the
// caller controls the block/wrapping via className.
export function SqlText({ sql, className }: { sql: string; className?: string }) {
  const theme = useThemeOptional();
  const effectiveColors =
    theme?.effectiveColors ??
    applyDefaults(
      { light: { tokens: {}, editor: {} }, dark: { tokens: {}, editor: {} } },
      DEFAULT_THEME_COLORS,
    );
  const effectiveMode = theme?.effectiveMode ?? "light";
  const editorColors = effectiveColors[effectiveMode].editor as EditorColors;

  const segments = useMemo(() => highlightSql(sql), [sql]);

  // A plain/identifier segment inherits the surrounding text colour (identifiers stay foreground,
  // like the editor's default text); only keyword/string/number/comment take a token hue.
  const colorFor = (kind: SqlSegmentKind): string | undefined => {
    switch (kind) {
      case "keyword":
        return editorColors.keyword;
      case "string":
        return editorColors.string;
      case "number":
        return editorColors.number;
      case "comment":
        return editorColors.comment;
      default:
        return undefined;
    }
  };

  return (
    <span className={className}>
      {segments.map((segment, index) => {
        const color = colorFor(segment.kind);
        return (
          <span
            key={index}
            style={color ? { color } : undefined}
            className={segment.kind === "comment" ? "italic" : undefined}
          >
            {segment.text}
          </span>
        );
      })}
    </span>
  );
}
