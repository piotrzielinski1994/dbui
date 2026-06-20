import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  type Settings,
  type SettingsStore,
} from "@/lib/settings/settings";

type SettingsContextValue = {
  settings: Settings;
  persist: (next: Settings) => void;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

type SettingsProviderProps = {
  store: SettingsStore;
  children: ReactNode;
};

export function SettingsProvider({ store, children }: SettingsProviderProps) {
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    let isMounted = true;
    store.load().then((loaded) => {
      if (isMounted) {
        setSettings(loaded);
      }
    });
    return () => {
      isMounted = false;
    };
  }, [store]);

  const persist = useCallback(
    (next: Settings) => {
      setSettings(next);
      store.save(next);
    },
    [store],
  );

  const value = useMemo<SettingsContextValue | null>(
    () => (settings === null ? null : { settings, persist }),
    [settings, persist],
  );

  if (value === null) {
    return null;
  }

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext);
  if (!value) {
    throw new Error("useSettings must be used within a SettingsProvider");
  }
  return value;
}
