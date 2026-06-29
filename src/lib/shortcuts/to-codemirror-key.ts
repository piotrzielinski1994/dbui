import { safeNormalize } from "@/lib/shortcuts/resolve";

// Converts a registry hotkey string ("Mod+Enter") into a CodeMirror key binding
// ("Mod-Enter"): modifiers join with "-" and a single trailing alphabetic key is
// lower-cased (CodeMirror matches "Mod-s", not "Mod-S"); named keys (Enter, Tab,
// Backspace) are kept verbatim. Returns null for an invalid hotkey.
export function toCodeMirrorKey(hotkey: string): string | null {
  if (safeNormalize(hotkey) === null) {
    return null;
  }
  const parts = hotkey.split("+");
  const key = parts[parts.length - 1];
  const modifiers = parts.slice(0, -1);
  const isSingleAlpha = /^[a-zA-Z]$/.test(key);
  const finalKey = isSingleAlpha ? key.toLowerCase() : key;
  return [...modifiers, finalKey].join("-");
}
