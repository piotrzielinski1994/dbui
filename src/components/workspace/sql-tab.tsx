import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { EditorView } from "@codemirror/view";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  copyRowsToClipboard,
  DataGrid,
  type Cell,
  type CopyFormat,
} from "@/components/workspace/data-grid";
import {
  nextRowSelection,
  type RowSelectionState,
  type RowSelectMode,
} from "@/lib/workspace/row-select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { HorizontalSplit } from "@/components/workspace/horizontal-split";
import { SaveScriptDialog } from "@/components/workspace/save-script-dialog";
import { Tab, TabBar } from "@/components/workspace/tab-bar";
import {
  SqlEditor,
  selectedOrAllSql,
} from "@/components/workspace/sql-editor";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { isWriteSql, isWriteMongo } from "@/lib/script/dispatch";
import { useSettingsOptional } from "@/lib/settings/settings-context";
import { DEFAULT_SETTINGS } from "@/lib/settings/settings";
import {
  cancelQuery,
  executeMongo,
  executeSql,
  type QueryOutcome,
} from "@/lib/tauri";
import type {
  DbEngine,
  SavedScript,
  Sort,
  TableSchema,
} from "@/lib/workspace/model";

const noop = () => {};
const alwaysFalse = () => false;
// The SQL result grid is read-only but row-selectable (for Copy CSV/JSON on a selection); a stable
// empty selection is the default and the reset value when the row array changes.
const EMPTY_SELECTION: RowSelectionState = { selected: new Set<number>(), anchor: null };

const UNTITLED = "untitled";

// True for the auto-generated names "untitled", "untitled-2", ... (an unnamed, never-saved-by-name
// document). Their first Cmd/Ctrl+S opens the name dialog instead of saving silently.
function isUntitledName(name: string): boolean {
  return name === UNTITLED || /^untitled-\d+$/.test(name);
}

// The next free "untitled" / "untitled-2" / ... not already taken by an existing script.
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
  // The resolved-override map, read here (OutcomeGrid re-renders with its parent anyway) and passed
  // to the memoized DataGrid as a stable-ref prop, so the grid never subscribes to Settings context
  // (a chrome toggle rebuilds that value and would re-render all rows despite memo).
  const shortcuts =
    useSettingsOptional()?.settings.shortcuts ?? DEFAULT_SETTINGS.shortcuts;

  const rows = useMemo(
    () => sortRows(outcome.columns, outcome.rows, sort),
    [outcome.columns, outcome.rows, sort],
  );

  // Selection is positional (indices into `rows`), so it's only valid for the exact row array it
  // was made against. Stamp it with that array; when `rows` changes (a new query, a sort) the stamp
  // mismatches and the selection reads empty - the same guard the editable grid uses.
  const [stamped, setStamped] = useState<{
    rows: Cell[][];
    selection: RowSelectionState;
  }>({ rows, selection: EMPTY_SELECTION });
  const selection = stamped.rows === rows ? stamped.selection : EMPTY_SELECTION;
  const handleSelectRow = useCallback(
    (index: number, mode: RowSelectMode) =>
      setStamped((current) => ({
        rows,
        selection: nextRowSelection(
          current.rows === rows ? current.selection : EMPTY_SELECTION,
          index,
          mode,
        ),
      })),
    [rows],
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

  const copyRows = useCallback(
    (rowIndices: number[], format: CopyFormat) => {
      const picked = rowIndices
        .map((index) => rows[index])
        .filter((row): row is Cell[] => row !== undefined);
      copyRowsToClipboard(outcome.columns, picked, format);
    },
    [rows, outcome.columns],
  );

  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <DataGrid
          columns={outcome.columns}
          rows={rows}
          selectedRows={selection.selected}
          onSelectRow={handleSelectRow}
          editable={false}
          editValueAt={editValueAt}
          isDirtyAt={alwaysFalse}
          onCommitEdit={noop}
          sort={sort}
          onSortColumn={cycleSort}
          onCopyRows={copyRows}
          shortcuts={shortcuts}
        />
      </ScrollArea>
      <div className="flex h-9 shrink-0 items-stretch border-t bg-muted/30">
        <span className="flex items-center px-3 text-xs text-muted-foreground">
          {rows.length} rows
        </span>
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
  // For MongoDB the live catalog leaves ARE the collections; offer them as `db.` completions.
  const collections =
    activeNode.engine === "mongodb"
      ? activeNode.tables.map((table) => table.name)
      : undefined;
  return (
    <SqlPane
      node={activeNode}
      connectionId={activeNode.id}
      isConnected={isConnected}
      engine={activeNode.engine}
      schema={databaseSchemas.get(activeNode.id) ?? EMPTY_SCHEMA}
      savedScripts={activeNode.savedScripts}
      collections={collections}
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
  savedScripts,
  collections,
}: {
  node: { id: string; sql: string; readOnly: boolean };
  connectionId: string;
  isConnected: boolean;
  engine: DbEngine;
  schema: TableSchema[];
  savedScripts: SavedScript[];
  collections?: string[];
}) {
  const {
    addHistoryEntry,
    splitOrientation,
    layouts,
    saveLayout,
    saveScript,
    updateScript,
    renameScript,
    deleteScript,
    activeScriptByDb,
    setActiveScript,
    sqlBuffers,
    setSqlBuffer,
    clearSqlBuffer,
  } = useWorkspace();
  const [isSaveOpen, setIsSaveOpen] = useState(false);
  const editorRef = useRef<EditorView | null>(null);

  // Scripts are document tabs. Ensure the database always has at least one: if it has none, create
  // a persisted "untitled" (seeded from the node's sql, if any) so the user can type immediately.
  // Runs once per empty database.
  const ensuredRef = useRef(false);
  useEffect(() => {
    if (savedScripts.length === 0 && !ensuredRef.current) {
      ensuredRef.current = true;
      saveScript(node.id, untitledName([]), node.sql);
    }
  }, [savedScripts.length, node.id, node.sql, saveScript]);

  // The active document tab for this database (defaults to the first script). Lives in the provider
  // so it survives the pane unmounting on a content-tab switch.
  const activeScript =
    activeScriptByDb.get(node.id) ?? savedScripts[0]?.name ?? null;
  const activeSaved = savedScripts.find((s) => s.name === activeScript) ?? null;

  // The editor buffer: the per-script unsaved draft if one exists, else the script's saved sql.
  const bufferKey = activeScript ? `${node.id}::${activeScript}` : node.id;
  const sql = sqlBuffers.get(bufferKey) ?? activeSaved?.sql ?? "";
  const setSql = useCallback(
    (next: string) => setSqlBuffer(bufferKey, next),
    [setSqlBuffer, bufferKey],
  );
  // The request id of the in-flight run, so Cancel targets exactly this run.
  const requestIdRef = useRef<string | null>(null);
  const run = useMutation<QueryOutcome[], unknown, string>({
    mutationFn: (query: string) => {
      const requestId = crypto.randomUUID();
      requestIdRef.current = requestId;
      // MongoDB and SQL share this pane; the command shape differs (db.coll.find(...) vs SQL) but
      // both return QueryOutcome[] and both cancel via the same request id.
      return engine === "mongodb"
        ? executeMongo(connectionId, query, requestId)
        : executeSql(connectionId, query, requestId);
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
    const effective = query.trim().length > 0 ? query : sql;
    // Read-only database: block a write-shaped statement before it reaches the backend. SQL uses the
    // leading-keyword `isWriteSql`; MongoDB uses `isWriteMongo` (the `.op(` after `db.<coll>.` -
    // updateOne/insertOne/... now that the Query tab runs writes too). Same block UX the Script tab
    // ships: sticky warning toast + a History error line, statement never sent. Prefix-only
    // (documented) - a read-led multi-statement buffer chaining a write slips by.
    const isWrite =
      engine === "mongodb" ? isWriteMongo(effective) : isWriteSql(effective);
    if (node.readOnly && isWrite) {
      toast.warning("Database is read-only - write blocked", {
        duration: Infinity,
      });
      addHistoryEntry({
        id: `readonly-${effective}-${Date.now()}`,
        sql: effective,
        status: "error",
        message: "blocked (read-only)",
        at: new Date().toLocaleTimeString(),
      });
      return;
    }
    run.mutate(effective);
  };
  const cancel = () => {
    if (requestIdRef.current) {
      void cancelQuery(requestIdRef.current);
    }
  };
  // Read the live editor doc (like Run does), not the React `sql` state, so the saved SQL is exactly
  // what the user sees in the editor - the state can lag the editor between renders.
  const currentSql = () => {
    const view = editorRef.current;
    return view ? view.state.doc.toString() : sql;
  };
  const canSave = activeScript !== null;
  const isUntitled = activeScript !== null && isUntitledName(activeScript);
  // Switch the active document tab. The current draft is already in the provider (keyed per script),
  // so nothing is lost.
  const selectScript = (name: string) => setActiveScript(node.id, name);
  // The "+" affordance: create a fresh empty "untitled" script (persisted immediately) and make it
  // the active document, so the user types straight into it - no upfront name prompt.
  const newScript = () => {
    const name = untitledName(savedScripts.map((s) => s.name));
    if (saveScript(node.id, name, "")) {
      setActiveScript(node.id, name);
    }
  };
  // Cmd/Ctrl+S: an `untitled` document's FIRST save opens the name dialog (rename in place); an
  // already-named document saves silently in place.
  const save = () => {
    if (!canSave || !activeScript) {
      return;
    }
    if (isUntitled) {
      setIsSaveOpen(true);
      return;
    }
    updateScript(node.id, activeScript, currentSql());
    toast.success(`Saved script "${activeScript}"`);
  };
  // The dialog confirm: name the active `untitled` document, persisting its current sql under the
  // new name. Rejects a name that collides with an existing script.
  const confirmName = (name: string) => {
    if (!activeScript) {
      return;
    }
    const trimmed = name.trim();
    updateScript(node.id, activeScript, currentSql());
    const previousName = activeScript;
    if (!renameScript(node.id, activeScript, trimmed)) {
      toast.error(`Script "${trimmed}" already exists`);
      return;
    }
    // The renamed doc reads from the new key now; drop the old (e.g. `untitled`) draft so a later
    // "+" reusing that name opens blank instead of inheriting this document's text.
    clearSqlBuffer(`${node.id}::${previousName}`);
    setActiveScript(node.id, trimmed);
    toast.success(`Saved script "${trimmed}"`);
  };
  const removeScript = (name: string) => {
    deleteScript(node.id, name);
    // Drop the deleted script's draft so a new document reusing the name doesn't inherit it.
    clearSqlBuffer(`${node.id}::${name}`);
    if (activeScript === name) {
      const fallback = savedScripts.find((s) => s.name !== name);
      if (fallback) {
        setActiveScript(node.id, fallback.name);
      }
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
          <TabBar
            ariaLabel="Saved scripts"
            className="min-w-0"
            trailing={
              <>
                <button
                  type="button"
                  aria-label="New script"
                  onClick={newScript}
                  className="flex shrink-0 items-center px-2 py-1.5 text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plus className="size-4" />
                </button>
                {!isConnected ? (
                  <span className="ml-auto flex items-center px-3 font-mono text-xs text-muted-foreground">
                    Connect first (Settings tab)
                  </span>
                ) : null}
                {run.isPending ? (
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
            {savedScripts.map((script) => (
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
          <div className="min-h-0 flex-1 overflow-auto">
            {/* Keyed per active script so switching/creating a document mounts a FRESH editor seeded
                with that script's own value - no content bleed from the previously active script. */}
            <SqlEditor
              key={activeScript ?? "none"}
              value={sql}
              onChange={setSql}
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
