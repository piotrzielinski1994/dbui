import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { DataGrid } from "@/components/workspace/data-grid";
import { HorizontalSplit } from "@/components/workspace/horizontal-split";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { executeSql, type QueryOutcome } from "@/lib/tauri";
import type { ConnectionConfig } from "@/components/workspace/mock-data";

const noop = () => {};

function OutcomeGrid({ outcome }: { outcome: QueryOutcome }) {
  return (
    <DataGrid
      columns={outcome.columns}
      rows={outcome.rows}
      selectedRow={-1}
      onSelectRow={noop}
      editable={false}
      editValueAt={(rowIndex, column) =>
        outcome.rows[rowIndex]?.[outcome.columns.indexOf(column)] ?? null
      }
      isDirtyAt={() => false}
      onCommitEdit={noop}
    />
  );
}

function LiveStatus({
  outcome,
  error,
  isPending,
}: {
  outcome: QueryOutcome | undefined;
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
    return (
      <span className="font-mono text-xs text-red-600 dark:text-red-400">
        {errorMessage(error)}
      </span>
    );
  }
  if (!outcome) {
    return (
      <span className="font-mono text-xs text-muted-foreground">Ready</span>
    );
  }
  return (
    <div className="flex items-center gap-3 font-mono text-xs">
      <span className="text-green-600 dark:text-green-400">Success</span>
      <span className="text-muted-foreground">{outcome.message}</span>
    </div>
  );
}

export function SqlTab() {
  const { activeNode, connections } = useWorkspace();

  if (!activeNode || activeNode.kind !== "database") {
    return null;
  }

  const config = connections.get(activeNode.id);
  return <SqlEditor node={activeNode} config={config} key={activeNode.id} />;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === "string" ? error : JSON.stringify(error);
}

function SqlEditor({
  node,
  config,
}: {
  node: { id: string; sql: string };
  config: ConnectionConfig | undefined;
}) {
  const { addHistoryEntry, splitOrientation, layouts, saveLayout } =
    useWorkspace();
  const [sql, setSql] = useState(node.sql);
  const run = useMutation<QueryOutcome, unknown, string>({
    mutationFn: (query: string) =>
      executeSql(config as ConnectionConfig, query),
    onSuccess: (outcome, query) =>
      addHistoryEntry({
        id: `ok-${query}-${outcome.message}`,
        sql: query,
        status: "success",
        message: outcome.message,
        at: new Date().toLocaleTimeString(),
      }),
    onError: (error, query) =>
      addHistoryEntry({
        id: `err-${query}`,
        sql: query,
        status: "error",
        message: errorMessage(error),
        at: new Date().toLocaleTimeString(),
      }),
  });

  const canRun = Boolean(config) && sql.trim().length > 0 && !run.isPending;
  const submit = () => {
    if (canRun) {
      run.mutate(sql);
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
            {!config ? (
              <span className="flex items-center px-3 font-mono text-xs text-muted-foreground">
                Connect first (Settings tab)
              </span>
            ) : null}
            <Button
              type="button"
              onClick={submit}
              disabled={!canRun}
              className="h-full shrink-0 rounded-none border-0 border-l border-l-border"
            >
              {run.isPending ? "Running..." : "Run"}
            </Button>
          </div>
          <textarea
            aria-label="SQL editor"
            value={sql}
            spellCheck={false}
            onChange={(event) => setSql(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                submit();
              }
            }}
            className="min-h-0 flex-1 resize-none bg-transparent p-3 font-mono text-xs outline-none"
          />
        </div>
      }
      right={
        <div className="flex h-full min-w-0 flex-col">
          <div className="flex h-9 shrink-0 items-center border-b bg-muted/30 px-3">
            <LiveStatus
              outcome={run.data}
              error={run.error}
              isPending={run.isPending}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {run.data ? (
              run.data.returnsRows ? (
                <OutcomeGrid outcome={run.data} />
              ) : (
                <p className="p-3 font-mono text-sm text-muted-foreground">
                  {run.data.message}
                </p>
              )
            ) : run.error ? (
              <p className="p-3 font-mono text-sm text-red-600 dark:text-red-400">
                {errorMessage(run.error)}
              </p>
            ) : null}
          </div>
        </div>
      }
    />
  );
}
