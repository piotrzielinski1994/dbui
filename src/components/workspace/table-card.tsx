import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DataGrid, renderCell, type Cell } from "@/components/workspace/data-grid";
import { fetchTable, updateTable, type CellEdit } from "@/lib/tauri";
import { useWorkspace } from "@/components/workspace/workspace-context";
import type {
  ConnectionConfig,
  TableNode,
  TableRows,
} from "@/components/workspace/mock-data";

function quoteIdent(engine: ConnectionConfig["engine"], name: string): string {
  return engine === "mysql"
    ? `\`${name.replace(/`/g, "``")}\``
    : `"${name.replace(/"/g, '""')}"`;
}

function quoteLiteral(value: Cell): string {
  return value === null ? "NULL" : `'${value.replace(/'/g, "''")}'`;
}

function previewSql(
  engine: ConnectionConfig["engine"],
  table: string,
  column: string,
  newValue: Cell,
  pkColumn: string,
  pkValue: Cell,
): string {
  return `UPDATE ${quoteIdent(engine, table)} SET ${quoteIdent(engine, column)} = ${quoteLiteral(newValue)} WHERE ${quoteIdent(engine, pkColumn)} = ${quoteLiteral(pkValue)}`;
}

function fetchSql(
  engine: ConnectionConfig["engine"],
  table: string,
  filter: string | undefined,
): string {
  const where = filter ? ` WHERE ${filter}` : "";
  return `SELECT * FROM ${quoteIdent(engine, table)}${where} LIMIT 200`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === "string" ? error : JSON.stringify(error);
}

function RecordView({
  columns,
  row,
  isDirtyColumn,
}: {
  columns: string[];
  row: Cell[];
  isDirtyColumn: (column: string) => boolean;
}) {
  return (
    <ul aria-label="Record" className="flex flex-col text-sm">
      {columns.map((name, index) => (
        <li key={name} className="flex border-b last:border-0">
          <span className="w-48 shrink-0 border-r px-3 py-1.5 font-mono font-medium text-muted-foreground">
            {name}
          </span>
          <span
            className={cn(
              "flex-1 px-3 py-1.5 font-mono break-all",
              isDirtyColumn(name) && "bg-amber-500/15",
            )}
          >
            {renderCell(row[index] ?? null)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function TableView({
  columns,
  rows,
  editable = false,
  edits = {},
  onCommitEdit = () => {},
}: {
  columns: string[];
  rows: Cell[][];
  editable?: boolean;
  edits?: Record<string, string>;
  onCommitEdit?: (rowIndex: number, column: string, value: string) => void;
}) {
  const [isRecordView, setIsRecordView] = useState(false);
  const [selectedRow, setSelectedRow] = useState(0);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") {
        return;
      }
      const target = event.target as HTMLElement | null;
      const isTyping =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement;
      if (isTyping) {
        return;
      }
      event.preventDefault();
      setIsRecordView((current) => !current);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const editValueAt = (rowIndex: number, column: string): Cell => {
    const key = `${rowIndex}:${column}`;
    if (key in edits) {
      return edits[key];
    }
    const columnIndex = columns.indexOf(column);
    return rows[rowIndex]?.[columnIndex] ?? null;
  };

  const isDirtyAt = (rowIndex: number, column: string): boolean =>
    `${rowIndex}:${column}` in edits;

  if (isRecordView && rows.length > 0) {
    const index = Math.min(selectedRow, rows.length - 1);
    return (
      <RecordView
        columns={columns}
        row={columns.map((column) => editValueAt(index, column))}
        isDirtyColumn={(column) => isDirtyAt(index, column)}
      />
    );
  }

  return (
    <DataGrid
      columns={columns}
      rows={rows}
      selectedRow={selectedRow}
      onSelectRow={setSelectedRow}
      editable={editable}
      editValueAt={editValueAt}
      isDirtyAt={isDirtyAt}
      onCommitEdit={onCommitEdit}
    />
  );
}

function LiveTable({
  config,
  tableId,
  tableName,
  filter,
}: {
  config: ConnectionConfig;
  tableId: string;
  tableName: string;
  filter: string | undefined;
}) {
  const queryClient = useQueryClient();
  const {
    pendingEdits,
    upsertPendingEdit,
    discardPendingEdit,
    discardPendingEditsForTable,
    addHistoryEntry,
  } = useWorkspace();
  const [isSaving, setIsSaving] = useState(false);

  const { data, error, isPending, dataUpdatedAt, errorUpdatedAt } = useQuery<
    TableRows,
    Error
  >({
    queryKey: ["table-rows", tableId, filter ?? ""],
    queryFn: () => fetchTable(config, tableName, filter),
    // Switching tabs unmounts/remounts this card; without a stale time the cached
    // rows would refetch on every return. A new filter uses a different queryKey
    // and Save explicitly invalidates, so the only thing this suppresses is the
    // pointless re-fetch (and duplicate history row) when revisiting the tab.
    staleTime: Infinity,
  });

  const sql = fetchSql(config.engine, tableName, filter);
  useEffect(() => {
    if (dataUpdatedAt === 0 || !data) {
      return;
    }
    addHistoryEntry({
      id: `fetch-${tableId}-${filter ?? ""}-${dataUpdatedAt}`,
      sql,
      status: "success",
      message: `SELECT ${data.rows.length}`,
      at: new Date().toLocaleTimeString(),
    });
    // addHistoryEntry/sql are stable enough; log once per fetch settle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataUpdatedAt]);
  useEffect(() => {
    if (errorUpdatedAt === 0 || !error) {
      return;
    }
    addHistoryEntry({
      id: `fetch-err-${tableId}-${filter ?? ""}-${errorUpdatedAt}`,
      sql,
      status: "error",
      message: errorMessage(error),
      at: new Date().toLocaleTimeString(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errorUpdatedAt]);

  const tableEdits = pendingEdits.filter((edit) => edit.tableId === tableId);
  const edits = Object.fromEntries(
    tableEdits.map((edit) => [
      `${edit.rowIndex}:${edit.column}`,
      edit.newValue,
    ]),
  );

  if (isPending) {
    return <p className="p-3 text-sm text-muted-foreground">Loading...</p>;
  }
  if (error) {
    return <p className="p-3 text-sm text-destructive">{error.message}</p>;
  }

  const { columns, rows, primaryKey } = data;
  const editable = primaryKey !== null;
  const pkIndex = primaryKey ? columns.indexOf(primaryKey) : -1;

  const commitEdit = (rowIndex: number, column: string, value: string) => {
    const columnIndex = columns.indexOf(column);
    const original = rows[rowIndex]?.[columnIndex] ?? null;
    const id = `${tableId}:${rowIndex}:${column}`;
    if (value === (original ?? "") || !primaryKey) {
      discardPendingEdit(id);
      return;
    }
    const pkValue = pkIndex >= 0 ? (rows[rowIndex]?.[pkIndex] ?? null) : null;
    upsertPendingEdit({
      id,
      tableId,
      tableName,
      column,
      rowIndex,
      pkValue,
      oldValue: original,
      newValue: value,
      sql: previewSql(
        config.engine,
        tableName,
        column,
        value,
        primaryKey,
        pkValue,
      ),
    });
  };

  const save = async () => {
    const payload: CellEdit[] = tableEdits.map((edit) => ({
      column: edit.column,
      pkValue: edit.pkValue ?? "",
      value: edit.newValue,
    }));
    setIsSaving(true);
    try {
      await updateTable(config, tableName, payload);
      discardPendingEditsForTable(tableId);
      toast.success(`Saved ${payload.length} change(s)`);
      queryClient.invalidateQueries({ queryKey: ["table-rows", tableId] });
    } catch (saveError) {
      toast.error(
        saveError instanceof Error ? saveError.message : String(saveError),
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        <TableView
          columns={columns}
          rows={rows}
          editable={editable}
          edits={edits}
          onCommitEdit={commitEdit}
        />
      </div>
      {tableEdits.length > 0 ? (
        <div className="flex shrink-0 items-center justify-end gap-2 border-t bg-muted/30 px-3 py-1.5">
          <span className="mr-auto text-xs text-muted-foreground">
            {tableEdits.length} pending (see Changes tab)
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => discardPendingEditsForTable(tableId)}
            disabled={isSaving}
          >
            Discard
          </Button>
          <Button size="sm" onClick={save} disabled={isSaving}>
            {isSaving ? "Saving..." : "Save"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function staticColumns(table: TableNode): string[] {
  return table.columns.map((column) => column.name);
}

function staticRows(table: TableNode, filter: string | undefined): Cell[][] {
  const all = table.rows.map((row) =>
    table.columns.map((column) => row[column.name] ?? null),
  );
  if (!filter) {
    return all;
  }
  const needle = filter.toLowerCase();
  return all.filter((row) =>
    row.some((cell) => (cell ?? "").toLowerCase().includes(needle)),
  );
}

export function TableCard() {
  const {
    activeNode,
    connections,
    databaseIdByTableId,
    pendingEdits,
    discardPendingEditsForTable,
  } = useWorkspace();
  const [filterText, setFilterText] = useState("");
  const [appliedFilter, setAppliedFilter] = useState("");
  const [isDiscardPromptOpen, setIsDiscardPromptOpen] = useState(false);

  const isTable = activeNode?.kind === "table";
  const databaseId = isTable
    ? databaseIdByTableId.get(activeNode.id)
    : undefined;
  const config = databaseId ? connections.get(databaseId) : undefined;
  const tableId = isTable ? activeNode.id : undefined;
  const hasPendingEdits = pendingEdits.some(
    (edit) => edit.tableId === tableId,
  );

  const filter = appliedFilter.trim() ? appliedFilter.trim() : undefined;
  const applyFilter = () => {
    if (hasPendingEdits) {
      setIsDiscardPromptOpen(true);
      return;
    }
    setAppliedFilter(filterText);
  };
  const confirmDiscardAndFilter = () => {
    if (tableId) {
      discardPendingEditsForTable(tableId);
    }
    setAppliedFilter(filterText);
    setIsDiscardPromptOpen(false);
  };

  if (!activeNode || activeNode.kind !== "table") {
    return null;
  }

  const isLive = Boolean(config);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10.25 shrink-0 items-stretch border-b bg-muted/30">
        <Input
          aria-label="Filter rows"
          placeholder={
            isLive ? "WHERE ... (raw SQL) - Enter to run" : "Filter..."
          }
          value={filterText}
          onChange={(event) => setFilterText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              applyFilter();
            }
          }}
          className="h-full flex-1 rounded-none border-0 bg-transparent px-3 font-mono text-xs shadow-none focus-visible:ring-0 dark:bg-transparent"
        />
        <Button
          type="button"
          aria-label="Run filter"
          onClick={applyFilter}
          className="h-full rounded-none border-0 border-l border-l-border px-3"
        >
          <Search className="size-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {isLive && config ? (
          <LiveTable
            config={config}
            tableId={activeNode.id}
            tableName={activeNode.name}
            filter={filter}
          />
        ) : (
          <TableView
            columns={staticColumns(activeNode)}
            rows={staticRows(activeNode, filter)}
          />
        )}
      </div>
      <Dialog
        open={isDiscardPromptOpen}
        onOpenChange={setIsDiscardPromptOpen}
      >
        <DialogContent onOpenAutoFocus={(event) => event.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Discard unsaved changes?</DialogTitle>
            <DialogDescription>
              Filtering reloads the rows and will discard your unsaved edits to
              this table.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setIsDiscardPromptOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={confirmDiscardAndFilter}>
              Discard and filter
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
