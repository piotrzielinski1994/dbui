import { useState } from "react";
import { useHotkeyRecorder, formatForDisplay } from "@tanstack/react-hotkeys";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/lib/settings/settings-context";
import { findConflict } from "@/lib/shortcuts/resolve";
import {
  SHORTCUT_ACTIONS,
  type ShortcutAction,
  type ShortcutActionId,
} from "@/lib/shortcuts/registry";

function actionName(id: ShortcutActionId): string {
  return SHORTCUT_ACTIONS.find((action) => action.id === id)?.name ?? id;
}

type ShortcutRowProps = {
  action: ShortcutAction;
  binding: string;
  effective: Record<ShortcutActionId, string>;
  hasOverride: boolean;
};

export function ShortcutRow({
  action,
  binding,
  effective,
  hasOverride,
}: ShortcutRowProps) {
  const { saveShortcut, resetShortcut } = useSettings();
  const [conflictName, setConflictName] = useState<string | null>(null);

  const recorder = useHotkeyRecorder({
    onRecord: (hotkey) => {
      const owner = findConflict(hotkey, action.id, effective);
      if (owner !== null) {
        setConflictName(actionName(owner));
        return;
      }
      setConflictName(null);
      saveShortcut(action.id, hotkey);
    },
    onCancel: () => setConflictName(null),
  });

  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="flex-1 text-sm">{action.name}</span>
      <span className="font-mono text-xs text-muted-foreground">
        {recorder.isRecording ? "Press keys…" : formatForDisplay(binding)}
      </span>
      {conflictName !== null && (
        <span role="alert" className="text-xs text-destructive">
          {`${conflictName} already uses that shortcut`}
        </span>
      )}
      {recorder.isRecording ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={recorder.cancelRecording}
        >
          Cancel
        </Button>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`Edit ${action.name}`}
          onClick={() => {
            setConflictName(null);
            recorder.startRecording();
          }}
        >
          Edit
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
