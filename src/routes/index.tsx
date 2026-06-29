import { useCallback } from "react";
import { createRoute } from "@tanstack/react-router";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { WorkspaceLayout } from "@/components/workspace/workspace-layout";
import { useSettings } from "@/lib/settings/settings-context";
import type { Settings } from "@/lib/settings/settings";
import { useWorkspaceStore } from "@/lib/workspace/workspace-store-context";
import { rootRoute } from "@/routes/__root";

export function HomePage() {
  const { settings, persist } = useSettings();
  const { tree, persistTree } = useWorkspaceStore();

  // The workspace persists only the UI-chrome slice of Settings; preserve the theme (owned by the
  // ThemeProvider / theme.json) and the shortcuts (owned by the Settings page / keymap.json) so a
  // chrome write doesn't clobber either back to defaults. Memoized + keyed on their stable
  // references so identity doesn't change on a chrome write (which would re-fire the provider's
  // persist effect and loop).
  const theme = settings.theme;
  const shortcuts = settings.shortcuts;
  const persistChrome = useCallback(
    (next: Omit<Settings, "theme" | "shortcuts">) =>
      persist({ ...next, theme, shortcuts }),
    [persist, theme, shortcuts],
  );

  return (
    <WorkspaceProvider
      tree={tree}
      onTreeChange={persistTree}
      initialExpandedIds={settings.expandedIds}
      initialOpenTabIds={settings.openTabIds}
      initialActiveTabId={settings.activeTabId ?? undefined}
      initialSidebarHidden={settings.sidebarHidden}
      initialConsoleHidden={settings.consoleHidden}
      initialSplitOrientation={settings.splitOrientation}
      initialLayouts={settings.layouts}
      onPersist={persistChrome}
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
