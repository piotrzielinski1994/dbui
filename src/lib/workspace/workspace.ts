import type {
  DbEngine,
  NetworkEngine,
  QueryResult,
  SavedJsScript,
  SavedScript,
  TreeNode,
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
  savedScripts?: SavedScript[];
  savedJsScripts?: SavedJsScript[];
};

export type PersistedSqliteDatabase = {
  kind: "database";
  id: string;
  name: string;
  engine: "sqlite";
  file: string;
  accentColor?: string;
  readOnly?: boolean;
  savedScripts?: SavedScript[];
  savedJsScripts?: SavedJsScript[];
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
  savedScripts?: SavedScript[];
  savedJsScripts?: SavedJsScript[];
};

export type PersistedDatabase =
  | PersistedNetworkDatabase
  | PersistedSqliteDatabase
  | PersistedMongoDatabase;

export type PersistedFolder = {
  kind: "folder";
  id: string;
  name: string;
  children: PersistedNode[];
};

export type PersistedNode = PersistedFolder | PersistedDatabase;

export type PersistedWorkspace = {
  version: 1;
  tree: PersistedNode[];
};

export type WorkspaceStore = {
  load: () => Promise<PersistedWorkspace>;
  save: (workspace: PersistedWorkspace) => Promise<void>;
};

export const DEFAULT_WORKSPACE: PersistedWorkspace = {
  version: 1,
  tree: [],
};

const NETWORK_ENGINES = new Set<DbEngine>(["postgres", "mysql"]);

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
// default). Guards a hand-edited/garbage workspace.json from crashing hydrate.
function mergeReadOnly(value: unknown): { readOnly: true } | undefined {
  return value === true ? { readOnly: true } : undefined;
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

function mergeDatabase(value: Record<string, unknown>): PersistedDatabase | null {
  const { id, name, engine } = value;
  if (typeof id !== "string" || typeof name !== "string") {
    return null;
  }
  const accent = mergeAccentColor(value.accentColor);
  const readOnly = mergeReadOnly(value.readOnly);
  const scripts = mergeSavedScripts(value.savedScripts);
  const jsScripts = mergeSavedJsScripts(value.savedJsScripts);
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
          ...scripts,
          ...jsScripts,
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
      ...scripts,
      ...jsScripts,
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
    ...scripts,
    ...jsScripts,
  };
}

function mergeFolder(value: Record<string, unknown>): PersistedFolder | null {
  const { id, name, children } = value;
  if (typeof id !== "string" || typeof name !== "string") {
    return null;
  }
  return {
    kind: "folder",
    id,
    name,
    children: Array.isArray(children) ? mergeNodes(children) : [],
  };
}

function mergeNode(value: unknown): PersistedNode | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.kind === "database") {
    return mergeDatabase(value);
  }
  if (value.kind === "folder") {
    return mergeFolder(value);
  }
  return null;
}

function mergeNodes(values: unknown[]): PersistedNode[] {
  return values
    .map(mergeNode)
    .filter((node): node is PersistedNode => node !== null);
}

export function mergeWorkspace(partial: unknown): PersistedWorkspace {
  if (!isRecord(partial) || !Array.isArray(partial.tree)) {
    return DEFAULT_WORKSPACE;
  }
  return { version: 1, tree: mergeNodes(partial.tree) };
}

export function hydrate(tree: PersistedNode[]): TreeNode[] {
  return tree.map(hydrateNode);
}

function hydrateNode(node: PersistedNode): TreeNode {
  if (node.kind === "folder") {
    return {
      kind: "folder",
      id: node.id,
      name: node.name,
      children: node.children.map(hydrateNode),
    };
  }
  const runtime = {
    kind: "database" as const,
    id: node.id,
    name: node.name,
    accentColor: node.accentColor ?? null,
    readOnly: node.readOnly ?? false,
    tables: [],
    views: [],
    sql: "",
    savedScripts: node.savedScripts ?? [],
    savedJsScripts: node.savedJsScripts ?? [],
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

export function dehydrate(tree: TreeNode[]): PersistedWorkspace {
  return { version: 1, tree: tree.flatMap(dehydrateNode) };
}

function dehydrateNode(node: TreeNode): PersistedNode[] {
  if (node.kind === "table") {
    return [];
  }
  if (node.kind === "folder") {
    return [
      {
        kind: "folder",
        id: node.id,
        name: node.name,
        children: node.children.flatMap(dehydrateNode),
      },
    ];
  }
  const accent =
    node.accentColor === null ? undefined : { accentColor: node.accentColor };
  const readOnly = node.readOnly ? { readOnly: true as const } : undefined;
  const scripts =
    node.savedScripts.length > 0
      ? { savedScripts: node.savedScripts }
      : undefined;
  const jsScripts =
    node.savedJsScripts.length > 0
      ? { savedJsScripts: node.savedJsScripts }
      : undefined;
  if (node.engine === "sqlite") {
    return [
      {
        kind: "database",
        id: node.id,
        name: node.name,
        engine: "sqlite",
        file: node.file,
        ...accent,
        ...readOnly,
        ...scripts,
        ...jsScripts,
      },
    ];
  }
  if (node.engine === "mongodb") {
    return [
      {
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
        ...scripts,
        ...jsScripts,
      },
    ];
  }
  return [
    {
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
      ...scripts,
      ...jsScripts,
    },
  ];
}
