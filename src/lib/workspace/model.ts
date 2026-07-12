export type DbEngine = "postgres" | "mysql" | "sqlite" | "mongodb";

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

// MongoDB carries the same host/port/database/user/password as the SQL network engines, PLUS an
// optional `uri` that, when non-empty, overrides the discrete fields at connect time (replica
// sets / Atlas / mongodb+srv). It is NOT a NetworkEngine because the uri field is mongo-only.
export type MongoConnection = {
  engine: "mongodb";
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  uri?: string;
};

export type ConnectionConfig =
  | NetworkConnection
  | SqliteConnection
  | MongoConnection;

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

export type SchemaColumn = { name: string; dataType: string };

// `schema` is the owning Postgres schema (so autocomplete disambiguates same-named tables across
// schemas); null for MySQL/SQLite, which have no schema level.
export type TableSchema = {
  schema: string | null;
  name: string;
  columns: SchemaColumn[];
};

// A table as returned by the catalog on connect. Postgres carries its owning schema; MySQL/SQLite
// have no schema level (`schema: null`).
export type TableRef = { schema: string | null; name: string };

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

// The read-only Structure view (F6 #14). SQL engines populate all four sections; MongoDB fills
// `indexes` only (documents have no columns / FKs / SQL constraints).
export type StructureColumn = {
  name: string;
  dataType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  defaultValue: string | null;
  ordinal: number;
};

export type IndexInfo = {
  name: string;
  columns: string[];
  isUnique: boolean;
  isPrimary: boolean;
};

export type ForeignKey = {
  name: string;
  columns: string[];
  referencedTable: string;
  // The referenced table's schema (Postgres); null for MySQL/SQLite. Used to resolve the target
  // table node id when navigating a foreign key.
  referencedSchema: string | null;
  referencedColumns: string[];
};

export type ConstraintInfo = {
  name: string;
  kind: "check" | "unique";
  definition: string | null;
};

export type TableStructure = {
  columns: StructureColumn[];
  indexes: IndexInfo[];
  foreignKeys: ForeignKey[];
  constraints: ConstraintInfo[];
};

// The catalog returned on connect (F6 #15): browsable tables PLUS the database's views.
export type ConnectCatalog = {
  tables: TableRef[];
  views: TableRef[];
};

export type SavedScript = { name: string; sql: string };

export type SavedJsScript = { name: string; code: string };

export type TableNode = {
  kind: "table";
  id: string;
  name: string;
  // The owning Postgres schema, carried so every table command can address the table as
  // (schema, table); null for MySQL/SQLite (no schema level). The sidebar groups by this.
  schema: string | null;
  columns: ResultColumn[];
  rows: Record<string, string>[];
};

type DatabaseNodeBase = {
  kind: "database";
  id: string;
  name: string;
  // Optional per-database accent color (lowercase `#rrggbb` hex) used as a border/orientation cue
  // across the sidebar row, tabs, and content frame. null = no accent (default border).
  accentColor: string | null;
  // When true, every write path to this database is blocked at the frontend boundary (table
  // mutations + write-shaped SQL) - a prod safety cue paired with accentColor. Default false.
  readOnly: boolean;
  // When true, this database runs in manual-commit mode (auto-commit OFF): the first write opens a
  // transaction on a pinned connection, reads see the uncommitted changes, and a Commit/Rollback
  // control finishes it. SQL engines only (MongoDB has no manual-commit). Default false.
  manualCommit: boolean;
  tables: TableNode[];
  views: ViewObject[];
  sql: string;
  savedScripts: SavedScript[];
  savedJsScripts: SavedJsScript[];
  result: QueryResult;
};

export type NetworkDatabaseNode = DatabaseNodeBase & NetworkConnection;

export type SqliteDatabaseNode = DatabaseNodeBase & SqliteConnection;

export type MongoDatabaseNode = DatabaseNodeBase & MongoConnection;

export type DatabaseNode =
  | NetworkDatabaseNode
  | SqliteDatabaseNode
  | MongoDatabaseNode;

export function connectionOf(node: DatabaseNode): ConnectionConfig {
  if (node.engine === "sqlite") {
    return { engine: "sqlite", file: node.file };
  }
  if (node.engine === "mongodb") {
    return {
      engine: "mongodb",
      host: node.host,
      port: node.port,
      database: node.database,
      user: node.user,
      password: node.password,
      ...(node.uri ? { uri: node.uri } : {}),
    };
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
