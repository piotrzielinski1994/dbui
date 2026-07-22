import { Button, useRecordHotkey } from "@pziel/pureui";
import { formatForDisplay } from "@tanstack/react-hotkeys";
import { useState } from "react";
import { useSettings } from "@/lib/settings/settings-context";
import {
  SHORTCUT_ACTIONS,
  type ShortcutAction,
  type ShortcutActionId,
} from "@/lib/shortcuts/registry";
import { findConflict } from "@/lib/shortcuts/resolve";

function actionName(id: ShortcutActionId): string {
  return SHORTCUT_ACTIONS.find((action) => action.id === id)?.name ?? id;
}

type ShortcutRowProps = {
  action: ShortcutAction;
  bindings: string[];
  effective: Record<ShortcutActionId, string[]>;
  hasOverride: boolean;
};

export function ShortcutRow({
  action,
  bindings,
  effective,
  hasOverride,
}: ShortcutRowProps) {
  const { addShortcut, removeShortcut, replaceShortcut, resetShortcut } =
    useSettings();
  const [conflictName, setConflictName] = useState<string | null>(null);
  // The chip being re-recorded in place (null while adding a new binding).
  const [editingBinding, setEditingBinding] = useState<string | null>(null);

  const recorder = useRecordHotkey({
    onRecord: (hotkey) => {
      const owner = findConflict(hotkey, action.id, effective);
      if (owner !== null) {
        setConflictName(actionName(owner));
        setEditingBinding(null);
        return;
      }
      setConflictName(null);
      if (editingBinding !== null) {
        replaceShortcut(action.id, editingBinding, hotkey);
        setEditingBinding(null);
        return;
      }
      addShortcut(action.id, hotkey);
    },
    onCancel: () => {
      setConflictName(null);
      setEditingBinding(null);
    },
  });

  const startEditing = (binding: string) => {
    setConflictName(null);
    setEditingBinding(binding);
    recorder.startRecording();
  };
  const startAdding = () => {
    setConflictName(null);
    setEditingBinding(null);
    recorder.startRecording();
  };
  const cancelRecording = () => {
    setEditingBinding(null);
    recorder.cancelRecording();
  };

  return (
    <div className="flex items-center gap-2 py-1.5">
      <span className="flex-1 text-sm">{action.name}</span>
      <div className="flex flex-wrap items-center justify-end gap-1">
        {bindings.length === 0 && !recorder.isRecording && (
          <span className="text-xs text-muted-foreground">(disabled)</span>
        )}
        {bindings.map((binding) =>
          recorder.isRecording && editingBinding === binding ? (
            <span
              key={binding}
              className="font-mono text-xs text-muted-foreground"
            >
              Press keys…
            </span>
          ) : (
            <span
              key={binding}
              className="flex items-center gap-1 border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-xs"
            >
              <button
                type="button"
                aria-label={`Edit ${formatForDisplay(binding)} for ${action.name}`}
                className="hover:text-foreground"
                onClick={() => startEditing(binding)}
              >
                {formatForDisplay(binding)}
              </button>
              <button
                type="button"
                aria-label={`Remove ${formatForDisplay(binding)} from ${action.name}`}
                className="text-muted-foreground hover:text-foreground"
                onClick={() => removeShortcut(action.id, binding)}
              >
                ×
              </button>
            </span>
          ),
        )}
        {recorder.isRecording && editingBinding === null && (
          <span className="font-mono text-xs text-muted-foreground">
            Press keys…
          </span>
        )}
        {conflictName !== null && (
          <span role="alert" className="text-xs text-destructive">
            {`${conflictName} already uses that shortcut`}
          </span>
        )}
      </div>
      {recorder.isRecording ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={cancelRecording}
        >
          Cancel
        </Button>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`Add shortcut for ${action.name}`}
          onClick={startAdding}
        >
          Add
        </Button>
      )}
      {hasOverride && !recorder.isRecording && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`Reset ${action.name}`}
          onClick={() => resetShortcut(action.id)}
        >
          Reset
        </Button>
      )}
    </div>
  );
}
