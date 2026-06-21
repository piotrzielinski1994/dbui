import { useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { TreeRow } from "@/components/workspace/tree-row";
import { DeleteRequestProvider } from "@/components/workspace/delete-request-context";
import { DeleteNodeDialog } from "@/components/workspace/delete-node-dialog";
import type { TreeNode } from "@/components/workspace/mock-data";

export function SidebarTree() {
  const { tree, removeNode } = useWorkspace();
  const [pendingDelete, setPendingDelete] = useState<TreeNode | null>(null);

  return (
    <DeleteRequestProvider value={setPendingDelete}>
      <ScrollArea className="flex-1">
        <ul role="tree" aria-label="Navigator">
          {tree.map((node) => (
            <TreeRow key={node.id} node={node} depth={0} />
          ))}
        </ul>
        {tree.length === 0 && (
          <div className="flex flex-col gap-1 px-3 py-4 text-center">
            <p className="text-sm font-medium">No connection</p>
            <p className="text-xs text-muted-foreground">
              Connect to a database to browse its objects.
            </p>
          </div>
        )}
      </ScrollArea>
      <DeleteNodeDialog
        node={pendingDelete}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        onConfirm={(id) => {
          removeNode(id);
          setPendingDelete(null);
        }}
      />
    </DeleteRequestProvider>
  );
}
