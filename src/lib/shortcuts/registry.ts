export type ShortcutScope = "global" | "tab" | "grid" | "tree" | "editor";

export type ShortcutActionId =
  | "open-command-palette"
  | "open-quick-open"
  | "open-workspace"
  | "new-database"
  | "new-folder"
  | "toggle-sidebar"
  | "toggle-console"
  | "panel-expand"
  | "panel-shrink"
  | "toggle-theme"
  | "toggle-split-orientation"
  | "next-tab"
  | "prev-tab"
  | "nav-back"
  | "nav-forward"
  | "close-tab"
  | "close-other-tabs"
  | "toggle-record-view"
  | "toggle-json-view"
  | "toggle-structure-view"
  | "open-find"
  | "refresh-table"
  | "delete-rows"
  | "delete-nodes"
  | "run-query"
  | "save-script"
  | "tree-nav-up"
  | "tree-nav-down"
  | "tree-nav-first"
  | "tree-nav-last"
  | "tree-expand"
  | "tree-collapse"
  | "tree-activate"
  | "tree-extend-up"
  | "tree-extend-down"
  | "tree-move-up"
  | "tree-move-down"
  | "tree-outdent"
  | "tree-nest"
  | "open-context-menu";

export type ShortcutAction = {
  id: ShortcutActionId;
  name: string;
  description: string;
  defaultHotkey: string;
  scope: ShortcutScope;
};

// A per-action LIST of hotkeys: an action can carry several bindings. An absent
// id means "use the registry default"; an explicit empty list means "disabled".
export type ShortcutOverrides = Partial<Record<ShortcutActionId, string[]>>;

export const SHORTCUT_ACTIONS: readonly ShortcutAction[] = [
  {
    id: "open-command-palette",
    name: "Open command palette",
    description: "Search and run any action from a command list.",
    defaultHotkey: "Mod+K",
    scope: "global",
  },
  {
    id: "open-quick-open",
    name: "Quick open table",
    description: "Fuzzy-jump to any table, database, or folder by name.",
    defaultHotkey: "Mod+P",
    scope: "global",
  },
  {
    id: "open-workspace",
    name: "Open workspace",
    description: "Pick a workspace folder to load.",
    defaultHotkey: "Mod+O",
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
    id: "panel-expand",
    name: "Expand panel",
    description: "Grow the focused panel (sidebar or console).",
    defaultHotkey: "Mod+Alt+=",
    scope: "global",
  },
  {
    id: "panel-shrink",
    name: "Shrink panel",
    description: "Shrink the focused panel (sidebar or console).",
    defaultHotkey: "Mod+Alt+-",
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
    id: "nav-back",
    name: "Navigate back",
    description: "Return to the previous table in the FK-navigation history.",
    defaultHotkey: "Mod+[",
    scope: "global",
  },
  {
    id: "nav-forward",
    name: "Navigate forward",
    description: "Go forward again in the FK-navigation history.",
    defaultHotkey: "Mod+]",
    scope: "global",
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
    id: "open-find",
    name: "Find",
    description: "Open the in-app find bar for the focused grid or editor.",
    defaultHotkey: "Mod+F",
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
  {
    id: "tree-nav-up",
    name: "Focus previous row",
    description: "Move focus to the previous visible sidebar row.",
    defaultHotkey: "ArrowUp",
    scope: "tree",
  },
  {
    id: "tree-nav-down",
    name: "Focus next row",
    description: "Move focus to the next visible sidebar row.",
    defaultHotkey: "ArrowDown",
    scope: "tree",
  },
  {
    id: "tree-nav-first",
    name: "Focus first row",
    description: "Move focus to the first visible sidebar row.",
    defaultHotkey: "Home",
    scope: "tree",
  },
  {
    id: "tree-nav-last",
    name: "Focus last row",
    description: "Move focus to the last visible sidebar row.",
    defaultHotkey: "End",
    scope: "tree",
  },
  {
    id: "tree-expand",
    name: "Expand row",
    description: "Expand a folder/database, or descend into its first child.",
    defaultHotkey: "ArrowRight",
    scope: "tree",
  },
  {
    id: "tree-collapse",
    name: "Collapse row",
    description: "Collapse a folder/database, or move focus to its parent.",
    defaultHotkey: "ArrowLeft",
    scope: "tree",
  },
  {
    id: "tree-activate",
    name: "Activate row",
    description: "Open a table's tab, or toggle a folder/database.",
    defaultHotkey: "Enter",
    scope: "tree",
  },
  {
    id: "tree-extend-up",
    name: "Extend selection up",
    description: "Extend the sidebar selection to the previous row.",
    defaultHotkey: "Shift+ArrowUp",
    scope: "tree",
  },
  {
    id: "tree-extend-down",
    name: "Extend selection down",
    description: "Extend the sidebar selection to the next row.",
    defaultHotkey: "Shift+ArrowDown",
    scope: "tree",
  },
  {
    id: "tree-move-up",
    name: "Move row up",
    description: "Reorder the focused folder/database above its sibling.",
    defaultHotkey: "Alt+ArrowUp",
    scope: "tree",
  },
  {
    id: "tree-move-down",
    name: "Move row down",
    description: "Reorder the focused folder/database below its sibling.",
    defaultHotkey: "Alt+ArrowDown",
    scope: "tree",
  },
  {
    id: "tree-outdent",
    name: "Outdent row",
    description: "Move the focused folder/database out to its grandparent.",
    defaultHotkey: "Alt+ArrowLeft",
    scope: "tree",
  },
  {
    id: "tree-nest",
    name: "Nest row",
    description: "Move the focused folder/database into the preceding folder.",
    defaultHotkey: "Alt+ArrowRight",
    scope: "tree",
  },
  {
    id: "open-context-menu",
    name: "Open context menu",
    description: "Open the context menu for the focused row or tab.",
    defaultHotkey: "Shift+F10",
    scope: "tree",
  },
];
