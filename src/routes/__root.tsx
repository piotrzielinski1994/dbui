import { useState } from "react";
import { createRootRoute, Link, Outlet } from "@tanstack/react-router";
import { SettingsProvider } from "@/lib/settings/settings-context";
import { createTauriSettingsStore } from "@/lib/settings/tauri-store";

function RootLayout() {
  const [settingsStore] = useState(createTauriSettingsStore);

  return (
    <SettingsProvider store={settingsStore}>
      <Outlet />
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
