import { memo, useCallback } from "react";
import type { GroupImperativeHandle } from "react-resizable-panels";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Content } from "@/components/workspace/content";
import { Console } from "@/components/workspace/console";
import {
  useChrome,
  useWorkspace,
} from "@/components/workspace/workspace-context";

// Memoized (no props): a SIDEBAR toggle re-renders WorkspaceLayout but must not re-render this
// subtree. A CONSOLE toggle flips useChrome here (adds/removes the console panel) - required - but
// the memoized <Content/> below still absorbs it, so the table grid never re-renders on either.
export const Main = memo(function Main() {
  const { layouts, saveLayout, registerPanelGroup } = useWorkspace();
  const { isConsoleVisible } = useChrome();
  const groupRef = useCallback(
    (handle: GroupImperativeHandle | null) =>
      registerPanelGroup("main", handle),
    [registerPanelGroup],
  );

  // Same reasoning as WorkspaceLayout: the group + content panel are rendered unconditionally with
  // stable keys/order so toggling the console (Cmd+J) only adds/removes the console panel and never
  // remounts <Content/> (the open table grid). A bare-<div> fallback would remount it every toggle.
  return (
    <ResizablePanelGroup
      orientation="vertical"
      className="h-full"
      groupRef={groupRef}
      defaultLayout={layouts.main}
      onLayoutChanged={(layout) => saveLayout("main", layout)}
    >
      <ResizablePanel
        key="content"
        id="content"
        defaultSize="75%"
        minSize="30%"
      >
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
});
