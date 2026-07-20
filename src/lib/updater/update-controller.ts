import { check as pluginCheck } from "@tauri-apps/plugin-updater";
import { relaunch as pluginRelaunch } from "@tauri-apps/plugin-process";

export { getAppVersion } from "@/lib/updater/app-version";

export type UpdateInfo = {
  version: string;
  downloadAndInstall: (onProgress: (pct: number) => void) => Promise<void>;
  relaunch: () => Promise<void>;
};

export type UpdateController = {
  check: () => Promise<UpdateInfo | null>;
};

type DownloadEvent =
  | { event: "Started"; data: { contentLength?: number } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Finished" };

type PluginUpdate = {
  version: string;
  downloadAndInstall: (
    onEvent: (event: DownloadEvent) => void,
  ) => Promise<void>;
};

export type UpdateControllerDeps = {
  check: () => Promise<PluginUpdate | null>;
  relaunch: () => Promise<void>;
};

function toUpdateInfo(
  update: PluginUpdate,
  relaunch: () => Promise<void>,
): UpdateInfo {
  return {
    version: update.version,
    downloadAndInstall: (onProgress) => {
      let downloaded = 0;
      let total = 0;
      return update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
          return;
        }
        if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          if (total > 0) {
            onProgress(Math.round((downloaded / total) * 100));
          }
          return;
        }
        onProgress(100);
      });
    },
    relaunch,
  };
}

export function createUpdateController(
  deps: UpdateControllerDeps = {
    check: pluginCheck,
    relaunch: pluginRelaunch,
  },
): UpdateController {
  return {
    check: async () => {
      const update = await deps.check();
      return update === null ? null : toUpdateInfo(update, deps.relaunch);
    },
  };
}

export function createNoopUpdateController(): UpdateController {
  return {
    check: () => Promise.resolve(null),
  };
}
