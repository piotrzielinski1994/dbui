import { useEffect, useState } from "react";
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
import { Toaster } from "@/components/ui/sonner";

export function WorkspaceLayout() {
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [isFolderDialogOpen, setIsFolderDialogOpen] = useState(false);
  const {
    activeNode,
    activeDatabaseTab,
    toggleSplitOrientation,
    isSidebarVisible,
    toggleSidebar,
    toggleConsole,
    addDatabase,
    layouts,
    saveLayout,
  } = useWorkspace();
  const isSplitView =
    activeNode?.kind === "database" && activeDatabaseTab === "sql";

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) {
        return;
      }
      if (event.key === "k") {
        event.preventDefault();
        setIsPaletteOpen(true);
        return;
      }
      if (event.key === "b") {
        event.preventDefault();
        toggleSidebar();
        return;
      }
      if (event.key === "j") {
        event.preventDefault();
        toggleConsole();
        return;
      }
      if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        if (event.shiftKey) {
          setIsFolderDialogOpen(true);
          return;
        }
        addDatabase();
        return;
      }
      if (event.key === "\\" && isSplitView) {
        event.preventDefault();
        toggleSplitOrientation();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    isSplitView,
    toggleSplitOrientation,
    toggleSidebar,
    toggleConsole,
    addDatabase,
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
