import { createRoute, Link } from "@tanstack/react-router";
import { rootRoute } from "@/routes/__root";
import { ThemeSection } from "@/components/settings/theme-section";
import { RowLimitSection } from "@/components/settings/row-limit-section";
import { ShortcutsSection } from "@/components/settings/shortcuts-section";
import { UpdatesSection } from "@/components/settings/updates-section";

function SettingsPage() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-baseline gap-3">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <Link to="/" className="text-sm text-muted-foreground underline">
          Back to workspace
        </Link>
      </div>
      <ThemeSection />
      <RowLimitSection />
      <ShortcutsSection />
      <UpdatesSection />
    </div>
  );
}

export const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage,
});
