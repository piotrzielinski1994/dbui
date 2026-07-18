import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { GroupImperativeHandle } from "react-resizable-panels";
import type {
  PanelGroupKey,
  PanelLayout,
  Settings,
} from "@/lib/settings/settings";
import type {
  ConnectionConfig,
  ConnectionStatus,
  DatabaseNode,
  FolderNode,
  SavedJsScript,
  SavedScript,
  TableNode,
  TableRef,
  TableSchema,
  TreeNode,
  Variable,
  ViewObject,
} from "@/lib/workspace/model";
import {
  moveNode as moveTreeNode,
  moveNodes as moveTreeNodes,
  type MoveTarget,
} from "@/lib/workspace/move";
import { flattenSelectable, rangeBetween } from "@/lib/workspace/tree-select";
import { insertNode } from "@/lib/workspace/tree-edit";
import { parseLogLine, type LogLine } from "@/lib/workspace/log-line";
import { createNoopLogStream, type LogStream } from "@/lib/logging/log-stream";
import {
  EMPTY_NAV,
  pushNavigation,
  canGoBack,
  canGoForward,
  goBack as goBackNav,
  goForward as goForwardNav,
  currentEntry,
  type NavState,
} from "@/lib/workspace/nav-history";

// How a click adjusts the sidebar multi-selection: a plain click replaces it, a
// Cmd/Ctrl click toggles one row, a Shift click selects the range from the
// anchor to the clicked row over the visible (expanded) rows.
export type SelectMode = "replace" | "toggle" | "range";

export type DatabaseTab =
  | "sql"
  | "views"
  | "procedures"
  | "functions"
  | "triggers"
  | "sequences"
  | "script"
  | "settings"
  | "query"
  | "variables";

export type SplitOrientation = "horizontal" | "vertical";

type MutationBase = {
  id: string;
  tableId: string;
  tableName: string;
  sql: string;
};

export type CellMutation = MutationBase & {
  kind: "cell";
  column: string;
  rowIndex: number;
  pkValue: string | null;
  oldValue: string | null;
  newValue: string;
};

export type InsertMutation = MutationBase & {
  kind: "insert";
  draftId: string;
  values: Record<string, string | null>;
};

export type DeleteMutation = MutationBase & {
  kind: "delete";
  pkColumn: string;
  pkValue: string;
};

// MongoDB full-document replace: the edited document JSON, matched on its pk (_id). Staged like the
// other mutations and applied via replaceOne on Save.
export type ReplaceMutation = MutationBase & {
  kind: "replace";
  pkValue: string;
  document: string;
};

export type PendingMutation =
  | CellMutation
  | InsertMutation
  | DeleteMutation
  | ReplaceMutation;

export type HistoryEntry = {
  id: string;
  sql: string;
  status: "success" | "error";
  message: string;
  at: string;
};

type OpenNode = DatabaseNode | TableNode;

type WorkspaceContextValue = {
  tree: TreeNode[];
  consoleLines: string[];
  expandedIds: Set<string>;
  openTabIds: string[];
  activeTabId: string | null;
  activeDatabaseTab: DatabaseTab;
  nodesById: Map<string, OpenNode>;
  databaseIdByTableId: Map<string, string>;
  activeNode: OpenNode | null;
  connectionStatus: Map<string, ConnectionStatus>;
  connections: Map<string, ConnectionConfig>;
  databaseSchemas: Map<string, TableSchema[]>;
  pendingEdits: PendingMutation[];
  history: HistoryEntry[];
  splitOrientation: SplitOrientation;
  toggleSplitOrientation: () => void;
  layouts: Settings["layouts"];
  saveLayout: (group: PanelGroupKey, layout: PanelLayout) => void;
  registerPanelGroup: (
    key: PanelGroupKey,
    handle: GroupImperativeHandle | null,
  ) => void;
  getPanelGroup: (key: PanelGroupKey) => GroupImperativeHandle | null;
  toggleExpand: (id: string) => void;
  openNode: (id: string) => void;
  setActiveTab: (id: string) => void;
  closeTab: (id: string) => void;
  closeOtherTabs: (keepId: string) => void;
  closeAllTabs: () => void;
  setDatabaseTab: (tab: DatabaseTab) => void;
  newTab: () => void;
  // Create a database (optionally inside a folder) and open its settings tab. No parentId = root.
  addDatabase: (parentId?: string) => void;
  addFolder: (name: string) => void;
  // Create a new folder (optionally inside a folder) and begin renaming it inline. No parentId = root.
  createFolder: (parentId?: string) => void;
  moveNode: (dragId: string, target: MoveTarget) => void;
  moveNodes: (dragIds: string[], target: MoveTarget) => void;
  // Inline rename of any tree node (folder or database). Empty/blank name is ignored.
  renameNode: (id: string, name: string) => void;
  // Which node is being renamed inline in the sidebar (null = none), plus its controls.
  renamingNodeId: string | null;
  beginRename: (id: string) => void;
  cancelRename: () => void;
  // Sidebar multi-selection of folders/databases (tables are never selectable). A plain click
  // replaces it, Cmd/Ctrl toggles, Shift ranges from the anchor over the visible rows.
  selectedIds: Set<string>;
  selectInTree: (id: string, mode: SelectMode) => void;
  clearSelection: () => void;
  renameDatabase: (id: string, name: string) => void;
  setDatabaseAccent: (id: string, color: string | null) => void;
  setDatabaseReadOnly: (id: string, readOnly: boolean) => void;
  setDatabaseDefaultSchema: (id: string, defaultSchema: string | null) => void;
  setDatabaseManualCommit: (id: string, manualCommit: boolean) => void;
  setDatabaseVariables: (id: string, variables: Variable[]) => void;
  saveScript: (databaseId: string, name: string, sql: string) => boolean;
  // Overwrite the sql of an EXISTING saved script (matched by name). Used when Cmd/Ctrl+S is pressed
  // while a named script is the active document - it saves in place, no name prompt.
  updateScript: (databaseId: string, name: string, sql: string) => void;
  // Rename a saved script in place (first save of an `untitled`). Returns false if the new name
  // already exists on that database (caller keeps the dialog/old name).
  renameScript: (
    databaseId: string,
    oldName: string,
    newName: string,
  ) => boolean;
  deleteScript: (databaseId: string, name: string) => void;
  // Which saved script is the active document per database (the tab the editor is editing). In
  // memory only - resets to the first script on reload.
  activeScriptByDb: Map<string, string>;
  setActiveScript: (databaseId: string, name: string) => void;
  // Per-script unsaved editor draft, keyed by `${databaseId}::${scriptName}`, kept in the provider
  // so edits survive the SQL pane unmounting on a content-tab/script switch. In-memory only - the
  // saved sql is what persists to workspace.json (on Cmd/Ctrl+S).
  sqlBuffers: Map<string, string>;
  setSqlBuffer: (key: string, sql: string) => void;
  clearSqlBuffer: (key: string) => void;
  // Per-table APPLIED filter, keyed by tableId, kept in the provider so the filter survives the
  // table card unmounting on a content-tab switch (the card is a singleton keyed on the active node,
  // so its own state would otherwise reset). In-memory only - filters are ephemeral, not persisted.
  tableFilters: Map<string, string>;
  setTableFilter: (tableId: string, filter: string) => void;
  // F12 manual-commit: the write statements in each database's open transaction, keyed by db id, in
  // execution order (the Commit modal lists them). Appended per write, cleared on commit/rollback.
  txStatements: Map<string, string[]>;
  appendTxStatement: (databaseId: string, sql: string) => void;
  clearTxStatements: (databaseId: string) => void;
  // FK-navigation back/forward history: `navigateTo` records a jump (opens the target tab + applies
  // the filter, pushing a history entry from the current position); `goBack`/`goForward` walk the
  // (tableId, filter) stack, restoring both the active tab and that table's filter. In-memory only.
  navigateTo: (target: { tableId: string; filter: string }) => void;
  goBack: () => void;
  goForward: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
  // JS saved-script document tabs (F7), mirroring the SQL saveScript/... family but keyed on `code`.
  saveJsScript: (databaseId: string, name: string, code: string) => boolean;
  updateJsScript: (databaseId: string, name: string, code: string) => void;
  renameJsScript: (
    databaseId: string,
    oldName: string,
    newName: string,
  ) => boolean;
  deleteJsScript: (databaseId: string, name: string) => void;
  activeJsScriptByDb: Map<string, string>;
  setActiveJsScript: (databaseId: string, name: string) => void;
  jsBuffers: Map<string, string>;
  setJsBuffer: (key: string, code: string) => void;
  clearJsBuffer: (key: string) => void;
  // Append a line to the bottom Console log / clear it (F7 script output). The log appends across
  // runs and is only wiped by the Console Clear button.
  appendConsoleLine: (line: string) => void;
  clearConsole: () => void;
  accentColorFor: (id: string) => string | null;
  removeNode: (id: string) => void;
  removeNodes: (ids: string[]) => void;
  setConnectionStatus: (id: string, status: ConnectionStatus) => void;
  setConnection: (id: string, config: ConnectionConfig) => void;
  removeConnection: (id: string) => void;
  setDatabaseSchema: (id: string, schema: TableSchema[]) => void;
  updateDatabaseConfig: (id: string, config: ConnectionConfig) => void;
  setDatabaseTables: (id: string, tables: TableRef[]) => void;
  setDatabaseViews: (id: string, views: ViewObject[]) => void;
  upsertPendingEdit: (edit: PendingMutation) => void;
  discardPendingEdit: (id: string) => void;
  discardPendingEditsForTable: (tableId: string) => void;
  discardAllPendingEdits: () => void;
  addHistoryEntry: (entry: HistoryEntry) => void;
  clearHistory: () => void;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

// Chrome visibility (sidebar/console) lives in its OWN small context, split out of the big
// workspace value on purpose: toggling it must NOT rebuild the workspace value (which every
// content consumer - the heavy 200-row TableCard among them - subscribes to). A toggle rebuilds
// only this tiny value, so the table subtree never re-renders on Cmd+B / Cmd+J.
// Which panel should grab keyboard focus after a toggle: the just-shown panel, or
// "content" when a panel was hidden (so focus never sticks on an unmounted panel).
// A consume-once flag (not a nonce) - a freshly-mounted panel consumer focuses then
// clears it.
export type PanelFocusTarget = "sidebar" | "console" | "content" | null;

type ChromeContextValue = {
  isSidebarVisible: boolean;
  toggleSidebar: () => void;
  isConsoleVisible: boolean;
  toggleConsole: () => void;
  pendingPanelFocus: PanelFocusTarget;
  requestPanelFocus: (target: PanelFocusTarget) => void;
  consumePanelFocus: () => void;
};

const ChromeContext = createContext<ChromeContextValue | null>(null);

// The JSON-view toggle is likewise isolated: only TableView reads it, and only it flips on Mod+
// Shift+J, so keeping it out of the workspace value means neither a chrome toggle nor a JSON toggle
// churns the other's subtree.
type JsonViewContextValue = {
  isJsonView: boolean;
  toggleJsonView: () => void;
};

const JsonViewContext = createContext<JsonViewContextValue | null>(null);

// The Structure-view toggle (F6 #14) is isolated exactly like the JSON view: only TableView reads
// it and only it flips on the toggle, so keeping it out of the workspace value means neither a
// chrome toggle nor a view toggle churns the heavy TableCard subtree.
type StructureViewContextValue = {
  isStructureView: boolean;
  toggleStructureView: () => void;
};

const StructureViewContext = createContext<StructureViewContextValue | null>(
  null,
);

// The mock-data dialog's open flag (F17), isolated exactly like the JSON / Structure view toggles:
// only LiveTable reads it and only the palette command flips it on, so keeping it out of the
// workspace value means opening the dialog never churns the heavy TableCard subtree.
type MockDataContextValue = {
  isMockDataOpen: boolean;
  openMockData: () => void;
  closeMockData: () => void;
};

const MockDataContext = createContext<MockDataContextValue | null>(null);

// The table quick-open (`Mod+P`) overlay's open flag. Isolated like MockData: opening it must not
// rebuild the workspace value (which the heavy TableCard reads) - only this tiny value + the
// overlay. The searchable entries are derived from `tree` at the call site, not stored here.
type QuickOpenContextValue = {
  isQuickOpenOpen: boolean;
  openQuickOpen: () => void;
  closeQuickOpen: () => void;
};

const QuickOpenContext = createContext<QuickOpenContextValue | null>(null);

// The application file-log stream (F18). Lines are pushed from tauri-plugin-log's Webview target
// and can arrive on every query/mutation, so - like the chrome/view toggles above - this lives in
// its OWN context: an append must NOT rebuild the workspace value (which the heavy TableCard reads),
// only this tiny value + the Console subtree.
type LogLinesContextValue = {
  logLines: LogLine[];
  appendLogLine: (raw: string, level?: number) => void;
  clearLogLines: () => void;
};

const LogLinesContext = createContext<LogLinesContextValue | null>(null);

function indexNodes(nodes: TreeNode[]): Map<string, OpenNode> {
  const flatten = (node: TreeNode): OpenNode[] => {
    if (node.kind === "folder") {
      return node.children.flatMap(flatten);
    }
    if (node.kind === "database") {
      return [node, ...node.tables];
    }
    return [node];
  };
  return new Map(nodes.flatMap(flatten).map((node) => [node.id, node]));
}

function indexTableParents(nodes: TreeNode[]): Map<string, string> {
  const walk = (node: TreeNode): [string, string][] => {
    if (node.kind === "folder") {
      return node.children.flatMap(walk);
    }
    if (node.kind === "database") {
      return node.tables.map((table) => [table.id, node.id]);
    }
    return [];
  };
  return new Map(nodes.flatMap(walk));
}

function tablesFromRefs(databaseId: string, refs: TableRef[]): TableNode[] {
  return refs.map(({ schema, name }) => ({
    kind: "table",
    // The schema is part of the id so two tables that share a name across schemas
    // (public.users / analytics.users) are distinct tree nodes and tab keys.
    id: `${databaseId}::${schema ?? ""}::${name}`,
    name,
    schema,
    columns: [],
    rows: [],
  }));
}

function replaceDatabaseTables(
  nodes: TreeNode[],
  databaseId: string,
  tables: TableNode[],
): TreeNode[] {
  return nodes.map((node) => {
    if (node.kind === "folder") {
      return {
        ...node,
        children: replaceDatabaseTables(node.children, databaseId, tables),
      };
    }
    if (node.kind === "database" && node.id === databaseId) {
      return { ...node, tables };
    }
    return node;
  });
}

function replaceDatabaseViews(
  nodes: TreeNode[],
  databaseId: string,
  views: ViewObject[],
): TreeNode[] {
  return nodes.map((node) => {
    if (node.kind === "folder") {
      return {
        ...node,
        children: replaceDatabaseViews(node.children, databaseId, views),
      };
    }
    if (node.kind === "database" && node.id === databaseId) {
      return { ...node, views };
    }
    return node;
  });
}

function applyDatabaseConfig(
  nodes: TreeNode[],
  databaseId: string,
  config: ConnectionConfig,
): TreeNode[] {
  return nodes.map((node) => {
    if (node.kind === "folder") {
      return {
        ...node,
        children: applyDatabaseConfig(node.children, databaseId, config),
      };
    }
    if (node.kind === "database" && node.id === databaseId) {
      const {
        kind,
        id,
        name,
        accentColor,
        readOnly,
        manualCommit,
        defaultSchema,
        tables,
        views,
        sql,
        savedScripts,
        savedJsScripts,
        variables,
        result,
      } = node;
      return {
        kind,
        id,
        name,
        accentColor,
        readOnly,
        manualCommit,
        defaultSchema,
        tables,
        views,
        sql,
        savedScripts,
        savedJsScripts,
        variables,
        result,
        ...config,
      };
    }
    return node;
  });
}

function newDatabaseNode(id: string): DatabaseNode {
  return {
    kind: "database",
    id,
    name: "new_database",
    accentColor: null,
    readOnly: false,
    manualCommit: false,
    defaultSchema: null,
    engine: "postgres",
    host: "localhost",
    port: 5432,
    database: "",
    user: "",
    password: "",
    tables: [],
    views: [],
    sql: "",
    savedScripts: [],
    savedJsScripts: [],
    variables: [],
    result: {
      status: "success",
      timeMs: 0,
      rowCount: 0,
      columns: [],
      rows: [],
      message: "",
    },
  };
}

function newFolderNode(id: string, name: string): FolderNode {
  return { kind: "folder", id, name, children: [] };
}

function databaseIdsIn(node: TreeNode): string[] {
  if (node.kind === "folder") {
    return node.children.flatMap(databaseIdsIn);
  }
  if (node.kind === "database") {
    return [node.id];
  }
  return [];
}

function findNode(nodes: TreeNode[], targetId: string): TreeNode | null {
  for (const node of nodes) {
    if (node.id === targetId) {
      return node;
    }
    if (node.kind === "folder") {
      const found = findNode(node.children, targetId);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function removeNodeFromTree(nodes: TreeNode[], targetId: string): TreeNode[] {
  return nodes
    .filter((node) => node.id !== targetId)
    .map((node) =>
      node.kind === "folder"
        ? { ...node, children: removeNodeFromTree(node.children, targetId) }
        : node,
    );
}

// Rename ANY node (folder or database) by id. Folders recurse into their children so a nested
// target is still found.
function renameNodeInTree(
  nodes: TreeNode[],
  targetId: string,
  name: string,
): TreeNode[] {
  return nodes.map((node) => {
    if (node.id === targetId && node.kind !== "table") {
      return { ...node, name };
    }
    if (node.kind === "folder") {
      return {
        ...node,
        children: renameNodeInTree(node.children, targetId, name),
      };
    }
    return node;
  });
}

function setAccentColor(
  nodes: TreeNode[],
  databaseId: string,
  accentColor: string | null,
): TreeNode[] {
  return nodes.map((node) => {
    if (node.kind === "folder") {
      return {
        ...node,
        children: setAccentColor(node.children, databaseId, accentColor),
      };
    }
    if (node.kind === "database" && node.id === databaseId) {
      return { ...node, accentColor };
    }
    return node;
  });
}

function setReadOnly(
  nodes: TreeNode[],
  databaseId: string,
  readOnly: boolean,
): TreeNode[] {
  return nodes.map((node) => {
    if (node.kind === "folder") {
      return {
        ...node,
        children: setReadOnly(node.children, databaseId, readOnly),
      };
    }
    if (node.kind === "database" && node.id === databaseId) {
      return { ...node, readOnly };
    }
    return node;
  });
}

function setManualCommit(
  nodes: TreeNode[],
  databaseId: string,
  manualCommit: boolean,
): TreeNode[] {
  return nodes.map((node) => {
    if (node.kind === "folder") {
      return {
        ...node,
        children: setManualCommit(node.children, databaseId, manualCommit),
      };
    }
    if (node.kind === "database" && node.id === databaseId) {
      return { ...node, manualCommit };
    }
    return node;
  });
}

function setDefaultSchema(
  nodes: TreeNode[],
  databaseId: string,
  defaultSchema: string | null,
): TreeNode[] {
  return nodes.map((node) => {
    if (node.kind === "folder") {
      return {
        ...node,
        children: setDefaultSchema(node.children, databaseId, defaultSchema),
      };
    }
    if (node.kind === "database" && node.id === databaseId) {
      return { ...node, defaultSchema };
    }
    return node;
  });
}

function setVariables(
  nodes: TreeNode[],
  databaseId: string,
  variables: Variable[],
): TreeNode[] {
  return nodes.map((node) => {
    if (node.kind === "folder") {
      return {
        ...node,
        children: setVariables(node.children, databaseId, variables),
      };
    }
    if (node.kind === "database" && node.id === databaseId) {
      return { ...node, variables };
    }
    return node;
  });
}

function addSavedScript(
  nodes: TreeNode[],
  databaseId: string,
  script: SavedScript,
): TreeNode[] {
  return nodes.map((node) => {
    if (node.kind === "folder") {
      return {
        ...node,
        children: addSavedScript(node.children, databaseId, script),
      };
    }
    if (node.kind === "database" && node.id === databaseId) {
      return { ...node, savedScripts: [...node.savedScripts, script] };
    }
    return node;
  });
}

function updateSavedScript(
  nodes: TreeNode[],
  databaseId: string,
  name: string,
  sql: string,
): TreeNode[] {
  return nodes.map((node) => {
    if (node.kind === "folder") {
      return {
        ...node,
        children: updateSavedScript(node.children, databaseId, name, sql),
      };
    }
    if (node.kind === "database" && node.id === databaseId) {
      return {
        ...node,
        savedScripts: node.savedScripts.map((script) =>
          script.name === name ? { ...script, sql } : script,
        ),
      };
    }
    return node;
  });
}

function renameSavedScript(
  nodes: TreeNode[],
  databaseId: string,
  oldName: string,
  newName: string,
): TreeNode[] {
  return nodes.map((node) => {
    if (node.kind === "folder") {
      return {
        ...node,
        children: renameSavedScript(
          node.children,
          databaseId,
          oldName,
          newName,
        ),
      };
    }
    if (node.kind === "database" && node.id === databaseId) {
      return {
        ...node,
        savedScripts: node.savedScripts.map((script) =>
          script.name === oldName ? { ...script, name: newName } : script,
        ),
      };
    }
    return node;
  });
}

function removeSavedScript(
  nodes: TreeNode[],
  databaseId: string,
  name: string,
): TreeNode[] {
  return nodes.map((node) => {
    if (node.kind === "folder") {
      return {
        ...node,
        children: removeSavedScript(node.children, databaseId, name),
      };
    }
    if (node.kind === "database" && node.id === databaseId) {
      return {
        ...node,
        savedScripts: node.savedScripts.filter(
          (script) => script.name !== name,
        ),
      };
    }
    return node;
  });
}

function addSavedJsScript(
  nodes: TreeNode[],
  databaseId: string,
  script: SavedJsScript,
): TreeNode[] {
  return nodes.map((node) => {
    if (node.kind === "folder") {
      return {
        ...node,
        children: addSavedJsScript(node.children, databaseId, script),
      };
    }
    if (node.kind === "database" && node.id === databaseId) {
      return { ...node, savedJsScripts: [...node.savedJsScripts, script] };
    }
    return node;
  });
}

function updateSavedJsScript(
  nodes: TreeNode[],
  databaseId: string,
  name: string,
  code: string,
): TreeNode[] {
  return nodes.map((node) => {
    if (node.kind === "folder") {
      return {
        ...node,
        children: updateSavedJsScript(node.children, databaseId, name, code),
      };
    }
    if (node.kind === "database" && node.id === databaseId) {
      return {
        ...node,
        savedJsScripts: node.savedJsScripts.map((script) =>
          script.name === name ? { ...script, code } : script,
        ),
      };
    }
    return node;
  });
}

function renameSavedJsScript(
  nodes: TreeNode[],
  databaseId: string,
  oldName: string,
  newName: string,
): TreeNode[] {
  return nodes.map((node) => {
    if (node.kind === "folder") {
      return {
        ...node,
        children: renameSavedJsScript(
          node.children,
          databaseId,
          oldName,
          newName,
        ),
      };
    }
    if (node.kind === "database" && node.id === databaseId) {
      return {
        ...node,
        savedJsScripts: node.savedJsScripts.map((script) =>
          script.name === oldName ? { ...script, name: newName } : script,
        ),
      };
    }
    return node;
  });
}

function removeSavedJsScript(
  nodes: TreeNode[],
  databaseId: string,
  name: string,
): TreeNode[] {
  return nodes.map((node) => {
    if (node.kind === "folder") {
      return {
        ...node,
        children: removeSavedJsScript(node.children, databaseId, name),
      };
    }
    if (node.kind === "database" && node.id === databaseId) {
      return {
        ...node,
        savedJsScripts: node.savedJsScripts.filter(
          (script) => script.name !== name,
        ),
      };
    }
    return node;
  });
}

function toggleInSet(set: Set<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) {
    next.delete(id);
    return next;
  }
  next.add(id);
  return next;
}

type WorkspaceProviderProps = {
  children: ReactNode;
  tree?: TreeNode[];
  consoleLines?: string[];
  // The application log stream (F18). Defaults to the noop so tests/browser mount without a webview;
  // the real Tauri stream is injected by the route.
  logStream?: LogStream;
  initialExpandedIds?: string[];
  initialActiveTabId?: string;
  initialOpenTabIds?: string[];
  initialConnections?: [string, ConnectionConfig][];
  initialConnectionStatus?: [string, ConnectionStatus][];
  initialSidebarHidden?: boolean;
  initialConsoleHidden?: boolean;
  initialJsonView?: boolean;
  initialMockDataOpen?: boolean;
  initialQuickOpenOpen?: boolean;
  initialSplitOrientation?: SplitOrientation;
  initialLayouts?: Settings["layouts"];
  // The workspace persists only the UI-chrome slice of Settings; the theme is owned by the
  // ThemeProvider, so it is not part of this payload (the route folds it back in).
  onPersist?: (
    settings: Omit<
      Settings,
      "theme" | "shortcuts" | "windowFullscreen" | "rowLimit"
    >,
  ) => void;
  onTreeChange?: (tree: TreeNode[]) => void;
};

export function WorkspaceProvider({
  children,
  tree: initialTree = [],
  consoleLines = [],
  logStream,
  initialExpandedIds = [],
  initialActiveTabId,
  initialOpenTabIds,
  initialConnections = [],
  initialConnectionStatus = [],
  initialSidebarHidden = false,
  initialConsoleHidden = false,
  initialJsonView = false,
  initialMockDataOpen = false,
  initialQuickOpenOpen = false,
  initialSplitOrientation = "horizontal",
  initialLayouts = {},
  onPersist,
  onTreeChange,
}: WorkspaceProviderProps) {
  const [tree, setTree] = useState(initialTree);
  const nodesById = useMemo(() => indexNodes(tree), [tree]);
  const databaseIdByTableId = useMemo(() => indexTableParents(tree), [tree]);

  const [connectionStatus, setConnectionStatusMap] = useState<
    Map<string, ConnectionStatus>
  >(() => new Map(initialConnectionStatus));
  const [connections, setConnectionsMap] = useState<
    Map<string, ConnectionConfig>
  >(() => new Map(initialConnections));
  const [databaseSchemas, setDatabaseSchemasMap] = useState<
    Map<string, TableSchema[]>
  >(() => new Map());

  const [expandedIds, setExpandedIds] = useState(
    () => new Set(initialExpandedIds),
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  // The shift-click anchor: the row a range extends from. Set by a replace/toggle click, reused by
  // a following range click.
  const [selectAnchorId, setSelectAnchorId] = useState<string | null>(null);
  // The node currently being renamed inline in the sidebar (null = none).
  const [renamingNodeId, setRenamingNodeId] = useState<string | null>(null);
  const [openTabIds, setOpenTabIds] = useState<string[]>(
    initialOpenTabIds ?? (initialActiveTabId ? [initialActiveTabId] : []),
  );
  const [activeTabId, setActiveTabId] = useState<string | null>(
    initialActiveTabId ?? null,
  );
  const [activeDatabaseTab, setActiveDatabaseTab] =
    useState<DatabaseTab>("sql");
  const [pendingEdits, setPendingEdits] = useState<PendingMutation[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [sqlBuffers, setSqlBuffers] = useState<Map<string, string>>(
    () => new Map(),
  );
  const [activeScriptByDb, setActiveScriptByDb] = useState<Map<string, string>>(
    () => new Map(),
  );
  const [jsBuffers, setJsBuffers] = useState<Map<string, string>>(
    () => new Map(),
  );
  const [tableFilters, setTableFilters] = useState<Map<string, string>>(
    () => new Map(),
  );
  // The write statements run inside each database's open manual-commit transaction (F12), keyed by
  // db id, in execution order. Appended as each write is sent (SQL Run + table Save), listed by the
  // Commit modal so the user sees exactly what COMMIT will persist, cleared on commit/rollback/
  // disconnect. In-memory only (like tableFilters) - a transaction never outlives the session.
  const [txStatements, setTxStatements] = useState<Map<string, string[]>>(
    () => new Map(),
  );
  const [navHistory, setNavHistory] = useState<NavState>(EMPTY_NAV);
  const [activeJsScriptByDb, setActiveJsScriptByDb] = useState<
    Map<string, string>
  >(() => new Map());
  // The bottom Console log is state (seeded from the prop) so script output appends live; only the
  // Console Clear button wipes it (F7). Prod feeds no prop; tests may seed prior lines.
  const [consoleLinesState, setConsoleLinesState] =
    useState<string[]>(consoleLines);
  // Application file-log lines (F18), parsed on append. Prod feeds none (the log stream pushes at
  // runtime); tests seed via appendLogLine like the console lines.
  const [logLines, setLogLines] = useState<LogLine[]>([]);
  const [splitOrientation, setSplitOrientation] = useState<SplitOrientation>(
    initialSplitOrientation,
  );
  // Layouts are only ever READ as the `defaultLayout` seed at panel mount, never reactively - so
  // the value exposes a STABLE seed (never setState) while the live layout lives in a ref that only
  // saveLayout (an event handler) and the persist effect touch. react-resizable-panels fires
  // onLayoutChanged (-> saveLayout) on every programmatic panel add/remove during a sidebar/console
  // toggle; doing setState there would rebuild the workspace value and re-render the whole shell a
  // second time per toggle (the measured lag). Ref + persist keeps the layout durable, zero render.
  const [layoutsSeed] = useState(initialLayouts);
  const layoutsRef = useRef<Settings["layouts"]>(initialLayouts);
  const [isSidebarVisible, setIsSidebarVisible] =
    useState(!initialSidebarHidden);
  const [isConsoleVisible, setIsConsoleVisible] =
    useState(!initialConsoleHidden);
  const [pendingPanelFocus, setPendingPanelFocus] =
    useState<PanelFocusTarget>(null);
  const [isJsonView, setIsJsonView] = useState(initialJsonView);
  const [isStructureView, setIsStructureView] = useState(false);
  const [isMockDataOpen, setIsMockDataOpen] = useState(initialMockDataOpen);
  const [isQuickOpenOpen, setIsQuickOpenOpen] = useState(initialQuickOpenOpen);

  // These actions are consumed by the heavy, memoized DataGrid (via table-card's commitEdit). They
  // use functional setters only, so they have no reactive deps - pinning their identity with
  // useCallback([]) keeps commitEdit (and thus the grid's props) stable across unrelated context
  // rebuilds (e.g. a sidebar/console toggle), so the 200-row grid render is skipped, not repeated.
  const upsertPendingEdit = useCallback(
    (edit: PendingMutation) =>
      setPendingEdits((current) =>
        current.some((existing) => existing.id === edit.id)
          ? current.map((existing) =>
              existing.id === edit.id ? edit : existing,
            )
          : [...current, edit],
      ),
    [],
  );
  const discardPendingEdit = useCallback(
    (id: string) =>
      setPendingEdits((current) => current.filter((edit) => edit.id !== id)),
    [],
  );
  const discardPendingEditsForTable = useCallback(
    (tableId: string) =>
      setPendingEdits((current) =>
        current.filter((edit) => edit.tableId !== tableId),
      ),
    [],
  );
  const discardAllPendingEdits = useCallback(() => setPendingEdits([]), []);
  const setSqlBuffer = useCallback(
    (key: string, sql: string) =>
      setSqlBuffers((current) => new Map(current).set(key, sql)),
    [],
  );
  // Drops a script's in-memory draft so a later document reusing the same buffer key (e.g. a fresh
  // "untitled" after the previous one was renamed) starts blank instead of inheriting stale text.
  const clearSqlBuffer = useCallback(
    (key: string) =>
      setSqlBuffers((current) => {
        if (!current.has(key)) {
          return current;
        }
        const next = new Map(current);
        next.delete(key);
        return next;
      }),
    [],
  );
  const setTableFilter = useCallback(
    (tableId: string, filter: string) =>
      setTableFilters((current) => new Map(current).set(tableId, filter)),
    [],
  );
  // Records one write statement into a database's open-transaction list (F12). Appended in send
  // order as each write is dispatched; the Commit modal lists them.
  const appendTxStatement = useCallback(
    (databaseId: string, sql: string) =>
      setTxStatements((current) =>
        new Map(current).set(databaseId, [
          ...(current.get(databaseId) ?? []),
          sql,
        ]),
      ),
    [],
  );
  // Drops a database's recorded transaction statements (on commit / rollback / disconnect).
  const clearTxStatements = useCallback(
    (databaseId: string) =>
      setTxStatements((current) => {
        if (!current.has(databaseId)) {
          return current;
        }
        const next = new Map(current);
        next.delete(databaseId);
        return next;
      }),
    [],
  );
  const setActiveScript = useCallback(
    (databaseId: string, name: string) =>
      setActiveScriptByDb((current) => new Map(current).set(databaseId, name)),
    [],
  );
  const setJsBuffer = useCallback(
    (key: string, code: string) =>
      setJsBuffers((current) => new Map(current).set(key, code)),
    [],
  );
  const clearJsBuffer = useCallback(
    (key: string) =>
      setJsBuffers((current) => {
        if (!current.has(key)) {
          return current;
        }
        const next = new Map(current);
        next.delete(key);
        return next;
      }),
    [],
  );
  const setActiveJsScript = useCallback(
    (databaseId: string, name: string) =>
      setActiveJsScriptByDb((current) =>
        new Map(current).set(databaseId, name),
      ),
    [],
  );
  const appendConsoleLine = useCallback(
    (line: string) => setConsoleLinesState((current) => [...current, line]),
    [],
  );
  const clearConsole = useCallback(() => setConsoleLinesState([]), []);
  const appendLogLine = useCallback(
    (raw: string, level?: number) =>
      setLogLines((current) => [...current, parseLogLine(raw, level)]),
    [],
  );
  const clearLogLines = useCallback(() => setLogLines([]), []);
  // saveLayout persists a panel-group layout WITHOUT setState (layouts are read only as the
  // defaultLayout seed). It writes the ref and re-persists the full chrome payload, which it reads
  // from persistPayloadRef (kept current by the render below) so this stays a stable useCallback
  // with no reactive deps - a layout write never rebuilds the workspace value.
  const persistPayloadRef = useRef<Omit<
    Settings,
    "theme" | "shortcuts" | "windowFullscreen" | "rowLimit"
  > | null>(null);
  const onPersistRef = useRef(onPersist);
  useEffect(() => {
    onPersistRef.current = onPersist;
  }, [onPersist]);
  const saveLayout = useCallback(
    (group: PanelGroupKey, layout: PanelLayout) => {
      const current = layoutsRef.current[group];
      if (JSON.stringify(current) === JSON.stringify(layout)) {
        return;
      }
      layoutsRef.current = { ...layoutsRef.current, [group]: layout };
      const payload = persistPayloadRef.current;
      if (payload && onPersistRef.current) {
        onPersistRef.current({ ...payload, layouts: layoutsRef.current });
      }
    },
    [],
  );

  // Imperative handles for the mounted resizable panel groups, keyed by group. A keyboard/palette
  // resize reads a group's handle to getLayout()/setLayout() it (setLayout fires onLayoutChanged ->
  // saveLayout, so the resize persists for free). Ref-based: never persisted, never reactive.
  const panelGroups = useRef<Map<PanelGroupKey, GroupImperativeHandle>>(
    new Map(),
  );
  const registerPanelGroup = useCallback(
    (key: PanelGroupKey, handle: GroupImperativeHandle | null) => {
      if (handle) {
        panelGroups.current.set(key, handle);
        return;
      }
      panelGroups.current.delete(key);
    },
    [],
  );
  const getPanelGroup = useCallback(
    (key: PanelGroupKey) => panelGroups.current.get(key) ?? null,
    [],
  );

  const clearHistory = useCallback(() => setHistory([]), []);
  const addHistoryEntry = useCallback(
    (entry: HistoryEntry) =>
      setHistory((current) =>
        current.some((existing) => existing.id === entry.id)
          ? current
          : [entry, ...current].slice(0, 100),
      ),
    [],
  );

  const value = useMemo<WorkspaceContextValue>(() => {
    const openNode = (id: string) => {
      if (!nodesById.has(id)) {
        return;
      }
      setOpenTabIds((current) =>
        current.includes(id) ? current : [...current, id],
      );
      setActiveTabId(id);
    };

    const closeTab = (id: string) => {
      setOpenTabIds((current) => {
        const index = current.indexOf(id);
        if (index === -1) {
          return current;
        }
        const next = current.filter((openId) => openId !== id);
        setActiveTabId((active) => {
          if (active !== id) {
            return active;
          }
          return next[Math.min(index, next.length - 1)] ?? null;
        });
        return next;
      });
    };

    // Remove one or more tree nodes in a single pass: drop each from the tree, close any tab a
    // removed database (or a database inside a removed folder) had open, and forget its connection.
    // The single-row delete and the bulk multi-select delete both flow through here.
    const removeNodes = (ids: string[]) => {
      const removedDbIds = ids.flatMap((id) => {
        const node = findNode(tree, id);
        return node ? databaseIdsIn(node) : [id];
      });
      setTree((current) =>
        ids.reduce((acc, id) => removeNodeFromTree(acc, id), current),
      );
      setSelectedIds((current) => {
        if (ids.every((id) => !current.has(id))) {
          return current;
        }
        const next = new Set(current);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      removedDbIds.forEach(closeTab);
      if (removedDbIds.length > 0) {
        setConnectionsMap((current) => {
          const next = new Map(current);
          removedDbIds.forEach((dbId) => next.delete(dbId));
          return next;
        });
        setConnectionStatusMap((current) => {
          const next = new Map(current);
          removedDbIds.forEach((dbId) => next.delete(dbId));
          return next;
        });
      }
    };

    return {
      tree,
      consoleLines: consoleLinesState,
      expandedIds,
      openTabIds,
      activeTabId,
      activeDatabaseTab,
      nodesById,
      databaseIdByTableId,
      activeNode:
        activeTabId !== null ? (nodesById.get(activeTabId) ?? null) : null,
      toggleExpand: (id) =>
        setExpandedIds((current) => toggleInSet(current, id)),
      openNode,
      setActiveTab: setActiveTabId,
      closeTab,
      closeOtherTabs: (keepId) => {
        setOpenTabIds((current) =>
          current.includes(keepId) ? [keepId] : current,
        );
        setActiveTabId((active) => (active === keepId ? active : keepId));
      },
      closeAllTabs: () => {
        setOpenTabIds([]);
        setActiveTabId(null);
      },
      setDatabaseTab: setActiveDatabaseTab,
      newTab: () => {},
      addDatabase: (parentId) => {
        const id = crypto.randomUUID();
        setTree((current) =>
          parentId
            ? insertNode(
                current,
                parentId,
                Number.MAX_SAFE_INTEGER,
                newDatabaseNode(id),
              )
            : [...current, newDatabaseNode(id)],
        );
        if (parentId) {
          setExpandedIds((current) => new Set(current).add(parentId));
        }
        setConnectionStatusMap((current) => new Map(current).set(id, "idle"));
        setOpenTabIds((current) =>
          current.includes(id) ? current : [...current, id],
        );
        setActiveTabId(id);
        setActiveDatabaseTab("settings");
      },
      addFolder: (name) =>
        setTree((current) => [
          ...current,
          newFolderNode(crypto.randomUUID(), name),
        ]),
      createFolder: (parentId) => {
        const id = crypto.randomUUID();
        const folder = newFolderNode(id, "New folder");
        setTree((current) =>
          parentId
            ? insertNode(current, parentId, Number.MAX_SAFE_INTEGER, folder)
            : [...current, folder],
        );
        if (parentId) {
          setExpandedIds((current) => new Set(current).add(parentId));
        }
        // Open the inline editor so the user names it immediately, requi-style.
        setRenamingNodeId(id);
      },
      moveNode: (dragId, target) =>
        setTree((current) => moveTreeNode(current, dragId, target)),
      moveNodes: (dragIds, target) =>
        setTree((current) => moveTreeNodes(current, dragIds, target)),
      renameDatabase: (id, name) =>
        setTree((current) => renameNodeInTree(current, id, name)),
      renameNode: (id, name) => {
        if (name.trim() === "") {
          setRenamingNodeId(null);
          return;
        }
        setTree((current) => renameNodeInTree(current, id, name.trim()));
        setRenamingNodeId(null);
      },
      renamingNodeId,
      beginRename: (id) => setRenamingNodeId(id),
      cancelRename: () => setRenamingNodeId(null),
      setDatabaseAccent: (id, color) =>
        setTree((current) => setAccentColor(current, id, color)),
      setDatabaseReadOnly: (id, readOnly) =>
        setTree((current) => setReadOnly(current, id, readOnly)),
      setDatabaseDefaultSchema: (id, defaultSchema) =>
        setTree((current) => setDefaultSchema(current, id, defaultSchema)),
      setDatabaseManualCommit: (id, manualCommit) =>
        setTree((current) => setManualCommit(current, id, manualCommit)),
      setDatabaseVariables: (id, variables) =>
        setTree((current) => setVariables(current, id, variables)),
      saveScript: (databaseId, name, sql) => {
        const trimmed = name.trim();
        const node = nodesById.get(databaseId);
        if (!node || node.kind !== "database") {
          return false;
        }
        if (node.savedScripts.some((script) => script.name === trimmed)) {
          return false;
        }
        setTree((current) =>
          addSavedScript(current, databaseId, { name: trimmed, sql }),
        );
        return true;
      },
      updateScript: (databaseId, name, sql) =>
        setTree((current) => updateSavedScript(current, databaseId, name, sql)),
      renameScript: (databaseId, oldName, newName) => {
        const trimmed = newName.trim();
        const node = nodesById.get(databaseId);
        if (!node || node.kind !== "database") {
          return false;
        }
        if (
          trimmed !== oldName &&
          node.savedScripts.some((script) => script.name === trimmed)
        ) {
          return false;
        }
        setTree((current) =>
          renameSavedScript(current, databaseId, oldName, trimmed),
        );
        return true;
      },
      deleteScript: (databaseId, name) =>
        setTree((current) => removeSavedScript(current, databaseId, name)),
      activeScriptByDb,
      setActiveScript,
      sqlBuffers,
      setSqlBuffer,
      clearSqlBuffer,
      tableFilters,
      setTableFilter,
      txStatements,
      appendTxStatement,
      clearTxStatements,
      navigateTo: (target) => {
        const from = {
          tableId: activeTabId ?? "",
          filter: (activeTabId && tableFilters.get(activeTabId)) || "",
        };
        setNavHistory((current) => pushNavigation(current, from, target));
        setTableFilters((current) =>
          new Map(current).set(target.tableId, target.filter),
        );
        openNode(target.tableId);
      },
      goBack: () => {
        const next = goBackNav(navHistory);
        if (next === navHistory) {
          return;
        }
        const entry = currentEntry(next);
        setNavHistory(next);
        if (entry) {
          setTableFilters((current) =>
            new Map(current).set(entry.tableId, entry.filter),
          );
          openNode(entry.tableId);
        }
      },
      goForward: () => {
        const next = goForwardNav(navHistory);
        if (next === navHistory) {
          return;
        }
        const entry = currentEntry(next);
        setNavHistory(next);
        if (entry) {
          setTableFilters((current) =>
            new Map(current).set(entry.tableId, entry.filter),
          );
          openNode(entry.tableId);
        }
      },
      canGoBack: canGoBack(navHistory),
      canGoForward: canGoForward(navHistory),
      saveJsScript: (databaseId, name, code) => {
        const trimmed = name.trim();
        const node = nodesById.get(databaseId);
        if (!node || node.kind !== "database") {
          return false;
        }
        if (node.savedJsScripts.some((script) => script.name === trimmed)) {
          return false;
        }
        setTree((current) =>
          addSavedJsScript(current, databaseId, { name: trimmed, code }),
        );
        return true;
      },
      updateJsScript: (databaseId, name, code) =>
        setTree((current) =>
          updateSavedJsScript(current, databaseId, name, code),
        ),
      renameJsScript: (databaseId, oldName, newName) => {
        const trimmed = newName.trim();
        const node = nodesById.get(databaseId);
        if (!node || node.kind !== "database") {
          return false;
        }
        if (
          trimmed !== oldName &&
          node.savedJsScripts.some((script) => script.name === trimmed)
        ) {
          return false;
        }
        setTree((current) =>
          renameSavedJsScript(current, databaseId, oldName, trimmed),
        );
        return true;
      },
      deleteJsScript: (databaseId, name) =>
        setTree((current) => removeSavedJsScript(current, databaseId, name)),
      activeJsScriptByDb,
      setActiveJsScript,
      jsBuffers,
      setJsBuffer,
      clearJsBuffer,
      appendConsoleLine,
      clearConsole,
      accentColorFor: (id) => {
        const node = nodesById.get(id);
        if (!node) {
          return null;
        }
        if (node.kind === "database") {
          return node.accentColor;
        }
        const databaseId = databaseIdByTableId.get(id);
        const database = databaseId ? nodesById.get(databaseId) : undefined;
        return database?.kind === "database" ? database.accentColor : null;
      },
      removeNode: (id) => removeNodes([id]),
      removeNodes,
      selectedIds,
      selectInTree: (id, mode) => {
        if (mode === "toggle") {
          setSelectedIds((current) => toggleInSet(current, id));
          setSelectAnchorId(id);
          return;
        }
        if (mode === "range" && selectAnchorId !== null) {
          const ordered = flattenSelectable(tree, expandedIds);
          setSelectedIds(new Set(rangeBetween(ordered, selectAnchorId, id)));
          return;
        }
        setSelectedIds(new Set([id]));
        setSelectAnchorId(id);
      },
      clearSelection: () => {
        setSelectedIds(new Set());
        setSelectAnchorId(null);
      },
      connectionStatus,
      connections,
      databaseSchemas,
      setConnectionStatus: (id, status) =>
        setConnectionStatusMap((current) => new Map(current).set(id, status)),
      setConnection: (id, config) =>
        setConnectionsMap((current) => new Map(current).set(id, config)),
      removeConnection: (id) => {
        setConnectionsMap((current) => {
          const next = new Map(current);
          next.delete(id);
          return next;
        });
        setDatabaseSchemasMap((current) => {
          const next = new Map(current);
          next.delete(id);
          return next;
        });
      },
      setDatabaseSchema: (id, schema) =>
        setDatabaseSchemasMap((current) => new Map(current).set(id, schema)),
      updateDatabaseConfig: (id, config) =>
        setTree((current) => applyDatabaseConfig(current, id, config)),
      setDatabaseTables: (id, tables) =>
        setTree((current) =>
          replaceDatabaseTables(current, id, tablesFromRefs(id, tables)),
        ),
      setDatabaseViews: (id, views) =>
        setTree((current) => replaceDatabaseViews(current, id, views)),
      pendingEdits,
      upsertPendingEdit,
      discardPendingEdit,
      discardPendingEditsForTable,
      discardAllPendingEdits,
      history,
      addHistoryEntry,
      clearHistory,
      splitOrientation,
      toggleSplitOrientation: () =>
        setSplitOrientation((current) =>
          current === "horizontal" ? "vertical" : "horizontal",
        ),
      layouts: layoutsSeed,
      saveLayout,
      registerPanelGroup,
      getPanelGroup,
    };
  }, [
    layoutsSeed,
    saveLayout,
    registerPanelGroup,
    getPanelGroup,
    tree,
    consoleLinesState,
    expandedIds,
    selectedIds,
    selectAnchorId,
    renamingNodeId,
    openTabIds,
    activeTabId,
    activeDatabaseTab,
    nodesById,
    databaseIdByTableId,
    connectionStatus,
    connections,
    databaseSchemas,
    pendingEdits,
    history,
    splitOrientation,
    activeScriptByDb,
    setActiveScript,
    sqlBuffers,
    setSqlBuffer,
    clearSqlBuffer,
    tableFilters,
    setTableFilter,
    txStatements,
    appendTxStatement,
    clearTxStatements,
    navHistory,
    activeJsScriptByDb,
    setActiveJsScript,
    jsBuffers,
    setJsBuffer,
    clearJsBuffer,
    appendConsoleLine,
    clearConsole,
    upsertPendingEdit,
    discardPendingEdit,
    discardPendingEditsForTable,
    discardAllPendingEdits,
    addHistoryEntry,
    clearHistory,
  ]);

  // Split-out chrome value: rebuilds ONLY when a visibility bool flips (functional-setter toggles
  // are stable), so a sidebar/console toggle never rebuilds the big workspace value above.
  const chromeValue = useMemo<ChromeContextValue>(
    () => ({
      isSidebarVisible,
      // Toggling visible moves focus into the panel (arrows work immediately);
      // toggling hidden returns focus to the content area so it never sticks on the
      // unmounted panel.
      toggleSidebar: () =>
        setIsSidebarVisible((current) => {
          setPendingPanelFocus(current ? "content" : "sidebar");
          return !current;
        }),
      isConsoleVisible,
      toggleConsole: () =>
        setIsConsoleVisible((current) => {
          setPendingPanelFocus(current ? "content" : "console");
          return !current;
        }),
      pendingPanelFocus,
      requestPanelFocus: (target) => setPendingPanelFocus(target),
      consumePanelFocus: () => setPendingPanelFocus(null),
    }),
    [isSidebarVisible, isConsoleVisible, pendingPanelFocus],
  );

  const jsonViewValue = useMemo<JsonViewContextValue>(
    () => ({
      isJsonView,
      toggleJsonView: () => setIsJsonView((current) => !current),
    }),
    [isJsonView],
  );

  const structureViewValue = useMemo<StructureViewContextValue>(
    () => ({
      isStructureView,
      toggleStructureView: () => setIsStructureView((current) => !current),
    }),
    [isStructureView],
  );

  const mockDataValue = useMemo<MockDataContextValue>(
    () => ({
      isMockDataOpen,
      openMockData: () => setIsMockDataOpen(true),
      closeMockData: () => setIsMockDataOpen(false),
    }),
    [isMockDataOpen],
  );

  const quickOpenValue = useMemo<QuickOpenContextValue>(
    () => ({
      isQuickOpenOpen,
      openQuickOpen: () => setIsQuickOpenOpen(true),
      closeQuickOpen: () => setIsQuickOpenOpen(false),
    }),
    [isQuickOpenOpen],
  );

  const logLinesValue = useMemo<LogLinesContextValue>(
    () => ({ logLines, appendLogLine, clearLogLines }),
    [logLines, appendLogLine, clearLogLines],
  );

  // The current chrome payload, minus layouts (which saveLayout owns via layoutsRef). Kept in a ref
  // so saveLayout can re-persist with the latest chrome without being a reactive dep.
  const chromePayload = useMemo(
    () => ({
      version: 1 as const,
      sidebarHidden: !isSidebarVisible,
      consoleHidden: !isConsoleVisible,
      splitOrientation,
      layouts: layoutsSeed,
      expandedIds: [...expandedIds],
      openTabIds,
      activeTabId,
    }),
    [
      isSidebarVisible,
      isConsoleVisible,
      splitOrientation,
      layoutsSeed,
      expandedIds,
      openTabIds,
      activeTabId,
    ],
  );

  useEffect(() => {
    // Persist with the LIVE layouts (ref), and stash the payload so saveLayout can re-persist chrome
    // without a reactive dep. The payload's own `layouts` field (the seed) is overridden here.
    const withLiveLayouts = { ...chromePayload, layouts: layoutsRef.current };
    persistPayloadRef.current = withLiveLayouts;
    if (onPersist) {
      onPersist(withLiveLayouts);
    }
  }, [onPersist, chromePayload]);

  useEffect(() => {
    if (onTreeChange) {
      onTreeChange(tree);
    }
  }, [onTreeChange, tree]);

  // Subscribe the injected log stream to appendLogLine once on mount (appendLogLine has stable
  // identity). The subscribe resolves async, so an unsubscribe that lands after unmount is called
  // immediately via the disposed flag. Defaults to the noop stream (browser/test).
  useEffect(() => {
    const stream = logStream ?? createNoopLogStream();
    let disposed = false;
    let unsubscribe: (() => void) | null = null;
    stream.subscribe(appendLogLine).then((fn) => {
      if (disposed) {
        fn();
        return;
      }
      unsubscribe = fn;
    });
    return () => {
      disposed = true;
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [logStream, appendLogLine]);

  return (
    <WorkspaceContext.Provider value={value}>
      <ChromeContext.Provider value={chromeValue}>
        <JsonViewContext.Provider value={jsonViewValue}>
          <StructureViewContext.Provider value={structureViewValue}>
            <MockDataContext.Provider value={mockDataValue}>
              <QuickOpenContext.Provider value={quickOpenValue}>
                <LogLinesContext.Provider value={logLinesValue}>
                  {children}
                </LogLinesContext.Provider>
              </QuickOpenContext.Provider>
            </MockDataContext.Provider>
          </StructureViewContext.Provider>
        </JsonViewContext.Provider>
      </ChromeContext.Provider>
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (!value) {
    throw new Error("useWorkspace must be used within a WorkspaceProvider");
  }
  return value;
}

export function useChrome(): ChromeContextValue {
  const value = useContext(ChromeContext);
  if (!value) {
    throw new Error("useChrome must be used within a WorkspaceProvider");
  }
  return value;
}

// Optional so a component outside the provider (isolated test) still renders; the JSON view toggle
// is only meaningful inside the workspace.
export function useJsonView(): JsonViewContextValue {
  return (
    useContext(JsonViewContext) ?? {
      isJsonView: false,
      toggleJsonView: () => {},
    }
  );
}

// Optional (like useJsonView) so a component rendered outside the provider still works; the
// Structure view toggle is only meaningful inside the workspace.
export function useStructureView(): StructureViewContextValue {
  return (
    useContext(StructureViewContext) ?? {
      isStructureView: false,
      toggleStructureView: () => {},
    }
  );
}

// Optional (like useStructureView) so a component rendered outside the provider still works; the
// mock-data dialog is only meaningful inside the workspace.
export function useMockData(): MockDataContextValue {
  return (
    useContext(MockDataContext) ?? {
      isMockDataOpen: false,
      openMockData: () => {},
      closeMockData: () => {},
    }
  );
}

// Optional (like the other isolated hooks) so a component rendered outside the provider still works.
export function useQuickOpen(): QuickOpenContextValue {
  return (
    useContext(QuickOpenContext) ?? {
      isQuickOpenOpen: false,
      openQuickOpen: () => {},
      closeQuickOpen: () => {},
    }
  );
}

// Optional (like the other isolated hooks) so a component rendered outside the provider still
// works; the application log stream is only meaningful inside the workspace.
export function useLogLines(): LogLinesContextValue {
  return (
    useContext(LogLinesContext) ?? {
      logLines: [],
      appendLogLine: () => {},
      clearLogLines: () => {},
    }
  );
}
