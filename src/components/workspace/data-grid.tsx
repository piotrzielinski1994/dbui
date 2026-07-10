import {
  Fragment,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { toCsv, toJson } from "@/lib/export";
import { isEditableTarget } from "@/lib/workspace/is-editable-target";
import { resolveShortcuts } from "@/lib/shortcuts/resolve";
import { matchesHotkey } from "@/lib/shortcuts/match-hotkey";
import type { ShortcutOverrides } from "@/lib/shortcuts/registry";
import type { RowSelectMode } from "@/lib/workspace/row-select";
import {
  foreignKeyForColumn,
  isForeignKeyNavigable,
  navigableForeignKeys,
} from "@/lib/workspace/foreign-key-nav";
import type { ForeignKey, Sort, TableColumn } from "@/lib/workspace/model";

// Which selection mode a row click implies: Shift = range, Cmd/Ctrl = toggle, plain = replace.
function rowSelectModeOf(event: {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}): RowSelectMode {
  if (event.shiftKey) {
    return "range";
  }
  if (event.metaKey || event.ctrlKey) {
    return "toggle";
  }
  return "replace";
}

export type Cell = string | null;
type Row = Record<string, Cell>;

export type ColumnMeta = Pick<
  TableColumn,
  "dataType" | "nullable" | "isPrimaryKey"
> & {
  // True when this column is (part of) an outbound foreign key - marked `FK` in the header so the
  // navigable link is discoverable. Optional: absent/false for non-FK columns and static grids.
  isForeignKey?: boolean;
};

const columnHelper = createColumnHelper<Row>();

// Test-only render counter (perf-probe): asserts the memo absorbs an unrelated chrome toggle. The
// grid must NOT re-render when the sidebar/console toggles - see the shortcuts-as-prop note below.
export const __dataGridRenderCount = { value: 0 };

export function renderCell(value: Cell) {
  if (value === null) {
    return <span className="text-muted-foreground/60">[NULL]</span>;
  }
  return value;
}

function isSortedBy(sort: Sort | null | undefined, column: string): boolean {
  return Boolean(sort && sort.column === column);
}

// Always renders a glyph so the affordance is visible on every sortable column: a dim neutral
// triangle when unsorted, a solid up/down when this column is the active sort.
function sortGlyph(sort: Sort | null | undefined, column: string): string {
  if (!isSortedBy(sort, column)) {
    return "▾";
  }
  return sort?.descending ? "▼" : "▲";
}

function columnMarkers(meta: ColumnMeta): string {
  const markers = [
    meta.isPrimaryKey ? "PK" : null,
    meta.isForeignKey ? "FK" : null,
    !meta.nullable ? "NN" : null,
  ]
    .filter((marker): marker is string => marker !== null)
    .join(" ");
  return [meta.dataType, markers].filter(Boolean).join(" ");
}

// Copies the given columns + rows to the clipboard as CSV or JSON and fires a toast. Shared by the
// grid's row context menu (copies the current selection) so the copy/toast behaviour stays in one
// place regardless of which caller (table card / SQL result) triggers it.
export type CopyFormat = "CSV" | "JSON";

async function writeToClipboard(
  text: string,
  successMessage: string,
): Promise<void> {
  const copied = await navigator.clipboard
    .writeText(text)
    .then(() => true)
    .catch(() => false);
  if (copied) {
    toast.success(successMessage);
    return;
  }
  toast.error("Could not copy to clipboard");
}

export async function copyRowsToClipboard(
  columns: string[],
  rows: Cell[][],
  format: CopyFormat,
): Promise<void> {
  const text = format === "CSV" ? toCsv(columns, rows) : toJson(columns, rows);
  await writeToClipboard(text, `Copied ${rows.length} row(s) as ${format}`);
}

// Copies pre-built SQL/insert statements (one per row) to the clipboard with a matching toast. The
// text is built by the caller via `rowsToInsertSql`; this only owns the write + toast so the copy
// UX stays identical to the CSV/JSON path.
export async function copySqlToClipboard(
  text: string,
  rowCount: number,
): Promise<void> {
  await writeToClipboard(text, `Copied ${rowCount} row(s) as SQL`);
}

// The single grid shared by the table card and the SQL result pane - they must look
// identical. Editing is opt-in (editable + the edit callbacks); read-only callers pass
// editable={false} and no-op handlers. Headers always render so an empty result still
// shows its column structure, with "No rows." beneath.
//
// Wrapped in React.memo: rendering 200 rows x N cells is the heaviest thing in the app, and the
// grid is a workspace-context consumer, so any unrelated context change (sidebar/console toggle)
// would otherwise re-render every cell. memo skips that as long as callers pass STABLE props
// (memoized rows/columns/columnMeta + useCallback'd handlers) - see table-card/sql-tab.
function DataGridImpl({
  columns,
  rows,
  selectedRows,
  onSelectRow,
  editable,
  editValueAt,
  isDirtyAt,
  onCommitEdit,
  columnMeta,
  sort,
  onSortColumn,
  isDraftRow,
  isDeletedRow,
  onDeleteRow,
  onDeleteRows,
  onUndeleteRow,
  onCloneRow,
  onEditDocument,
  onCopyRows,
  onCopySql,
  copySqlLabel = "Copy SQL",
  foreignKeys,
  onFollowForeignKey,
  shortcuts,
}: {
  columns: string[];
  rows: Cell[][];
  // The set of selected row indices (multi-select via Cmd/Ctrl + Shift click).
  selectedRows: Set<number>;
  onSelectRow: (index: number, mode: RowSelectMode) => void;
  editable: boolean;
  editValueAt: (rowIndex: number, column: string) => Cell;
  isDirtyAt: (rowIndex: number, column: string) => boolean;
  onCommitEdit: (rowIndex: number, column: string, value: string) => void;
  columnMeta?: Record<string, ColumnMeta>;
  sort?: Sort | null;
  onSortColumn?: (column: string) => void;
  isDraftRow?: (rowIndex: number) => boolean;
  isDeletedRow?: (rowIndex: number) => boolean;
  onDeleteRow?: (rowIndex: number) => void;
  // Bulk-delete the given row indices (the current multi-selection). When present, the grid shows a
  // "Delete N rows" item for a multi-selection and binds the Delete/Backspace key.
  onDeleteRows?: (rowIndices: number[]) => void;
  onUndeleteRow?: (rowIndex: number) => void;
  onCloneRow?: (rowIndex: number) => void;
  // MongoDB only: open the whole row's document in a JSON editor (a nested object/array cell can't
  // be edited inline). Absent for SQL grids, so no "Edit document" item shows there.
  onEditDocument?: (rowIndex: number) => void;
  // Copy the given row indices (the current selection) to the clipboard as CSV/JSON. When present,
  // the row menu offers "Copy CSV"/"Copy JSON" for the selection. Absent => no copy items.
  onCopyRows?: (rowIndices: number[], format: CopyFormat) => void;
  // Copy the given row indices as engine-aware INSERT statements. When present, the row menu offers a
  // "Copy SQL" item (label overridable via copySqlLabel). Absent => no SQL copy item (SQL result
  // pane / static path, where there is no single target table).
  onCopySql?: (rowIndices: number[]) => void;
  // The SQL-copy item's label - "Copy SQL" for SQL engines, "Copy insert" for MongoDB.
  copySqlLabel?: string;
  // The open table's outbound foreign keys (live SQL tables only). When present with
  // onFollowForeignKey, the row menu offers a "Go to <refTable>" item per FK with non-null value(s).
  foreignKeys?: ForeignKey[];
  // Navigate to the referenced row of the given foreign key from the given source row.
  onFollowForeignKey?: (fk: ForeignKey, rowIndex: number) => void;
  // The resolved shortcut OVERRIDES map, passed in as a prop (not read via useSettingsOptional here)
  // so this memoized grid does NOT subscribe to the Settings context - a chrome toggle rebuilds the
  // settings value, and a context consumer would re-render all 200 rows despite memo. The callers'
  // `settings.shortcuts` ref is stable across a chrome write, so memo absorbs the toggle.
  shortcuts: ShortcutOverrides;
}) {
  const [editing, setEditing] = useState<{
    rowIndex: number;
    column: string;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  __dataGridRenderCount.value += 1;

  // The delete-rows binding deletes the current multi-selection, but only when the grid (not a cell
  // input or another surface) has focus, and only if bulk delete is wired (editable table card).
  // The PC forward-Delete key is a fixed alias regardless of the rebindable Backspace default.
  useEffect(() => {
    if (!onDeleteRows) {
      return;
    }
    const deleteBinding = resolveShortcuts(shortcuts)["delete-rows"];
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && !matchesHotkey(event, deleteBinding)) {
        return;
      }
      if (isEditableTarget(event.target) || selectedRows.size === 0) {
        return;
      }
      if (!containerRef.current?.contains(event.target as Node)) {
        return;
      }
      event.preventDefault();
      onDeleteRows([...selectedRows]);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onDeleteRows, selectedRows, shortcuts]);

  const data = useMemo(
    () =>
      rows.map((row) =>
        Object.fromEntries(
          columns.map((name, index) => [name, row[index] ?? null]),
        ),
      ),
    [columns, rows],
  );

  const defs = useMemo(
    () =>
      columns.map((name) =>
        columnHelper.accessor((row) => row[name], {
          id: name,
          header: name,
          cell: (info) => renderCell(info.getValue()),
        }),
      ),
    [columns],
  );

  const grid = useReactTable({
    data,
    columns: defs,
    columnResizeMode: "onChange",
    enableColumnResizing: true,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div ref={containerRef} tabIndex={-1} className="outline-none">
      <table
        className="w-full border-collapse text-left text-sm"
        style={{ minWidth: grid.getTotalSize() }}
      >
        <thead>
          {grid.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const columnId = header.column.id;
                const meta = columnMeta?.[columnId];
                const isSortable = Boolean(onSortColumn);
                return (
                  <th
                    key={header.id}
                    style={{ width: header.getSize() }}
                    onClick={
                      isSortable
                        ? () => onSortColumn?.(columnId)
                        : undefined
                    }
                    // Sticky so vertical scroll keeps the header visible. With border-collapse a
                    // sticky cell's own border scrolls away, so the 1px bottom divider is an inset
                    // box-shadow (travels with the cell, stays exactly 1px per design.md).
                    className={cn(
                      "sticky top-0 z-10 overflow-hidden border-r bg-background px-3 py-1.5 font-mono font-medium text-ellipsis whitespace-nowrap text-muted-foreground shadow-[inset_0_-1px_0_var(--border)] last:border-r-0",
                      isSortable && "cursor-pointer select-none",
                    )}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                      </span>
                      {isSortable ? (
                        <span
                          aria-hidden="true"
                          className={cn(
                            "shrink-0",
                            isSortedBy(sort, columnId)
                              ? "text-foreground"
                              : "text-muted-foreground/30",
                          )}
                        >
                          {sortGlyph(sort, columnId)}
                        </span>
                      ) : null}
                    </div>
                    {meta ? (
                      <span
                        aria-hidden="true"
                        className="block text-[10px] font-normal text-muted-foreground/60"
                      >
                        {columnMarkers(meta)}
                      </span>
                    ) : null}
                    <span
                      aria-hidden="true"
                      data-testid={`resize-${header.column.id}`}
                      onMouseDown={header.getResizeHandler()}
                      onTouchStart={header.getResizeHandler()}
                      onClick={(event) => event.stopPropagation()}
                      className="absolute top-0 right-0 h-full w-1 cursor-col-resize touch-none select-none hover:bg-border"
                    />
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {grid.getRowModel().rows.map((row) => {
            const isDraft = isDraftRow?.(row.index) ?? false;
            const isDeleted = isDeletedRow?.(row.index) ?? false;
            // A draft (staged-insert) row still gets a menu, but only the copy items - it can be
            // copied to the clipboard like any row, while Delete/Clone/Edit/FK stay saved-row-only
            // (a draft is discarded via the Changes tab, and cloning/deleting an unsaved row is
            // meaningless). So the menu shows whenever a copy handler is wired, or - for a saved row -
            // any of the mutation handlers.
            const hasCopyItems = Boolean(onCopyRows || onCopySql);
            const hasSavedRowItems = Boolean(
              onDeleteRow || onEditDocument || onFollowForeignKey,
            );
            const hasRowMenu =
              hasCopyItems || (hasSavedRowItems && !isDraft);
            const rowElement = (
              <tr
                aria-selected={selectedRows.has(row.index)}
                onClick={(event: MouseEvent) =>
                  onSelectRow(row.index, rowSelectModeOf(event))
                }
                className={cn(
                  // select-none: Shift-click range-select must not also trigger the browser's
                  // native text selection (which highlights the cell text blue). An editing input
                  // re-enables its own text selection, so inline edit is unaffected.
                  "cursor-default select-none border-b aria-selected:bg-accent",
                  isDraft && "bg-emerald-500/10",
                  isDeleted && "line-through opacity-50",
                )}
              >
                {row.getVisibleCells().map((cell) => {
                  const column = cell.column.id;
                  const isEditing =
                    editable &&
                    editing?.rowIndex === row.index &&
                    editing.column === column;
                  const dirtyValue = editValueAt(row.index, column);
                  const isDirty = isDirtyAt(row.index, column);
                  return (
                    <td
                      key={cell.id}
                      style={{ width: cell.column.getSize() }}
                      onDoubleClick={() => {
                        if (editable && !isDeleted) {
                          setEditing({ rowIndex: row.index, column });
                        }
                      }}
                      className={cn(
                        "overflow-hidden border-r px-0 py-0 font-mono last:border-r-0",
                        isDirty && "bg-amber-500/15",
                      )}
                    >
                      {isEditing ? (
                        <input
                          aria-label={`Edit ${column}`}
                          autoFocus
                          autoComplete="off"
                          autoCorrect="off"
                          autoCapitalize="off"
                          spellCheck={false}
                          data-1p-ignore
                          data-lpignore="true"
                          defaultValue={dirtyValue ?? ""}
                          onBlur={(event) => {
                            onCommitEdit(row.index, column, event.target.value);
                            setEditing(null);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              onCommitEdit(
                                row.index,
                                column,
                                event.currentTarget.value,
                              );
                              setEditing(null);
                            }
                            if (event.key === "Escape") {
                              setEditing(null);
                            }
                          }}
                          className="w-full bg-background px-3 py-1.5 font-mono outline-none"
                        />
                      ) : (
                        (() => {
                          // Render an FK cell's value as a Cmd/Ctrl+click link when the column is part
                          // of a foreign key whose value(s) are all non-null for this row. The modifier
                          // (not a plain click) navigates, so a plain click still selects the row like
                          // any cell; stopPropagation on the modified click keeps it from toggling the
                          // row selection.
                          const fk =
                            onFollowForeignKey && foreignKeys && dirtyValue !== null
                              ? foreignKeyForColumn(foreignKeys, column)
                              : null;
                          const isFkLink =
                            fk !== null &&
                            isForeignKeyNavigable(
                              fk,
                              columns,
                              rows[row.index] ?? [],
                            );
                          if (isFkLink && fk && onFollowForeignKey) {
                            return (
                              <div className="overflow-hidden px-3 py-1.5 text-ellipsis whitespace-nowrap">
                                <span
                                  role="link"
                                  data-testid={`fk-link-${column}-${row.index}`}
                                  title={`Cmd/Ctrl+click to go to ${fk.referencedTable}`}
                                  onClick={(event) => {
                                    if (!event.metaKey && !event.ctrlKey) {
                                      return;
                                    }
                                    event.stopPropagation();
                                    onFollowForeignKey(fk, row.index);
                                  }}
                                  className="cursor-pointer text-primary underline underline-offset-2"
                                >
                                  {renderCell(dirtyValue)}
                                </span>
                              </div>
                            );
                          }
                          return (
                            <div className="overflow-hidden px-3 py-1.5 text-ellipsis whitespace-nowrap">
                              {renderCell(dirtyValue)}
                            </div>
                          );
                        })()
                      )}
                    </td>
                  );
                })}
              </tr>
            );

            if (!hasRowMenu) {
              return <Fragment key={row.id}>{rowElement}</Fragment>;
            }

            return (
              <ContextMenu key={row.id}>
                <ContextMenuTrigger asChild>{rowElement}</ContextMenuTrigger>
                <ContextMenuContent>
                  {isDeleted ? (
                    <ContextMenuItem onSelect={() => onUndeleteRow?.(row.index)}>
                      Undo delete
                    </ContextMenuItem>
                  ) : (
                    <>
                      {onEditDocument && !isDraft ? (
                        <ContextMenuItem
                          onSelect={() => onEditDocument(row.index)}
                        >
                          Edit document
                        </ContextMenuItem>
                      ) : null}
                      {onCloneRow && !isDraft ? (
                        <ContextMenuItem
                          onSelect={() => onCloneRow(row.index)}
                        >
                          Clone
                        </ContextMenuItem>
                      ) : null}
                      {onCopyRows
                        ? (() => {
                            // Copy the selection if the right-clicked row is part of it, else just
                            // this row - same "act on the selection you clicked into" rule as delete.
                            const target =
                              selectedRows.has(row.index) && selectedRows.size > 0
                                ? [...selectedRows]
                                : [row.index];
                            const suffix =
                              target.length > 1 ? ` (${target.length} rows)` : "";
                            return (
                              <>
                                <ContextMenuItem
                                  onSelect={() => onCopyRows(target, "CSV")}
                                >
                                  {`Copy CSV${suffix}`}
                                </ContextMenuItem>
                                <ContextMenuItem
                                  onSelect={() => onCopyRows(target, "JSON")}
                                >
                                  {`Copy JSON${suffix}`}
                                </ContextMenuItem>
                              </>
                            );
                          })()
                        : null}
                      {onCopySql
                        ? (() => {
                            const target =
                              selectedRows.has(row.index) && selectedRows.size > 0
                                ? [...selectedRows]
                                : [row.index];
                            const suffix =
                              target.length > 1 ? ` (${target.length} rows)` : "";
                            return (
                              <ContextMenuItem
                                onSelect={() => onCopySql(target)}
                              >
                                {`${copySqlLabel}${suffix}`}
                              </ContextMenuItem>
                            );
                          })()
                        : null}
                      {onFollowForeignKey && foreignKeys && !isDraft
                        ? (() => {
                            const navigable = navigableForeignKeys(
                              foreignKeys,
                              columns,
                              rows[row.index] ?? [],
                            );
                            if (navigable.length === 0) {
                              return null;
                            }
                            return (
                              <>
                                <ContextMenuSeparator />
                                {navigable.map(({ fk, label }) => (
                                  <ContextMenuItem
                                    key={fk.name}
                                    onSelect={() =>
                                      onFollowForeignKey(fk, row.index)
                                    }
                                  >
                                    {label}
                                  </ContextMenuItem>
                                ))}
                              </>
                            );
                          })()
                        : null}
                      {isDraft ? null : onDeleteRows &&
                        selectedRows.has(row.index) &&
                        selectedRows.size > 1 ? (
                        <>
                          {onDeleteRow ? <ContextMenuSeparator /> : null}
                          <ContextMenuItem
                            variant="destructive"
                            onSelect={() => onDeleteRows([...selectedRows])}
                          >
                            {`Delete ${selectedRows.size} rows`}
                          </ContextMenuItem>
                        </>
                      ) : onDeleteRow ? (
                        <ContextMenuItem
                          variant="destructive"
                          onSelect={() => onDeleteRow(row.index)}
                        >
                          Delete
                        </ContextMenuItem>
                      ) : null}
                    </>
                  )}
                </ContextMenuContent>
              </ContextMenu>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 ? (
        <p className="p-3 text-sm text-muted-foreground">No rows.</p>
      ) : null}
    </div>
  );
}

export const DataGrid = memo(DataGridImpl);
