export type DbEngine = "postgres" | "mysql" | "sqlite";

export type NetworkEngine = "postgres" | "mysql";

export type NetworkConnection = {
  engine: NetworkEngine;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
};

export type SqliteConnection = {
  engine: "sqlite";
  file: string;
};

export type ConnectionConfig = NetworkConnection | SqliteConnection;

export type ConnectionStatus = "idle" | "connecting" | "connected" | "error";

export type TableColumn = {
  name: string;
  dataType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
};

export type TableRows = {
  columns: TableColumn[];
  rows: (string | null)[][];
  primaryKey: string | null;
};

export type Sort = {
  column: string;
  descending: boolean;
};

export type ResultColumn = { name: string; type: string };

export type QueryResult = {
  status: "success" | "error";
  timeMs: number;
  rowCount: number;
  columns: ResultColumn[];
  rows: Record<string, string>[];
  message: string;
};

export type ViewObject = { name: string };

export type TableNode = {
  kind: "table";
  id: string;
  name: string;
  columns: ResultColumn[];
  rows: Record<string, string>[];
};

type DatabaseNodeBase = {
  kind: "database";
  id: string;
  name: string;
  tables: TableNode[];
  views: ViewObject[];
  sql: string;
  savedScripts: string[];
  script: string;
  result: QueryResult;
};

export type NetworkDatabaseNode = DatabaseNodeBase & NetworkConnection;

export type SqliteDatabaseNode = DatabaseNodeBase & SqliteConnection;

export type DatabaseNode = NetworkDatabaseNode | SqliteDatabaseNode;

export function connectionOf(node: DatabaseNode): ConnectionConfig {
  if (node.engine === "sqlite") {
    return { engine: "sqlite", file: node.file };
  }
  return {
    engine: node.engine,
    host: node.host,
    port: node.port,
    database: node.database,
    user: node.user,
    password: node.password,
  };
}

export type FolderNode = {
  kind: "folder";
  id: string;
  name: string;
  children: TreeNode[];
};

export type TreeNode = FolderNode | DatabaseNode | TableNode;
