export type PaletteCommandId =
  | "new-database"
  | "new-folder"
  | "close-tab"
  | "close-all-tabs"
  | "next-tab"
  | "prev-tab"
  | "new-tab"
  | "toggle-split-orientation"
  | "toggle-sidebar"
  | "toggle-console"
  | "toggle-theme";

export type PaletteState = {
  openTabCount: number;
  isSplitView: boolean;
};

import type { ShortcutActionId } from "@/lib/shortcuts/registry";

export type PaletteCommandDef = {
  id: PaletteCommandId;
  name: string;
  // The registry action whose effective binding supplies the displayed hint;
  // commands with no bound shortcut (e.g. new-tab, close-all-tabs) omit it.
  actionId?: ShortcutActionId;
  when: (state: PaletteState) => boolean;
};

const hasTabs = (state: PaletteState) => state.openTabCount >= 1;
const hasMultipleTabs = (state: PaletteState) => state.openTabCount >= 2;

export const PALETTE_COMMANDS: readonly PaletteCommandDef[] = [
  {
    id: "new-database",
    name: "New database",
    actionId: "new-database",
    when: () => true,
  },
  {
    id: "new-folder",
    name: "New folder",
    actionId: "new-folder",
    when: () => true,
  },
  { id: "close-tab", name: "Close tab", actionId: "close-tab", when: hasTabs },
  { id: "close-all-tabs", name: "Close all tabs", when: hasTabs },
  {
    id: "next-tab",
    name: "Next tab",
    actionId: "next-tab",
    when: hasMultipleTabs,
  },
  {
    id: "prev-tab",
    name: "Previous tab",
    actionId: "prev-tab",
    when: hasMultipleTabs,
  },
  { id: "new-tab", name: "New tab", when: () => true },
  {
    id: "toggle-split-orientation",
    name: "Toggle split layout (rows / columns)",
    actionId: "toggle-split-orientation",
    when: (state) => state.isSplitView,
  },
  {
    id: "toggle-sidebar",
    name: "Toggle sidebar",
    actionId: "toggle-sidebar",
    when: () => true,
  },
  {
    id: "toggle-console",
    name: "Toggle console panel",
    actionId: "toggle-console",
    when: () => true,
  },
  {
    id: "toggle-theme",
    name: "Toggle theme",
    actionId: "toggle-theme",
    when: () => true,
  },
];
