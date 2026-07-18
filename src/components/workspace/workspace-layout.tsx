import { useCallback, useEffect, useState, type CSSProperties } from "react";
import type { GroupImperativeHandle } from "react-resizable-panels";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Sidebar } from "@/components/workspace/sidebar";
import { Main } from "@/components/workspace/main";
import { CommandPalette } from "@/components/workspace/command-palette";
import { TableQuickOpen } from "@/components/workspace/table-quick-open";
import { NewFolderDialog } from "@/components/workspace/new-folder-dialog";
import {
  useChrome,
  useQuickOpen,
  useWorkspace,
} from "@/components/workspace/workspace-context";
import {
  buildQuickOpenEntries,
  quickOpenTarget,
} from "@/lib/workspace/quick-open";
import { useThemeToggle } from "@/lib/theme/theme-context";
import { Toaster } from "@/components/ui/sonner";
import { useSettingsOptional } from "@/lib/settings/settings-context";
import { DEFAULT_SETTINGS } from "@/lib/settings/settings";
import { resolveShortcuts } from "@/lib/shortcuts/resolve";
import { matchesAny } from "@/lib/shortcuts/match-hotkey";
import type { ShortcutActionId } from "@/lib/shortcuts/registry";
import { useConnectionActions } from "@/components/workspace/use-connection";
import { connectionOf } from "@/lib/workspace/model";
import {
  PANEL_RESIZE_STEP,
  resolveFocusedPanel,
  stepLayout,
  type PanelResizeTarget,
} from "@/lib/workspace/panel-resize";

export function WorkspaceLayout({
  onOpenWorkspace,
}: {
  onOpenWorkspace?: () => void;
}) {
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [isFolderDialogOpen, setIsFolderDialogOpen] = useState(false);
  const {
    tree,
    nodesById,
    expandedIds,
    connections,
    toggleExpand,
    openNode,
    selectInTree,
    activeNode,
    activeTabId,
    activeDatabaseTab,
    toggleSplitOrientation,
    addDatabase,
    layouts,
    saveLayout,
    registerPanelGroup,
    getPanelGroup,
    accentColorFor,
    openTabIds,
    setActiveTab,
    closeTab,
    closeOtherTabs,
    goBack,
    goForward,
  } = useWorkspace();
  const { isSidebarVisible, toggleSidebar, toggleConsole } = useChrome();
  const { isQuickOpenOpen, openQuickOpen, closeQuickOpen } = useQuickOpen();
  const { connect } = useConnectionActions();
  const workspaceGroupRef = useCallback(
    (handle: GroupImperativeHandle | null) =>
      registerPanelGroup("workspace", handle),
    [registerPanelGroup],
  );

  // The last panel the pointer interacted with. Clicking a blank (non-focusable) area of the
  // sidebar/console does not move DOM focus into it, so document.activeElement alone can't tell a
  // resize which panel is active; this tracks the last-clicked panel (null when the last click was
  // outside a resizable panel, e.g. the content area) as the fallback target.
  const [pointerTarget, setPointerTarget] = useState<PanelResizeTarget | null>(
    null,
  );
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const next = resolveFocusedPanel(event.target as Element | null);
      setPointerTarget((current) =>
        current?.panelId === next?.panelId ? current : next,
      );
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  // The panel focused when the command palette opened. Running a resize action from the palette
  // can't read document.activeElement (focus is trapped in the modal), so it falls back to this snapshot.
  const [paletteResizeTarget, setPaletteResizeTarget] =
    useState<PanelResizeTarget | null>(null);
  const openPalette = useCallback(() => {
    setPaletteResizeTarget(
      resolveFocusedPanel(document.activeElement) ?? pointerTarget,
    );
    setIsPaletteOpen(true);
  }, [pointerTarget]);

  const resizeFocusedPanel = useCallback(
    (deltaPct: number) => {
      const target =
        resolveFocusedPanel(document.activeElement) ??
        (isPaletteOpen ? paletteResizeTarget : pointerTarget);
      if (target === null) {
        return;
      }
      const handle = getPanelGroup(target.group);
      if (handle === null) {
        return;
      }
      handle.setLayout(stepLayout(handle.getLayout(), target, deltaPct));
    },
    [isPaletteOpen, paletteResizeTarget, pointerTarget, getPanelGroup],
  );
  const quickOpenEntries = buildQuickOpenEntries(
    tree,
    new Set(connections.keys()),
  );
  // Quick-open navigation, decided by the pure quickOpenTarget: a table/connected-database opens its
  // tab; a disconnected database connects + expands (its tables then populate); a folder (absent from
  // nodesById, which indexes only databases + tables) is revealed (selected + expanded).
  const selectQuickOpen = (id: string) => {
    const node = nodesById.get(id) ?? null;
    const target = quickOpenTarget(node, connections.has(id));
    if (target.kind === "open") {
      openNode(id);
      return;
    }
    if (target.kind === "connect" && node?.kind === "database") {
      connect(id, connectionOf(node));
    } else {
      selectInTree(id, "replace");
    }
    if (!expandedIds.has(id)) {
      toggleExpand(id);
    }
  };
  const toggleTheme = useThemeToggle();
  const shortcuts =
    useSettingsOptional()?.settings.shortcuts ?? DEFAULT_SETTINGS.shortcuts;
  const isSplitView =
    activeNode?.kind === "database" &&
    (activeDatabaseTab === "sql" ||
      activeDatabaseTab === "query" ||
      activeDatabaseTab === "script");
  // The accent recolours the existing 1px borders by overriding the --border token (every divider/
  // input/grid border resolves from it). The hex is used verbatim, so the user controls how loud
  // the borders are via the hex's own alpha pair (#rrggbbaa). Only --border is overridden; --input
  // is left alone so input backgrounds (which also read --input) stay untouched.
  const accentBorder = activeTabId ? accentColorFor(activeTabId) : null;

  useEffect(() => {
    const effective = resolveShortcuts(shortcuts);
    const cycleTab = (step: number) => {
      if (openTabIds.length === 0) {
        return;
      }
      const current =
        activeTabId !== null ? openTabIds.indexOf(activeTabId) : -1;
      const length = openTabIds.length;
      const next = (((current + step) % length) + length) % length;
      setActiveTab(openTabIds[next]);
    };
    // global + tab scopes both dispatch off the document/window keydown; their
    // callbacks self-guard (split only in split view, close only with an active tab).
    const dispatch: Partial<Record<ShortcutActionId, () => void>> = {
      "open-command-palette": openPalette,
      "open-quick-open": openQuickOpen,
      "toggle-sidebar": toggleSidebar,
      "toggle-console": toggleConsole,
      "panel-expand": () => resizeFocusedPanel(PANEL_RESIZE_STEP),
      "panel-shrink": () => resizeFocusedPanel(-PANEL_RESIZE_STEP),
      "toggle-theme": toggleTheme,
      "new-database": addDatabase,
      "new-folder": () => setIsFolderDialogOpen(true),
      "toggle-split-orientation": () => {
        if (isSplitView) {
          toggleSplitOrientation();
        }
      },
      "next-tab": () => cycleTab(1),
      "prev-tab": () => cycleTab(-1),
      "nav-back": goBack,
      "nav-forward": goForward,
      "close-tab": () => {
        if (activeTabId !== null) {
          closeTab(activeTabId);
        }
      },
      "close-other-tabs": () => {
        if (activeTabId !== null) {
          closeOtherTabs(activeTabId);
        }
      },
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const hit = (Object.keys(dispatch) as ShortcutActionId[]).find((id) =>
        matchesAny(event, effective[id]),
      );
      if (hit === undefined) {
        return;
      }
      event.preventDefault();
      dispatch[hit]?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    shortcuts,
    isSplitView,
    toggleSplitOrientation,
    toggleSidebar,
    toggleConsole,
    addDatabase,
    toggleTheme,
    openTabIds,
    activeTabId,
    setActiveTab,
    closeTab,
    closeOtherTabs,
    goBack,
    goForward,
    openQuickOpen,
    openPalette,
    resizeFocusedPanel,
  ]);

  return (
    <>
      {/* The group is rendered unconditionally and the content panel keeps a stable key+order so
          toggling the sidebar only adds/removes the sidebar panel - it never remounts <Main/> (and
          the open table grid). Swapping the whole group for a bare <div> used to unmount the grid,
          forcing a costly 200-row TanStack rebuild on every Cmd+B - that was the toggle lag. */}
      <ResizablePanelGroup
        orientation="horizontal"
        className="h-full w-full"
        groupRef={workspaceGroupRef}
        defaultLayout={layouts.workspace}
        onLayoutChanged={(layout) => saveLayout("workspace", layout)}
        style={
          accentBorder
            ? ({ "--border": accentBorder } as CSSProperties)
            : undefined
        }
      >
        {isSidebarVisible
          ? [
              <ResizablePanel
                key="sidebar"
                id="sidebar"
                defaultSize="20%"
                minSize="12%"
                maxSize="40%"
              >
                <Sidebar />
              </ResizablePanel>,
              <ResizableHandle key="handle" />,
            ]
          : null}
        <ResizablePanel key="content" id="content" defaultSize="80%">
          <Main />
        </ResizablePanel>
      </ResizablePanelGroup>
      <CommandPalette
        open={isPaletteOpen}
        onOpenChange={setIsPaletteOpen}
        onNewFolder={() => setIsFolderDialogOpen(true)}
        onOpenWorkspace={() => onOpenWorkspace?.()}
        onResizePanel={resizeFocusedPanel}
      />
      <TableQuickOpen
        open={isQuickOpenOpen}
        onOpenChange={(open) => (open ? openQuickOpen() : closeQuickOpen())}
        entries={quickOpenEntries}
        onSelect={selectQuickOpen}
      />
      <NewFolderDialog
        open={isFolderDialogOpen}
        onOpenChange={setIsFolderDialogOpen}
      />
      <Toaster />
    </>
  );
}
