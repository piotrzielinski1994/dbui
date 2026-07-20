import { createContext, useContext, type ReactNode } from "react";
import {
  createNoopUpdateController,
  getAppVersion,
  type UpdateController,
} from "@/lib/updater/update-controller";

type UpdaterContextValue = {
  controller: UpdateController;
  getVersion: () => Promise<string>;
};

const UpdaterContext = createContext<UpdaterContextValue | null>(null);

const DEFAULT: UpdaterContextValue = {
  controller: createNoopUpdateController(),
  getVersion: getAppVersion,
};

export function UpdaterProvider({
  controller,
  getVersion,
  children,
}: {
  controller: UpdateController;
  getVersion: () => Promise<string>;
  children: ReactNode;
}) {
  return (
    <UpdaterContext.Provider value={{ controller, getVersion }}>
      {children}
    </UpdaterContext.Provider>
  );
}

export function useUpdater(): UpdaterContextValue {
  return useContext(UpdaterContext) ?? DEFAULT;
}
