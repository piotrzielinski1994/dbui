import { useCallback, useEffect, useMemo, useState } from "react";
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SqlEditor } from "@/components/workspace/sql-editor";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CopyButtons,
  DataGrid,
  renderCell,
  type Cell,
  type ColumnMeta,
} from "@/components/workspace/data-grid";
import {
  applyRowMutations,
  countTable,
  fetchTable,
  type RowMutation,
} from "@/lib/tauri";
import { toResult } from "@/lib/result";
import {
  useWorkspace,
  type PendingMutation,
} from "@/components/workspace/workspace-context";
import type {
  ConnectionConfig,
  Sort,
  TableNode,
  TableRows,
  TableSchema,
} from "@/lib/workspace/model";

const EMPTY_SCHEMA: TableSchema[] = [];

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

function previewInsertSql(
  engine: ConnectionConfig["engine"],
  table: string,
  values: Record<string, Cell>,
): string {
  const entries = Object.entries(values);
  const columns = entries
    .map(([column]) => quoteIdent(engine, column))
    .join(", ");
  const cells = entries
    .map(([, value]) => quoteLiteral(value))
    .join(", ");
  return `INSERT INTO ${quoteIdent(engine, table)} (${columns}) VALUES (${cells})`;
}

function previewDeleteSql(
  engine: ConnectionConfig["engine"],
  table: string,
  pkColumn: string,
  pkValue: Cell,
): string {
  return `DELETE FROM ${quoteIdent(engine, table)} WHERE ${quoteIdent(engine, pkColumn)} = ${quoteLiteral(pkValue)}`;
}

const ROW_LIMIT = 200;

function fetchSql(
  engine: ConnectionConfig["engine"],
  table: string,
  filter: string | undefined,
  sort: Sort | null,
  limit: number,
): string {
  const where = filter ? ` WHERE (${filter})` : "";
  const order = sort
    ? ` ORDER BY ${quoteIdent(engine, sort.column)}${sort.descending ? " DESC" : ""}`
    : "";
  return `SELECT * FROM ${quoteIdent(engine, table)}${where}${order} LIMIT ${limit}`;
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
  columnMeta,
  sort,
  onSortColumn,
  isDraftRow,
  isDeletedRow,
  onDeleteRow,
  onUndeleteRow,
  onCloneRow,
}: {
  columns: string[];
  rows: Cell[][];
  editable?: boolean;
  edits?: Record<string, string>;
  onCommitEdit?: (rowIndex: number, column: string, value: string) => void;
  columnMeta?: Record<string, ColumnMeta>;
  sort?: Sort | null;
  onSortColumn?: (column: string) => void;
  isDraftRow?: (rowIndex: number) => boolean;
  isDeletedRow?: (rowIndex: number) => boolean;
  onDeleteRow?: (rowIndex: number) => void;
  onUndeleteRow?: (rowIndex: number) => void;
  onCloneRow?: (rowIndex: number) => void;
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

  const editValueAt = useCallback(
    (rowIndex: number, column: string): Cell => {
      const key = `${rowIndex}:${column}`;
      if (key in edits) {
        return edits[key];
      }
      const columnIndex = columns.indexOf(column);
      return rows[rowIndex]?.[columnIndex] ?? null;
    },
    [edits, columns, rows],
  );

  const isDirtyAt = useCallback(
    (rowIndex: number, column: string): boolean =>
      `${rowIndex}:${column}` in edits,
    [edits],
  );

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
      columnMeta={columnMeta}
      sort={sort}
      onSortColumn={onSortColumn}
      isDraftRow={isDraftRow}
      isDeletedRow={isDeletedRow}
      onDeleteRow={onDeleteRow}
      onUndeleteRow={onUndeleteRow}
      onCloneRow={onCloneRow}
    />
  );
}

function LiveTable({
  config,
  connectionId,
  tableId,
  tableName,
  filter,
}: {
  config: ConnectionConfig;
  connectionId: string;
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
  const [sort, setSort] = useState<Sort | null>(null);
  const [pageSize, setPageSize] = useState(ROW_LIMIT);

  const sortKey = sort ? `${sort.column}:${sort.descending}` : "";
  const {
    data,
    error,
    isPending,
    dataUpdatedAt,
    errorUpdatedAt,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useInfiniteQuery<TableRows, Error>({
    queryKey: ["table-rows", tableId, filter ?? "", sortKey, pageSize],
    queryFn: ({ pageParam }) =>
      fetchTable(connectionId, tableName, {
        filter,
        sort,
        limit: pageSize,
        offset: pageParam as number,
      }),
    initialPageParam: 0,
    // A full page (= the chosen page size) means there may be more; a short page is the last.
    getNextPageParam: (lastPage, pages) =>
      lastPage.rows.length < pageSize
        ? undefined
        : pages.length * pageSize,
    // Keep the prior page on screen while a new sort/filter loads, so the headers (and the
    // user's click target) don't unmount and flash a loading state mid-sort.
    placeholderData: keepPreviousData,
    // Switching tabs unmounts/remounts this card; without a stale time the cached
    // rows would refetch on every return. A new filter/sort uses a different queryKey
    // and Save explicitly invalidates, so the only thing this suppresses is the
    // pointless re-fetch (and duplicate history row) when revisiting the tab.
    staleTime: Infinity,
  });

  // The unbounded total ("N of TOTAL" in the status bar), independent of the page size. Depends
  // only on the filter - sort and paging don't change how many rows match.
  const { data: totalRows } = useQuery<number, Error>({
    queryKey: ["table-count", tableId, filter ?? ""],
    queryFn: () => countTable(connectionId, tableName, filter),
    staleTime: Infinity,
  });

  const sql = fetchSql(config.engine, tableName, filter, sort, pageSize);
  useEffect(() => {
    if (dataUpdatedAt === 0 || !data) {
      return;
    }
    const total = data.pages.reduce((sum, page) => sum + page.rows.length, 0);
    addHistoryEntry({
      id: `fetch-${tableId}-${filter ?? ""}-${sortKey}-${dataUpdatedAt}`,
      sql,
      status: "success",
      message: `SELECT ${total}`,
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
      id: `fetch-err-${tableId}-${filter ?? ""}-${sortKey}-${errorUpdatedAt}`,
      sql,
      status: "error",
      message: errorMessage(error),
      at: new Date().toLocaleTimeString(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errorUpdatedAt]);

  const cycleSort = useCallback(
    (column: string) =>
      setSort((current) => {
        if (!current || current.column !== column) {
          return { column, descending: false };
        }
        if (!current.descending) {
          return { column, descending: true };
        }
        return null;
      }),
    [],
  );

  const tableEdits = useMemo(
    () => pendingEdits.filter((edit) => edit.tableId === tableId),
    [pendingEdits, tableId],
  );
  const inserts = useMemo(
    () =>
      tableEdits.filter(
        (edit): edit is Extract<PendingMutation, { kind: "insert" }> =>
          edit.kind === "insert",
      ),
    [tableEdits],
  );
  const deletedPks = useMemo(
    () =>
      new Set(
        tableEdits
          .filter(
            (edit): edit is Extract<PendingMutation, { kind: "delete" }> =>
              edit.kind === "delete",
          )
          .map((edit) => edit.pkValue),
      ),
    [tableEdits],
  );
  const edits = useMemo(
    () =>
      Object.fromEntries(
        tableEdits
          .filter(
            (edit): edit is Extract<PendingMutation, { kind: "cell" }> =>
              edit.kind === "cell",
          )
          .map((edit) => [`${edit.rowIndex}:${edit.column}`, edit.newValue]),
      ),
    [tableEdits],
  );

  // Memoize the grid inputs: any context change (sidebar/console toggle) re-renders this card,
  // and rebuilding rows/columns as fresh arrays would defeat DataGrid's internal useMemo and
  // trigger TanStack Table's full re-render of every row (the documented stable-ref trap that
  // freezes the app on large tables). Derive from data?.pages so the hook stays unconditional.
  const columns = data?.pages[0]?.columns;
  const rows = useMemo(
    () => (data ? data.pages.flatMap((page) => page.rows) : []),
    [data],
  );
  const columnNames = useMemo(
    () => (columns ? columns.map((column) => column.name) : []),
    [columns],
  );
  const columnMeta = useMemo(
    () =>
      Object.fromEntries(
        (columns ?? []).map((column) => [
          column.name,
          {
            dataType: column.dataType,
            nullable: column.nullable,
            isPrimaryKey: column.isPrimaryKey,
          },
        ]),
      ),
    [columns],
  );

  const primaryKey = data?.pages[0]?.primaryKey ?? null;
  const editable = primaryKey !== null;
  const pkIndex = primaryKey ? columnNames.indexOf(primaryKey) : -1;

  // Draft rows (staged inserts) are appended after the saved rows; their grid index is
  // savedRowCount + position-in-inserts, so an index past the saved rows addresses a draft.
  const savedRowCount = rows.length;
  const draftRows = useMemo(
    () =>
      inserts.map((insert) =>
        columnNames.map((name) => insert.values[name] ?? null),
      ),
    [inserts, columnNames],
  );
  const gridRows = useMemo(
    () => [...rows, ...draftRows],
    [rows, draftRows],
  );

  const isDraftRow = useCallback(
    (rowIndex: number) => rowIndex >= savedRowCount,
    [savedRowCount],
  );
  const isDeletedRow = useCallback(
    (rowIndex: number) => {
      const pkValue = pkIndex >= 0 ? rows[rowIndex]?.[pkIndex] : null;
      return pkValue !== null && pkValue !== undefined && deletedPks.has(pkValue);
    },
    [deletedPks, rows, pkIndex],
  );

  const commitEdit = useCallback(
    (rowIndex: number, column: string, value: string) => {
      if (rowIndex >= savedRowCount) {
        const insert = inserts[rowIndex - savedRowCount];
        if (!insert) {
          return;
        }
        const values = { ...insert.values };
        if (value === "") {
          delete values[column];
        } else {
          values[column] = value;
        }
        upsertPendingEdit({
          ...insert,
          values,
          sql: previewInsertSql(config.engine, tableName, values),
        });
        return;
      }
      const columnIndex = columnNames.indexOf(column);
      const original = rows[rowIndex]?.[columnIndex] ?? null;
      const id = `${tableId}:${rowIndex}:${column}`;
      if (value === (original ?? "") || !primaryKey) {
        discardPendingEdit(id);
        return;
      }
      const pkValue = pkIndex >= 0 ? (rows[rowIndex]?.[pkIndex] ?? null) : null;
      upsertPendingEdit({
        kind: "cell",
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
    },
    [
      savedRowCount,
      inserts,
      columnNames,
      rows,
      tableId,
      tableName,
      primaryKey,
      pkIndex,
      config.engine,
      discardPendingEdit,
      upsertPendingEdit,
    ],
  );

  const addRow = useCallback(() => {
    const draftId = crypto.randomUUID();
    upsertPendingEdit({
      kind: "insert",
      id: `${tableId}:insert:${draftId}`,
      draftId,
      tableId,
      tableName,
      values: {},
      sql: previewInsertSql(config.engine, tableName, {}),
    });
  }, [tableId, tableName, config.engine, upsertPendingEdit]);

  const cloneRow = useCallback(
    (rowIndex: number) => {
      const source = rows[rowIndex];
      if (!source) {
        return;
      }
      const values: Record<string, string | null> = {};
      columnNames.forEach((name, index) => {
        const cell = source[index] ?? null;
        if (name !== primaryKey && cell !== null) {
          values[name] = cell;
        }
      });
      const draftId = crypto.randomUUID();
      upsertPendingEdit({
        kind: "insert",
        id: `${tableId}:insert:${draftId}`,
        draftId,
        tableId,
        tableName,
        values,
        sql: previewInsertSql(config.engine, tableName, values),
      });
    },
    [rows, columnNames, primaryKey, tableId, tableName, config.engine, upsertPendingEdit],
  );

  const deleteRow = useCallback(
    (rowIndex: number) => {
      if (!primaryKey || pkIndex < 0) {
        return;
      }
      const pkValue = rows[rowIndex]?.[pkIndex] ?? null;
      if (pkValue === null) {
        return;
      }
      // Deleting a row supersedes any pending cell edits to it.
      tableEdits
        .filter((edit) => edit.kind === "cell" && edit.rowIndex === rowIndex)
        .forEach((edit) => discardPendingEdit(edit.id));
      upsertPendingEdit({
        kind: "delete",
        id: `${tableId}:delete:${pkValue}`,
        tableId,
        tableName,
        pkColumn: primaryKey,
        pkValue,
        sql: previewDeleteSql(config.engine, tableName, primaryKey, pkValue),
      });
    },
    [
      primaryKey,
      pkIndex,
      rows,
      tableEdits,
      tableId,
      tableName,
      config.engine,
      discardPendingEdit,
      upsertPendingEdit,
    ],
  );

  const undeleteRow = useCallback(
    (rowIndex: number) => {
      if (pkIndex < 0) {
        return;
      }
      const pkValue = rows[rowIndex]?.[pkIndex] ?? null;
      if (pkValue === null) {
        return;
      }
      discardPendingEdit(`${tableId}:delete:${pkValue}`);
    },
    [pkIndex, rows, tableId, discardPendingEdit],
  );

  if (isPending) {
    return <p className="p-3 text-sm text-muted-foreground">Loading...</p>;
  }
  if (error) {
    return <p className="p-3 text-sm text-destructive">{error.message}</p>;
  }

  const save = async () => {
    const payload: RowMutation[] = tableEdits.flatMap(
      (edit): RowMutation[] => {
        if (edit.kind === "cell") {
          return [
            {
              kind: "cell",
              column: edit.column,
              pkValue: edit.pkValue ?? "",
              newValue: edit.newValue,
            },
          ];
        }
        if (edit.kind === "delete") {
          return [{ kind: "delete", pkValue: edit.pkValue }];
        }
        return Object.keys(edit.values).length > 0
          ? [{ kind: "insert", values: edit.values }]
          : [];
      },
    );
    const savedSqls = tableEdits
      .filter(
        (edit) => edit.kind !== "insert" || Object.keys(edit.values).length > 0,
      )
      .map((edit) => ({ id: edit.id, sql: edit.sql }));
    setIsSaving(true);
    const result = await toResult(
      applyRowMutations(connectionId, tableName, payload),
    );
    setIsSaving(false);
    if (!result.ok) {
      addHistoryEntry({
        id: `save-err-${tableId}-${Date.now()}`,
        sql: savedSqls.map((entry) => entry.sql).join(";\n"),
        status: "error",
        message: result.error,
        at: new Date().toLocaleTimeString(),
      });
      toast.error(result.error);
      return;
    }
    discardPendingEditsForTable(tableId);
    const at = new Date().toLocaleTimeString();
    const savedAt = Date.now();
    savedSqls.forEach((entry) =>
      addHistoryEntry({
        id: `save-${entry.id}-${savedAt}`,
        sql: entry.sql,
        status: "success",
        message: "OK",
        at,
      }),
    );
    toast.success(`Saved ${result.value} change(s)`);
    queryClient.invalidateQueries({ queryKey: ["table-rows", tableId] });
    queryClient.invalidateQueries({ queryKey: ["table-count", tableId] });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        <TableView
          columns={columnNames}
          rows={gridRows}
          editable={editable}
          edits={edits}
          onCommitEdit={commitEdit}
          columnMeta={columnMeta}
          sort={sort}
          onSortColumn={cycleSort}
          isDraftRow={editable ? isDraftRow : undefined}
          isDeletedRow={editable ? isDeletedRow : undefined}
          onDeleteRow={editable ? deleteRow : undefined}
          onUndeleteRow={editable ? undeleteRow : undefined}
          onCloneRow={editable ? cloneRow : undefined}
        />
      </div>
      <div className="flex h-9 shrink-0 items-stretch border-t bg-muted/30">
        <span className="flex items-center px-3 text-xs text-muted-foreground">
          {rows.length}
          {typeof totalRows === "number" ? ` of ${totalRows}` : ""} rows
        </span>
        <label className="flex items-stretch border-l border-l-border text-xs text-muted-foreground">
          <span className="flex items-center pl-3">Page size</span>
          <input
            type="number"
            min={1}
            aria-label="Page size"
            defaultValue={pageSize}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.currentTarget.blur();
              }
            }}
            onBlur={(event) => {
              const next = Number(event.target.value);
              if (Number.isInteger(next) && next > 0 && next !== pageSize) {
                setPageSize(next);
                return;
              }
              event.target.value = String(pageSize);
            }}
            className="h-full w-12 bg-transparent pr-3 pl-2 font-mono text-xs text-foreground outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
        </label>
        {hasNextPage ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
            className="h-full rounded-none border-0 border-l border-l-border px-3"
          >
            {isFetchingNextPage ? "Loading..." : "Load more"}
          </Button>
        ) : null}
        {editable ? (
          <Button
            type="button"
            variant="ghost"
            aria-label="Add row"
            onClick={addRow}
            className="h-full rounded-none border-0 border-l border-l-border px-3"
          >
            <Plus className="size-4" />
          </Button>
        ) : null}
        <CopyButtons
          className="ml-auto h-full items-stretch"
          columns={columnNames}
          rows={rows}
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
    databaseSchemas,
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
  const schema =
    (databaseId ? databaseSchemas.get(databaseId) : undefined) ?? EMPTY_SCHEMA;
  const tableId = isTable ? activeNode.id : undefined;
  const hasPendingEdits = pendingEdits.some(
    (edit) => edit.tableId === tableId,
  );

  const filter = appliedFilter.trim() ? appliedFilter.trim() : undefined;
  // The filter is wrapped as a single `WHERE (<expr>)` clause. A semicolon would mean the user is
  // trying to chain a second statement, which the filter is not - reject it up front with a clear
  // message instead of letting it become a DB syntax error (defense-in-depth; the backend runs one
  // prepared statement so it could never execute anyway).
  const hasStatementBreak = filterText.includes(";");
  const applyFilter = () => {
    if (hasStatementBreak) {
      toast.error("Filter is one SQL expression - remove the semicolon");
      return;
    }
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
        <div className="flex min-w-0 flex-1 items-center px-3">
          <SqlEditor
            value={filterText}
            onChange={setFilterText}
            engine={config?.engine ?? "postgres"}
            schema={schema}
            onSubmit={applyFilter}
            singleLine
            ariaLabel="Filter rows"
            placeholder={
              isLive ? "WHERE ... (raw SQL) - Enter to run" : "Filter..."
            }
            defaultTable={activeNode.name}
          />
        </div>
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
        {isLive && config && databaseId ? (
          <LiveTable
            config={config}
            connectionId={databaseId}
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
