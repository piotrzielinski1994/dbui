export type PaletteCommandId =
  | "quick-open"
  | "open-workspace"
  | "new-database"
  | "new-folder"
  | "close-tab"
  | "close-other-tabs"
  | "close-all-tabs"
  | "next-tab"
  | "prev-tab"
  | "nav-back"
  | "nav-forward"
  | "new-tab"
  | "generate-mock-data"
  | "toggle-split-orientation"
  | "toggle-sidebar"
  | "toggle-console"
  | "toggle-theme"
  | "toggle-json-view"
  | "toggle-structure-view"
  | "open-find"
  | "panel-expand"
  | "panel-shrink";

export type PaletteState = {
  openTabCount: number;
  isSplitView: boolean;
  isTableActive: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
};

import type { ShortcutActionId } from "@/lib/shortcuts/registry";

// Palette command groups, in the order they render under their headings. Keeps the palette scannable
// (Create / Tabs / View) instead of one flat mishmash.
export type PaletteGroup = "Create" | "Tabs" | "View";

export const PALETTE_GROUP_ORDER: readonly PaletteGroup[] = [
  "Create",
  "Tabs",
  "View",
];

export type PaletteCommandDef = {
  id: PaletteCommandId;
  name: string;
  group: PaletteGroup;
  // The registry action whose effective binding supplies the displayed hint;
  // commands with no bound shortcut (e.g. new-tab, close-all-tabs) omit it.
  actionId?: ShortcutActionId;
  when: (state: PaletteState) => boolean;
};

const hasTabs = (state: PaletteState) => state.openTabCount >= 1;
const hasMultipleTabs = (state: PaletteState) => state.openTabCount >= 2;

export const PALETTE_COMMANDS: readonly PaletteCommandDef[] = [
  {
    id: "quick-open",
    name: "Quick open table",
    group: "View",
    actionId: "open-quick-open",
    when: () => true,
  },
  {
    id: "open-workspace",
    name: "Open workspace folder",
    group: "View",
    actionId: "open-workspace",
    when: () => true,
  },
  {
    id: "new-database",
    name: "New database",
    group: "Create",
    actionId: "new-database",
    when: () => true,
  },
  {
    id: "new-folder",
    name: "New folder",
    group: "Create",
    actionId: "new-folder",
    when: () => true,
  },
  { id: "new-tab", name: "New tab", group: "Create", when: () => true },
  {
    id: "generate-mock-data",
    name: "Generate mock data",
    group: "Create",
    when: (state) => state.isTableActive,
  },
  {
    id: "next-tab",
    name: "Next tab",
    group: "Tabs",
    actionId: "next-tab",
    when: hasMultipleTabs,
  },
  {
    id: "prev-tab",
    name: "Previous tab",
    group: "Tabs",
    actionId: "prev-tab",
    when: hasMultipleTabs,
  },
  {
    id: "nav-back",
    name: "Navigate back",
    group: "Tabs",
    actionId: "nav-back",
    when: (state) => state.canGoBack,
  },
  {
    id: "nav-forward",
    name: "Navigate forward",
    group: "Tabs",
    actionId: "nav-forward",
    when: (state) => state.canGoForward,
  },
  {
    id: "close-tab",
    name: "Close tab",
    group: "Tabs",
    actionId: "close-tab",
    when: hasTabs,
  },
  {
    id: "close-other-tabs",
    name: "Close other tabs",
    group: "Tabs",
    actionId: "close-other-tabs",
    when: hasMultipleTabs,
  },
  {
    id: "close-all-tabs",
    name: "Close all tabs",
    group: "Tabs",
    when: hasTabs,
  },
  {
    id: "toggle-sidebar",
    name: "Toggle sidebar",
    group: "View",
    actionId: "toggle-sidebar",
    when: () => true,
  },
  {
    id: "toggle-console",
    name: "Toggle console panel",
    group: "View",
    actionId: "toggle-console",
    when: () => true,
  },
  {
    id: "toggle-split-orientation",
    name: "Toggle split layout (rows / columns)",
    group: "View",
    actionId: "toggle-split-orientation",
    when: (state) => state.isSplitView,
  },
  {
    id: "toggle-theme",
    name: "Toggle theme",
    group: "View",
    actionId: "toggle-theme",
    when: () => true,
  },
  {
    id: "toggle-json-view",
    name: "View rows as JSON",
    group: "View",
    actionId: "toggle-json-view",
    when: (state) => state.isTableActive,
  },
  {
    id: "toggle-structure-view",
    name: "View table structure",
    group: "View",
    actionId: "toggle-structure-view",
    when: (state) => state.isTableActive,
  },
  {
    id: "open-find",
    name: "Find",
    group: "View",
    actionId: "open-find",
    when: () => true,
  },
  {
    id: "panel-expand",
    name: "Expand panel",
    group: "View",
    actionId: "panel-expand",
    when: () => true,
  },
  {
    id: "panel-shrink",
    name: "Shrink panel",
    group: "View",
    actionId: "panel-shrink",
    when: () => true,
  },
];
