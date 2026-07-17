import { useState } from "react";
import { createRoute } from "@tanstack/react-router";
import { isTauri } from "@tauri-apps/api/core";
import { WorkspaceLoader } from "@/components/workspace/workspace-loader";
import {
  createNoopLogStream,
  createTauriLogStream,
} from "@/lib/logging/log-stream";
import { createTauriWorkspaceFs } from "@/lib/workspace/tauri-fs";
import { createInMemoryWorkspaceFs } from "@/lib/workspace/in-memory-fs";
import {
  createNoopFolderPicker,
  createTauriFolderPicker,
} from "@/lib/workspace/folder-picker";
import { rootRoute } from "@/routes/__root";

// Only the real Tauri host forwards backend log records to the webview; the dev-browser + jsdom
// get the noop (attachLogger would have no plugin to talk to).
function createLogStreamForEnv() {
  return isTauri() ? createTauriLogStream() : createNoopLogStream();
}

// The real Tauri host reads/writes the picked workspace folder via plugin-fs + plugin-dialog; the
// dev-browser + jsdom get an in-memory fs + a noop picker (no webview to drive).
function createWorkspaceFsForEnv() {
  return isTauri() ? createTauriWorkspaceFs() : createInMemoryWorkspaceFs({});
}

function createFolderPickerForEnv() {
  return isTauri() ? createTauriFolderPicker() : createNoopFolderPicker();
}

export function HomePage() {
  const [logStream] = useState(createLogStreamForEnv);
  const [fs] = useState(createWorkspaceFsForEnv);
  const [picker] = useState(createFolderPickerForEnv);

  return <WorkspaceLoader fs={fs} picker={picker} logStream={logStream} />;
}

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomePage,
});
