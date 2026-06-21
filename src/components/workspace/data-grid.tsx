import { memo, useMemo, useState } from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { toCsv, toJson } from "@/lib/export";
import type { Sort, TableColumn } from "@/lib/workspace/model";

export type Cell = string | null;
type Row = Record<string, Cell>;

export type ColumnMeta = Pick<
  TableColumn,
  "dataType" | "nullable" | "isPrimaryKey"
>;

const columnHelper = createColumnHelper<Row>();

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
  const markers = [meta.isPrimaryKey ? "PK" : null, !meta.nullable ? "NN" : null]
    .filter((marker): marker is string => marker !== null)
    .join(" ");
  return [meta.dataType, markers].filter(Boolean).join(" ");
}

// Shared by the table card and the SQL result footer: copies the grid's columns + rows to the
// clipboard as CSV or JSON. Disabled when there are no rows.
export function CopyButtons({
  columns,
  rows,
  className,
}: {
  columns: string[];
  rows: Cell[][];
  className?: string;
}) {
  const copy = async (format: "CSV" | "JSON") => {
    const text = format === "CSV" ? toCsv(columns, rows) : toJson(columns, rows);
    const result = await navigator.clipboard
      .writeText(text)
      .then(() => true)
      .catch(() => false);
    if (result) {
      toast.success(`Copied ${rows.length} row(s) as ${format}`);
    } else {
      toast.error(`Could not copy to clipboard`);
    }
  };

  return (
    <div className={cn("flex items-center", className)}>
      <Button
        type="button"
        variant="ghost"
        disabled={rows.length === 0}
        onClick={() => copy("CSV")}
        className="h-full rounded-none border-0 border-l border-l-border px-3"
      >
        Copy CSV
      </Button>
      <Button
        type="button"
        variant="ghost"
        disabled={rows.length === 0}
        onClick={() => copy("JSON")}
        className="h-full rounded-none border-0 border-l border-l-border px-3"
      >
        Copy JSON
      </Button>
    </div>
  );
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
  selectedRow,
  onSelectRow,
  editable,
  editValueAt,
  isDirtyAt,
  onCommitEdit,
  columnMeta,
  sort,
  onSortColumn,
}: {
  columns: string[];
  rows: Cell[][];
  selectedRow: number;
  onSelectRow: (index: number) => void;
  editable: boolean;
  editValueAt: (rowIndex: number, column: string) => Cell;
  isDirtyAt: (rowIndex: number, column: string) => boolean;
  onCommitEdit: (rowIndex: number, column: string, value: string) => void;
  columnMeta?: Record<string, ColumnMeta>;
  sort?: Sort | null;
  onSortColumn?: (column: string) => void;
}) {
  const [editing, setEditing] = useState<{
    rowIndex: number;
    column: string;
  } | null>(null);

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
    <div>
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
          {grid.getRowModel().rows.map((row) => (
            <tr
              key={row.id}
              aria-selected={row.index === selectedRow}
              onClick={() => onSelectRow(row.index)}
              className="cursor-default border-b last:border-0 aria-selected:bg-accent"
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
                      if (editable) {
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
                      <div className="overflow-hidden px-3 py-1.5 text-ellipsis whitespace-nowrap">
                        {renderCell(dirtyValue)}
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 ? (
        <p className="p-3 text-sm text-muted-foreground">No rows.</p>
      ) : null}
    </div>
  );
}

export const DataGrid = memo(DataGridImpl);
