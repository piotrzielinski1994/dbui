import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/components/workspace/workspace-context";

type NewFolderDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function NewFolderDialog({ open, onOpenChange }: NewFolderDialogProps) {
  const { addFolder } = useWorkspace();
  const [name, setName] = useState("");
  const isValid = name.trim().length > 0;

  const close = () => {
    onOpenChange(false);
    setName("");
  };

  const submit = () => {
    if (!isValid) {
      return;
    }
    addFolder(name.trim());
    close();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>New folder</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-1">
          <label htmlFor="folder-name" className="text-xs text-muted-foreground">
            Name
          </label>
          <Input
            id="folder-name"
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submit();
              }
            }}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={!isValid}>
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
