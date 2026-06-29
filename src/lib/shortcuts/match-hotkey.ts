import { safeNormalize } from "@/lib/shortcuts/resolve";

type ModifierEvent = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
};

// Matches a keyboard event against a registry hotkey string. "Mod" matches EITHER
// Cmd or Ctrl (so a binding works the same on macOS and elsewhere, and tests can
// fire either modifier); a literal "Ctrl"/"Meta" must match that exact key. A bare
// key (Tab, Backspace) matches only when no modifier is held.
export function matchesHotkey(event: ModifierEvent, hotkey: string): boolean {
  if (safeNormalize(hotkey) === null) {
    return false;
  }
  const parts = hotkey.split("+");
  const key = parts[parts.length - 1];
  const mods = new Set(parts.slice(0, -1).map((m) => m.toLowerCase()));

  const wantMod = mods.has("mod");
  const wantCtrl = mods.has("ctrl") || mods.has("control");
  const wantMeta = mods.has("meta") || mods.has("cmd") || mods.has("command");
  const wantShift = mods.has("shift");
  const wantAlt = mods.has("alt") || mods.has("option");

  const keyMatches = /^[a-zA-Z]$/.test(key)
    ? event.key.toLowerCase() === key.toLowerCase()
    : event.key === key;
  if (!keyMatches) {
    return false;
  }
  if (event.shiftKey !== wantShift || event.altKey !== wantAlt) {
    return false;
  }
  if (wantMod) {
    return event.metaKey || event.ctrlKey;
  }
  return event.ctrlKey === wantCtrl && event.metaKey === wantMeta;
}
