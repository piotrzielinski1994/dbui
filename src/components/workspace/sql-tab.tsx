import { useCallback, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { EditorView } from "@codemirror/view";
import { Button } from "@/components/ui/button";
import { CopyButtons, DataGrid } from "@/components/workspace/data-grid";
import { HorizontalSplit } from "@/components/workspace/horizontal-split";
import {
  SqlEditor,
  selectedOrAllSql,
} from "@/components/workspace/sql-editor";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { cancelQuery, executeSql, type QueryOutcome } from "@/lib/tauri";
import type {
  DbEngine,
  Sort,
  TableSchema,
} from "@/lib/workspace/model";

const noop = () => {};
const alwaysFalse = () => false;

// The Rust cancel path rejects a cancelled run with this exact string (mirrors requi). It is a
// control signal, never shown raw to the user - it surfaces as a neutral "Cancelled" status.
const CANCEL_SENTINEL = "__cancelled__";

function isCancelled(error: unknown): boolean {
  return error === CANCEL_SENTINEL;
}

// The grid shows the LAST row-returning statement (or, if none return rows, the last outcome so its
// rows-affected message still renders). Mirrors how psql/DBeaver surface a multi-statement run.
function lastDisplayOutcome(
  outcomes: QueryOutcome[],
): QueryOutcome | undefined {
  if (outcomes.length === 0) {
    return undefined;
  }
  return (
    [...outcomes].reverse().find((outcome) => outcome.returnsRows) ??
    outcomes[outcomes.length - 1]
  );
}

// The SQL result holds arbitrary user-query rows whose types are unknown, so sorting happens
// client-side over the in-memory rows (no re-run). Locale-compares cells, NULLs sort last.
function sortRows(
  columns: string[],
  rows: (string | null)[][],
  sort: Sort | null,
): (string | null)[][] {
  if (!sort) {
    return rows;
  }
  const index = columns.indexOf(sort.column);
  if (index < 0) {
    return rows;
  }
  const direction = sort.descending ? -1 : 1;
  return [...rows].sort((left, right) => {
    const a = left[index];
    const b = right[index];
    if (a === b) {
      return 0;
    }
    if (a === null) {
      return 1;
    }
    if (b === null) {
      return -1;
    }
    return a.localeCompare(b, undefined, { numeric: true }) * direction;
  });
}

function OutcomeGrid({ outcome }: { outcome: QueryOutcome }) {
  const [sort, setSort] = useState<Sort | null>(null);

  const rows = useMemo(
    () => sortRows(outcome.columns, outcome.rows, sort),
    [outcome.columns, outcome.rows, sort],
  );

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

  const editValueAt = useCallback(
    (rowIndex: number, column: string) =>
      rows[rowIndex]?.[outcome.columns.indexOf(column)] ?? null,
    [rows, outcome.columns],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        <DataGrid
          columns={outcome.columns}
          rows={rows}
          selectedRow={-1}
          onSelectRow={noop}
          editable={false}
          editValueAt={editValueAt}
          isDirtyAt={alwaysFalse}
          onCommitEdit={noop}
          sort={sort}
          onSortColumn={cycleSort}
        />
      </div>
      <div className="flex h-9 shrink-0 items-stretch border-t bg-muted/30">
        <span className="flex items-center px-3 text-xs text-muted-foreground">
          {rows.length} rows
        </span>
        <CopyButtons
          className="ml-auto h-full items-stretch"
          columns={outcome.columns}
          rows={rows}
        />
      </div>
    </div>
  );
}

function LiveStatus({
  outcomes,
  error,
  isPending,
}: {
  outcomes: QueryOutcome[] | undefined;
  error: unknown;
  isPending: boolean;
}) {
  if (isPending) {
    return (
      <span className="font-mono text-xs text-muted-foreground">
        Running...
      </span>
    );
  }
  if (error) {
    if (isCancelled(error)) {
      return (
        <span className="font-mono text-xs text-muted-foreground">
          Cancelled
        </span>
      );
    }
    return (
      <span className="font-mono text-xs text-red-600 dark:text-red-400">
        {errorMessage(error)}
      </span>
    );
  }
  if (!outcomes || outcomes.length === 0) {
    return (
      <span className="font-mono text-xs text-muted-foreground">Ready</span>
    );
  }
  const display = lastDisplayOutcome(outcomes);
  const message =
    outcomes.length > 1
      ? `${outcomes.length} statements - OK`
      : (display?.message ?? "OK");
  return (
    <div className="flex items-center gap-3 font-mono text-xs">
      <span className="text-green-600 dark:text-green-400">Success</span>
      <span className="text-muted-foreground">{message}</span>
    </div>
  );
}

// Renders the result body: the last row-returning statement's grid, or the last outcome's message
// when none return rows. A cancel is neutral (muted "Cancelled"), a real error is red.
function SqlResult({
  outcomes,
  error,
}: {
  outcomes: QueryOutcome[] | undefined;
  error: unknown;
}) {
  if (error) {
    if (isCancelled(error)) {
      return (
        <p className="p-3 font-mono text-sm text-muted-foreground">Cancelled</p>
      );
    }
    return (
      <p className="p-3 font-mono text-sm text-red-600 dark:text-red-400">
        {errorMessage(error)}
      </p>
    );
  }
  if (!outcomes || outcomes.length === 0) {
    return null;
  }
  const display = lastDisplayOutcome(outcomes);
  if (display?.returnsRows) {
    return <OutcomeGrid outcome={display} />;
  }
  return (
    <p className="p-3 font-mono text-sm text-muted-foreground">
      {display?.message ?? "OK"}
    </p>
  );
}

export function SqlTab() {
  const { activeNode, connections, databaseSchemas } = useWorkspace();

  if (!activeNode || activeNode.kind !== "database") {
    return null;
  }

  const isConnected = connections.has(activeNode.id);
  return (
    <SqlPane
      node={activeNode}
      connectionId={activeNode.id}
      isConnected={isConnected}
      engine={activeNode.engine}
      schema={databaseSchemas.get(activeNode.id) ?? EMPTY_SCHEMA}
      key={activeNode.id}
    />
  );
}

const EMPTY_SCHEMA: TableSchema[] = [];

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === "string" ? error : JSON.stringify(error);
}

function SqlPane({
  node,
  connectionId,
  isConnected,
  engine,
  schema,
}: {
  node: { id: string; sql: string };
  connectionId: string;
  isConnected: boolean;
  engine: DbEngine;
  schema: TableSchema[];
}) {
  const { addHistoryEntry, splitOrientation, layouts, saveLayout } =
    useWorkspace();
  const [sql, setSql] = useState(node.sql);
  const editorRef = useRef<EditorView | null>(null);
  // The request id of the in-flight run, so Cancel targets exactly this run.
  const requestIdRef = useRef<string | null>(null);
  const run = useMutation<QueryOutcome[], unknown, string>({
    mutationFn: (query: string) => {
      const requestId = crypto.randomUUID();
      requestIdRef.current = requestId;
      return executeSql(connectionId, query, requestId);
    },
    onSuccess: (outcomes, query) =>
      // One History entry per statement so each is individually visible, each logging its OWN
      // statement text (not the whole buffer). The single-statement case logs one entry as before.
      outcomes.forEach((outcome, index) =>
        addHistoryEntry({
          id: `ok-${query}-${index}-${outcome.message}`,
          sql: outcome.statement || query,
          status: "success",
          message: outcome.message,
          at: new Date().toLocaleTimeString(),
        }),
      ),
    // A cancelled run is a neutral outcome, not an error - it is NOT logged to History.
    onError: (error, query) => {
      if (isCancelled(error)) {
        return;
      }
      addHistoryEntry({
        id: `err-${query}`,
        sql: query,
        status: "error",
        message: errorMessage(error),
        at: new Date().toLocaleTimeString(),
      });
    },
  });

  const canRun = isConnected && sql.trim().length > 0 && !run.isPending;
  const submit = () => {
    if (!canRun) {
      return;
    }
    const query = selectedOrAllSql(editorRef.current);
    run.mutate(query.trim().length > 0 ? query : sql);
  };
  const cancel = () => {
    if (requestIdRef.current) {
      void cancelQuery(requestIdRef.current);
    }
  };

  return (
    <HorizontalSplit
      className="h-full"
      orientation={splitOrientation}
      ariaLabel="SQL editor and results"
      initialLeftPercent={layouts.sql?.left ?? 50}
      onLeftPercentChange={(percent) => saveLayout("sql", { left: percent })}
      left={
        <div className="flex h-full min-w-0 flex-col">
          <div className="flex h-9 shrink-0 items-stretch justify-end border-b bg-muted/30">
            {!isConnected ? (
              <span className="flex items-center px-3 font-mono text-xs text-muted-foreground">
                Connect first (Settings tab)
              </span>
            ) : null}
            {run.isPending ? (
              <Button
                type="button"
                onClick={cancel}
                className="h-full shrink-0 rounded-none border-0 border-l border-l-border"
              >
                Cancel
              </Button>
            ) : (
              <Button
                type="button"
                onClick={submit}
                disabled={!canRun}
                className="h-full shrink-0 rounded-none border-0 border-l border-l-border"
              >
                Run
              </Button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <SqlEditor
              value={sql}
              onChange={setSql}
              engine={engine}
              schema={schema}
              onSubmit={submit}
              onCreateEditor={(view) => {
                editorRef.current = view;
              }}
            />
          </div>
        </div>
      }
      right={
        <div className="flex h-full min-w-0 flex-col">
          <div className="flex h-9 shrink-0 items-center border-b bg-muted/30 px-3">
            <LiveStatus
              outcomes={run.data}
              error={run.error}
              isPending={run.isPending}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <SqlResult outcomes={run.data} error={run.error} />
          </div>
        </div>
      }
    />
  );
}
