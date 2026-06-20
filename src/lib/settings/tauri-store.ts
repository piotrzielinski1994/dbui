import { LazyStore } from "@tauri-apps/plugin-store";
import {
  DEFAULT_SETTINGS,
  mergeSettings,
  type Settings,
  type SettingsStore,
} from "@/lib/settings/settings";

const SETTINGS_FILE = "settings.json";
const CONNECTIONS_FILE = "connections.json";
const SETTINGS_KEY = "settings";
const CONNECTIONS_KEY = "connections";

export function createTauriSettingsStore(): SettingsStore {
  const settingsStore = new LazyStore(SETTINGS_FILE);
  const connectionsStore = new LazyStore(CONNECTIONS_FILE);

  const load = async (): Promise<Settings> => {
    const persistedSettings = await settingsStore
      .get<unknown>(SETTINGS_KEY)
      .catch(() => undefined);
    const persistedConnections = await connectionsStore
      .get<unknown>(CONNECTIONS_KEY)
      .catch(() => undefined);
    const base = mergeSettings(DEFAULT_SETTINGS, persistedSettings);
    return mergeSettings(base, { ...base, connections: persistedConnections });
  };

  const save = async (settings: Settings): Promise<void> => {
    const { connections, ...withoutConnections } = settings;
    await persist(settingsStore, SETTINGS_KEY, withoutConnections);
    await persist(connectionsStore, CONNECTIONS_KEY, connections);
  };

  return { load, save };
}

async function persist(
  store: LazyStore,
  key: string,
  value: Omit<Settings, "connections"> | Settings["connections"],
): Promise<void> {
  await store
    .set(key, value)
    .then(() => store.save())
    .catch((error) => {
      console.warn(`Failed to persist ${key}`, error);
    });
}
