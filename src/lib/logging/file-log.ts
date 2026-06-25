import { invoke } from "@tauri-apps/api/core";

export type LogLevel = "info" | "warn" | "error" | "debug";

// Send a leveled message to the Rust file log (same per-launch file as the
// backend's own log::info! lines). Best-effort: a no-op outside a Tauri host
// (invoke rejects) and never throws, so instrumentation can't break the app.
export async function logMessage(
  level: LogLevel,
  message: string,
): Promise<void> {
  try {
    await invoke("log_message", { level, message });
  } catch {
    // no-op outside a Tauri host
  }
}
