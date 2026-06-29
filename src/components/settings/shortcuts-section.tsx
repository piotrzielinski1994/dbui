import { ShortcutRow } from "@/components/settings/shortcut-row";
import { useSettings } from "@/lib/settings/settings-context";
import { resolveShortcuts } from "@/lib/shortcuts/resolve";
import {
  SHORTCUT_ACTIONS,
  type ShortcutScope,
} from "@/lib/shortcuts/registry";

const SCOPE_LABELS: Record<ShortcutScope, string> = {
  global: "Global",
  tab: "Tabs",
  grid: "Data grid",
  tree: "Sidebar",
  editor: "Query editor",
};

const SCOPE_ORDER: ShortcutScope[] = ["global", "tab", "grid", "tree", "editor"];

export function ShortcutsSection() {
  const { settings } = useSettings();
  const effective = resolveShortcuts(settings.shortcuts);

  return (
    <section className="flex flex-col gap-1">
      <h2 className="text-lg font-medium">Keyboard Shortcuts</h2>
      <p className="text-sm text-muted-foreground">
        Press Edit and type a new combination. Escape cancels recording, so it
        cannot be assigned.
      </p>
      <div className="mt-2 flex flex-col gap-4">
        {SCOPE_ORDER.map((scope) => {
          const actions = SHORTCUT_ACTIONS.filter(
            (action) => action.scope === scope,
          );
          if (actions.length === 0) {
            return null;
          }
          return (
            <div key={scope} className="flex flex-col">
              <h3 className="text-xs font-medium uppercase text-muted-foreground">
                {SCOPE_LABELS[scope]}
              </h3>
              <div className="divide-y">
                {actions.map((action) => (
                  <ShortcutRow
                    key={action.id}
                    action={action}
                    binding={effective[action.id]}
                    effective={effective}
                    hasOverride={action.id in settings.shortcuts}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
