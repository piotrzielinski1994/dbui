import type { SettingsStore as GenericSettingsStore } from "@pziel/pureui";

import type { SplitOrientation } from "@/components/workspace/workspace-context";
import {
  SHORTCUT_ACTIONS,
  type ShortcutOverrides,
} from "@/lib/shortcuts/registry";
import { safeNormalize } from "@/lib/shortcuts/resolve";

export type PanelLayout = Record<string, number>;

export type PanelGroupKey = "workspace" | "main" | "sql" | "script";

export type ThemeMode = "light" | "dark" | "system";

export type AppTokenName =
  | "background"
  | "foreground"
  | "card"
  | "card-foreground"
  | "popover"
  | "popover-foreground"
  | "primary"
  | "primary-foreground"
  | "secondary"
  | "secondary-foreground"
  | "muted"
  | "muted-foreground"
  | "accent"
  | "accent-foreground"
  | "destructive"
  | "border"
  | "input"
  | "ring";

export type EditorTokenName =
  | "caret"
  | "selection"
  | "gutter"
  | "keyword"
  | "string"
  | "number"
  | "property"
  | "comment"
  | "invalid";

// Sparse per-mode override maps. An absent key means "use the built-in default
// for that token in that mode" (defaults live in src/lib/theme/theme-defaults).
export type ThemeColorOverrides = {
  tokens: Partial<Record<AppTokenName, string>>;
  editor: Partial<Record<EditorTokenName, string>>;
};

export type ThemeColors = {
  light: ThemeColorOverrides;
  dark: ThemeColorOverrides;
};

// The complete (non-sparse) built-in default set: every token present in both
// modes. Assignable to ThemeColors (a full record satisfies the partial).
export type FullThemeColorOverrides = {
  tokens: Record<AppTokenName, string>;
  editor: Record<EditorTokenName, string>;
};

export type FullThemeColors = {
  light: FullThemeColorOverrides;
  dark: FullThemeColorOverrides;
};

export type ThemeSettings = {
  mode: ThemeMode;
  colors: ThemeColors;
};

export type Settings = {
  version: 1;
  // The absolute path of the user-picked workspace folder (exploded file/folder store). Undefined
  // until a folder is opened; persisted in settings.json. The workspace tree lives on disk under it.
  workspacePath?: string;
  sidebarHidden: boolean;
  consoleHidden: boolean;
  splitOrientation: SplitOrientation;
  layouts: Partial<Record<PanelGroupKey, PanelLayout>>;
  expandedIds: string[];
  openTabIds: string[];
  activeTabId: string | null;
  // Whether the native window was fullscreen at last exit - restored on next launch.
  windowFullscreen: boolean;
  // Default page size a freshly opened table's grid seeds from (positive integer).
  rowLimit: number;
  theme: ThemeSettings;
  shortcuts: ShortcutOverrides;
};

export type SettingsStore = GenericSettingsStore<Settings>;

function emptyThemeColors(): ThemeColors {
  return {
    light: { tokens: {}, editor: {} },
    dark: { tokens: {}, editor: {} },
  };
}

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  sidebarHidden: false,
  consoleHidden: false,
  splitOrientation: "horizontal",
  layouts: {},
  expandedIds: [],
  openTabIds: [],
  activeTabId: null,
  windowFullscreen: false,
  rowLimit: 200,
  theme: { mode: "system", colors: emptyThemeColors() },
  shortcuts: {},
};

const SHORTCUT_ACTION_IDS = new Set<string>(
  SHORTCUT_ACTIONS.map((action) => action.id),
);

// A stored override value is either a legacy single string (migrated to a
// one-element list), an array (kept, invalid entries dropped, an empty array
// preserved as "disabled"), or anything else -> null (the key is then absent, so
// the action falls back to its registry default).
function mergeShortcutValue(value: unknown): string[] | null {
  if (typeof value === "string") {
    const normalized = safeNormalize(value);
    return normalized === null ? null : [normalized];
  }
  if (!Array.isArray(value)) {
    return null;
  }
  return value
    .map((entry) => (typeof entry === "string" ? safeNormalize(entry) : null))
    .filter((entry): entry is string => entry !== null);
}

function mergeShortcuts(value: unknown): ShortcutOverrides {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).flatMap(([id, raw]) => {
      if (!SHORTCUT_ACTION_IDS.has(id)) {
        return [];
      }
      const merged = mergeShortcutValue(raw);
      return merged === null
        ? []
        : [[id as keyof ShortcutOverrides, merged] as const];
    }),
  );
}

const THEME_MODES = new Set<string>(["light", "dark", "system"]);

const APP_TOKEN_NAMES = new Set<string>([
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "border",
  "input",
  "ring",
]);

const EDITOR_TOKEN_NAMES = new Set<string>([
  "caret",
  "selection",
  "gutter",
  "keyword",
  "string",
  "number",
  "property",
  "comment",
  "invalid",
]);

const GROUP_KEYS: PanelGroupKey[] = ["workspace", "main", "sql", "script"];

const SPLIT_ORIENTATIONS = new Set<SplitOrientation>([
  "horizontal",
  "vertical",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

function isPanelLayout(value: unknown): value is PanelLayout {
  return (
    isRecord(value) &&
    Object.values(value).every((size) => typeof size === "number")
  );
}

function mergeLayouts(value: unknown): Settings["layouts"] {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    GROUP_KEYS.flatMap((key) => {
      const layout = value[key];
      return isPanelLayout(layout) ? [[key, layout] as const] : [];
    }),
  );
}

function mergeSplitOrientation(
  value: unknown,
  fallback: SplitOrientation,
): SplitOrientation {
  return typeof value === "string" &&
    SPLIT_ORIENTATIONS.has(value as SplitOrientation)
    ? (value as SplitOrientation)
    : fallback;
}

function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === "string" && THEME_MODES.has(value);
}

function mergeTokenMap<K extends string>(
  value: unknown,
  known: Set<string>,
): Partial<Record<K, string>> {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [K, string] =>
        known.has(entry[0]) && typeof entry[1] === "string",
    ),
  ) as Partial<Record<K, string>>;
}

function mergeOverrides(value: unknown): ThemeColorOverrides {
  if (!isRecord(value)) {
    return { tokens: {}, editor: {} };
  }
  return {
    tokens: mergeTokenMap<AppTokenName>(value.tokens, APP_TOKEN_NAMES),
    editor: mergeTokenMap<EditorTokenName>(value.editor, EDITOR_TOKEN_NAMES),
  };
}

function mergeThemeColors(value: unknown): ThemeColors {
  if (!isRecord(value)) {
    return emptyThemeColors();
  }
  return {
    light: mergeOverrides(value.light),
    dark: mergeOverrides(value.dark),
  };
}

function mergeTheme(defaults: ThemeSettings, partial: unknown): ThemeSettings {
  if (!isRecord(partial)) {
    return defaults;
  }
  return {
    mode: isThemeMode(partial.mode) ? partial.mode : defaults.mode,
    colors: mergeThemeColors(partial.colors),
  };
}

export function mergeSettings(defaults: Settings, partial: unknown): Settings {
  if (!isRecord(partial)) {
    return defaults;
  }
  const openTabIds = isStringArray(partial.openTabIds);
  const activeTabId =
    typeof partial.activeTabId === "string" &&
    openTabIds.includes(partial.activeTabId)
      ? partial.activeTabId
      : null;
  return {
    version: defaults.version,
    ...(typeof partial.workspacePath === "string"
      ? { workspacePath: partial.workspacePath }
      : defaults.workspacePath !== undefined
        ? { workspacePath: defaults.workspacePath }
        : {}),
    sidebarHidden:
      typeof partial.sidebarHidden === "boolean"
        ? partial.sidebarHidden
        : defaults.sidebarHidden,
    consoleHidden:
      typeof partial.consoleHidden === "boolean"
        ? partial.consoleHidden
        : defaults.consoleHidden,
    splitOrientation: mergeSplitOrientation(
      partial.splitOrientation,
      defaults.splitOrientation,
    ),
    layouts: mergeLayouts(partial.layouts),
    expandedIds: isStringArray(partial.expandedIds),
    openTabIds,
    activeTabId,
    windowFullscreen:
      typeof partial.windowFullscreen === "boolean"
        ? partial.windowFullscreen
        : defaults.windowFullscreen,
    rowLimit:
      typeof partial.rowLimit === "number" &&
      Number.isInteger(partial.rowLimit) &&
      partial.rowLimit > 0
        ? partial.rowLimit
        : defaults.rowLimit,
    theme: mergeTheme(defaults.theme, partial.theme),
    shortcuts: mergeShortcuts(partial.shortcuts),
  };
}
