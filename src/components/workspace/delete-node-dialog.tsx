import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { TreeNode } from "@/components/workspace/mock-data";

type DeleteNodeDialogProps = {
  node: TreeNode | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (id: string) => void;
};

export function DeleteNodeDialog({
  node,
  onOpenChange,
  onConfirm,
}: DeleteNodeDialogProps) {
  const isFolder = node?.kind === "folder";
  const body = isFolder
    ? "This removes the folder and the databases inside it from the workspace."
    : "This removes the connection from the workspace.";

  return (
    <Dialog open={node !== null} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Delete "{node?.name}"?</DialogTitle>
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
            onClick={() => node && onConfirm(node.id)}
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
