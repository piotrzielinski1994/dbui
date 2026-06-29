import { useEffect, useState, type CSSProperties } from "react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Sidebar } from "@/components/workspace/sidebar";
import { Main } from "@/components/workspace/main";
import { CommandPalette } from "@/components/workspace/command-palette";
import { NewFolderDialog } from "@/components/workspace/new-folder-dialog";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { useThemeToggle } from "@/lib/theme/theme-context";
import { Toaster } from "@/components/ui/sonner";
import { useSettingsOptional } from "@/lib/settings/settings-context";
import { DEFAULT_SETTINGS } from "@/lib/settings/settings";
import { resolveShortcuts } from "@/lib/shortcuts/resolve";
import { matchesHotkey } from "@/lib/shortcuts/match-hotkey";
import type { ShortcutActionId } from "@/lib/shortcuts/registry";

export function WorkspaceLayout() {
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [isFolderDialogOpen, setIsFolderDialogOpen] = useState(false);
  const {
    activeNode,
    activeTabId,
    activeDatabaseTab,
    toggleSplitOrientation,
    isSidebarVisible,
    toggleSidebar,
    toggleConsole,
    addDatabase,
    layouts,
    saveLayout,
    accentColorFor,
    openTabIds,
    setActiveTab,
    closeTab,
  } = useWorkspace();
  const toggleTheme = useThemeToggle();
  const shortcuts =
    useSettingsOptional()?.settings.shortcuts ?? DEFAULT_SETTINGS.shortcuts;
  const isSplitView =
    activeNode?.kind === "database" && activeDatabaseTab === "sql";
  // The accent recolours the existing 1px borders by overriding the --border token (every divider/
  // input/grid border resolves from it). The hex is used verbatim, so the user controls how loud
  // the borders are via the hex's own alpha pair (#rrggbbaa). Only --border is overridden; --input
  // is left alone so input backgrounds (which also read --input) stay untouched.
  const accentBorder = activeTabId ? accentColorFor(activeTabId) : null;

  useEffect(() => {
    const effective = resolveShortcuts(shortcuts);
    const cycleTab = (step: number) => {
      if (openTabIds.length === 0) {
        return;
      }
      const current =
        activeTabId !== null ? openTabIds.indexOf(activeTabId) : -1;
      const length = openTabIds.length;
      const next = (((current + step) % length) + length) % length;
      setActiveTab(openTabIds[next]);
    };
    // global + tab scopes both dispatch off the document/window keydown; their
    // callbacks self-guard (split only in split view, close only with an active tab).
    const dispatch: Partial<Record<ShortcutActionId, () => void>> = {
      "open-command-palette": () => setIsPaletteOpen(true),
      "toggle-sidebar": toggleSidebar,
      "toggle-console": toggleConsole,
      "toggle-theme": toggleTheme,
      "new-database": addDatabase,
      "new-folder": () => setIsFolderDialogOpen(true),
      "toggle-split-orientation": () => {
        if (isSplitView) {
          toggleSplitOrientation();
        }
      },
      "next-tab": () => cycleTab(1),
      "prev-tab": () => cycleTab(-1),
      "close-tab": () => {
        if (activeTabId !== null) {
          closeTab(activeTabId);
        }
      },
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const hit = (Object.keys(dispatch) as ShortcutActionId[]).find((id) =>
        matchesHotkey(event, effective[id]),
      );
      if (hit === undefined) {
        return;
      }
      event.preventDefault();
      dispatch[hit]?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    shortcuts,
    isSplitView,
    toggleSplitOrientation,
    toggleSidebar,
    toggleConsole,
    addDatabase,
    toggleTheme,
    openTabIds,
    activeTabId,
    setActiveTab,
    closeTab,
  ]);

  return (
    <>
      {/* The group is rendered unconditionally and the content panel keeps a stable key+order so
          toggling the sidebar only adds/removes the sidebar panel - it never remounts <Main/> (and
          the open table grid). Swapping the whole group for a bare <div> used to unmount the grid,
          forcing a costly 200-row TanStack rebuild on every Cmd+B - that was the toggle lag. */}
      <ResizablePanelGroup
        orientation="horizontal"
        className="h-full w-full"
        defaultLayout={layouts.workspace}
        onLayoutChanged={(layout) => saveLayout("workspace", layout)}
        style={
          accentBorder
            ? ({ "--border": accentBorder } as CSSProperties)
            : undefined
        }
      >
        {isSidebarVisible
          ? [
              <ResizablePanel
                key="sidebar"
                id="sidebar"
                defaultSize="20%"
                minSize="12%"
                maxSize="40%"
              >
                <Sidebar />
              </ResizablePanel>,
              <ResizableHandle key="handle" />,
            ]
          : null}
        <ResizablePanel key="content" id="content" defaultSize="80%">
          <Main />
        </ResizablePanel>
      </ResizablePanelGroup>
      <CommandPalette
        open={isPaletteOpen}
        onOpenChange={setIsPaletteOpen}
        onNewFolder={() => setIsFolderDialogOpen(true)}
      />
      <NewFolderDialog
        open={isFolderDialogOpen}
        onOpenChange={setIsFolderDialogOpen}
      />
      <Toaster />
    </>
  );
}
