import { getVersion } from "@tauri-apps/api/app";
import { isTauri } from "@tauri-apps/api/core";

const FALLBACK_VERSION = "dev";

export function getAppVersion(): Promise<string> {
  if (!isTauri()) {
    return Promise.resolve(FALLBACK_VERSION);
  }
  return getVersion();
}
