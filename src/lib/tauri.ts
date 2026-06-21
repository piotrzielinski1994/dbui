import { invoke } from "@tauri-apps/api/core";
import type {
  ConnectionConfig,
  Sort,
  TableRows,
} from "@/lib/workspace/model";

export function greet(name: string): Promise<string> {
  return invoke<string>("greet", { name });
}

export function connectDatabase(config: ConnectionConfig): Promise<string[]> {
  return invoke<string[]>("connect_database", { config });
}

export function fetchTable(
  config: ConnectionConfig,
  table: string,
  opts?: { limit?: number; offset?: number; filter?: string; sort?: Sort | null },
): Promise<TableRows> {
  return invoke<TableRows>("fetch_table", {
    config,
    table,
    limit: opts?.limit ?? null,
    offset: opts?.offset ?? 0,
    filter: opts?.filter ?? null,
    sort: opts?.sort ?? null,
  });
}

export function countTable(
  config: ConnectionConfig,
  table: string,
  filter?: string,
): Promise<number> {
  return invoke<number>("count_table", {
    config,
    table,
    filter: filter ?? null,
  });
}

export type CellEdit = {
  column: string;
  pkValue: string;
  value: string | null;
};

export function updateTable(
  config: ConnectionConfig,
  table: string,
  edits: CellEdit[],
): Promise<number> {
  return invoke<number>("update_table", { config, table, edits });
}

export type QueryOutcome = {
  columns: string[];
  rows: (string | null)[][];
  rowsAffected: number;
  returnsRows: boolean;
  message: string;
};

export function executeSql(
  config: ConnectionConfig,
  sql: string,
): Promise<QueryOutcome> {
  return invoke<QueryOutcome>("execute_sql", { config, sql });
}
