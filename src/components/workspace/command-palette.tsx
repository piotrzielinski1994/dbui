import { formatForDisplay } from "@tanstack/react-hotkeys";
import {
  useChrome,
  useJsonView,
  useMockData,
  useQuickOpen,
  useStructureView,
  useWorkspace,
} from "@/components/workspace/workspace-context";
import { useThemeToggle } from "@/lib/theme/theme-context";
import {
  PALETTE_COMMANDS,
  PALETTE_GROUP_ORDER,
  type PaletteCommandId,
} from "@/components/workspace/command-registry";
import { useSettingsOptional } from "@/lib/settings/settings-context";
import { DEFAULT_SETTINGS } from "@/lib/settings/settings";
import { resolveShortcuts } from "@/lib/shortcuts/resolve";
import { PANEL_RESIZE_STEP } from "@/lib/workspace/panel-resize";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";

type CommandPaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNewFolder: () => void;
  onOpenWorkspace: () => void;
  onResizePanel: (deltaPct: number) => void;
};

// Re-fire the open-find binding at whatever surface holds focus once the palette has closed. Find
// has no global toggle - the grid (window listener) and the editors (CM keymap) each own their own
// Cmd+F, so the palette just replays the keystroke to the restored-focus element.
function triggerFind(binding: string | undefined) {
  if (!binding) {
    return;
  }
  const parts = binding.split("+");
  const key = parts[parts.length - 1];
  const mods = new Set(parts.slice(0, -1).map((m) => m.toLowerCase()));
  const wantsMod = mods.has("mod") || mods.has("meta") || mods.has("ctrl");
  setTimeout(() => {
    const target = document.activeElement ?? document.body;
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: key.length === 1 ? key.toLowerCase() : key,
        metaKey: wantsMod,
        ctrlKey: wantsMod,
        shiftKey: mods.has("shift"),
        altKey: mods.has("alt") || mods.has("option"),
        bubbles: true,
        cancelable: true,
      }),
    );
  }, 0);
}

export function CommandPalette({
  open,
  onOpenChange,
  onNewFolder,
  onOpenWorkspace,
  onResizePanel,
}: CommandPaletteProps) {
  const {
    openTabIds,
    activeTabId,
    activeNode,
    activeDatabaseTab,
    setActiveTab,
    closeTab,
    closeOtherTabs,
    closeAllTabs,
    newTab,
    addDatabase,
    toggleSplitOrientation,
    goBack,
    goForward,
    canGoBack,
    canGoForward,
  } = useWorkspace();
  const { toggleSidebar, toggleConsole } = useChrome();
  const { toggleJsonView } = useJsonView();
  const { toggleStructureView } = useStructureView();
  const { openMockData } = useMockData();
  const { openQuickOpen } = useQuickOpen();
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

  const closeOthers = () => {
    if (activeTabId === null) {
      return;
    }
    closeOtherTabs(activeTabId);
  };

  const handlers: Record<PaletteCommandId, () => void> = {
    "quick-open": openQuickOpen,
    "open-workspace": onOpenWorkspace,
    "new-database": addDatabase,
    "new-folder": onNewFolder,
    "close-tab": closeActiveTab,
    "close-other-tabs": closeOthers,
    "close-all-tabs": closeAllTabs,
    "next-tab": () => cycleTab(1),
    "prev-tab": () => cycleTab(-1),
    "nav-back": goBack,
    "nav-forward": goForward,
    "new-tab": newTab,
    "generate-mock-data": openMockData,
    "toggle-split-orientation": toggleSplitOrientation,
    "toggle-sidebar": toggleSidebar,
    "toggle-console": toggleConsole,
    "toggle-theme": toggleTheme,
    "toggle-json-view": toggleJsonView,
    "toggle-structure-view": toggleStructureView,
    "open-find": () => triggerFind(effective["open-find"][0]),
    "panel-expand": () => onResizePanel(PANEL_RESIZE_STEP),
    "panel-shrink": () => onResizePanel(-PANEL_RESIZE_STEP),
  };

  const shortcuts =
    useSettingsOptional()?.settings.shortcuts ?? DEFAULT_SETTINGS.shortcuts;
  const effective = resolveShortcuts(shortcuts);

  const isSplitView =
    activeNode?.kind === "database" &&
    (activeDatabaseTab === "sql" ||
      activeDatabaseTab === "query" ||
      activeDatabaseTab === "script");
  const isTableActive = activeNode?.kind === "table";
  const state = {
    openTabCount: openTabIds.length,
    isSplitView,
    isTableActive,
    canGoBack,
    canGoForward,
  };
  const commands = PALETTE_COMMANDS.filter((def) => def.when(state));

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Type a command…" />
      <CommandList>
        <CommandEmpty>No matching commands</CommandEmpty>
        {PALETTE_GROUP_ORDER.map((group) => {
          const groupCommands = commands.filter((def) => def.group === group);
          if (groupCommands.length === 0) {
            return null;
          }
          return (
            <CommandGroup key={group} heading={group}>
              {groupCommands.map((def) => (
                <CommandItem
                  key={def.id}
                  value={def.name}
                  onSelect={() => {
                    handlers[def.id]();
                    onOpenChange(false);
                  }}
                >
                  <span>{def.name}</span>
                  {def.actionId && effective[def.actionId][0] && (
                    <CommandShortcut>
                      {formatForDisplay(effective[def.actionId][0])}
                    </CommandShortcut>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          );
        })}
      </CommandList>
    </CommandDialog>
  );
}
