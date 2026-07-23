import { type FolderPicker, matchesAny } from "@pziel/pureui";
import { useCallback, useEffect, useState } from "react";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { WorkspaceLayout } from "@/components/workspace/workspace-layout";
import { logMessage } from "@/lib/logging/file-log";
import type { LogStream } from "@/lib/logging/log-stream";
import type { Settings } from "@/lib/settings/settings";
import { useSettings } from "@/lib/settings/settings-context";
import { resolveShortcuts } from "@/lib/shortcuts/resolve";
import { deserialize, serialize } from "@/lib/workspace/disk-format";
import type { WorkspaceFs } from "@/lib/workspace/fs";
import type { TreeNode } from "@/lib/workspace/model";

type LoadState =
  | { status: "loading" }
  | { status: "empty" }
  | { status: "loaded"; tree: TreeNode[]; consoleLines: string[] };

const WORKSPACE_NAME = "Workspace";

export function WorkspaceLoader({
  fs,
  picker,
  logStream,
}: {
  fs: WorkspaceFs;
  picker: FolderPicker;
  logStream?: LogStream;
}) {
  const { settings, saveChrome, saveWorkspacePath } = useSettings();
  const workspacePath = settings.workspacePath;
  const [state, setState] = useState<LoadState>(
    workspacePath ? { status: "loading" } : { status: "empty" },
  );
  // Reset to the pre-read state DURING render when the path changes (adjust-state-on-render, the
  // sanctioned alternative to a sync setState in the read effect), so switching workspaces shows the
  // loading/empty state instead of the previous folder's tree until the new read resolves.
  const [loadedPath, setLoadedPath] = useState(workspacePath);
  if (workspacePath !== loadedPath) {
    setLoadedPath(workspacePath);
    setState(workspacePath ? { status: "loading" } : { status: "empty" });
  }

  useEffect(() => {
    if (!workspacePath) {
      return;
    }
    let isMounted = true;
    // A configured workspacePath that is fresh/unreadable/not-yet-a-workspace still mounts a WRITABLE
    // empty workspace (an empty tree wired to this path), so the first folder/database the user
    // creates bootstraps the dir on disk. Read-only empty is reserved for when NO path is set at all.
    // The read/deserialize error is surfaced as a console line (not swallowed) so a failed load is
    // diagnosable instead of silently empty.
    fs.readWorkspace(workspacePath).then((read) => {
      if (!isMounted) {
        return;
      }
      if (!read.ok) {
        logMessage("error", `workspace read failed: ${read.error}`);
        setState({
          status: "loaded",
          tree: [],
          consoleLines: [`[workspace] ${read.error}`],
        });
        return;
      }
      const parsed = deserialize(read.files);
      if (!parsed.ok) {
        logMessage(
          "error",
          `workspace deserialize failed: ${parsed.error} (read ${Object.keys(read.files).length} files)`,
        );
        setState({
          status: "loaded",
          tree: [],
          consoleLines: [
            `[workspace] ${parsed.error} (read ${Object.keys(read.files).length} files from ${workspacePath})`,
          ],
        });
        return;
      }
      logMessage(
        "info",
        `workspace loaded: ${parsed.tree.length} root nodes from ${workspacePath}`,
      );
      setState({
        status: "loaded",
        tree: parsed.tree,
        consoleLines: parsed.skipped.map(
          (path) => `[workspace] skipped malformed file: ${path}`,
        ),
      });
    });
    return () => {
      isMounted = false;
    };
  }, [fs, workspacePath]);

  const openWorkspace = useCallback(() => {
    picker.pick().then((path) => {
      if (path !== null) {
        saveWorkspacePath(path);
      }
    });
  }, [picker, saveWorkspacePath]);

  // The open-workspace binding lives here (not the layout) so Mod+O works from BOTH the empty prompt
  // and a loaded workspace - the layout only mounts once a workspace is loaded.
  useEffect(() => {
    const effective = resolveShortcuts(settings.shortcuts);
    const onKeyDown = (event: KeyboardEvent) => {
      if (matchesAny(event, effective["open-workspace"])) {
        event.preventDefault();
        openWorkspace();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [settings.shortcuts, openWorkspace]);

  const persistChrome = useCallback(
    (
      next: Omit<
        Settings,
        | "theme"
        | "shortcuts"
        | "windowFullscreen"
        | "rowLimit"
        | "workspacePath"
      >,
    ) => saveChrome(next),
    [saveChrome],
  );

  if (state.status === "loading") {
    return null;
  }

  if (state.status === "empty") {
    return <EmptyWorkspace onOpenWorkspace={openWorkspace} />;
  }

  return (
    <WorkspaceProvider
      key={workspacePath}
      tree={state.tree}
      consoleLines={state.consoleLines}
      logStream={logStream}
      initialSidebarHidden={settings.sidebarHidden}
      initialConsoleHidden={settings.consoleHidden}
      initialSplitOrientation={settings.splitOrientation}
      initialLayouts={settings.layouts}
      initialExpandedIds={settings.expandedIds}
      initialOpenTabIds={settings.openTabIds}
      initialActiveTabId={settings.activeTabId ?? undefined}
      onPersist={persistChrome}
      onTreeChange={(tree) =>
        fs.writeWorkspace(workspacePath ?? "", serialize(tree, WORKSPACE_NAME))
      }
    >
      <WorkspaceLayout onOpenWorkspace={openWorkspace} />
    </WorkspaceProvider>
  );
}

function EmptyWorkspace({ onOpenWorkspace }: { onOpenWorkspace: () => void }) {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="text-sm text-muted-foreground">
          No workspace folder open.
        </p>
        <button
          type="button"
          onClick={onOpenWorkspace}
          className="border border-border px-3 py-1.5 text-sm hover:bg-accent"
        >
          Open workspace folder...
        </button>
      </div>
    </div>
  );
}
