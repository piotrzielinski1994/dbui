import { useEffect, useState } from "react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Sidebar } from "@/components/workspace/sidebar";
import { Main } from "@/components/workspace/main";
import { CommandPalette } from "@/components/workspace/command-palette";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { Toaster } from "@/components/ui/sonner";

export function WorkspaceLayout() {
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const {
    activeNode,
    activeDatabaseTab,
    toggleSplitOrientation,
    isSidebarVisible,
    toggleSidebar,
    toggleConsole,
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
      if (event.key === "\\" && isSplitView) {
        event.preventDefault();
        toggleSplitOrientation();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isSplitView, toggleSplitOrientation, toggleSidebar, toggleConsole]);

  return (
    <>
      {isSidebarVisible ? (
        <ResizablePanelGroup
          orientation="horizontal"
          className="h-full w-full"
          defaultLayout={layouts.workspace}
          onLayoutChanged={(layout) => saveLayout("workspace", layout)}
        >
          <ResizablePanel
            id="sidebar"
            defaultSize="20%"
            minSize="12%"
            maxSize="40%"
          >
            <Sidebar />
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel id="content" defaultSize="80%">
            <Main />
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        <div className="h-full w-full">
          <Main />
        </div>
      )}
      <CommandPalette open={isPaletteOpen} onOpenChange={setIsPaletteOpen} />
      <Toaster />
    </>
  );
}
