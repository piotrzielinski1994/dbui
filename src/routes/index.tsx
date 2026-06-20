import { createRoute } from "@tanstack/react-router";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { WorkspaceLayout } from "@/components/workspace/workspace-layout";
import { useSettings } from "@/lib/settings/settings-context";
import { rootRoute } from "@/routes/__root";

function HomePage() {
  const { settings, persist } = useSettings();

  return (
    <WorkspaceProvider
      initialExpandedIds={settings.expandedIds}
      initialOpenTabIds={settings.openTabIds}
      initialActiveTabId={settings.activeTabId ?? undefined}
      initialConnections={Object.entries(settings.connections)}
      initialSidebarHidden={settings.sidebarHidden}
      initialConsoleHidden={settings.consoleHidden}
      initialSplitOrientation={settings.splitOrientation}
      initialLayouts={settings.layouts}
      onPersist={persist}
    >
      <WorkspaceLayout />
    </WorkspaceProvider>
  );
}

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomePage,
});
