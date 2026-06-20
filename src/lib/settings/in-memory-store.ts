import {
  DEFAULT_SETTINGS,
  type Settings,
  type SettingsStore,
} from "@/lib/settings/settings";

export function createInMemorySettingsStore(
  initial: Settings = DEFAULT_SETTINGS,
): SettingsStore {
  let current = initial;
  return {
    load: () => Promise.resolve(current),
    save: (settings) => {
      current = settings;
      return Promise.resolve();
    },
  };
}
