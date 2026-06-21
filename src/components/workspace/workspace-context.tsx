import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type {
  PanelGroupKey,
  PanelLayout,
  Settings,
} from "@/lib/settings/settings";
import {
  mockConsoleLines,
  mockTree,
  type ConnectionConfig,
  type ConnectionStatus,
  type DatabaseNode,
  type FolderNode,
  type TableNode,
  type TreeNode,
} from "@/components/workspace/mock-data";

export type DatabaseTab = "sql" | "views" | "script" | "settings";

export type SplitOrientation = "horizontal" | "vertical";

export type PendingEdit = {
  id: string;
  tableId: string;
  tableName: string;
  column: string;
  rowIndex: number;
  pkValue: string | null;
  oldValue: string | null;
  newValue: string;
  sql: string;
};

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
  pendingEdits: PendingEdit[];
  history: HistoryEntry[];
  splitOrientation: SplitOrientation;
  toggleSplitOrientation: () => void;
  layouts: Settings["layouts"];
  saveLayout: (group: PanelGroupKey, layout: PanelLayout) => void;
  isSidebarVisible: boolean;
  toggleSidebar: () => void;
  isConsoleVisible: boolean;
  toggleConsole: () => void;
  toggleExpand: (id: string) => void;
  openNode: (id: string) => void;
  setActiveTab: (id: string) => void;
  closeTab: (id: string) => void;
  closeAllTabs: () => void;
  setDatabaseTab: (tab: DatabaseTab) => void;
  newTab: () => void;
  addDatabase: () => void;
  addFolder: (name: string) => void;
  renameDatabase: (id: string, name: string) => void;
  removeNode: (id: string) => void;
  setConnectionStatus: (id: string, status: ConnectionStatus) => void;
  setConnection: (id: string, config: ConnectionConfig) => void;
  removeConnection: (id: string) => void;
  updateDatabaseConfig: (id: string, config: ConnectionConfig) => void;
  setDatabaseTables: (id: string, tableNames: string[]) => void;
  upsertPendingEdit: (edit: PendingEdit) => void;
  discardPendingEdit: (id: string) => void;
  discardPendingEditsForTable: (tableId: string) => void;
  addHistoryEntry: (entry: HistoryEntry) => void;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

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

function tablesFromNames(databaseId: string, names: string[]): TableNode[] {
  return names.map((name) => ({
    kind: "table",
    id: `${databaseId}::${name}`,
    name,
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
      return { ...node, ...config };
    }
    return node;
  });
}

function newDatabaseNode(id: string): DatabaseNode {
  return {
    kind: "database",
    id,
    name: "new_database",
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
    script: "",
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

function renameNode(
  nodes: TreeNode[],
  databaseId: string,
  name: string,
): TreeNode[] {
  return nodes.map((node) => {
    if (node.kind === "folder") {
      return { ...node, children: renameNode(node.children, databaseId, name) };
    }
    if (node.kind === "database" && node.id === databaseId) {
      return { ...node, name };
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
  initialExpandedIds?: string[];
  initialActiveTabId?: string;
  initialOpenTabIds?: string[];
  initialConnections?: [string, ConnectionConfig][];
  initialConnectionStatus?: [string, ConnectionStatus][];
  initialSidebarHidden?: boolean;
  initialConsoleHidden?: boolean;
  initialSplitOrientation?: SplitOrientation;
  initialLayouts?: Settings["layouts"];
  onPersist?: (settings: Settings) => void;
  onTreeChange?: (tree: TreeNode[]) => void;
};

export function WorkspaceProvider({
  children,
  tree: initialTree = mockTree,
  consoleLines = mockConsoleLines,
  initialExpandedIds = [],
  initialActiveTabId,
  initialOpenTabIds,
  initialConnections = [],
  initialConnectionStatus = [],
  initialSidebarHidden = false,
  initialConsoleHidden = false,
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

  const [expandedIds, setExpandedIds] = useState(
    () => new Set(initialExpandedIds),
  );
  const [openTabIds, setOpenTabIds] = useState<string[]>(
    initialOpenTabIds ?? (initialActiveTabId ? [initialActiveTabId] : []),
  );
  const [activeTabId, setActiveTabId] = useState<string | null>(
    initialActiveTabId ?? null,
  );
  const [activeDatabaseTab, setActiveDatabaseTab] =
    useState<DatabaseTab>("sql");
  const [pendingEdits, setPendingEdits] = useState<PendingEdit[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [splitOrientation, setSplitOrientation] = useState<SplitOrientation>(
    initialSplitOrientation,
  );
  const [layouts, setLayouts] = useState<Settings["layouts"]>(initialLayouts);
  const [isSidebarVisible, setIsSidebarVisible] = useState(
    !initialSidebarHidden,
  );
  const [isConsoleVisible, setIsConsoleVisible] = useState(!initialConsoleHidden);

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

    return {
      tree,
      consoleLines,
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
      closeAllTabs: () => {
        setOpenTabIds([]);
        setActiveTabId(null);
      },
      setDatabaseTab: setActiveDatabaseTab,
      newTab: () => {},
      addDatabase: () => {
        const id = crypto.randomUUID();
        setTree((current) => [...current, newDatabaseNode(id)]);
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
      renameDatabase: (id, name) =>
        setTree((current) => renameNode(current, id, name)),
      removeNode: (id) => {
        const node = findNode(tree, id);
        const removedDbIds = node ? databaseIdsIn(node) : [id];
        setTree((current) => removeNodeFromTree(current, id));
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
      },
      connectionStatus,
      connections,
      setConnectionStatus: (id, status) =>
        setConnectionStatusMap((current) => new Map(current).set(id, status)),
      setConnection: (id, config) =>
        setConnectionsMap((current) => new Map(current).set(id, config)),
      removeConnection: (id) =>
        setConnectionsMap((current) => {
          const next = new Map(current);
          next.delete(id);
          return next;
        }),
      updateDatabaseConfig: (id, config) =>
        setTree((current) => applyDatabaseConfig(current, id, config)),
      setDatabaseTables: (id, tableNames) =>
        setTree((current) =>
          replaceDatabaseTables(current, id, tablesFromNames(id, tableNames)),
        ),
      pendingEdits,
      upsertPendingEdit: (edit) =>
        setPendingEdits((current) => [
          ...current.filter((existing) => existing.id !== edit.id),
          edit,
        ]),
      discardPendingEdit: (id) =>
        setPendingEdits((current) => current.filter((edit) => edit.id !== id)),
      discardPendingEditsForTable: (tableId) =>
        setPendingEdits((current) =>
          current.filter((edit) => edit.tableId !== tableId),
        ),
      history,
      addHistoryEntry: (entry) =>
        setHistory((current) =>
          current.some((existing) => existing.id === entry.id)
            ? current
            : [entry, ...current].slice(0, 100),
        ),
      splitOrientation,
      toggleSplitOrientation: () =>
        setSplitOrientation((current) =>
          current === "horizontal" ? "vertical" : "horizontal",
        ),
      layouts,
      saveLayout: (group, layout) =>
        setLayouts((current) => ({ ...current, [group]: layout })),
      isSidebarVisible,
      toggleSidebar: () => setIsSidebarVisible((current) => !current),
      isConsoleVisible,
      toggleConsole: () => setIsConsoleVisible((current) => !current),
    };
  }, [
    tree,
    consoleLines,
    expandedIds,
    openTabIds,
    activeTabId,
    activeDatabaseTab,
    nodesById,
    databaseIdByTableId,
    connectionStatus,
    connections,
    pendingEdits,
    history,
    splitOrientation,
    layouts,
    isSidebarVisible,
    isConsoleVisible,
  ]);

  useEffect(() => {
    if (!onPersist) {
      return;
    }
    onPersist({
      version: 1,
      sidebarHidden: !isSidebarVisible,
      consoleHidden: !isConsoleVisible,
      splitOrientation,
      layouts,
      expandedIds: [...expandedIds],
      openTabIds,
      activeTabId,
    });
  }, [
    onPersist,
    isSidebarVisible,
    isConsoleVisible,
    splitOrientation,
    layouts,
    expandedIds,
    openTabIds,
    activeTabId,
  ]);

  useEffect(() => {
    if (onTreeChange) {
      onTreeChange(tree);
    }
  }, [onTreeChange, tree]);

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
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
