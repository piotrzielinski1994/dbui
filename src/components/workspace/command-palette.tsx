import {
  PANEL_RESIZE_STEP,
  type PaletteCommand,
  CommandPalette as PaletteShell,
} from "@pziel/pureui";
import {
  PALETTE_COMMANDS,
  PALETTE_GROUP_ORDER,
  type PaletteCommandId,
} from "@/components/workspace/command-registry";
import {
  useChrome,
  useJsonView,
  useMockData,
  useQuickOpen,
  useStructureView,
  useWorkspace,
} from "@/components/workspace/workspace-context";
import { DEFAULT_SETTINGS } from "@/lib/settings/settings";
import { useSettingsOptional } from "@/lib/settings/settings-context";
import { resolveShortcuts } from "@/lib/shortcuts/resolve";
import { useThemeToggle } from "@/lib/theme/theme-context";

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
  const commands: PaletteCommand[] = PALETTE_COMMANDS.filter((def) =>
    def.when(state),
  ).map((def) => ({
    key: def.id,
    name: def.name,
    group: def.group,
    binding: def.actionId ? (effective[def.actionId][0] ?? "") : undefined,
    run: () => handlers[def.id](),
  }));

  return (
    <PaletteShell
      open={open}
      onOpenChange={onOpenChange}
      groups={PALETTE_GROUP_ORDER}
      commands={commands}
    />
  );
}
