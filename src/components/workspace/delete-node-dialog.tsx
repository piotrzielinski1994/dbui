import { Button, cn } from "@pziel/pureui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { TreeNode } from "@/lib/workspace/model";

type DeleteNodeDialogProps = {
  nodes: TreeNode[];
  onOpenChange: (open: boolean) => void;
  onConfirm: (ids: string[]) => void;
};

function describe(nodes: TreeNode[]): { title: string; body: string } {
  if (nodes.length > 1) {
    const hasFolder = nodes.some((node) => node.kind === "folder");
    return {
      title: `Delete ${nodes.length} items?`,
      body: hasFolder
        ? "This removes the selected connections and folders (and the databases inside them) from the workspace."
        : "This removes the selected connections from the workspace.",
    };
  }
  const node = nodes[0];
  const isFolder = node?.kind === "folder";
  return {
    title: `Delete "${node?.name}"?`,
    body: isFolder
      ? "This removes the folder and the databases inside it from the workspace."
      : "This removes the connection from the workspace.",
  };
}

export function DeleteNodeDialog({
  nodes,
  onOpenChange,
  onConfirm,
}: DeleteNodeDialogProps) {
  const isOpen = nodes.length > 0;
  const { title, body } = describe(nodes);

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => onConfirm(nodes.map((node) => node.id))}
            className={cn(
              "bg-red-600 text-white hover:bg-red-700",
              "dark:bg-red-600 dark:hover:bg-red-700",
            )}
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
