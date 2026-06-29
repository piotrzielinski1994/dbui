import { useCallback, useEffect, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { TreeRow } from "@/components/workspace/tree-row";
import {
  TreeDndProvider,
  type DropIndicator,
} from "@/components/workspace/tree-dnd";
import { DeleteRequestProvider } from "@/components/workspace/delete-request-context";
import { DeleteNodeDialog } from "@/components/workspace/delete-node-dialog";
import {
  dropTarget,
  findNode,
  locateNode,
  parseEmptyZoneId,
  projectDropPosition,
  rawDropTarget,
} from "@/lib/workspace/tree-locate";
import { isEditableTarget } from "@/lib/workspace/is-editable-target";
import { dragOverlayLabel } from "@/lib/workspace/drag-overlay-label";
import { useSettingsOptional } from "@/lib/settings/settings-context";
import { DEFAULT_SETTINGS } from "@/lib/settings/settings";
import { resolveShortcuts } from "@/lib/shortcuts/resolve";
import { matchesHotkey } from "@/lib/shortcuts/match-hotkey";
import type { TreeNode } from "@/lib/workspace/model";

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
    clearSelection,
    expandedIds,
    toggleExpand,
    addDatabase,
    createFolder,
  } = useWorkspace();
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
      if (event.key !== "Delete" && !matchesHotkey(event, deleteBinding)) {
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
    const position = projectPosition(event, Boolean(isOverFolder), isOverFolder);
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
