import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@pziel/pureui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Table, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { EngineIcon } from "@/components/workspace/engine-icon";
import { SqlText } from "@/components/workspace/sql-text";
import { Tab, TabBar } from "@/components/workspace/tab-bar";
import { openContextMenuOnKey } from "@/components/workspace/tree-nav";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { DEFAULT_SETTINGS } from "@/lib/settings/settings";
import { useSettingsOptional } from "@/lib/settings/settings-context";
import { resolveShortcuts } from "@/lib/shortcuts/resolve";
import {
  commitTransaction,
  rollbackTransaction,
  transactionState,
} from "@/lib/tauri";

// The F12 Commit/Rollback toolbar for the active manual-commit database. Polls `transactionState`
// (keyed by db id) and renders the controls + an "uncommitted changes" cue only while a transaction
// is open; Commit/Rollback finish it and invalidate the tx-state query (so the toolbar disables) plus
// the open table's rows/count (so a rollback's discarded rows disappear from the grid). SQL only -
// the caller passes a db id only for a manual-commit SQL database.
function ManualCommitControls({ databaseId }: { databaseId: string }) {
  const queryClient = useQueryClient();
  const { txStatements, clearTxStatements } = useWorkspace();
  const [isCommitOpen, setIsCommitOpen] = useState(false);
  const { data: isOpen } = useQuery({
    queryKey: ["tx-state", databaseId],
    queryFn: () => transactionState(databaseId),
  });

  if (!isOpen) {
    return null;
  }

  const statements = txStatements.get(databaseId) ?? [];

  const finish = async (run: (id: string) => Promise<void>, verb: string) => {
    try {
      await run(databaseId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      return;
    }
    toast.success(`${verb} - transaction closed`);
    clearTxStatements(databaseId);
    // The tx is now closed - set the state authoritatively (a commit/rollback always ends it) rather
    // than racing a refetch, then invalidate the open table's rows/count so a rollback's discarded
    // rows disappear from the grid.
    queryClient.setQueryData(["tx-state", databaseId], false);
    queryClient.invalidateQueries({ queryKey: ["table-rows"] });
    queryClient.invalidateQueries({ queryKey: ["table-count"] });
  };

  return (
    <div className="flex shrink-0 items-center gap-2 border-l px-3">
      <span className="font-mono text-xs text-amber-600 dark:text-amber-400">
        * uncommitted changes
      </span>
      <Button
        size="sm"
        variant="outline"
        onClick={() => finish(rollbackTransaction, "Rolled back")}
      >
        Rollback
      </Button>
      <Button size="sm" onClick={() => setIsCommitOpen(true)}>
        Commit
      </Button>
      <Dialog open={isCommitOpen} onOpenChange={setIsCommitOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Commit transaction</DialogTitle>
            <DialogDescription>
              Committing will make the following{" "}
              {statements.length === 1
                ? "statement"
                : `${statements.length} statements`}{" "}
              permanent:
            </DialogDescription>
          </DialogHeader>
          {statements.length > 0 ? (
            <SqlText
              sql={statements.map((statement) => `${statement};`).join("\n")}
              className="block max-h-64 overflow-auto border bg-muted/30 p-3 font-mono text-xs whitespace-pre-wrap"
            />
          ) : (
            <p className="font-mono text-xs text-muted-foreground">
              No statements recorded for this transaction.
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCommitOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setIsCommitOpen(false);
                void finish(commitTransaction, "Committed");
              }}
            >
              Commit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function ContentHeader() {
  const {
    openTabIds,
    activeTabId,
    activeNode,
    nodesById,
    databaseIdByTableId,
    setActiveTab,
    closeTab,
    closeOtherTabs,
    closeAllTabs,
    addDatabase,
  } = useWorkspace();
  const hasMultipleTabs = openTabIds.length > 1;
  const shortcuts =
    useSettingsOptional()?.settings.shortcuts ?? DEFAULT_SETTINGS.shortcuts;
  const contextMenuBindings = resolveShortcuts(shortcuts)["open-context-menu"];

  // The active database (the node itself, or the owning db when a table tab is active) - the
  // manual-commit toolbar is scoped to it. Only a manual-commit database shows the Commit/Rollback
  // controls (which then render only while its transaction is open).
  const activeDatabaseId =
    activeNode?.kind === "database"
      ? activeNode.id
      : activeNode
        ? databaseIdByTableId.get(activeNode.id)
        : undefined;
  const activeDatabase = activeDatabaseId
    ? nodesById.get(activeDatabaseId)
    : undefined;
  const manualCommitDbId =
    activeDatabase?.kind === "database" && activeDatabase.manualCommit
      ? activeDatabase.id
      : undefined;

  return (
    <TabBar
      ariaLabel="Open tabs"
      trailing={
        <div className="flex shrink-0 items-center">
          {manualCommitDbId ? (
            <ManualCommitControls databaseId={manualCommitDbId} />
          ) : null}
          <button
            type="button"
            aria-label="New database"
            onClick={() => addDatabase()}
            className="shrink-0 px-2 py-1.5 text-muted-foreground hover:text-foreground"
          >
            <Plus className="size-4" />
          </button>
        </div>
      }
    >
      {openTabIds.map((id) => {
        const node = nodesById.get(id);
        if (!node) {
          return null;
        }
        return (
          <ContextMenu key={id}>
            <ContextMenuTrigger asChild>
              <Tab
                isActive={id === activeTabId}
                onSelect={() => setActiveTab(id)}
                onKeyDown={(event) =>
                  openContextMenuOnKey(event, contextMenuBindings)
                }
                trailing={
                  <button
                    type="button"
                    aria-label={`Close ${node.name}`}
                    onClick={() => closeTab(id)}
                    className="p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <X className="size-3" />
                  </button>
                }
              >
                {node.kind === "database" ? (
                  <EngineIcon
                    engine={node.engine}
                    className="size-3.5 shrink-0"
                  />
                ) : (
                  <Table aria-hidden="true" className="size-3.5 shrink-0" />
                )}
                {node.name}
              </Tab>
            </ContextMenuTrigger>
            <ContextMenuContent
              onCloseAutoFocus={(event) => event.preventDefault()}
            >
              <ContextMenuItem onSelect={() => closeTab(id)}>
                Close
              </ContextMenuItem>
              <ContextMenuItem
                disabled={!hasMultipleTabs}
                onSelect={() => closeOtherTabs(id)}
              >
                Close other tabs
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => closeAllTabs()}>
                Close all
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        );
      })}
    </TabBar>
  );
}
