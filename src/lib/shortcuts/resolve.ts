import { normalizeHotkey, validateHotkey } from "@tanstack/react-hotkeys";
import {
  SHORTCUT_ACTIONS,
  type ShortcutActionId,
  type ShortcutOverrides,
  type ShortcutScope,
} from "@/lib/shortcuts/registry";

const SCOPE_BY_ID = new Map<ShortcutActionId, ShortcutScope>(
  SHORTCUT_ACTIONS.map((action) => [action.id, action.scope]),
);

function isShortcutActionId(value: string): value is ShortcutActionId {
  return SCOPE_BY_ID.has(value as ShortcutActionId);
}

export function safeNormalize(hotkey: string): string | null {
  if (typeof hotkey !== "string" || hotkey.length === 0) {
    return null;
  }
  const result = validateHotkey(hotkey);
  const hasUnknownKey = result.warnings.some((warning) =>
    warning.includes("Unknown key"),
  );
  if (!result.valid || hasUnknownKey) {
    return null;
  }
  return normalizeHotkey(hotkey);
}

export function resolveShortcuts(
  overrides: ShortcutOverrides,
): Record<ShortcutActionId, string> {
  const overlay =
    typeof overrides === "object" && overrides !== null ? overrides : {};
  return SHORTCUT_ACTIONS.reduce(
    (acc, action) => {
      const candidate = overlay[action.id];
      const normalized =
        typeof candidate === "string" ? safeNormalize(candidate) : null;
      acc[action.id] = normalized ?? action.defaultHotkey;
      return acc;
    },
    {} as Record<ShortcutActionId, string>,
  );
}

// Per-scope: a combo only conflicts with another action in the SAME scope, so the
// same key can mean different things in the grid vs the tree (e.g. Backspace).
export function findConflict(
  hotkey: string,
  forAction: ShortcutActionId,
  effective: Record<ShortcutActionId, string>,
): ShortcutActionId | null {
  const target = safeNormalize(hotkey);
  if (target === null) {
    return null;
  }
  const scope = SCOPE_BY_ID.get(forAction);
  const owner = (Object.keys(effective) as ShortcutActionId[]).find((id) => {
    if (id === forAction || !isShortcutActionId(id)) {
      return false;
    }
    if (SCOPE_BY_ID.get(id) !== scope) {
      return false;
    }
    return safeNormalize(effective[id]) === target;
  });
  return owner ?? null;
}
