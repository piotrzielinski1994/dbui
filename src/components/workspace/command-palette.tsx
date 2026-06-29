import { formatForDisplay } from "@tanstack/react-hotkeys";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { useThemeToggle } from "@/lib/theme/theme-context";
import {
  PALETTE_COMMANDS,
  type PaletteCommandId,
} from "@/components/workspace/command-registry";
import { useSettingsOptional } from "@/lib/settings/settings-context";
import { DEFAULT_SETTINGS } from "@/lib/settings/settings";
import { resolveShortcuts } from "@/lib/shortcuts/resolve";
import {
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";

type CommandPaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNewFolder: () => void;
};

export function CommandPalette({
  open,
  onOpenChange,
  onNewFolder,
}: CommandPaletteProps) {
  const {
    openTabIds,
    activeTabId,
    activeNode,
    activeDatabaseTab,
    setActiveTab,
    closeTab,
    closeAllTabs,
    newTab,
    addDatabase,
    toggleSplitOrientation,
    toggleSidebar,
    toggleConsole,
  } = useWorkspace();
  const toggleTheme = useThemeToggle();

  const cycleTab = (step: number) => {
    if (openTabIds.length === 0) {
      return;
    }
    const current = activeTabId !== null ? openTabIds.indexOf(activeTabId) : -1;
    const length = openTabIds.length;
    const next = (((current + step) % length) + length) % length;
    setActiveTab(openTabIds[next]);
  };

  const closeActiveTab = () => {
    if (activeTabId === null) {
      return;
    }
    closeTab(activeTabId);
  };

  const handlers: Record<PaletteCommandId, () => void> = {
    "new-database": addDatabase,
    "new-folder": onNewFolder,
    "close-tab": closeActiveTab,
    "close-all-tabs": closeAllTabs,
    "next-tab": () => cycleTab(1),
    "prev-tab": () => cycleTab(-1),
    "new-tab": newTab,
    "toggle-split-orientation": toggleSplitOrientation,
    "toggle-sidebar": toggleSidebar,
    "toggle-console": toggleConsole,
    "toggle-theme": toggleTheme,
  };

  const shortcuts =
    useSettingsOptional()?.settings.shortcuts ?? DEFAULT_SETTINGS.shortcuts;
  const effective = resolveShortcuts(shortcuts);

  const isSplitView =
    activeNode?.kind === "database" && activeDatabaseTab === "sql";
  const state = { openTabCount: openTabIds.length, isSplitView };
  const commands = PALETTE_COMMANDS.filter((def) => def.when(state));

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Type a command…" />
      <CommandList>
        <CommandEmpty>No matching commands</CommandEmpty>
        {commands.map((def) => (
          <CommandItem
            key={def.id}
            value={def.name}
            onSelect={() => {
              handlers[def.id]();
              onOpenChange(false);
            }}
          >
            <span>{def.name}</span>
            {def.actionId && (
              <CommandShortcut>
                {formatForDisplay(effective[def.actionId])}
              </CommandShortcut>
            )}
          </CommandItem>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
