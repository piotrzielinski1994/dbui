import {
  findConflict as findConflictGeneric,
  resolveShortcuts as resolveShortcutsGeneric,
} from "@pziel/pureui";
import {
  SHORTCUT_ACTIONS,
  type ShortcutActionId,
  type ShortcutOverrides,
} from "@/lib/shortcuts/registry";

export { safeNormalize } from "@pziel/pureui";

export function resolveShortcuts(
  overrides: ShortcutOverrides,
): Record<ShortcutActionId, string[]> {
  return resolveShortcutsGeneric(SHORTCUT_ACTIONS, overrides);
}

export function findConflict(
  hotkey: string,
  forAction: ShortcutActionId,
  effective: Record<ShortcutActionId, string[]>,
): ShortcutActionId | null {
  return findConflictGeneric(SHORTCUT_ACTIONS, hotkey, forAction, effective);
}
