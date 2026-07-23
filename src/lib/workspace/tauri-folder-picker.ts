import type { FolderPicker } from "@pziel/pureui";
import { open } from "@tauri-apps/plugin-dialog";

export function createTauriFolderPicker(): FolderPicker {
  return {
    pick: () =>
      open({ directory: true, multiple: false })
        .then((selected) => (typeof selected === "string" ? selected : null))
        .catch(() => null),
  };
}
