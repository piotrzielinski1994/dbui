import { Button } from "@pziel/pureui";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type SaveScriptDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (name: string) => void;
};

export function SaveScriptDialog({
  open,
  onOpenChange,
  onSave,
}: SaveScriptDialogProps) {
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
    onSave(name.trim());
    close();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Save script</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-1">
          <label
            htmlFor="script-name"
            className="text-xs text-muted-foreground"
          >
            Name
          </label>
          <Input
            id="script-name"
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
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
