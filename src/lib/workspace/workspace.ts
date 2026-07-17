import type {
  DatabaseNode,
  DbEngine,
  NetworkEngine,
  QueryResult,
  SavedJsScript,
  SavedScript,
  Variable,
} from "@/lib/workspace/model";

export type PersistedNetworkDatabase = {
  kind: "database";
  id: string;
  name: string;
  engine: NetworkEngine;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  accentColor?: string;
  readOnly?: boolean;
  manualCommit?: boolean;
  defaultSchema?: string;
  savedScripts?: SavedScript[];
  savedJsScripts?: SavedJsScript[];
  variables?: Variable[];
};

export type PersistedSqliteDatabase = {
  kind: "database";
  id: string;
  name: string;
  engine: "sqlite";
  file: string;
  accentColor?: string;
  readOnly?: boolean;
  manualCommit?: boolean;
  defaultSchema?: string;
  savedScripts?: SavedScript[];
  savedJsScripts?: SavedJsScript[];
  variables?: Variable[];
};

export type PersistedMongoDatabase = {
  kind: "database";
  id: string;
  name: string;
  engine: "mongodb";
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  uri?: string;
  accentColor?: string;
  readOnly?: boolean;
  manualCommit?: boolean;
  defaultSchema?: string;
  savedScripts?: SavedScript[];
  savedJsScripts?: SavedJsScript[];
  variables?: Variable[];
};

export type PersistedDatabase =
  | PersistedNetworkDatabase
  | PersistedSqliteDatabase
  | PersistedMongoDatabase;

const NETWORK_ENGINES = new Set<DbEngine>(["postgres", "mysql", "sqlserver"]);

const EMPTY_RESULT: QueryResult = {
  status: "success",
  timeMs: 0,
  rowCount: 0,
  columns: [],
  rows: [],
  message: "",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const HEX_COLOR = /^#([0-9a-f]{6}|[0-9a-f]{8})$/i;

// A persisted accentColor is kept only when it is a `#rrggbb` or `#rrggbbaa` hex string (stored
// lowercased; the optional alpha pair carries the user's chosen border opacity); anything else
// (number, named color, 3/5/7-digit hex) is dropped so the database loads uncolored.
function mergeAccentColor(value: unknown): { accentColor: string } | undefined {
  if (typeof value !== "string" || !HEX_COLOR.test(value)) {
    return undefined;
  }
  return { accentColor: value.toLowerCase() };
}

// A persisted readOnly is kept only when it is the boolean `true`; a `false`, non-boolean, or
// missing value is dropped so the database loads writable (mirrors mergeAccentColor omitting the
// default). Guards a hand-edited/garbage db.json.
function mergeReadOnly(value: unknown): { readOnly: true } | undefined {
  return value === true ? { readOnly: true } : undefined;
}

// A persisted manualCommit is kept only when it is the boolean `true`; anything else is dropped
// so the database loads in auto-commit mode (mirrors mergeReadOnly). Guards garbage json.
function mergeManualCommit(value: unknown): { manualCommit: true } | undefined {
  return value === true ? { manualCommit: true } : undefined;
}

// A persisted defaultSchema is kept only when it is a NON-EMPTY string; an empty string, null, or
// non-string is dropped so the database loads with no schema filter (mirrors mergeReadOnly).
function mergeDefaultSchema(
  value: unknown,
): { defaultSchema: string } | undefined {
  return typeof value === "string" && value.length > 0
    ? { defaultSchema: value }
    : undefined;
}

// Keeps only the saved-script entries that are records with string `name` + `sql`; anything else
// (missing field, non-record, non-array payload) is dropped. Returns the field only when the cleaned
// list is non-empty, so an empty list is omitted from the persisted shape (mirrors mergeAccentColor).
function mergeSavedScripts(
  value: unknown,
): { savedScripts: SavedScript[] } | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const scripts = value.filter(
    (entry): entry is SavedScript =>
      isRecord(entry) &&
      typeof entry.name === "string" &&
      typeof entry.sql === "string",
  );
  return scripts.length > 0 ? { savedScripts: scripts } : undefined;
}

// Same as mergeSavedScripts for the JS document tabs (F7): keeps only `{ name, code }` records,
// drops anything else, and omits the field when the cleaned list is empty.
function mergeSavedJsScripts(
  value: unknown,
): { savedJsScripts: SavedJsScript[] } | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const scripts = value.filter(
    (entry): entry is SavedJsScript =>
      isRecord(entry) &&
      typeof entry.name === "string" &&
      typeof entry.code === "string",
  );
  return scripts.length > 0 ? { savedJsScripts: scripts } : undefined;
}

// Keeps only the `{ name, value }` string records; drops anything else. Returns the field only when
// the cleaned list is non-empty, so an empty list is omitted from the persisted shape (mirrors
// mergeSavedScripts). Guards a hand-edited/garbage db.json.
function mergeVariables(
  value: unknown,
): { variables: Variable[] } | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const variables = value.filter(
    (entry): entry is Variable =>
      isRecord(entry) &&
      typeof entry.name === "string" &&
      typeof entry.value === "string",
  );
  return variables.length > 0 ? { variables } : undefined;
}

// Validate a parsed db.json record into a PersistedDatabase (or null when it is not a valid database
// shape). Tolerant: garbage optional fields are dropped, required fields missing -> null, never
// throws. This is the single per-database field codec both the disk reader and any importer share.
export function mergeDatabaseFile(value: unknown): PersistedDatabase | null {
  if (!isRecord(value)) {
    return null;
  }
  const { id, name, engine } = value;
  if (typeof id !== "string" || typeof name !== "string") {
    return null;
  }
  const accent = mergeAccentColor(value.accentColor);
  const readOnly = mergeReadOnly(value.readOnly);
  const manualCommit = mergeManualCommit(value.manualCommit);
  const defaultSchema = mergeDefaultSchema(value.defaultSchema);
  const scripts = mergeSavedScripts(value.savedScripts);
  const jsScripts = mergeSavedJsScripts(value.savedJsScripts);
  const variables = mergeVariables(value.variables);
  if (engine === "sqlite") {
    return typeof value.file === "string"
      ? {
          kind: "database",
          id,
          name,
          engine: "sqlite",
          file: value.file,
          ...accent,
          ...readOnly,
          ...manualCommit,
          ...defaultSchema,
          ...scripts,
          ...jsScripts,
          ...variables,
        }
      : null;
  }
  const { host, port, database, user, password } = value;
  if (engine === "mongodb") {
    if (
      typeof host !== "string" ||
      typeof port !== "number" ||
      typeof database !== "string" ||
      typeof user !== "string" ||
      typeof password !== "string"
    ) {
      return null;
    }
    const uri = typeof value.uri === "string" ? { uri: value.uri } : undefined;
    return {
      kind: "database",
      id,
      name,
      engine: "mongodb",
      host,
      port,
      database,
      user,
      password,
      ...uri,
      ...accent,
      ...readOnly,
      ...manualCommit,
      ...defaultSchema,
      ...scripts,
      ...jsScripts,
      ...variables,
    };
  }
  if (
    typeof engine !== "string" ||
    !NETWORK_ENGINES.has(engine as DbEngine) ||
    typeof host !== "string" ||
    typeof port !== "number" ||
    typeof database !== "string" ||
    typeof user !== "string" ||
    typeof password !== "string"
  ) {
    return null;
  }
  return {
    kind: "database",
    id,
    name,
    engine: engine as NetworkEngine,
    host,
    port,
    database,
    user,
    password,
    ...accent,
    ...readOnly,
    ...manualCommit,
    ...defaultSchema,
    ...scripts,
    ...jsScripts,
    ...variables,
  };
}

// Build a runtime DatabaseNode from a persisted record: missing optional flags default off,
// runtime-only fields (tables/views/sql/result) start empty (a live connect fills them).
export function hydrateDatabase(node: PersistedDatabase): DatabaseNode {
  const runtime = {
    kind: "database" as const,
    id: node.id,
    name: node.name,
    accentColor: node.accentColor ?? null,
    readOnly: node.readOnly ?? false,
    manualCommit: node.manualCommit ?? false,
    defaultSchema: node.defaultSchema ?? null,
    tables: [],
    views: [],
    sql: "",
    savedScripts: node.savedScripts ?? [],
    savedJsScripts: node.savedJsScripts ?? [],
    variables: node.variables ?? [],
    result: { ...EMPTY_RESULT },
  };
  if (node.engine === "sqlite") {
    return { ...runtime, engine: "sqlite", file: node.file };
  }
  if (node.engine === "mongodb") {
    return {
      ...runtime,
      engine: "mongodb",
      host: node.host,
      port: node.port,
      database: node.database,
      user: node.user,
      password: node.password,
      ...(node.uri !== undefined ? { uri: node.uri } : {}),
    };
  }
  return {
    ...runtime,
    engine: node.engine,
    host: node.host,
    port: node.port,
    database: node.database,
    user: node.user,
    password: node.password,
  };
}

// Serialize a runtime DatabaseNode to its persisted shape: default flags + empty collections are
// OMITTED for a minimal diff, and the runtime-only fields (tables/views/sql/result) never appear.
export function dehydrateDatabase(node: DatabaseNode): PersistedDatabase {
  const accent =
    node.accentColor === null ? undefined : { accentColor: node.accentColor };
  const readOnly = node.readOnly ? { readOnly: true as const } : undefined;
  const manualCommit = node.manualCommit
    ? { manualCommit: true as const }
    : undefined;
  const defaultSchema =
    node.defaultSchema && node.defaultSchema.length > 0
      ? { defaultSchema: node.defaultSchema }
      : undefined;
  const scripts =
    node.savedScripts.length > 0
      ? { savedScripts: node.savedScripts }
      : undefined;
  const jsScripts =
    node.savedJsScripts.length > 0
      ? { savedJsScripts: node.savedJsScripts }
      : undefined;
  const variables =
    node.variables.length > 0 ? { variables: node.variables } : undefined;
  if (node.engine === "sqlite") {
    return {
      kind: "database",
      id: node.id,
      name: node.name,
      engine: "sqlite",
      file: node.file,
      ...accent,
      ...readOnly,
      ...manualCommit,
      ...defaultSchema,
      ...scripts,
      ...jsScripts,
      ...variables,
    };
  }
  if (node.engine === "mongodb") {
    return {
      kind: "database",
      id: node.id,
      name: node.name,
      engine: "mongodb",
      host: node.host,
      port: node.port,
      database: node.database,
      user: node.user,
      password: node.password,
      ...(node.uri !== undefined ? { uri: node.uri } : {}),
      ...accent,
      ...readOnly,
      ...manualCommit,
      ...defaultSchema,
      ...scripts,
      ...jsScripts,
      ...variables,
    };
  }
  return {
    kind: "database",
    id: node.id,
    name: node.name,
    engine: node.engine,
    host: node.host,
    port: node.port,
    database: node.database,
    user: node.user,
    password: node.password,
    ...accent,
    ...readOnly,
    ...manualCommit,
    ...defaultSchema,
    ...scripts,
    ...jsScripts,
    ...variables,
  };
}
