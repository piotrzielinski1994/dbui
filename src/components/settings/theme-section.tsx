import { Prec } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { Button } from "@pziel/pureui";
import CodeMirror from "@uiw/react-codemirror";
import { useMemo, useState } from "react";
import { makeSchemaExtensions } from "@/components/workspace/schema-intellisense";
import { themeColorsJsonSchema } from "@/lib/config-schema/json-schemas";
import type {
  ThemeColorOverrides,
  ThemeColors,
  ThemeMode,
} from "@/lib/settings/settings";
import { useSettings } from "@/lib/settings/settings-context";
import { applyDefaults, diffOverrides } from "@/lib/theme/overrides";
import { DEFAULT_THEME_COLORS } from "@/lib/theme/theme-defaults";

const MODES: { id: ThemeMode; label: string }[] = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "System" },
];

function isOverridesShape(value: unknown): value is ThemeColorOverrides {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as { tokens?: unknown; editor?: unknown };
  const isMap = (slot: unknown) =>
    typeof slot === "object" && slot !== null && !Array.isArray(slot);
  return isMap(record.tokens) && isMap(record.editor);
}

function parseThemeColors(text: string): ThemeColors | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    const record = parsed as { light?: unknown; dark?: unknown };
    if (!isOverridesShape(record.light) || !isOverridesShape(record.dark)) {
      return null;
    }
    return parsed as ThemeColors;
  } catch {
    return null;
  }
}

function ColorEditor() {
  const { settings, saveThemeColors } = useSettings();
  const effective = applyDefaults(settings.theme.colors, DEFAULT_THEME_COLORS);
  const [text, setText] = useState(() => JSON.stringify(effective, null, 2));
  const parsed = parseThemeColors(text);
  const canSave = parsed !== null;

  // Persist the current buffer's sparse diff. Reads the live editor doc the keymap passes in (Mod+S)
  // or the React `text` (Save button) - both resolve to the same content.
  const persist = (raw: string) => {
    const value = parseThemeColors(raw);
    if (!value) {
      return;
    }
    saveThemeColors(diffOverrides(value, DEFAULT_THEME_COLORS));
  };
  const save = () => persist(text);

  // Mod+S inside the editor saves; `run` receives the live EditorView, so it reads the current doc
  // directly (no ref, no stale closure). Stable extension list - keyed on nothing, never churns.
  const extensions = useMemo(
    () => [
      Prec.highest(
        keymap.of([
          {
            key: "Mod-s",
            run: (view) => {
              const value = parseThemeColors(view.state.doc.toString());
              if (value) {
                saveThemeColors(diffOverrides(value, DEFAULT_THEME_COLORS));
              }
              return true;
            },
          },
        ]),
      ),
      ...makeSchemaExtensions(themeColorsJsonSchema),
    ],
    [saveThemeColors],
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="h-72 min-h-0 border border-border">
        <CodeMirror
          value={text}
          onChange={setText}
          theme="none"
          extensions={extensions}
          height="100%"
          className="h-full text-xs"
        />
      </div>
      <div className="flex">
        <Button type="button" onClick={save} disabled={!canSave}>
          Save
        </Button>
      </div>
    </div>
  );
}

export function ThemeSection() {
  const { settings, saveThemeMode } = useSettings();
  const mode = settings.theme.mode;

  return (
    <section className="flex flex-col gap-1">
      <h2 className="text-lg font-medium">Theme</h2>
      <p className="text-sm text-muted-foreground">
        Choose the app appearance, or follow your OS preference.
      </p>
      <div className="mt-2 flex">
        {MODES.map((option) => {
          const isActive = mode === option.id;
          return (
            <Button
              key={option.id}
              type="button"
              variant={isActive ? "default" : "outline"}
              aria-pressed={isActive}
              className="rounded-none border-0 border-l border-l-border first:border-l-0"
              onClick={() => saveThemeMode(option.id)}
            >
              {option.label}
            </Button>
          );
        })}
      </div>
      <p className="mt-4 text-sm text-muted-foreground">
        Customize colors per mode. Edit a value to override it, or set it back
        to the default to clear the override, then Save.
      </p>
      <div className="mt-2">
        <ColorEditor />
      </div>
    </section>
  );
}
