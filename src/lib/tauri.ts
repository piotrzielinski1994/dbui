import { invoke } from "@tauri-apps/api/core";
import type {
  ConnectCatalog,
  ConnectionConfig,
  Sort,
  TableRows,
  TableSchema,
  TableStructure,
} from "@/lib/workspace/model";

export function greet(name: string): Promise<string> {
  return invoke<string>("greet", { name });
}

// Opens + holds a pool for this connection id and returns the catalog: browsable tables PLUS the
// database's views (F6 #15). The only command that sends `config`; the rest address the held pool
// by id.
export function connectDatabase(
  connectionId: string,
  config: ConnectionConfig,
): Promise<ConnectCatalog> {
  return invoke<ConnectCatalog>("connect_database", { connectionId, config });
}

export function disconnectDatabase(connectionId: string): Promise<void> {
  return invoke<void>("disconnect_database", { connectionId });
}

export function fetchSchema(connectionId: string): Promise<TableSchema[]> {
  return invoke<TableSchema[]>("fetch_schema", { connectionId });
}

// Read-only per-table structure for the schema browser (F6 #14): columns/indexes/FK/constraints for
// SQL engines, indexes-only for MongoDB. Fetched lazily when the Structure view opens.
export function fetchTableStructure(
  connectionId: string,
  table: string,
  schema?: string | null,
): Promise<TableStructure> {
  return invoke<TableStructure>("fetch_table_structure", {
    connectionId,
    schema: schema ?? null,
    table,
  });
}

export function fetchTable(
  connectionId: string,
  table: string,
  opts?: {
    schema?: string | null;
    limit?: number;
    offset?: number;
    filter?: string;
    sort?: Sort | null;
  },
): Promise<TableRows> {
  return invoke<TableRows>("fetch_table", {
    connectionId,
    schema: opts?.schema ?? null,
    table,
    limit: opts?.limit ?? null,
    offset: opts?.offset ?? 0,
    filter: opts?.filter ?? null,
    sort: opts?.sort ?? null,
  });
}

export function countTable(
  connectionId: string,
  table: string,
  filter?: string,
  schema?: string | null,
): Promise<number> {
  return invoke<number>("count_table", {
    connectionId,
    schema: schema ?? null,
    table,
    filter: filter ?? null,
  });
}

export type CellMutation = {
  kind: "cell";
  column: string;
  pkValue: string;
  newValue: string | null;
};

export type InsertMutation = {
  kind: "insert";
  values: Record<string, string | null>;
};

export type DeleteMutation = {
  kind: "delete";
  pkValue: string;
};

// MongoDB full-document replace: the edited document as a JSON string, matched on its pk (_id).
// Only the Mongo backend path interprets it; the SQL path rejects it.
export type ReplaceMutation = {
  kind: "replace";
  pkValue: string;
  document: string;
};

export type RowMutation =
  | CellMutation
  | InsertMutation
  | DeleteMutation
  | ReplaceMutation;

export function applyRowMutations(
  connectionId: string,
  table: string,
  mutations: RowMutation[],
  schema?: string | null,
): Promise<number> {
  return invoke<number>("apply_mutations", {
    connectionId,
    schema: schema ?? null,
    table,
    mutations,
  });
}

export type QueryOutcome = {
  statement: string;
  columns: string[];
  rows: (string | null)[][];
  rowsAffected: number;
  returnsRows: boolean;
  message: string;
};

// Runs one or more `;`-separated statements on the held connection, returning one outcome per
// statement. `requestId` lets a concurrent `cancelQuery` abort the run.
export function executeSql(
  connectionId: string,
  sql: string,
  requestId: string,
): Promise<QueryOutcome[]> {
  return invoke<QueryOutcome[]>("execute_sql", { connectionId, sql, requestId });
}

export function cancelQuery(requestId: string): Promise<void> {
  return invoke<void>("cancel_query", { requestId });
}

// Runs one or more `;`-separated MongoDB Query-tab commands (`db.<coll>.find({...})` /
// `db.<coll>.aggregate([...])`), returning one outcome per command - same shape as executeSql, so
// the SQL editor pane (saved-script tabs, Run/Cancel, History) drives both engines.
export function executeMongo(
  connectionId: string,
  command: string,
  requestId: string,
): Promise<QueryOutcome[]> {
  return invoke<QueryOutcome[]>("execute_mongo", {
    connectionId,
    command,
    requestId,
  });
}

// The Rust `connect_database` registers its cancel token under a `connect:`-namespaced key (see
// `connect_cancel_key`), so aborting an in-flight connect is the same cancel registry as a query.
export function cancelConnect(connectionId: string): Promise<void> {
  return cancelQuery(`connect:${connectionId}`);
}

// Manual-commit transaction control (F12), SQL engines only. `beginTransaction` opens a transaction
// on the first write (idempotent - a no-op if one is already open); `commit`/`rollback` finish it;
// `transactionState` reports whether one is open (drives the Commit/Rollback toolbar).
export function beginTransaction(connectionId: string): Promise<void> {
  return invoke<void>("begin_transaction", { connectionId });
}

export function commitTransaction(connectionId: string): Promise<void> {
  return invoke<void>("commit_transaction", { connectionId });
}

export function rollbackTransaction(connectionId: string): Promise<void> {
  return invoke<void>("rollback_transaction", { connectionId });
}

export function transactionState(connectionId: string): Promise<boolean> {
  return invoke<boolean>("transaction_state", { connectionId });
}
