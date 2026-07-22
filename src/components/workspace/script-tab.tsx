import type { EditorView } from "@codemirror/view";
import { Button } from "@pziel/pureui";
import { Plus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  type Cell,
  type CopyFormat,
  DataGrid,
} from "@/components/workspace/data-grid";
import { HorizontalSplit } from "@/components/workspace/horizontal-split";
import { JsEditor } from "@/components/workspace/js-editor";
import { SaveScriptDialog } from "@/components/workspace/save-script-dialog";
import { Tab, TabBar } from "@/components/workspace/tab-bar";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { isWriteSql } from "@/lib/script/dispatch";
import { type GridReturn, parseGridReturn } from "@/lib/script/result";
import {
  createWorkerRunner,
  type RpcReply,
  type ScriptRunner,
} from "@/lib/script/runner";
import { DEFAULT_SETTINGS } from "@/lib/settings/settings";
import { useSettingsOptional } from "@/lib/settings/settings-context";
import { executeMongo, executeSql, fetchSchema } from "@/lib/tauri";
import type {
  DbEngine,
  SavedJsScript,
  TableSchema,
} from "@/lib/workspace/model";
import type { RowSelectMode } from "@/lib/workspace/row-select";

const noop = () => {};
const alwaysFalse = () => false;
const EMPTY_SELECTION = new Set<number>();

const UNTITLED = "untitled";

// Matches "untitled", "untitled-2", ... - an unnamed, never-saved-by-name document whose first
// Cmd/Ctrl+S opens the name dialog instead of saving silently. (Mirrors sql-tab.)
function isUntitledName(name: string): boolean {
  return name === UNTITLED || /^untitled-\d+$/.test(name);
}

function untitledName(existing: string[]): string {
  if (!existing.includes(UNTITLED)) {
    return UNTITLED;
  }
  let n = 2;
  while (existing.includes(`${UNTITLED}-${n}`)) {
    n += 1;
  }
  return `${UNTITLED}-${n}`;
}

// The script sits ~5s before we warn (no auto-kill) so a runaway loop gets a sticky, click-to-dismiss
// toast with a Cancel affordance (F7 safety decision).
const WARN_AFTER_MS = 5000;

type RunStatus =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "done" }
  | { kind: "cancelled" }
  | { kind: "error"; message: string };

// True when a return value LOOKS like an attempted grid (a non-array object carrying a `header` or
// `rows` key) but failed `parseGridReturn` - so we explain why no grid rendered. A plain array or
// scalar return is intentional non-grid output and stays silent.
function isGridLike(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    ("header" in value || "rows" in value)
  );
}

// Maps the last outcome of a run (columns + string[][] rows) into the array-of-objects a script author
// reads (`r.name`), matching the Mongo path which already returns documents. A `;`-separated run
// yields one outcome per statement; the script sees the LAST (mirrors the SQL result grid).
function lastOutcomeAsObjects(
  outcomes: { columns: string[]; rows: (string | null)[][] }[],
): Record<string, string | null>[] {
  const last = outcomes[outcomes.length - 1];
  if (!last) {
    return [];
  }
  return last.rows.map((row) => {
    const record: Record<string, string | null> = {};
    last.columns.forEach((column, index) => {
      record[column] = row[index] ?? null;
    });
    return record;
  });
}

export function ScriptTab({ runner }: { runner?: ScriptRunner }) {
  const { activeNode, databaseSchemas } = useWorkspace();

  if (activeNode?.kind !== "database") {
    return null;
  }

  // For MongoDB the live catalog leaves ARE the collections; offer them (and the sampled schema) as
  // db.<...> string-literal completions in the editor.
  const collections =
    activeNode.engine === "mongodb"
      ? activeNode.tables.map((table) => table.name)
      : undefined;
  return (
    <ScriptPane
      node={activeNode}
      connectionId={activeNode.id}
      engine={activeNode.engine}
      savedJsScripts={activeNode.savedJsScripts}
      schema={databaseSchemas.get(activeNode.id) ?? EMPTY_SCHEMA}
      collections={collections}
      runner={runner}
      key={activeNode.id}
    />
  );
}

const EMPTY_SCHEMA: TableSchema[] = [];

function ScriptPane({
  node,
  connectionId,
  engine,
  savedJsScripts,
  schema,
  collections,
  runner: injectedRunner,
}: {
  node: { id: string; savedJsScripts: SavedJsScript[] };
  connectionId: string;
  engine: DbEngine;
  savedJsScripts: SavedJsScript[];
  schema: TableSchema[];
  collections?: string[];
  runner?: ScriptRunner;
}) {
  const {
    connections,
    saveJsScript,
    updateJsScript,
    renameJsScript,
    deleteJsScript,
    activeJsScriptByDb,
    setActiveJsScript,
    jsBuffers,
    setJsBuffer,
    clearJsBuffer,
    appendConsoleLine,
    splitOrientation,
    layouts,
    saveLayout,
  } = useWorkspace();
  const isConnected = connections.has(connectionId);
  const [isSaveOpen, setIsSaveOpen] = useState(false);
  const [status, setStatus] = useState<RunStatus>({ kind: "idle" });
  const [grid, setGrid] = useState<GridReturn | null>(null);
  const editorRef = useRef<EditorView | null>(null);
  const warnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warnToastRef = useRef<string | number | null>(null);

  // One runner per pane. Prefer an injected one (tests pass a fake); default to the real worker-backed
  // runner. Held in a ref so a re-render never spawns a second worker.
  const runnerRef = useRef<ScriptRunner | null>(null);
  if (runnerRef.current === null) {
    runnerRef.current = injectedRunner ?? createWorkerRunner();
  }
  const runner = runnerRef.current;

  // Ensure the database always has at least one JS document (a persisted "untitled") so the user can
  // type immediately. Runs once per empty database.
  const ensuredRef = useRef(false);
  useEffect(() => {
    if (savedJsScripts.length === 0 && !ensuredRef.current) {
      ensuredRef.current = true;
      saveJsScript(node.id, untitledName([]), "");
    }
  }, [savedJsScripts.length, node.id, saveJsScript]);

  const activeScript =
    activeJsScriptByDb.get(node.id) ?? savedJsScripts[0]?.name ?? null;
  const activeSaved =
    savedJsScripts.find((script) => script.name === activeScript) ?? null;
  const bufferKey = activeScript ? `${node.id}::${activeScript}` : node.id;
  const code = jsBuffers.get(bufferKey) ?? activeSaved?.code ?? "";
  const setCode = useCallback(
    (next: string) => setJsBuffer(bufferKey, next),
    [setJsBuffer, bufferKey],
  );

  const clearWarnTimer = useCallback(() => {
    if (warnTimerRef.current !== null) {
      clearTimeout(warnTimerRef.current);
      warnTimerRef.current = null;
    }
    if (warnToastRef.current !== null) {
      toast.dismiss(warnToastRef.current);
      warnToastRef.current = null;
    }
  }, []);

  useEffect(() => clearWarnTimer, [clearWarnTimer]);

  const shortcuts =
    useSettingsOptional()?.settings.shortcuts ?? DEFAULT_SETTINGS.shortcuts;

  // Handles one `db.*` RPC from the worker: enforces the read-only guard for SQL writes, else routes
  // to the existing engine command. Returns the reply the runner posts back to the script's await. A
  // thrown backend error (bad SQL, not-connected, ...) is caught and returned as `{ error }` so the
  // script's `await` REJECTS - the host must never throw here, or the worker would await a reply that
  // never arrives (deadlock).
  const handleRpc = useCallback(
    async (_id: string, method: string, args: unknown[]): Promise<RpcReply> => {
      try {
        if (method === "query") {
          const sql = String(args[0] ?? "");
          if (isWriteSql(sql)) {
            appendConsoleLine(
              "[error] read-only script cannot write to the database",
            );
            toast.warning("Script tried to write - blocked (read-only)", {
              duration: Infinity,
            });
            return { error: "read-only script cannot write to the database" };
          }
          const outcomes = await executeSql(
            connectionId,
            sql,
            crypto.randomUUID(),
          );
          return { result: lastOutcomeAsObjects(outcomes) };
        }
        if (method === "find" || method === "aggregate") {
          // The backend `executeMongo` parses a full `db.<coll>.find(<json>)` /
          // `db.<coll>.aggregate(<json>)` command, so build it from the collection (args[0]) + the
          // filter/pipeline (args[1]); a find with no filter defaults to `{}`.
          const collection = String(args[0] ?? "");
          const payload = args[1] ?? (method === "find" ? {} : []);
          const command = `db.${collection}.${method}(${JSON.stringify(payload)})`;
          const outcomes = await executeMongo(
            connectionId,
            command,
            crypto.randomUUID(),
          );
          return { result: lastOutcomeAsObjects(outcomes) };
        }
        if (method === "schema") {
          return { result: await fetchSchema(connectionId) };
        }
        if (method === "tables" || method === "collections") {
          const schema = await fetchSchema(connectionId);
          return { result: schema.map((entry) => entry.name) };
        }
        return { error: `unknown db method: ${method}` };
      } catch (error) {
        // A backend failure (bad SQL, not connected, ...) is returned as an error reply so the
        // script's `await` REJECTS - the host must never throw, or the worker awaits a reply that
        // never arrives (the run hangs forever).
        const message = error instanceof Error ? error.message : String(error);
        appendConsoleLine(`[error] ${message}`);
        return { error: message };
      }
    },
    [connectionId, appendConsoleLine],
  );

  const canRun = isConnected && status.kind !== "running";

  const cancel = () => {
    runner.terminate();
    clearWarnTimer();
    setStatus({ kind: "cancelled" });
  };

  const submit = () => {
    if (!canRun) {
      return;
    }
    const view = editorRef.current;
    const selected = view
      ? view.state.sliceDoc(
          view.state.selection.main.from,
          view.state.selection.main.to,
        )
      : "";
    const source = selected.trim().length > 0 ? selected : code;
    setGrid(null);
    setStatus({ kind: "running" });
    appendConsoleLine(
      `-- run ${activeScript ?? "untitled"} ${new Date().toLocaleTimeString()}`,
    );
    clearWarnTimer();
    warnTimerRef.current = setTimeout(() => {
      warnToastRef.current = toast.warning("Script still running...", {
        duration: Infinity,
        action: { label: "Cancel", onClick: cancel },
      });
    }, WARN_AFTER_MS);
    runner.run(source, engine, {
      onLog: (level, text) =>
        appendConsoleLine(level === "error" ? `[error] ${text}` : text),
      onRpc: handleRpc,
      onDone: (value) => {
        clearWarnTimer();
        const parsed = parseGridReturn(value);
        // A return that is neither undefined/null nor a valid {header,rows} is a shape the user
        // probably meant as a grid - surface why it didn't render one (spec TC-006).
        if (
          !parsed &&
          value !== undefined &&
          value !== null &&
          isGridLike(value)
        ) {
          appendConsoleLine(
            "[error] return value is not a valid { header, rows } grid - no grid rendered",
          );
        }
        setGrid(parsed);
        setStatus({ kind: "done" });
      },
      onError: (message) => {
        clearWarnTimer();
        appendConsoleLine(`[error] ${message}`);
        setStatus({ kind: "error", message });
      },
    });
  };

  const currentCode = () => {
    const view = editorRef.current;
    return view ? view.state.doc.toString() : code;
  };
  const isUntitled = activeScript !== null && isUntitledName(activeScript);
  const selectScript = (name: string) => setActiveJsScript(node.id, name);
  const newScript = () => {
    const name = untitledName(savedJsScripts.map((script) => script.name));
    if (saveJsScript(node.id, name, "")) {
      setActiveJsScript(node.id, name);
    }
  };
  const save = () => {
    if (!activeScript) {
      return;
    }
    if (isUntitled) {
      setIsSaveOpen(true);
      return;
    }
    updateJsScript(node.id, activeScript, currentCode());
    toast.success(`Saved script "${activeScript}"`);
  };
  const confirmName = (name: string) => {
    if (!activeScript) {
      return;
    }
    const trimmed = name.trim();
    updateJsScript(node.id, activeScript, currentCode());
    const previousName = activeScript;
    if (!renameJsScript(node.id, activeScript, trimmed)) {
      toast.error(`Script "${trimmed}" already exists`);
      return;
    }
    clearJsBuffer(`${node.id}::${previousName}`);
    setActiveJsScript(node.id, trimmed);
    toast.success(`Saved script "${trimmed}"`);
  };
  const removeScript = (name: string) => {
    deleteJsScript(node.id, name);
    clearJsBuffer(`${node.id}::${name}`);
    if (activeScript === name) {
      const fallback = savedJsScripts.find((script) => script.name !== name);
      if (fallback) {
        setActiveJsScript(node.id, fallback.name);
      }
    }
  };

  return (
    <HorizontalSplit
      className="h-full"
      orientation={splitOrientation}
      ariaLabel="JavaScript editor and results"
      initialLeftPercent={layouts.script?.left ?? 50}
      onLeftPercentChange={(percent) => saveLayout("script", { left: percent })}
      left={
        <div className="flex h-full min-w-0 flex-col">
          <TabBar
            ariaLabel="Saved scripts"
            className="min-w-0"
            trailing={
              <>
                <button
                  type="button"
                  aria-label="New script"
                  onClick={newScript}
                  className="flex shrink-0 items-center px-2 py-1.5 text-muted-foreground hover:text-foreground"
                >
                  <Plus className="size-4" />
                </button>
                {!isConnected ? (
                  <span className="ml-auto flex items-center px-3 font-mono text-xs text-muted-foreground">
                    Connect first (Settings tab)
                  </span>
                ) : null}
                {status.kind === "running" ? (
                  <Button
                    type="button"
                    onClick={cancel}
                    className={`h-full shrink-0 rounded-none border-0 border-l border-l-border${
                      isConnected ? " ml-auto" : ""
                    }`}
                  >
                    Cancel
                  </Button>
                ) : (
                  <Button
                    type="button"
                    onClick={submit}
                    disabled={!canRun}
                    className={`h-full shrink-0 rounded-none border-0 border-l border-l-border${
                      isConnected ? " ml-auto" : ""
                    }`}
                  >
                    Run
                  </Button>
                )}
              </>
            }
          >
            {savedJsScripts.map((script) => (
              <Tab
                key={script.name}
                isActive={activeScript === script.name}
                onSelect={() => selectScript(script.name)}
                ariaLabel={script.name}
                trailing={
                  <button
                    type="button"
                    aria-label={`Delete ${script.name}`}
                    onClick={() => removeScript(script.name)}
                    className="p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <X className="size-3" />
                  </button>
                }
              >
                {script.name}
              </Tab>
            ))}
          </TabBar>
          <SaveScriptDialog
            open={isSaveOpen}
            onOpenChange={setIsSaveOpen}
            onSave={confirmName}
          />
          <div className="min-h-0 flex-1">
            <JsEditor
              key={activeScript ?? "none"}
              value={code}
              onChange={setCode}
              engine={engine}
              schema={schema}
              collections={collections}
              onSubmit={submit}
              onSave={save}
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
            <ScriptStatus status={status} />
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            {grid ? (
              <ScrollArea horizontal className="h-full">
                <DataGrid
                  columns={grid.header}
                  rows={grid.rows as Cell[][]}
                  selectedRows={EMPTY_SELECTION}
                  onSelectRow={
                    noop as (index: number, mode: RowSelectMode) => void
                  }
                  editable={false}
                  editValueAt={(rowIndex, column) =>
                    grid.rows[rowIndex]?.[grid.header.indexOf(column)] ?? null
                  }
                  isDirtyAt={alwaysFalse}
                  onCommitEdit={noop}
                  onCopyRows={noop as (i: number[], f: CopyFormat) => void}
                  shortcuts={shortcuts}
                />
              </ScrollArea>
            ) : (
              <p className="p-3 font-mono text-xs text-muted-foreground">
                {status.kind === "done"
                  ? "No result grid - return { header, rows } to show one."
                  : "Run a script to see results here."}
              </p>
            )}
          </div>
        </div>
      }
    />
  );
}

function ScriptStatus({ status }: { status: RunStatus }) {
  if (status.kind === "running") {
    return (
      <span className="font-mono text-xs text-muted-foreground">
        Running...
      </span>
    );
  }
  if (status.kind === "cancelled") {
    return (
      <span className="font-mono text-xs text-muted-foreground">Cancelled</span>
    );
  }
  if (status.kind === "error") {
    return (
      <span className="font-mono text-xs text-red-600 dark:text-red-400">
        {status.message}
      </span>
    );
  }
  if (status.kind === "done") {
    return (
      <span className="font-mono text-xs text-green-600 dark:text-green-400">
        Done
      </span>
    );
  }
  return <span className="font-mono text-xs text-muted-foreground">Ready</span>;
}
