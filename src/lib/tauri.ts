import { invoke } from "@tauri-apps/api/core";
import type {
  ConnectionConfig,
  Sort,
  TableRows,
  TableSchema,
} from "@/lib/workspace/model";

export function greet(name: string): Promise<string> {
  return invoke<string>("greet", { name });
}

// Opens + holds a pool for this connection id and returns the table catalog. The only command
// that sends `config`; the rest address the held pool by id.
export function connectDatabase(
  connectionId: string,
  config: ConnectionConfig,
): Promise<string[]> {
  return invoke<string[]>("connect_database", { connectionId, config });
}

export function disconnectDatabase(connectionId: string): Promise<void> {
  return invoke<void>("disconnect_database", { connectionId });
}

export function fetchSchema(connectionId: string): Promise<TableSchema[]> {
  return invoke<TableSchema[]>("fetch_schema", { connectionId });
}

export function fetchTable(
  connectionId: string,
  table: string,
  opts?: { limit?: number; offset?: number; filter?: string; sort?: Sort | null },
): Promise<TableRows> {
  return invoke<TableRows>("fetch_table", {
    connectionId,
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
): Promise<number> {
  return invoke<number>("count_table", {
    connectionId,
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

export type RowMutation = CellMutation | InsertMutation | DeleteMutation;

export function applyRowMutations(
  connectionId: string,
  table: string,
  mutations: RowMutation[],
): Promise<number> {
  return invoke<number>("apply_mutations", { connectionId, table, mutations });
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

// The Rust `connect_database` registers its cancel token under a `connect:`-namespaced key (see
// `connect_cancel_key`), so aborting an in-flight connect is the same cancel registry as a query.
export function cancelConnect(connectionId: string): Promise<void> {
  return cancelQuery(`connect:${connectionId}`);
}
