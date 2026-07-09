import type {
  DatabaseNode,
  QueryResult,
  TableNode,
  TreeNode,
  ViewObject,
} from "@/lib/workspace/model";

const appUsersResult: QueryResult = {
  status: "success",
  timeMs: 142,
  rowCount: 3,
  columns: [
    { name: "id", type: "int4" },
    { name: "name", type: "text" },
    { name: "email", type: "text" },
  ],
  rows: [
    { id: "1", name: "Ada", email: "ada@example.com" },
    { id: "2", name: "Linus", email: "linus@example.com" },
    { id: "3", name: "Grace", email: "grace@example.com" },
  ],
  message: "SELECT 3",
};

const adminResult: QueryResult = {
  status: "success",
  timeMs: 24,
  rowCount: 2,
  columns: [
    { name: "id", type: "int4" },
    { name: "role", type: "text" },
  ],
  rows: [
    { id: "1", role: "admin" },
    { id: "2", role: "ops" },
  ],
  message: "SELECT 2",
};

// zero-row SQL result (E-6) - status still renders, grid empty.
const emptyResult: QueryResult = {
  status: "success",
  timeMs: 17,
  rowCount: 0,
  columns: [
    { name: "id", type: "int4" },
    { name: "name", type: "text" },
  ],
  rows: [],
  message: "SELECT 0",
};

// users: >=2 columns + >=2 rows -> drives the table-card grid (AC-015).
export const usersTable: TableNode = {
  kind: "table",
  id: "tbl-users",
  name: "users",
  schema: null,
  columns: [
    { name: "id", type: "int4" },
    { name: "name", type: "text" },
    { name: "email", type: "text" },
  ],
  rows: [
    { id: "1", name: "Ada", email: "ada@example.com" },
    { id: "2", name: "Linus", email: "linus@example.com" },
  ],
};

export const ordersTable: TableNode = {
  kind: "table",
  id: "tbl-orders",
  name: "orders",
  schema: null,
  columns: [
    { name: "id", type: "int4" },
    { name: "amount", type: "numeric" },
  ],
  rows: [
    { id: "1", amount: "12400" },
    { id: "2", amount: "8200" },
  ],
};

// zero-row table -> table-card empty state (E-6).
export const emptyAuditTable: TableNode = {
  kind: "table",
  id: "tbl-empty",
  name: "empty_audit",
  schema: null,
  columns: [
    { name: "id", type: "int4" },
    { name: "event", type: "text" },
  ],
  rows: [],
};

export const accountsTable: TableNode = {
  kind: "table",
  id: "tbl-accounts",
  name: "accounts",
  schema: null,
  columns: [
    { name: "id", type: "int4" },
    { name: "role", type: "text" },
  ],
  rows: [
    { id: "1", role: "admin" },
    { id: "2", role: "ops" },
  ],
};

export const auditLogTable: TableNode = {
  kind: "table",
  id: "tbl-audit",
  name: "audit_log",
  schema: null,
  columns: [
    { name: "id", type: "int4" },
    { name: "action", type: "text" },
  ],
  rows: [{ id: "1", action: "login" }],
};

const appViews: ViewObject[] = [
  { name: "active_users" },
  { name: "daily_signups" },
];

// folder "prod" > folder "team" > database "app_db" (token, 2 folders deep -> AC-002/E-9)
export const appDb: DatabaseNode = {
  kind: "database",
  id: "db-app",
  name: "app_db",
  engine: "postgres",
  host: "localhost",
  port: 5432,
  database: "app",
  user: "app_user",
  password: "app-secret",
  tables: [usersTable, ordersTable, emptyAuditTable],
  views: appViews,
  sql: "SELECT id, name, email\nFROM users\nWHERE last_seen > now() - interval '7 days'",
  savedScripts: [
    { name: "active_users_script", sql: "SELECT 1" },
    { name: "revenue", sql: "SELECT 2" },
  ],
  savedJsScripts: [{ name: "nightly", code: "return await db.tables();" }],
  result: appUsersResult,
  // uncolored database (accent-border feature): plain border everywhere.
  accentColor: null,
  readOnly: false,
};

// folder "staging" > database "admin_db" (password variant; script "" -> Script empty E-7)
export const adminDb: DatabaseNode = {
  kind: "database",
  id: "db-admin",
  name: "admin_db",
  engine: "postgres",
  host: "db.internal",
  port: 5433,
  database: "admin",
  user: "seed_admin",
  password: "s3cr3t-pw",
  tables: [accountsTable, auditLogTable],
  views: [{ name: "recent_admins" }],
  sql: "SELECT id, role FROM accounts",
  savedScripts: [{ name: "recent", sql: "SELECT 3" }],
  savedJsScripts: [],
  result: adminResult,
  // colored database (accent-border feature): the red "prod" preset (50% alpha) its tables inherit.
  accentColor: "#dc262680",
  readOnly: false,
};

// root-level leaf "scratch_db" (none; no tables E-5; no views/script E-7; zero-row SQL E-6)
export const scratchDb: DatabaseNode = {
  kind: "database",
  id: "db-scratch",
  name: "scratch_db",
  engine: "postgres",
  host: "localhost",
  port: 5432,
  database: "scratch",
  user: "postgres",
  password: "",
  tables: [],
  views: [],
  sql: "SELECT 1 WHERE false",
  savedScripts: [],
  savedJsScripts: [],
  result: emptyResult,
  // uncolored database (accent-border feature): plain border everywhere.
  accentColor: null,
  readOnly: false,
};

export const fixtureTree: TreeNode[] = [
  {
    kind: "folder",
    id: "folder-prod",
    name: "prod",
    children: [
      {
        kind: "folder",
        id: "folder-team",
        name: "team",
        children: [appDb],
      },
    ],
  },
  {
    kind: "folder",
    id: "folder-staging",
    name: "staging",
    children: [adminDb],
  },
  scratchDb,
];

export const fixtureConsoleLines: string[] = [
  "[12:00:01] connected to localhost:5432",
  "[12:00:02] SELECT app_db.users -> 3 rows in 142ms",
  "[12:00:03] idle",
];

// Folders that must be open to reach app_db.
export const expandedToAppDb: string[] = ["folder-prod", "folder-team"];
