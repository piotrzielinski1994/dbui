export type ShortcutScope = "global" | "tab" | "grid" | "tree" | "editor";

export type ShortcutActionId =
  | "open-command-palette"
  | "new-database"
  | "new-folder"
  | "toggle-sidebar"
  | "toggle-console"
  | "toggle-theme"
  | "toggle-split-orientation"
  | "next-tab"
  | "prev-tab"
  | "close-tab"
  | "close-other-tabs"
  | "toggle-record-view"
  | "toggle-json-view"
  | "toggle-structure-view"
  | "refresh-table"
  | "delete-rows"
  | "delete-nodes"
  | "run-query"
  | "save-script";

export type ShortcutAction = {
  id: ShortcutActionId;
  name: string;
  description: string;
  defaultHotkey: string;
  scope: ShortcutScope;
};

export type ShortcutOverrides = Partial<Record<ShortcutActionId, string>>;

export const SHORTCUT_ACTIONS: readonly ShortcutAction[] = [
  {
    id: "open-command-palette",
    name: "Open command palette",
    description: "Search and run any action from a command list.",
    defaultHotkey: "Mod+K",
    scope: "global",
  },
  {
    id: "new-database",
    name: "New database",
    description: "Add a new database connection at the tree root.",
    defaultHotkey: "Mod+N",
    scope: "global",
  },
  {
    id: "new-folder",
    name: "New folder",
    description: "Create a folder at the tree root.",
    defaultHotkey: "Mod+Shift+N",
    scope: "global",
  },
  {
    id: "toggle-sidebar",
    name: "Toggle sidebar",
    description: "Show or hide the workspace sidebar.",
    defaultHotkey: "Mod+B",
    scope: "global",
  },
  {
    id: "toggle-console",
    name: "Toggle console",
    description: "Show or hide the console panel.",
    defaultHotkey: "Mod+J",
    scope: "global",
  },
  {
    id: "toggle-theme",
    name: "Toggle theme",
    description: "Cycle the theme: light, dark, system.",
    defaultHotkey: "Mod+Shift+L",
    scope: "global",
  },
  {
    id: "toggle-split-orientation",
    name: "Toggle split layout",
    description: "Flip the SQL editor/results split between rows and columns.",
    defaultHotkey: "Mod+\\",
    scope: "global",
  },
  {
    id: "next-tab",
    name: "Next tab",
    description: "Activate the next open tab.",
    defaultHotkey: "Ctrl+Tab",
    scope: "tab",
  },
  {
    id: "prev-tab",
    name: "Previous tab",
    description: "Activate the previous open tab.",
    defaultHotkey: "Ctrl+Shift+Tab",
    scope: "tab",
  },
  {
    id: "close-tab",
    name: "Close tab",
    description: "Close the active tab.",
    defaultHotkey: "Mod+W",
    scope: "tab",
  },
  {
    id: "close-other-tabs",
    name: "Close other tabs",
    description: "Close every open tab except the active one.",
    defaultHotkey: "Mod+Alt+W",
    scope: "tab",
  },
  {
    id: "toggle-record-view",
    name: "Toggle record view",
    description: "Switch the data grid between table and record view.",
    defaultHotkey: "Tab",
    scope: "grid",
  },
  {
    id: "toggle-json-view",
    name: "Toggle JSON view",
    description: "Show the loaded rows as an editable, foldable JSON array.",
    defaultHotkey: "Mod+Shift+J",
    scope: "grid",
  },
  {
    id: "toggle-structure-view",
    name: "Toggle structure view",
    description:
      "Show the table's columns, indexes, foreign keys, and constraints.",
    defaultHotkey: "Mod+Shift+I",
    scope: "grid",
  },
  {
    id: "refresh-table",
    name: "Refresh table",
    description: "Re-fetch the open table's rows from the database.",
    defaultHotkey: "Mod+R",
    scope: "grid",
  },
  {
    id: "delete-rows",
    name: "Delete rows",
    description: "Delete the selected rows in the data grid.",
    defaultHotkey: "Backspace",
    scope: "grid",
  },
  {
    id: "delete-nodes",
    name: "Delete",
    description: "Delete the selected databases or folders.",
    defaultHotkey: "Backspace",
    scope: "tree",
  },
  {
    id: "run-query",
    name: "Run query",
    description: "Run the query in the editor.",
    defaultHotkey: "Mod+Enter",
    scope: "editor",
  },
  {
    id: "save-script",
    name: "Save script",
    description: "Save the active editor's script.",
    defaultHotkey: "Mod+S",
    scope: "editor",
  },
];
