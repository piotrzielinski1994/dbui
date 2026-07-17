import { open } from "@tauri-apps/plugin-dialog";

export type FolderPicker = {
  pick: () => Promise<string | null>;
};

export function createTauriFolderPicker(): FolderPicker {
  return {
    pick: () =>
      open({ directory: true, multiple: false })
        .then((selected) => (typeof selected === "string" ? selected : null))
        .catch(() => null),
  };
}

export function createNoopFolderPicker(): FolderPicker {
  return {
    pick: () => Promise.resolve(null),
  };
}
