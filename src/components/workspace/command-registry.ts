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
  | "toggle-console";

export type PaletteState = {
  openTabCount: number;
  isSplitView: boolean;
};

export type PaletteCommandDef = {
  id: PaletteCommandId;
  name: string;
  hint?: string;
  when: (state: PaletteState) => boolean;
};

const hasTabs = (state: PaletteState) => state.openTabCount >= 1;
const hasMultipleTabs = (state: PaletteState) => state.openTabCount >= 2;

export const PALETTE_COMMANDS: readonly PaletteCommandDef[] = [
  {
    id: "new-database",
    name: "New database",
    hint: "Cmd/Ctrl+N",
    when: () => true,
  },
  {
    id: "new-folder",
    name: "New folder",
    hint: "Cmd/Ctrl+Shift+N",
    when: () => true,
  },
  { id: "close-tab", name: "Close tab", hint: "Ctrl+W", when: hasTabs },
  { id: "close-all-tabs", name: "Close all tabs", when: hasTabs },
  { id: "next-tab", name: "Next tab", hint: "Tab", when: hasMultipleTabs },
  {
    id: "prev-tab",
    name: "Previous tab",
    hint: "Shift+Tab",
    when: hasMultipleTabs,
  },
  { id: "new-tab", name: "New tab", when: () => true },
  {
    id: "toggle-split-orientation",
    name: "Toggle split layout (rows / columns)",
    hint: "Cmd/Ctrl+\\",
    when: (state) => state.isSplitView,
  },
  {
    id: "toggle-sidebar",
    name: "Toggle sidebar",
    hint: "Cmd/Ctrl+B",
    when: () => true,
  },
  {
    id: "toggle-console",
    name: "Toggle console panel",
    hint: "Cmd/Ctrl+J",
    when: () => true,
  },
];
