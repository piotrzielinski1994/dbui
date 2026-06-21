import { useWorkspace } from "@/components/workspace/workspace-context";
import { cn } from "@/lib/utils";
import { Database, Plus, Table, X } from "lucide-react";

export function ContentHeader() {
  const {
    openTabIds,
    activeTabId,
    nodesById,
    setActiveTab,
    closeTab,
    addDatabase,
  } = useWorkspace();

  return (
    <div className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b bg-muted/30">
      <div
        role="tablist"
        aria-label="Open tabs"
        className="flex h-full items-stretch"
      >
        {openTabIds.map((id) => {
          const node = nodesById.get(id);
          if (!node) {
            return null;
          }
          const isActive = id === activeTabId;
          const Icon = node.kind === "database" ? Database : Table;
          return (
            <div
              key={id}
              className={cn(
                "flex h-full items-center gap-1 border-r px-3 text-sm hover:bg-accent",
                isActive
                  ? "-mb-px h-[calc(100%+1px)] bg-accent shadow-[inset_0_-2px_0_0_var(--primary)]"
                  : "bg-transparent",
              )}
            >
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveTab(id)}
                className={cn(
                  "flex items-center gap-1.5 truncate",
                  isActive ? "text-foreground" : "text-muted-foreground",
                )}
              >
                <Icon aria-hidden="true" className="size-3.5 shrink-0" />
                {node.name}
              </button>
              <button
                type="button"
                aria-label={`Close ${node.name}`}
                onClick={() => closeTab(id)}
                className="rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        aria-label="New database"
        onClick={addDatabase}
        className="shrink-0 px-2 py-1.5 text-muted-foreground hover:text-foreground"
      >
        <Plus className="size-4" />
      </button>
    </div>
  );
}
