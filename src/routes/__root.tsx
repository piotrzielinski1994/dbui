import { useState } from "react";
import { createRootRoute, Link, Outlet } from "@tanstack/react-router";
import { isTauri } from "@tauri-apps/api/core";
import { SettingsProvider } from "@/lib/settings/settings-context";
import { createTauriSettingsStore } from "@/lib/settings/tauri-store";
import { ThemeProvider } from "@/lib/theme/theme-context";
import {
  createNoopWindowController,
  createWindowController,
} from "@/lib/window/window-controller";
import { WindowFullscreenSync } from "@/lib/window/window-fullscreen-sync";

// Only the real Tauri host has a window to drive; the dev-browser AND the jsdom test env (both
// non-Tauri) get the noop, so getCurrentWindow() - which throws without a Tauri host - is never
// called outside the native build.
function createWindowControllerForEnv() {
  return isTauri() ? createWindowController() : createNoopWindowController();
}

function RootLayout() {
  const [settingsStore] = useState(createTauriSettingsStore);
  const [windowController] = useState(createWindowControllerForEnv);

  return (
    <SettingsProvider store={settingsStore}>
      <WindowFullscreenSync controller={windowController} />
      <ThemeProvider>
        <Outlet />
      </ThemeProvider>
    </SettingsProvider>
  );
}

function NotFound() {
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold">404 - Not found</h1>
      <p className="text-muted-foreground">
        The page you are looking for does not exist.
      </p>
      <Link to="/" className="underline">
        Go home
      </Link>
    </div>
  );
}

export const rootRoute = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFound,
});
