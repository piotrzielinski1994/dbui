import { createInMemorySettingsStore as createGenericInMemorySettingsStore } from "@pziel/pureui";

import {
  DEFAULT_SETTINGS,
  type Settings,
  type SettingsStore,
} from "@/lib/settings/settings";

export function createInMemorySettingsStore(
  initial: Settings = DEFAULT_SETTINGS,
): SettingsStore {
  return createGenericInMemorySettingsStore(initial);
}
