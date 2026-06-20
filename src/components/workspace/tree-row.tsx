import { ChevronDown, ChevronRight, Database, Table } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/components/workspace/workspace-context";
import type {
  ConnectionStatus,
  DatabaseNode,
  FolderNode,
  TableNode,
  TreeNode,
} from "@/components/workspace/mock-data";

function FolderRow({ node, depth }: { node: FolderNode; depth: number }) {
  const { expandedIds, toggleExpand } = useWorkspace();
  const isExpanded = expandedIds.has(node.id);
  const Chevron = isExpanded ? ChevronDown : ChevronRight;

  return (
    <li>
      <div
        role="treeitem"
        aria-expanded={isExpanded}
        tabIndex={0}
        onClick={() => toggleExpand(node.id)}
        style={{ paddingLeft: `${depth * 14 + 6}px` }}
        className="flex cursor-pointer items-center gap-1 py-1 pr-2 text-[13px] hover:bg-accent"
      >
        <Chevron className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{node.name}</span>
      </div>
      {isExpanded ? (
        <ul role="group">
          {node.children.map((child) => (
            <TreeRow key={child.id} node={child} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

const STATUS_DOT_COLOR: Partial<Record<ConnectionStatus, string>> = {
  connected: "bg-green-500",
  error: "bg-red-500",
};

function DatabaseRow({ node, depth }: { node: DatabaseNode; depth: number }) {
  const { expandedIds, activeTabId, toggleExpand, openNode, connectionStatus } =
    useWorkspace();
  const isExpanded = expandedIds.has(node.id);
  const isSelected = activeTabId === node.id;
  const Chevron = isExpanded ? ChevronDown : ChevronRight;
  const status = connectionStatus.get(node.id) ?? "idle";
  const dotColor = STATUS_DOT_COLOR[status];
  const isConnected = status === "connected";

  return (
    <li>
      <div
        role="treeitem"
        aria-expanded={isExpanded}
        aria-selected={isSelected}
        aria-label={node.name}
        tabIndex={0}
        onClick={() => openNode(node.id)}
        style={{ paddingLeft: `${depth * 14 + 6}px` }}
        className={cn(
          "flex cursor-pointer items-center gap-1 py-1 pr-2 text-[13px] hover:bg-accent",
          isSelected && "bg-accent",
        )}
      >
        <button
          type="button"
          aria-label={`Toggle ${node.name} tables`}
          onClick={(event) => {
            event.stopPropagation();
            toggleExpand(node.id);
          }}
          className="flex shrink-0 items-center rounded-sm text-muted-foreground hover:text-foreground"
        >
          <Chevron className="size-3.5" />
        </button>
        <Database className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{node.name}</span>
        {dotColor ? (
          <span
            role="img"
            aria-label={`${node.name} ${status}`}
            className={cn("ml-auto size-2 shrink-0 rounded-full", dotColor)}
          />
        ) : null}
      </div>
      {isExpanded && isConnected ? (
        <ul role="group">
          {node.tables.map((table) => (
            <TreeRow key={table.id} node={table} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function TableRow({ node, depth }: { node: TableNode; depth: number }) {
  const { activeTabId, openNode } = useWorkspace();
  const isSelected = activeTabId === node.id;

  return (
    <li>
      <div
        role="treeitem"
        aria-selected={isSelected}
        aria-label={node.name}
        tabIndex={0}
        onClick={() => openNode(node.id)}
        style={{ paddingLeft: `${depth * 14 + 10}px` }}
        className={cn(
          "flex cursor-pointer items-center gap-2 py-1 pr-2 text-[13px] hover:bg-accent",
          isSelected && "bg-accent",
        )}
      >
        <Table className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{node.name}</span>
      </div>
    </li>
  );
}

export function TreeRow({ node, depth }: { node: TreeNode; depth: number }) {
  if (node.kind === "folder") {
    return <FolderRow node={node} depth={depth} />;
  }
  if (node.kind === "database") {
    return <DatabaseRow node={node} depth={depth} />;
  }
  return <TableRow node={node} depth={depth} />;
}
