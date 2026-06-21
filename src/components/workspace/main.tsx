import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Content } from "@/components/workspace/content";
import { Console } from "@/components/workspace/console";
import { useWorkspace } from "@/components/workspace/workspace-context";

export function Main() {
  const { isConsoleVisible, layouts, saveLayout } = useWorkspace();

  // Same reasoning as WorkspaceLayout: the group + content panel are rendered unconditionally with
  // stable keys/order so toggling the console (Cmd+J) only adds/removes the console panel and never
  // remounts <Content/> (the open table grid). A bare-<div> fallback would remount it every toggle.
  return (
    <ResizablePanelGroup
      orientation="vertical"
      className="h-full"
      defaultLayout={layouts.main}
      onLayoutChanged={(layout) => saveLayout("main", layout)}
    >
      <ResizablePanel key="content" id="content" defaultSize="75%" minSize="30%">
        <Content />
      </ResizablePanel>
      {isConsoleVisible
        ? [
            <ResizableHandle key="handle" />,
            <ResizablePanel
              key="console"
              id="console"
              defaultSize="25%"
              minSize="10%"
            >
              <Console />
            </ResizablePanel>,
          ]
        : null}
    </ResizablePanelGroup>
  );
}
