import {
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { matchesAny } from "@pziel/pureui";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DeleteNodeDialog } from "@/components/workspace/delete-node-dialog";
import { DeleteRequestProvider } from "@/components/workspace/delete-request-context";
import {
  type DropIndicator,
  TreeDndProvider,
} from "@/components/workspace/tree-dnd";
import { TreeNavProvider } from "@/components/workspace/tree-nav";
import { TreeRow } from "@/components/workspace/tree-row";
import {
  useChrome,
  useWorkspace,
} from "@/components/workspace/workspace-context";
import { DEFAULT_SETTINGS } from "@/lib/settings/settings";
import { useSettingsOptional } from "@/lib/settings/settings-context";
import { resolveShortcuts } from "@/lib/shortcuts/resolve";
import { dragOverlayLabel } from "@/lib/workspace/drag-overlay-label";
import { isEditableTarget } from "@/lib/workspace/is-editable-target";
import type { TreeNode } from "@/lib/workspace/model";
import {
  dropTarget,
  findNode,
  locateNode,
  parseEmptyZoneId,
  projectDropPosition,
  rawDropTarget,
} from "@/lib/workspace/tree-locate";
import { flattenVisible, resolveTreeKey } from "@/lib/workspace/tree-navigate";

function pointerY(event: DragOverEvent): number | null {
  const activator = event.activatorEvent;
  if (activator instanceof PointerEvent || activator instanceof MouseEvent) {
    return activator.clientY + event.delta.y;
  }
  const activeRect = event.active.rect.current.translated;
  return activeRect ? activeRect.top + activeRect.height / 2 : null;
}

function projectPosition(
  event: DragOverEvent,
  isOverFolder: boolean,
  isExpandedFolder: boolean,
): DropIndicator["position"] {
  const overRect = event.over?.rect;
  const y = pointerY(event);
  if (!overRect || y === null) {
    return "before";
  }
  return projectDropPosition({
    pointerY: y,
    rectTop: overRect.top,
    rectHeight: overRect.height,
    isOverFolder,
    isExpandedFolder,
  });
}

export function SidebarTree() {
  const {
    tree,
    moveNode,
    moveNodes,
    removeNodes,
    selectedIds,
    selectInTree,
    clearSelection,
    expandedIds,
    toggleExpand,
    openNode,
    activeTabId,
    addDatabase,
    createFolder,
  } = useWorkspace();
  const { pendingPanelFocus, consumePanelFocus } = useChrome();
  const shortcuts =
    useSettingsOptional()?.settings.shortcuts ?? DEFAULT_SETTINGS.shortcuts;
  // The nodes the confirm dialog is about to delete (a right-click target or the live selection).
  const [pendingDelete, setPendingDelete] = useState<TreeNode[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [indicator, setIndicator] = useState<DropIndicator | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // A row's context-menu Delete: if the right-clicked row is part of a multi-selection, the dialog
  // targets the whole selection; otherwise just that one node.
  const requestDelete = useCallback(
    (node: TreeNode) => {
      if (selectedIds.has(node.id) && selectedIds.size > 1) {
        const selected = [...selectedIds]
          .map((id) => findNode(tree, id))
          .filter((found): found is TreeNode => found !== null);
        setPendingDelete(selected);
        return;
      }
      setPendingDelete([node]);
    },
    [selectedIds, tree],
  );

  // The delete-nodes binding (default Backspace; macOS delete sends Backspace) with a non-empty
  // selection opens the bulk confirm dialog, unless focus is in a text input. The PC forward-Delete
  // key is a fixed alias regardless of the rebindable Backspace default.
  useEffect(() => {
    const deleteBinding = resolveShortcuts(shortcuts)["delete-nodes"];
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && !matchesAny(event, deleteBinding)) {
        return;
      }
      if (isEditableTarget(event.target) || selectedIds.size === 0) {
        return;
      }
      const selected = [...selectedIds]
        .map((id) => findNode(tree, id))
        .filter((found): found is TreeNode => found !== null);
      if (selected.length === 0) {
        return;
      }
      event.preventDefault();
      setPendingDelete(selected);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedIds, tree, shortcuts]);

  // Roving tabIndex: exactly one row is Tab-focusable - the active tab if it is a visible row, else
  // the first selected visible row, else the first visible row. The rest carry tabIndex=-1.
  const visibleIds = useMemo(
    () => flattenVisible(tree, expandedIds),
    [tree, expandedIds],
  );
  const selectedVisible = visibleIds.find((id) => selectedIds.has(id));
  const rovingId =
    (activeTabId !== null && visibleIds.includes(activeTabId)
      ? activeTabId
      : null) ??
    selectedVisible ??
    visibleIds[0] ??
    null;

  // A row registers its element here so a nav command can move DOM focus to it imperatively after
  // the state change lands (a layout-less effect below drains pendingFocusId).
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const pendingFocusId = useRef<string | null>(null);
  const registerRow = useCallback((id: string, element: HTMLElement | null) => {
    if (element) {
      rowRefs.current.set(id, element);
      return;
    }
    rowRefs.current.delete(id);
  }, []);

  useEffect(() => {
    const id = pendingFocusId.current;
    if (id === null) {
      return;
    }
    pendingFocusId.current = null;
    rowRefs.current.get(id)?.focus();
  });

  // The sidebar panel-focus consumer (Slice C's deferred "sidebar" branch): when the sidebar is
  // toggled visible, move focus to the roving row so arrows navigate immediately.
  useEffect(() => {
    if (pendingPanelFocus !== "sidebar") {
      return;
    }
    if (rovingId !== null) {
      rowRefs.current.get(rovingId)?.focus();
    }
    consumePanelFocus();
  }, [pendingPanelFocus, rovingId, consumePanelFocus]);

  const handleKeyDown = useCallback(
    (focusedId: string, event: ReactKeyboardEvent) => {
      const bindings = resolveShortcuts(shortcuts);
      const command = resolveTreeKey({
        tree,
        expandedIds,
        focusedId,
        event: event.nativeEvent,
        bindings,
      });
      if (command.type === "none") {
        return;
      }
      event.preventDefault();
      if (command.type === "focus") {
        selectInTree(command.id, "replace");
        pendingFocusId.current = command.id;
        return;
      }
      if (command.type === "extend") {
        selectInTree(command.id, "range");
        pendingFocusId.current = command.id;
        return;
      }
      if (command.type === "activate") {
        openNode(command.id);
        return;
      }
      if (
        command.type === "toggle" ||
        command.type === "expand" ||
        command.type === "collapse"
      ) {
        toggleExpand(command.id);
        return;
      }
      // move: reorder/reparent, then keep focus on the moved row.
      moveNode(command.id, command.target);
      pendingFocusId.current = command.id;
    },
    [
      tree,
      expandedIds,
      shortcuts,
      selectInTree,
      openNode,
      toggleExpand,
      moveNode,
    ],
  );

  const contextMenuBindings = resolveShortcuts(shortcuts)["open-context-menu"];

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  };

  const handleDragOver = (event: DragOverEvent) => {
    const overId = event.over ? String(event.over.id) : null;
    if (!overId || overId === String(event.active.id)) {
      setIndicator(null);
      return;
    }
    // The empty-folder drop zone always means "inside" - no projection needed.
    if (parseEmptyZoneId(overId) !== null) {
      setIndicator({ overId, position: "inside" });
      return;
    }
    const over = findNode(tree, overId);
    const isOverFolder = over?.kind === "folder";
    // Expand a hovered folder so its children (or the empty-drop zone) appear as
    // drop targets. A hovered folder is always (about to be) expanded, so project
    // it with the expanded-folder geometry (whole row = inside).
    if (isOverFolder && !expandedIds.has(overId)) {
      toggleExpand(overId);
    }
    const position = projectPosition(
      event,
      Boolean(isOverFolder),
      isOverFolder,
    );
    setIndicator({ overId, position });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const dragId = String(event.active.id);
    const current = indicator;
    setActiveId(null);
    setIndicator(null);
    if (!current || current.overId === dragId) {
      return;
    }
    // Dragging a row that's part of a multi-selection moves the WHOLE selection;
    // dragging an unselected row moves just that one (and the over-row can't be a
    // dragged member). moveNodes wants the RAW drop index (it does its own
    // multi-node compensation); the single path keeps dropTarget's compensation.
    const isMultiDrag = selectedIds.has(dragId) && selectedIds.size > 1;
    if (isMultiDrag) {
      if (selectedIds.has(current.overId)) {
        return;
      }
      const raw = rawDropTarget(tree, current.overId, current.position);
      if (!raw) {
        return;
      }
      moveNodes([...selectedIds], raw);
      return;
    }
    const target = dropTarget(tree, dragId, current.overId, current.position);
    if (!target) {
      return;
    }
    const from = locateNode(tree, dragId);
    if (
      from &&
      from.parentId === target.parentId &&
      from.index === target.index
    ) {
      return;
    }
    moveNode(dragId, target);
  };

  const activeNode = activeId ? findNode(tree, activeId) : null;
  const isMultiActive =
    activeId !== null && selectedIds.has(activeId) && selectedIds.size > 1;

  return (
    <DeleteRequestProvider value={requestDelete}>
      <ScrollArea className="flex-1">
        <DndContext
          sensors={sensors}
          collisionDetection={pointerWithin}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={() => {
            setActiveId(null);
            setIndicator(null);
          }}
        >
          <TreeDndProvider value={{ activeId, indicator }}>
            <TreeNavProvider
              value={{
                rovingId,
                contextMenuBindings,
                registerRow,
                handleKeyDown,
              }}
            >
              <ContextMenu>
                {/* Right-clicking the empty sidebar area opens this root menu; a row's own menu (nested
                  trigger) takes precedence when the click lands on a row. min-h keeps the empty-area
                  target tall even with few rows. */}
                <ContextMenuTrigger asChild>
                  <ul
                    role="tree"
                    aria-label="Navigator"
                    className="min-h-40"
                    // A plain left-click on the empty area clears the selection.
                    onClick={(event) => {
                      if (event.target === event.currentTarget) {
                        clearSelection();
                      }
                    }}
                  >
                    {tree.map((node) => (
                      <TreeRow key={node.id} node={node} depth={0} />
                    ))}
                  </ul>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onSelect={() => addDatabase()}>
                    New database
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={() => createFolder()}>
                    New folder
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
              <DragOverlay>
                {activeNode ? (
                  <div className="relative">
                    {/* A second offset card behind the chip reads as a stack when dragging many. */}
                    {isMultiActive ? (
                      <div className="absolute left-1 top-1 size-full bg-accent shadow" />
                    ) : null}
                    <div
                      data-testid="drag-overlay"
                      className="relative bg-accent px-2 py-1 text-[13px] shadow"
                    >
                      {dragOverlayLabel(
                        activeNode.id,
                        activeNode.name,
                        selectedIds,
                      )}
                    </div>
                  </div>
                ) : null}
              </DragOverlay>
            </TreeNavProvider>
          </TreeDndProvider>
        </DndContext>
        {tree.length === 0 && (
          <div className="flex flex-col gap-1 px-3 py-4 text-center">
            <p className="text-sm font-medium">No connection</p>
            <p className="text-xs text-muted-foreground">
              Connect to a database to browse its objects.
            </p>
          </div>
        )}
      </ScrollArea>
      <DeleteNodeDialog
        nodes={pendingDelete}
        onOpenChange={(open) => !open && setPendingDelete([])}
        onConfirm={(ids) => {
          removeNodes(ids);
          clearSelection();
          setPendingDelete([]);
        }}
      />
    </DeleteRequestProvider>
  );
}
