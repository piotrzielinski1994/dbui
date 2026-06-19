import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "@/routes/__root";

function SettingsPage() {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <p className="text-muted-foreground">
        Configuration lives here in a future feature.
      </p>
    </div>
  );
}

export const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage,
});
