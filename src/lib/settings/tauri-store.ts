import { LazyStore } from "@tauri-apps/plugin-store";
import { logMessage } from "@/lib/logging/file-log";
import {
  DEFAULT_SETTINGS,
  mergeSettings,
  type Settings,
  type SettingsStore,
} from "@/lib/settings/settings";

const SETTINGS_FILE = "settings.json";
const THEME_FILE = "theme.json";
const KEYMAP_FILE = "keymap.json";
const SETTINGS_KEY = "settings";
const THEME_COLORS_KEY = "colors";
const SHORTCUTS_KEY = "shortcuts";

export function createTauriSettingsStore(): SettingsStore {
  const settingsStore = new LazyStore(SETTINGS_FILE);
  const themeStore = new LazyStore(THEME_FILE);
  const keymapStore = new LazyStore(KEYMAP_FILE);

  const load = async (): Promise<Settings> => {
    const persistedSettings = await settingsStore
      .get<unknown>(SETTINGS_KEY)
      .catch(() => undefined);
    const persistedColors = await themeStore
      .get<unknown>(THEME_COLORS_KEY)
      .catch(() => undefined);
    const persistedShortcuts = await keymapStore
      .get<unknown>(SHORTCUTS_KEY)
      .catch(() => undefined);

    const base = mergeSettings(DEFAULT_SETTINGS, persistedSettings);
    // Recombine the colors from theme.json and the keymap from keymap.json over the
    // base (which carries the mode); mergeSettings tolerantly drops any garbage.
    return mergeSettings(base, {
      ...base,
      theme: { mode: base.theme.mode, colors: persistedColors },
      shortcuts: persistedShortcuts,
    });
  };

  const save = async (settings: Settings): Promise<void> => {
    // Strip the color overrides and keymap out of settings.json (they live in
    // theme.json / keymap.json) - each is then device-syncable on its own.
    const settingsPayload: Settings = {
      ...settings,
      theme: { mode: settings.theme.mode, colors: DEFAULT_SETTINGS.theme.colors },
      shortcuts: {},
    };
    await persist(settingsStore, SETTINGS_KEY, settingsPayload);
    await persist(themeStore, THEME_COLORS_KEY, settings.theme.colors);
    await persist(keymapStore, SHORTCUTS_KEY, settings.shortcuts);
  };

  return { load, save };
}

async function persist(
  store: LazyStore,
  key: string,
  value: unknown,
): Promise<void> {
  await store
    .set(key, value)
    .then(() => store.save())
    .catch((error) => {
      logMessage("warn", `Failed to persist ${key}: ${String(error)}`);
    });
}
