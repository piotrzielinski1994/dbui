use percent_encoding::{utf8_percent_encode, AsciiSet, NON_ALPHANUMERIC};
use serde::{Deserialize, Serialize};
use sqlx::any::AnyPoolOptions;
use sqlx::Row;
use std::collections::HashMap;
use std::sync::{Arc, LazyLock, Mutex};
use tokio_util::sync::CancellationToken;

pub const DEFAULT_ROW_LIMIT: u32 = 200;

// How many connections a held pool keeps. >1 so concurrent runs (e.g. two SQL tabs, or a query
// while a table browses) don't serialise behind a single connection.
const POOL_MAX_CONNECTIONS: u32 = 5;

// A live connection held for the lifetime of a database connection. The engine travels with the
// pool because commands now address a connection by id and no longer re-send the config that the
// per-engine query builders need. `AnyPool` is a cheap `Arc` clone, `DbEngine` is `Copy`, so the
// whole struct clones out of the registry lock without holding it across an `.await`.
#[derive(Clone)]
pub struct HeldConnection {
    pub pool: sqlx::AnyPool,
    pub engine: DbEngine,
}

// Process-wide registry of held pools, keyed by database id. Opened on connect, removed + closed
// on disconnect. Reverses the prior "Connect is stateless" model (open/close per command).
static POOLS: LazyLock<Mutex<HashMap<String, HeldConnection>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

// Clones the held connection (pool handle + engine) out of the registry, or a clear not-connected
// error when no pool is held for the id. Synchronous: never holds the lock across an await.
pub fn with_pool(connection_id: &str) -> Result<HeldConnection, String> {
    POOLS
        .lock()
        .unwrap()
        .get(connection_id)
        .cloned()
        .ok_or_else(|| format!("not connected: no connection for id '{connection_id}'"))
}

// An open manual-commit transaction (F12): a single connection pinned out of the held pool with a
// live `BEGIN`, kept until the user commits or rolls back. While one exists for a database id,
// EVERY connection-addressed SQL command routes through this connection (via `acquire_conn`) so a
// read sees the uncommitted writes. The engine rides along so the command path stays config-free.
struct TxSession {
    conn: sqlx::pool::PoolConnection<sqlx::Any>,
    engine: DbEngine,
}

// Process-wide registry of OPEN transactions, keyed by database id. The outer std `Mutex` is only
// held synchronously (clone the `Arc` out, drop the lock); the inner `tokio::Mutex` serialises the
// awaited work on the pinned connection without ever holding the registry lock across an `.await`
// (same discipline as `with_pool`). Absent id = auto-commit (commands run on the pool).
static TRANSACTIONS: LazyLock<Mutex<HashMap<String, Arc<tokio::sync::Mutex<TxSession>>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

// Clones the open-transaction handle for an id out of the registry (None = no open tx). Synchronous.
fn tx_session(connection_id: &str) -> Option<Arc<tokio::sync::Mutex<TxSession>>> {
    TRANSACTIONS.lock().unwrap().get(connection_id).cloned()
}

// True when the database has an open manual-commit transaction. Sync, false for an unknown id.
pub fn transaction_state(connection_id: String) -> bool {
    TRANSACTIONS.lock().unwrap().contains_key(&connection_id)
}

// A connection to run one command on: either the pinned transaction connection (when a tx is open
// for the id) or a fresh connection acquired from the held pool (auto-commit). Both deref to
// `&mut AnyConnection` via `conn()`, so every read/mutation helper takes that one shape and never
// needs to know whether it is inside a transaction.
enum ConnHandle {
    Pinned {
        guard: tokio::sync::OwnedMutexGuard<TxSession>,
    },
    Pooled {
        conn: sqlx::pool::PoolConnection<sqlx::Any>,
        engine: DbEngine,
    },
}

impl ConnHandle {
    fn conn(&mut self) -> &mut sqlx::AnyConnection {
        match self {
            ConnHandle::Pinned { guard } => &mut guard.conn,
            ConnHandle::Pooled { conn, .. } => conn,
        }
    }

    fn engine(&self) -> DbEngine {
        match self {
            ConnHandle::Pinned { guard } => guard.engine,
            ConnHandle::Pooled { engine, .. } => *engine,
        }
    }

    // True when this runs inside an open manual-commit transaction (the pinned connection). Only
    // then can a statement be wrapped in a SAVEPOINT - a savepoint outside a transaction is an error.
    fn is_pinned(&self) -> bool {
        matches!(self, ConnHandle::Pinned { .. })
    }
}

// Resolves the connection a command should run on: the pinned tx connection when one is open for
// the id, else a fresh pool connection. Errors "not connected" when neither a pool nor a tx exists.
async fn acquire_conn(connection_id: &str) -> Result<ConnHandle, String> {
    if let Some(session) = tx_session(connection_id) {
        return Ok(ConnHandle::Pinned {
            guard: session.lock_owned().await,
        });
    }
    let held = with_pool(connection_id)?;
    let conn = held
        .pool
        .acquire()
        .await
        .map_err(|error| error.to_string())?;
    Ok(ConnHandle::Pooled {
        conn,
        engine: held.engine,
    })
}

// Opens a manual-commit transaction: acquires a dedicated connection from the held pool, issues
// `BEGIN`, and stores it in the registry. Idempotent - a no-op when a transaction is already open
// (the FE calls this before every write, only the first one opens the tx).
pub async fn begin_transaction(connection_id: String) -> Result<(), String> {
    if tx_session(&connection_id).is_some() {
        return Ok(());
    }
    let held = with_pool(&connection_id)?;
    let mut conn = held
        .pool
        .acquire()
        .await
        .map_err(|error| error.to_string())?;
    sqlx::query("BEGIN")
        .execute(&mut *conn)
        .await
        .map_err(|error| error.to_string())?;
    TRANSACTIONS.lock().unwrap().insert(
        connection_id,
        Arc::new(tokio::sync::Mutex::new(TxSession {
            conn,
            engine: held.engine,
        })),
    );
    Ok(())
}

// Removes the open-transaction session for an id from the registry (None = none open). Split out so
// commit/rollback take the session out synchronously, then run the final statement without holding
// the registry lock across the await.
fn take_tx(connection_id: &str) -> Option<Arc<tokio::sync::Mutex<TxSession>>> {
    TRANSACTIONS.lock().unwrap().remove(connection_id)
}

// Finishes an open transaction with the given verb (`COMMIT` / `ROLLBACK`): takes the pinned
// connection out of the registry, runs the statement, and drops the connection (returning it to the
// pool). Errors "not connected" when no transaction is open for the id.
async fn finish_transaction(connection_id: String, verb: &str) -> Result<(), String> {
    let session = take_tx(&connection_id)
        .ok_or_else(|| format!("not connected: no open transaction for id '{connection_id}'"))?;
    let mut guard = session.lock_owned().await;
    sqlx::query(verb)
        .execute(&mut *guard.conn)
        .await
        .map_err(|error| error.to_string())
        .map(|_| ())
}

pub async fn commit_transaction(connection_id: String) -> Result<(), String> {
    finish_transaction(connection_id, "COMMIT").await
}

pub async fn rollback_transaction(connection_id: String) -> Result<(), String> {
    finish_transaction(connection_id, "ROLLBACK").await
}

// Cancellation token sentinel + registry, ported from the sibling `requi` repo. A run registers
// its token keyed by request id, a guard removes it on every exit, a cancel fires it.
pub const CANCEL_SENTINEL: &str = "__cancelled__";

static CANCELS: LazyLock<Mutex<HashMap<String, CancellationToken>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

// Removes the request's token on drop so no run path leaks an entry (success, error, or cancel all
// unwind through this).
struct CancelGuard {
    request_id: String,
}

impl Drop for CancelGuard {
    fn drop(&mut self) {
        CANCELS.lock().unwrap().remove(&self.request_id);
    }
}

// Fires the cancellation token for a request id, aborting its in-flight run at the next await
// point. A no-op for an unknown id (already finished, or never started).
pub async fn cancel_query(request_id: String) {
    let token = CANCELS.lock().unwrap().get(&request_id).cloned();
    if let Some(token) = token {
        token.cancel();
    }
}

// Registers a fresh cancellation token under `request_id` and returns it, so a sibling module
// (the Mongo path) can make its own runs cancellable through the SAME registry that `cancel_query`
// fires - the connect "Cancel" button works identically for both engines. The caller must
// `unregister_cancel_token` on every exit (success/error/cancel) to avoid leaking an entry.
pub fn register_cancel_token(request_id: &str) -> CancellationToken {
    let token = CancellationToken::new();
    CANCELS
        .lock()
        .unwrap()
        .insert(request_id.to_string(), token.clone());
    token
}

// Removes a token registered by `register_cancel_token`. A no-op for an unknown id.
pub fn unregister_cancel_token(request_id: &str) {
    CANCELS.lock().unwrap().remove(request_id);
}

// Splits a buffer into individual statements on top-level `;`, leaving a `;` inside a string
// literal, quoted identifier, comment, or Postgres dollar-quote untouched. Each statement is
// trimmed; blank and comment-only statements are dropped. Char-scanned with a tiny lexer state so a
// function body full of semicolons stays one statement.
pub fn split_sql_statements(sql: &str) -> Vec<String> {
    let chars: Vec<char> = sql.chars().collect();
    let length = chars.len();
    let mut statements: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut index = 0;

    while index < length {
        let character = chars[index];

        if character == '-' && chars.get(index + 1) == Some(&'-') {
            while index < length && chars[index] != '\n' {
                current.push(chars[index]);
                index += 1;
            }
            continue;
        }

        if character == '/' && chars.get(index + 1) == Some(&'*') {
            current.push('/');
            current.push('*');
            index += 2;
            while index < length {
                if chars[index] == '*' && chars.get(index + 1) == Some(&'/') {
                    current.push('*');
                    current.push('/');
                    index += 2;
                    break;
                }
                current.push(chars[index]);
                index += 1;
            }
            continue;
        }

        if character == '\'' || character == '"' {
            index = consume_quoted(&chars, index, character, &mut current);
            continue;
        }

        if character == '`' {
            current.push('`');
            index += 1;
            while index < length {
                current.push(chars[index]);
                if chars[index] == '`' {
                    index += 1;
                    break;
                }
                index += 1;
            }
            continue;
        }

        if character == '$' {
            if let Some(tag_length) = dollar_tag_length(&chars, index) {
                let tag = &chars[index..index + tag_length];
                for offset in 0..tag_length {
                    current.push(chars[index + offset]);
                }
                index += tag_length;
                while index < length {
                    if matches_at(&chars, index, tag) {
                        for character in tag {
                            current.push(*character);
                        }
                        index += tag.len();
                        break;
                    }
                    current.push(chars[index]);
                    index += 1;
                }
                continue;
            }
        }

        if character == ';' {
            statements.push(current.trim().to_string());
            current.clear();
            index += 1;
            continue;
        }

        current.push(character);
        index += 1;
    }

    statements.push(current.trim().to_string());
    statements
        .into_iter()
        .filter(|statement| !strip_leading_noise(statement).trim().is_empty())
        .collect()
}

// Consumes a single- or double-quoted run starting at the opening quote, pushing it verbatim into
// `current`, and returns the index just past the closing quote. A doubled quote (`''` / `""`) is an
// escaped quote, not a terminator.
fn consume_quoted(chars: &[char], start: usize, quote: char, current: &mut String) -> usize {
    let length = chars.len();
    current.push(quote);
    let mut index = start + 1;
    while index < length {
        current.push(chars[index]);
        if chars[index] == quote {
            if chars.get(index + 1) == Some(&quote) {
                current.push(quote);
                index += 2;
                continue;
            }
            return index + 1;
        }
        index += 1;
    }
    index
}

// If a `$` at `start` opens a Postgres dollar-quote tag (`$$` or `$tag$` with an identifier tag),
// returns the tag length including both `$`. Otherwise None (e.g. a `$1` placeholder).
fn dollar_tag_length(chars: &[char], start: usize) -> Option<usize> {
    let mut index = start + 1;
    while index < chars.len() {
        let character = chars[index];
        if character == '$' {
            return Some(index - start + 1);
        }
        if character.is_alphanumeric() || character == '_' {
            index += 1;
            continue;
        }
        return None;
    }
    None
}

fn matches_at(chars: &[char], position: usize, needle: &[char]) -> bool {
    position + needle.len() <= chars.len() && chars[position..position + needle.len()] == *needle
}

const CREDENTIAL_ENCODE_SET: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'.')
    .remove(b'_')
    .remove(b'~');

// SQLite file paths keep their separators and path-safe punctuation; only URL-breaking
// characters (spaces, ...) are percent-encoded so `sqlite://<path>` stays a valid URL.
const PATH_ENCODE_SET: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'/')
    .remove(b'-')
    .remove(b'.')
    .remove(b'_')
    .remove(b'~');

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DbEngine {
    Postgres,
    Mysql,
    Sqlite,
}

// Engine-discriminated connection. The network engines carry host/port/credentials; SQLite is
// a single file. Tagged on `engine` so the TypeScript union deserializes directly.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "engine", rename_all = "lowercase")]
pub enum ConnectionConfig {
    Postgres {
        host: String,
        port: u16,
        database: String,
        user: String,
        password: String,
    },
    Mysql {
        host: String,
        port: u16,
        database: String,
        user: String,
        password: String,
    },
    Sqlite {
        file: String,
    },
}

impl ConnectionConfig {
    pub fn engine(&self) -> DbEngine {
        match self {
            ConnectionConfig::Postgres { .. } => DbEngine::Postgres,
            ConnectionConfig::Mysql { .. } => DbEngine::Mysql,
            ConnectionConfig::Sqlite { .. } => DbEngine::Sqlite,
        }
    }
}

fn encode(value: &str) -> String {
    utf8_percent_encode(value, CREDENTIAL_ENCODE_SET).to_string()
}

pub fn build_url(config: &ConnectionConfig) -> String {
    let (scheme, host, port, database, user, password) = match config {
        ConnectionConfig::Postgres {
            host,
            port,
            database,
            user,
            password,
        } => ("postgresql", host, port, database, user, password),
        ConnectionConfig::Mysql {
            host,
            port,
            database,
            user,
            password,
        } => ("mysql", host, port, database, user, password),
        ConnectionConfig::Sqlite { file } => {
            return format!("sqlite://{}", utf8_percent_encode(file, PATH_ENCODE_SET));
        }
    };
    format!(
        "{scheme}://{user}:{password}@{host}:{port}/{database}",
        user = encode(user),
        password = encode(password),
        database = encode(database),
    )
}

// A table the catalog lists. Postgres carries the owning schema so the sidebar can group by it and
// every table command can qualify the name; MySQL/SQLite have no schema level (`schema: None`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableRef {
    pub schema: Option<String>,
    pub name: String,
}

// Postgres selects (schema, table) so each table is qualifiable and groupable; MySQL/SQLite select
// the bare name only (no schema level). The Postgres ordering is schema-then-table so the grouped
// sidebar is alphabetical within each schema.
pub fn catalog_query(engine: DbEngine) -> &'static str {
    match engine {
        DbEngine::Postgres => {
            "SELECT table_schema::text, table_name::text FROM information_schema.tables \
             WHERE table_type = 'BASE TABLE' \
             AND table_schema NOT IN ('pg_catalog', 'information_schema') \
             ORDER BY table_schema, table_name"
        }
        DbEngine::Mysql => {
            "SELECT table_name FROM information_schema.tables \
             WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' \
             ORDER BY table_name"
        }
        DbEngine::Sqlite => {
            "SELECT name FROM sqlite_master \
             WHERE type = 'table' AND name NOT LIKE 'sqlite_%' \
             ORDER BY name"
        }
    }
}

// Qualifies a table for the FROM/UPDATE/INSERT/DELETE target: `"schema"."table"` when a schema is
// known (Postgres), bare `"table"` otherwise (MySQL/SQLite). Both parts are quoted per engine, so
// an embedded quote is doubled and the name can never break out of its identifier.
pub fn qualified_table(engine: DbEngine, schema: Option<&str>, table: &str) -> String {
    match schema {
        Some(schema) => format!(
            "{}.{}",
            quote_identifier(engine, schema),
            quote_identifier(engine, table)
        ),
        None => quote_identifier(engine, table),
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableColumn {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub is_primary_key: bool,
}

// A column sort the table card asks for. `column` is validated against the known column list
// before it reaches the ORDER BY, so it can never be an injection vector.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Sort {
    pub column: String,
    pub descending: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableRows {
    pub columns: Vec<TableColumn>,
    pub rows: Vec<Vec<Option<String>>>,
    pub primary_key: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaColumn {
    pub name: String,
    pub data_type: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableSchema {
    // The owning Postgres schema, so autocomplete can disambiguate same-named tables across schemas.
    // None for MySQL/SQLite (no schema level).
    pub schema: Option<String>,
    pub name: String,
    pub columns: Vec<SchemaColumn>,
}

// The catalog read on connect: the browsable tables PLUS the database's views (F6 #15). Views ride
// the existing connect round-trip so the Views tab has real data without a second command. MongoDB
// returns no views.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectCatalog {
    pub tables: Vec<TableRef>,
    pub views: Vec<TableRef>,
}

// One column's full metadata for the read-only Structure view (F6 #14): the grid header already
// shows type/nullable/PK, this adds the default value + ordinal position.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StructureColumn {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub is_primary_key: bool,
    pub default_value: Option<String>,
    pub ordinal: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexInfo {
    pub name: String,
    pub columns: Vec<String>,
    pub is_unique: bool,
    pub is_primary: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForeignKey {
    pub name: String,
    pub columns: Vec<String>,
    pub referenced_table: String,
    // The referenced table's schema, so a cross-schema Postgres FK resolves to the correct target
    // node id. Populated for Postgres; null for MySQL/SQLite (schemaless in this app).
    pub referenced_schema: Option<String>,
    pub referenced_columns: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConstraintInfo {
    pub name: String,
    // "check" | "unique" - the two named constraint kinds F6 surfaces.
    pub kind: String,
    pub definition: Option<String>,
}

// The four read-only sections of the Structure view, assembled per table. MongoDB fills `indexes`
// only (documents have no columns/FK/SQL constraints).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableStructure {
    pub columns: Vec<StructureColumn>,
    pub indexes: Vec<IndexInfo>,
    pub foreign_keys: Vec<ForeignKey>,
    pub constraints: Vec<ConstraintInfo>,
}

pub fn quote_identifier(engine: DbEngine, name: &str) -> String {
    match engine {
        DbEngine::Postgres | DbEngine::Sqlite => format!("\"{}\"", name.replace('"', "\"\"")),
        DbEngine::Mysql => format!("`{}`", name.replace('`', "``")),
    }
}

// Postgres scopes introspection to a specific schema when one is known (`AND table_schema = $2`,
// the caller binds the schema as the 2nd param) instead of the system-schema-exclusion filter, so
// `public.users` and `analytics.users` introspect independently rather than via `search_path`.
// MySQL stays scoped to `DATABASE()`; SQLite's pragma has no schema. `has_schema` only affects the
// Postgres branch (MySQL/SQLite never carry a schema).
fn postgres_table_scope(has_schema: bool) -> &'static str {
    if has_schema {
        "table_schema = $2"
    } else {
        "table_schema NOT IN ('pg_catalog', 'information_schema')"
    }
}

pub fn columns_query(engine: DbEngine, has_schema: bool) -> String {
    match engine {
        DbEngine::Postgres => format!(
            "SELECT column_name::text FROM information_schema.columns \
             WHERE table_name = $1 AND {} \
             ORDER BY ordinal_position",
            postgres_table_scope(has_schema)
        ),
        DbEngine::Mysql => "SELECT column_name FROM information_schema.columns \
             WHERE table_name = ? AND table_schema = DATABASE() \
             ORDER BY ordinal_position"
            .to_string(),
        DbEngine::Sqlite => "SELECT name FROM pragma_table_info(?) ORDER BY cid".to_string(),
    }
}

// Reads every base table and its columns in one statement, ordered by table then column position,
// so `fetch_schema` can fold the flat rows into per-table groups for the SQL editor's autocomplete.
// No bind params - it covers the whole database, not one named table. Postgres leads with
// `table_schema` (4 columns) so groups disambiguate same-named tables across schemas; MySQL/SQLite
// have no schema level (3 columns: table, column, type). `fetch_schema` reads the shape per engine.
pub fn schema_query(engine: DbEngine) -> &'static str {
    match engine {
        DbEngine::Postgres => {
            "SELECT table_schema::text, table_name::text, column_name::text, data_type::text \
             FROM information_schema.columns \
             WHERE table_schema NOT IN ('pg_catalog', 'information_schema') \
             ORDER BY table_schema, table_name, ordinal_position"
        }
        DbEngine::Mysql => {
            "SELECT table_name, column_name, data_type \
             FROM information_schema.columns \
             WHERE table_schema = DATABASE() \
             ORDER BY table_name, ordinal_position"
        }
        DbEngine::Sqlite => {
            "SELECT m.name, c.name, c.type \
             FROM sqlite_master m \
             JOIN pragma_table_info(m.name) c \
             WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%' \
             ORDER BY m.name, c.cid"
        }
    }
}

fn text_expression(engine: DbEngine, column: &str) -> String {
    match engine {
        DbEngine::Postgres => format!("{}::text", quote_identifier(engine, column)),
        DbEngine::Mysql => format!("CAST({} AS CHAR)", quote_identifier(engine, column)),
        DbEngine::Sqlite => format!("CAST({} AS TEXT)", quote_identifier(engine, column)),
    }
}

// `filter` is a raw SQL boolean expression wrapped verbatim in parentheses as a WHERE clause
// (DBeaver-style). It cannot be parameterized, so it is the caller's SQL to own; a malformed
// expression simply errors at the database. `sort` orders by the REAL (un-cast) column so numeric
// columns sort numerically, and is dropped unless its column is in the known `columns` list.
pub fn build_rows_query(
    engine: DbEngine,
    schema: Option<&str>,
    table: &str,
    columns: &[String],
    limit: u32,
    offset: u32,
    filter: Option<&str>,
    sort: Option<&Sort>,
) -> String {
    let selected = columns
        .iter()
        .map(|column| text_expression(engine, column))
        .collect::<Vec<_>>()
        .join(", ");

    let where_clause = match filter.map(str::trim).filter(|text| !text.is_empty()) {
        Some(expression) => format!(" WHERE ({expression})"),
        None => String::new(),
    };

    let order_clause = match sort.filter(|sort| columns.iter().any(|name| name == &sort.column)) {
        Some(sort) => {
            let direction = if sort.descending { " DESC" } else { "" };
            // Qualify the column with the table. The SELECT casts each column to text
            // (`"id"::text`) and Postgres preserves the column name through that cast, so a bare
            // `ORDER BY "id"` would bind to the TEXT output alias and sort lexicographically
            // (1, 10, 100, 11). The table-qualified form references the original (numeric) column.
            format!(
                " ORDER BY {}.{}{direction}",
                qualified_table(engine, schema, table),
                quote_identifier(engine, &sort.column)
            )
        }
        None => String::new(),
    };

    let offset_clause = if offset > 0 {
        format!(" OFFSET {offset}")
    } else {
        String::new()
    };

    format!(
        "SELECT {selected} FROM {table}{where_clause}{order_clause} LIMIT {limit}{offset_clause}",
        table = qualified_table(engine, schema, table),
    )
}

// The unbounded row count the table card shows in its status bar ("N of TOTAL"). Mirrors the
// rows query's filter handling (same parenthesized raw WHERE), minus columns/sort/limit.
pub fn build_count_query(
    engine: DbEngine,
    schema: Option<&str>,
    table: &str,
    filter: Option<&str>,
) -> String {
    let where_clause = match filter.map(str::trim).filter(|text| !text.is_empty()) {
        Some(expression) => format!(" WHERE ({expression})"),
        None => String::new(),
    };
    format!(
        "SELECT COUNT(*) FROM {table}{where_clause}",
        table = qualified_table(engine, schema, table),
    )
}

// The value bound to the primary-key query's parameter. Postgres resolves the table via
// `$1::regclass`, which parses a (possibly quoted) qualified SQL name, so the bind is the
// schema-qualified, quoted name (`"analytics"."users"`) when a schema is known - this is what pins
// the lookup to the right schema rather than the server's `search_path`. MySQL/SQLite match the
// bare table name in information_schema/pragma, so they bind the unquoted table.
fn pk_regclass_bind(engine: DbEngine, schema: Option<&str>, table: &str) -> String {
    match engine {
        DbEngine::Postgres => qualified_table(engine, schema, table),
        DbEngine::Mysql | DbEngine::Sqlite => table.to_string(),
    }
}

pub fn primary_key_query(engine: DbEngine) -> &'static str {
    match engine {
        DbEngine::Postgres => {
            "SELECT a.attname::text \
             FROM pg_index i \
             JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) \
             WHERE i.indrelid = $1::regclass AND i.indisprimary \
             ORDER BY a.attnum"
        }
        DbEngine::Mysql => {
            "SELECT column_name FROM information_schema.key_column_usage \
             WHERE table_schema = DATABASE() AND table_name = ? \
             AND constraint_name = 'PRIMARY' \
             ORDER BY ordinal_position"
        }
        DbEngine::Sqlite => "SELECT name FROM pragma_table_info(?) WHERE pk > 0 ORDER BY pk",
    }
}

// Builds an UPDATE that sets one column on the row whose primary key matches `pk_value`.
// The new value is cast to the column's SQL type for Postgres (which won't implicitly
// coerce text); MySQL coerces strings, so it binds plainly. The pk is matched as text so
// any pk type works. Returns (sql, ordered bind values).
pub fn build_update_query_value(
    engine: DbEngine,
    schema: Option<&str>,
    table: &str,
    column: &str,
    column_type: &str,
    pk_column: &str,
    new_value: Option<&str>,
    pk_value: &str,
) -> (String, Vec<String>) {
    let quoted_table = qualified_table(engine, schema, table);
    let quoted_column = quote_identifier(engine, column);
    let mut binds = Vec::new();

    let (set_expression, value_placeholder_taken) = match new_value {
        None => ("NULL".to_string(), false),
        Some(value) => {
            binds.push(value.to_string());
            match engine {
                DbEngine::Postgres => (format!("$1::{column_type}"), true),
                DbEngine::Mysql | DbEngine::Sqlite => ("?".to_string(), true),
            }
        }
    };

    let pk_placeholder = match engine {
        DbEngine::Postgres => {
            if value_placeholder_taken {
                "$2"
            } else {
                "$1"
            }
        }
        DbEngine::Mysql | DbEngine::Sqlite => "?",
    };
    binds.push(pk_value.to_string());

    let pk_match = match engine {
        DbEngine::Postgres => format!(
            "{}::text = {pk_placeholder}",
            quote_identifier(engine, pk_column)
        ),
        DbEngine::Mysql | DbEngine::Sqlite => {
            format!("{} = {pk_placeholder}", text_expression(engine, pk_column))
        }
    };

    let sql =
        format!("UPDATE {quoted_table} SET {quoted_column} = {set_expression} WHERE {pk_match}",);
    (sql, binds)
}

// Builds an INSERT listing only the columns the user set (parallel `columns` + `values`). Each
// non-null value is bound; Postgres casts it to the column's type ($n::type) like the update path,
// MySQL/SQLite bind plainly with `?`. A None value goes in as a literal NULL (no bind), so DB
// defaults/sequences still apply to columns the user left untouched (those aren't listed at all).
pub fn build_insert_query(
    engine: DbEngine,
    schema: Option<&str>,
    table: &str,
    columns: &[(&str, &str)],
    values: &[Option<&str>],
) -> (String, Vec<String>) {
    let quoted_table = qualified_table(engine, schema, table);
    let quoted_columns = columns
        .iter()
        .map(|(name, _)| quote_identifier(engine, name))
        .collect::<Vec<_>>()
        .join(", ");

    let mut binds = Vec::new();
    let placeholders = columns
        .iter()
        .zip(values)
        .map(|((_, column_type), value)| match value {
            None => "NULL".to_string(),
            Some(text) => {
                binds.push(text.to_string());
                match engine {
                    DbEngine::Postgres => format!("${}::{column_type}", binds.len()),
                    DbEngine::Mysql | DbEngine::Sqlite => "?".to_string(),
                }
            }
        })
        .collect::<Vec<_>>()
        .join(", ");

    let sql = format!("INSERT INTO {quoted_table} ({quoted_columns}) VALUES ({placeholders})");
    (sql, binds)
}

// Builds a DELETE matching the row whose primary key equals `pk_value`. The pk is compared as text
// (PG `::text`, MySQL/SQLite `CAST(... AS CHAR/TEXT)`) so any pk type works, mirroring the update path.
pub fn build_delete_query(
    engine: DbEngine,
    schema: Option<&str>,
    table: &str,
    pk_column: &str,
    pk_value: &str,
) -> (String, Vec<String>) {
    let quoted_table = qualified_table(engine, schema, table);
    let pk_match = match engine {
        DbEngine::Postgres => format!("{}::text = $1", quote_identifier(engine, pk_column)),
        DbEngine::Mysql | DbEngine::Sqlite => {
            format!("{} = ?", text_expression(engine, pk_column))
        }
    };
    let sql = format!("DELETE FROM {quoted_table} WHERE {pk_match}");
    (sql, vec![pk_value.to_string()])
}

#[cfg(test)]
pub fn build_update_query(
    engine: DbEngine,
    schema: Option<&str>,
    table: &str,
    column: &str,
    column_type: &str,
    pk_column: &str,
    new_value: &str,
    pk_value: &str,
) -> (String, Vec<String>) {
    build_update_query_value(
        engine,
        schema,
        table,
        column,
        column_type,
        pk_column,
        Some(new_value),
        pk_value,
    )
}

// Wraps a user's row-returning query so every result column is cast to text,
// the only type the sqlx Any driver can decode for arbitrary result shapes.
// `columns` are the names discovered by preparing the statement.
pub fn wrap_select_as_text(
    engine: DbEngine,
    user_sql: &str,
    columns: &[String],
    limit: u32,
) -> String {
    let selected = columns
        .iter()
        .map(|column| {
            let quoted = quote_identifier(engine, column);
            match engine {
                DbEngine::Postgres => format!("{quoted}::text"),
                DbEngine::Mysql => format!("CAST({quoted} AS CHAR)"),
                DbEngine::Sqlite => format!("CAST({quoted} AS TEXT)"),
            }
        })
        .collect::<Vec<_>>()
        .join(", ");
    let trimmed = user_sql.trim().trim_end_matches(';');
    format!("SELECT {selected} FROM ({trimmed}) AS dbui_q LIMIT {limit}")
}

// Strips leading whitespace and SQL comments so the first real keyword can be read.
fn strip_leading_noise(sql: &str) -> &str {
    let mut rest = sql.trim_start();
    loop {
        if let Some(after) = rest.strip_prefix("--") {
            match after.find('\n') {
                Some(index) => rest = after[index + 1..].trim_start(),
                None => return "",
            }
        } else if let Some(after) = rest.strip_prefix("/*") {
            match after.find("*/") {
                Some(index) => rest = after[index + 2..].trim_start(),
                None => return "",
            }
        } else {
            return rest;
        }
    }
}

// True when the statement yields a result set (so it must be wrapped + fetched),
// false for write/DDL statements (which are executed for a rows-affected count).
pub fn is_row_returning(sql: &str) -> bool {
    matches!(
        leading_keyword(sql).as_str(),
        "SELECT" | "WITH" | "VALUES" | "TABLE" | "SHOW" | "EXPLAIN"
    )
}

// A row-returning statement that can legally sit inside `(<sql>) AS alias` so it can be
// wrapped in row_to_json. SELECT/WITH/VALUES/TABLE qualify; EXPLAIN and SHOW do NOT - Postgres
// rejects them as subqueries ("syntax error at or near ..."), so they must run directly.
pub fn is_subquery_wrappable(sql: &str) -> bool {
    matches!(
        leading_keyword(sql).as_str(),
        "SELECT" | "WITH" | "VALUES" | "TABLE"
    )
}

fn leading_keyword(sql: &str) -> String {
    strip_leading_noise(sql)
        .chars()
        .take_while(|character| character.is_ascii_alphabetic())
        .collect::<String>()
        .to_ascii_uppercase()
}

// Postgres path: the sqlx Any driver cannot describe native column types (timestamp,
// uuid, numeric, ...), so we never prepare arbitrary SQL. Instead each result row is
// serialised by Postgres itself with row_to_json (preserves column order, unlike jsonb)
// and cast to text - the one type Any always decodes.
pub fn wrap_select_as_json(user_sql: &str, limit: u32) -> String {
    let trimmed = user_sql.trim().trim_end_matches(';');
    format!("SELECT row_to_json(dbui_q)::text AS dbui_row FROM ({trimmed}) AS dbui_q LIMIT {limit}")
}

// Column-name probe for an empty result. row_to_json only emits keys for rows that exist,
// so a zero-row query yields no column info. A LEFT JOIN LATERAL against a single base row
// always produces exactly one row; when the user query is empty the lateral side is all NULL.
// We then re-select `dbui_q.*` into a derived table `dbui_cols` so the composite is a real
// (non-null) row - row_to_json over the join-nullable `dbui_q` directly would be a NULL
// whole-row composite and emit no keys. The derived row's columns are individually null but
// defined, so row_to_json emits every key; parsing recovers the names, the null row is dropped.
pub fn wrap_columns_probe(user_sql: &str) -> String {
    let trimmed = user_sql.trim().trim_end_matches(';');
    format!(
        "SELECT row_to_json(dbui_cols)::text AS dbui_row FROM (\
         SELECT dbui_q.* FROM (SELECT 1 AS dbui_one) AS dbui_base \
         LEFT JOIN LATERAL ({trimmed}) AS dbui_q ON true LIMIT 1\
         ) AS dbui_cols"
    )
}

// Turns row_to_json text rows into (column names, string cells). Column order comes from
// the first row's key order (serde_json keeps insertion order via the preserve_order
// feature); JSON nulls become None, strings pass through, everything else stringifies.
fn parse_json_rows(
    json_rows: &[String],
) -> Result<(Vec<String>, Vec<Vec<Option<String>>>), String> {
    use serde_json::{Map, Value};

    let mut columns: Vec<String> = Vec::new();
    let mut rows: Vec<Vec<Option<String>>> = Vec::new();
    for raw in json_rows {
        let value: Value = serde_json::from_str(raw).map_err(|error| error.to_string())?;
        let object: &Map<String, Value> = value
            .as_object()
            .ok_or_else(|| "expected a JSON object per row".to_string())?;
        if columns.is_empty() {
            columns = object.keys().cloned().collect();
        }
        let row = columns
            .iter()
            .map(|column| match object.get(column) {
                None | Some(Value::Null) => None,
                Some(Value::String(text)) => Some(text.clone()),
                Some(other) => Some(other.to_string()),
            })
            .collect();
        rows.push(row);
    }
    Ok((columns, rows))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryOutcome {
    // The single statement this outcome is for (after splitting a multi-statement buffer), so the
    // frontend logs each statement to History on its own rather than repeating the whole buffer.
    pub statement: String,
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Option<String>>>,
    pub rows_affected: u64,
    pub returns_rows: bool,
    pub message: String,
}

// Command-facing SQL execution over a held pool. Splits the buffer into statements, runs them in
// order on ONE acquired connection (so a user-written BEGIN/COMMIT spans them), and returns one
// outcome per statement. Cancellable by `request_id`: a concurrent `cancel_query` aborts the batch
// at the next await point and resolves to the cancel sentinel. The guard removes the token on every
// exit. An empty/comment-only buffer yields zero statements -> an empty result, no DB round-trip.
pub async fn run_query(
    connection_id: String,
    sql: String,
    limit: u32,
    request_id: String,
) -> Result<Vec<QueryOutcome>, String> {
    // Resolve the connection up front (errors "not connected" here) so the select! only wraps the
    // batch. When a manual-commit tx is open for this id, this is the pinned tx connection, so the
    // query runs inside the transaction and sees its uncommitted writes.
    let mut handle = acquire_conn(&connection_id).await?;

    let token = CancellationToken::new();
    CANCELS
        .lock()
        .unwrap()
        .insert(request_id.clone(), token.clone());
    let _guard = CancelGuard {
        request_id: request_id.clone(),
    };

    tokio::select! {
        biased;
        _ = token.cancelled() => Err(CANCEL_SENTINEL.to_string()),
        result = run_query_batch(&mut handle, &sql, limit) => result,
    }
}

// Runs each split statement in order on ONE connection (the pinned tx connection or a fresh pooled
// one), stopping at (and returning) the first error so a failed statement aborts the batch. Earlier
// statements stay applied unless the user wrapped them in a transaction.
//
// Inside an open manual-commit transaction (pinned connection) each statement is wrapped in a
// SAVEPOINT: a failure rolls back TO that savepoint before returning the error, so the transaction
// stays usable (Postgres would otherwise mark the whole tx aborted and reject every later command
// until ROLLBACK). This mirrors DBeaver's "use savepoint for each statement" - the user's next Run
// works instead of hitting "current transaction is aborted". No savepoint on the pooled/auto-commit
// path (a savepoint outside a transaction is an error).
async fn run_query_batch(
    handle: &mut ConnHandle,
    sql: &str,
    limit: u32,
) -> Result<Vec<QueryOutcome>, String> {
    let statements = split_sql_statements(sql);
    if statements.is_empty() {
        return Ok(Vec::new());
    }

    let engine = handle.engine();
    let pinned = handle.is_pinned();
    let connection = handle.conn();
    let mut outcomes = Vec::with_capacity(statements.len());
    for statement in &statements {
        let result = run_one_in_savepoint(engine, connection, statement, limit, pinned).await;
        match result {
            Ok(mut outcome) => {
                outcome.statement = statement.clone();
                outcomes.push(outcome);
            }
            Err(error) => return Err(error),
        }
    }
    Ok(outcomes)
}

// Runs one statement, wrapping it in a SAVEPOINT when inside an open transaction so a failure leaves
// the transaction usable. Outside a transaction (`pinned` false) it runs the statement directly.
async fn run_one_in_savepoint(
    engine: DbEngine,
    connection: &mut sqlx::AnyConnection,
    statement: &str,
    limit: u32,
    pinned: bool,
) -> Result<QueryOutcome, String> {
    if !pinned {
        return run_one_statement(engine, connection, statement, limit).await;
    }
    use sqlx::Executor;
    (&mut *connection)
        .execute("SAVEPOINT dbui_stmt")
        .await
        .map_err(|error| error.to_string())?;
    match run_one_statement(engine, connection, statement, limit).await {
        Ok(outcome) => {
            // Best-effort release; a failed release does not invalidate the committed work.
            let _ = (&mut *connection).execute("RELEASE SAVEPOINT dbui_stmt").await;
            Ok(outcome)
        }
        Err(error) => {
            // Undo just this statement so the transaction stays alive for the next command.
            (&mut *connection)
                .execute("ROLLBACK TO SAVEPOINT dbui_stmt")
                .await
                .map_err(|rollback_error| format!("{error}; savepoint rollback failed: {rollback_error}"))?;
            Err(error)
        }
    }
}

// Dispatches a single statement to the per-engine runner. Postgres avoids preparing arbitrary SQL
// (its Any type-describe fails on native types); MySQL/SQLite share the prepared path.
async fn run_one_statement(
    engine: DbEngine,
    connection: &mut sqlx::AnyConnection,
    sql: &str,
    limit: u32,
) -> Result<QueryOutcome, String> {
    match engine {
        DbEngine::Postgres => run_query_postgres(connection, sql, limit).await,
        DbEngine::Mysql | DbEngine::Sqlite => {
            run_query_prepared(engine, connection, sql, limit).await
        }
    }
}

fn non_row_outcome(affected: u64) -> QueryOutcome {
    QueryOutcome {
        statement: String::new(),
        columns: Vec::new(),
        rows: Vec::new(),
        rows_affected: affected,
        returns_rows: false,
        message: format!("OK - {affected} row(s) affected"),
    }
}

async fn run_query_postgres(
    connection: &mut sqlx::AnyConnection,
    sql: &str,
    limit: u32,
) -> Result<QueryOutcome, String> {
    use sqlx::Executor;

    if !is_row_returning(sql) {
        let result = (&mut *connection)
            .execute(sql.trim().trim_end_matches(';'))
            .await
            .map_err(|error| error.to_string())?;
        return Ok(non_row_outcome(result.rows_affected()));
    }

    // EXPLAIN / SHOW return rows but cannot be subquery-wrapped, so they can't go through
    // row_to_json. Their output columns are already text (QUERY PLAN, setting), which the Any
    // driver decodes directly - fetch as-is.
    if !is_subquery_wrappable(sql) {
        return fetch_plain_text_rows(connection, sql.trim().trim_end_matches(';')).await;
    }

    let wrapped = wrap_select_as_json(sql, limit);
    let data_rows = sqlx::query(&wrapped)
        .fetch_all(&mut *connection)
        .await
        .map_err(|error| error.to_string())?;
    let json_rows: Vec<String> = data_rows
        .iter()
        .filter_map(|row| row.try_get::<Option<String>, _>(0).ok().flatten())
        .collect();
    let (mut columns, rows) = parse_json_rows(&json_rows)?;

    // Zero rows -> row_to_json emitted no keys, so we have no column names. Probe for them
    // so the result grid still shows the table's column headers (matching the table card).
    if columns.is_empty() {
        let probe_rows = sqlx::query(&wrap_columns_probe(sql))
            .fetch_all(&mut *connection)
            .await
            .map_err(|error| error.to_string())?;
        let probe_json: Vec<String> = probe_rows
            .iter()
            .filter_map(|row| row.try_get::<Option<String>, _>(0).ok().flatten())
            .collect();
        columns = parse_json_rows(&probe_json)?.0;
    }

    let count = rows.len();
    Ok(QueryOutcome {
        statement: String::new(),
        columns,
        rows,
        rows_affected: count as u64,
        returns_rows: true,
        message: format!("SELECT {count}"),
    })
}

// Fetches a statement whose result columns are already Any-decodable text (EXPLAIN, SHOW).
// Column names come from the first row's metadata; every cell reads as Option<String>.
async fn fetch_plain_text_rows(
    connection: &mut sqlx::AnyConnection,
    sql: &str,
) -> Result<QueryOutcome, String> {
    use sqlx::{Column, Row};

    let data_rows = sqlx::query(sql)
        .fetch_all(&mut *connection)
        .await
        .map_err(|error| error.to_string())?;

    let columns: Vec<String> = data_rows
        .first()
        .map(|row| {
            row.columns()
                .iter()
                .map(|column| column.name().to_string())
                .collect()
        })
        .unwrap_or_default();

    let rows: Vec<Vec<Option<String>>> = data_rows
        .iter()
        .map(|row| {
            (0..columns.len())
                .map(|index| row.try_get::<Option<String>, _>(index).unwrap_or(None))
                .collect()
        })
        .collect();

    let count = rows.len();
    Ok(QueryOutcome {
        statement: String::new(),
        columns,
        rows,
        rows_affected: count as u64,
        returns_rows: true,
        message: format!("SELECT {count}"),
    })
}

// Shared by MySQL and SQLite: both let the Any driver describe a prepared statement, so the
// result columns are discovered without executing, then the query is wrapped to cast every
// column to text (per engine). Postgres cannot take this path (its describe fails on native
// types) and uses run_query_postgres instead.
async fn run_query_prepared(
    engine: DbEngine,
    connection: &mut sqlx::AnyConnection,
    sql: &str,
    limit: u32,
) -> Result<QueryOutcome, String> {
    use sqlx::{Column, Executor, Statement};

    let prepared = (&mut *connection)
        .prepare(sql.trim().trim_end_matches(';'))
        .await
        .map_err(|error| error.to_string())?;
    let columns: Vec<String> = prepared
        .columns()
        .iter()
        .map(|column| column.name().to_string())
        .collect();

    if columns.is_empty() {
        let result = (&mut *connection)
            .execute(sql.trim().trim_end_matches(';'))
            .await
            .map_err(|error| error.to_string())?;
        return Ok(non_row_outcome(result.rows_affected()));
    }

    let wrapped = wrap_select_as_text(engine, sql, &columns, limit);
    let data_rows = sqlx::query(&wrapped)
        .fetch_all(&mut *connection)
        .await
        .map_err(|error| error.to_string())?;
    let rows: Vec<Vec<Option<String>>> = data_rows
        .iter()
        .map(|row| {
            (0..columns.len())
                .map(|index| row.try_get::<Option<String>, _>(index).unwrap_or(None))
                .collect()
        })
        .collect();
    let count = rows.len();
    Ok(QueryOutcome {
        statement: String::new(),
        columns,
        rows,
        rows_affected: count as u64,
        returns_rows: true,
        message: format!("SELECT {count}"),
    })
}

// Opens a pool for the connection, stores it in the registry keyed by `connection_id`, and returns
// the table catalog. Reconnecting the same id replaces (and closes) any prior held pool. This is
// the only command that takes `config` - subsequent commands address the held pool by id.
pub async fn connect_database(
    connection_id: String,
    config: ConnectionConfig,
) -> Result<ConnectCatalog, String> {
    // The connect is cancellable like a query: its token lives under a `connect:` key so the
    // Settings "Cancel" button (cancel_query) can abort a stuck connect without colliding with a
    // query request id. The guard removes the token on every exit.
    let cancel_key = connect_cancel_key(&connection_id);
    let token = CancellationToken::new();
    CANCELS
        .lock()
        .unwrap()
        .insert(cancel_key.clone(), token.clone());
    let _guard = CancelGuard {
        request_id: cancel_key,
    };

    tokio::select! {
        biased;
        _ = token.cancelled() => Err(CANCEL_SENTINEL.to_string()),
        result = open_and_catalog(connection_id, config) => result,
    }
}

// Derives the cancel-registry key for a connect, namespaced so it can never collide with a query
// request id. The frontend builds the same key to cancel an in-flight connect.
pub fn connect_cancel_key(connection_id: &str) -> String {
    format!("connect:{connection_id}")
}

// Opens a fail-fast pool, reads the catalog, and stores the held connection. Split out so the
// cancel select! above wraps the whole open-and-catalog future.
async fn open_and_catalog(
    connection_id: String,
    config: ConnectionConfig,
) -> Result<ConnectCatalog, String> {
    let engine = config.engine();
    let pool = AnyPoolOptions::new()
        .max_connections(POOL_MAX_CONNECTIONS)
        // Fail fast instead of hanging on sqlx's ~30s default when the host/port is wrong.
        .acquire_timeout(std::time::Duration::from_secs(10))
        .connect(&build_url(&config))
        .await
        .map_err(|error| error.to_string())?;

    let table_rows = sqlx::query(catalog_query(engine))
        .fetch_all(&pool)
        .await
        .map_err(|error| error.to_string());
    // Views ride the connect round-trip (F6 #15). A views-query failure must not fail the connect -
    // an engine/permission that can't read views still browses tables - so it degrades to empty.
    let view_rows = sqlx::query(views_query(engine)).fetch_all(&pool).await;

    if let Err(error) = table_rows {
        pool.close().await;
        return Err(error);
    }

    let previous = POOLS
        .lock()
        .unwrap()
        .insert(connection_id, HeldConnection { pool, engine });
    if let Some(previous) = previous {
        previous.pool.close().await;
    }

    // Postgres returns (schema, table) so the sidebar can group + every command can qualify;
    // MySQL/SQLite return the bare name only (no schema level). Views share the same shape.
    let has_schema_column = matches!(engine, DbEngine::Postgres);
    let tables = table_refs(&table_rows.expect("error returned above"), has_schema_column)?;
    let views = view_rows
        .ok()
        .map(|rows| table_refs(&rows, has_schema_column))
        .transpose()?
        .unwrap_or_default();
    Ok(ConnectCatalog { tables, views })
}

// Maps catalog rows (tables or views) to `TableRef`s. Postgres carries (schema, name); MySQL/SQLite
// carry the bare name (schema None).
fn table_refs(rows: &[sqlx::any::AnyRow], has_schema_column: bool) -> Result<Vec<TableRef>, String> {
    rows.iter()
        .map(|row| {
            if has_schema_column {
                let schema = row.try_get::<String, _>(0).map_err(|e| e.to_string())?;
                let name = row.try_get::<String, _>(1).map_err(|e| e.to_string())?;
                Ok(TableRef {
                    schema: Some(schema),
                    name,
                })
            } else {
                let name = row.try_get::<String, _>(0).map_err(|e| e.to_string())?;
                Ok(TableRef { schema: None, name })
            }
        })
        .collect()
}

// Closes and removes the held pool for a connection id. A no-op for an unknown id. An open
// manual-commit transaction is rolled back first so disconnect never leaks an idle-in-transaction
// connection (its pinned connection is dropped back to the pool before the pool closes).
pub async fn disconnect_database(connection_id: String) {
    if let Some(session) = take_tx(&connection_id) {
        let mut guard = session.lock_owned().await;
        let _ = sqlx::query("ROLLBACK").execute(&mut *guard.conn).await;
    }
    let held = POOLS.lock().unwrap().remove(&connection_id);
    if let Some(held) = held {
        held.pool.close().await;
    }
}

pub async fn fetch_schema(connection_id: String) -> Result<Vec<TableSchema>, String> {
    let mut handle = acquire_conn(&connection_id).await?;
    let engine = handle.engine();

    // Postgres leads with `table_schema` (4 columns) so the autocomplete groups can disambiguate
    // same-named tables across schemas; MySQL/SQLite have no schema level (3 columns -> None).
    let has_schema_column = matches!(engine, DbEngine::Postgres);
    let rows = sqlx::query(schema_query(engine))
        .fetch_all(handle.conn())
        .await
        .map_err(|error| error.to_string())?
        .iter()
        .map(|row| {
            let offset = if has_schema_column { 1 } else { 0 };
            let schema = if has_schema_column {
                Some(row.try_get::<String, _>(0).map_err(|e| e.to_string())?)
            } else {
                None
            };
            Ok((
                schema,
                row.try_get::<String, _>(offset).map_err(|e| e.to_string())?,
                row.try_get::<String, _>(offset + 1)
                    .map_err(|e| e.to_string())?,
                row.try_get::<String, _>(offset + 2)
                    .map_err(|e| e.to_string())?,
            ))
        })
        .collect::<Result<Vec<(Option<String>, String, String, String)>, String>>()?;

    Ok(group_schema(rows))
}

// Folds flat (schema, table, column, type) rows - already ordered by schema, table, column position
// - into one `TableSchema` per (schema, table), preserving column order. Relies on the query's
// ORDER BY so equal (schema, table) pairs arrive contiguously; a new group starts whenever either
// the schema or the table name changes (so `public.users` and `analytics.users` stay distinct).
fn group_schema(rows: Vec<(Option<String>, String, String, String)>) -> Vec<TableSchema> {
    rows.into_iter().fold(
        Vec::<TableSchema>::new(),
        |mut tables, (schema, table, column, data_type)| {
            let entry = match tables.last_mut() {
                Some(last) if last.name == table && last.schema == schema => last,
                _ => {
                    tables.push(TableSchema {
                        schema,
                        name: table,
                        columns: Vec::new(),
                    });
                    tables.last_mut().expect("just pushed")
                }
            };
            entry.columns.push(SchemaColumn {
                name: column,
                data_type,
            });
            tables
        },
    )
}

pub async fn count_table_rows(
    connection_id: String,
    schema: Option<String>,
    table: String,
    filter: Option<String>,
) -> Result<i64, String> {
    let mut handle = acquire_conn(&connection_id).await?;
    let engine = handle.engine();

    sqlx::query(&build_count_query(
        engine,
        schema.as_deref(),
        &table,
        filter.as_deref(),
    ))
    .fetch_one(handle.conn())
    .await
    .map_err(|error| error.to_string())?
    .try_get::<i64, _>(0)
    .map_err(|error| error.to_string())
}

pub async fn fetch_table_rows(
    connection_id: String,
    schema: Option<String>,
    table: String,
    limit: u32,
    offset: u32,
    filter: Option<String>,
    sort: Option<Sort>,
) -> Result<TableRows, String> {
    let mut handle = acquire_conn(&connection_id).await?;
    let engine = handle.engine();

    read_table_rows(
        handle.conn(),
        engine,
        schema.as_deref(),
        &table,
        limit,
        offset,
        filter.as_deref(),
        sort.as_ref(),
    )
    .await
}

// Runs an introspection query (column list / types / nullability) for one table: binds the table
// name as $1, and the schema as $2 only when the query is the schema-pinned Postgres form. Keeps the
// optional-second-bind in one place so each introspection call site stays a single expression.
async fn fetch_introspection(
    connection: &mut sqlx::AnyConnection,
    sql: &str,
    table: &str,
    schema: Option<&str>,
) -> Result<Vec<sqlx::any::AnyRow>, String> {
    let mut query = sqlx::query(sql).bind(table);
    if let Some(schema) = schema {
        query = query.bind(schema);
    }
    query
        .fetch_all(&mut *connection)
        .await
        .map_err(|e| e.to_string())
}

async fn read_table_rows(
    connection: &mut sqlx::AnyConnection,
    engine: DbEngine,
    schema: Option<&str>,
    table: &str,
    limit: u32,
    offset: u32,
    filter: Option<&str>,
    sort: Option<&Sort>,
) -> Result<TableRows, String> {
    let has_schema = schema.is_some();
    let column_rows =
        fetch_introspection(connection, &columns_query(engine, has_schema), table, schema).await?;

    let names = column_rows
        .iter()
        .map(|row| {
            row.try_get::<String, _>(0)
                .map_err(|error| error.to_string())
        })
        .collect::<Result<Vec<String>, String>>()?;

    if names.is_empty() {
        return Ok(TableRows {
            columns: Vec::new(),
            rows: Vec::new(),
            primary_key: None,
        });
    }

    // The Postgres pk query resolves the table via `$1::regclass`, so the bound value is the
    // (quoted) schema-qualified name - regclass parses a quoted, qualified SQL name. MySQL/SQLite
    // bind the bare table (their pk query reads information_schema/pragma, not regclass).
    let pk_bind = pk_regclass_bind(engine, schema, table);
    let pk_rows = sqlx::query(primary_key_query(engine))
        .bind(&pk_bind)
        .fetch_all(&mut *connection)
        .await
        .map_err(|error| error.to_string())?;
    let primary_key = pk_rows
        .first()
        .and_then(|row| row.try_get::<String, _>(0).ok());

    let type_rows =
        fetch_introspection(connection, &column_types_query(engine, has_schema), table, schema)
            .await?;
    let types: std::collections::HashMap<String, String> = type_rows
        .iter()
        .filter_map(|row| {
            Some((
                row.try_get::<String, _>(0).ok()?,
                row.try_get::<String, _>(1).ok()?,
            ))
        })
        .collect();

    let nullable_rows =
        fetch_introspection(connection, &nullable_query(engine, has_schema), table, schema).await?;
    let nullable: std::collections::HashMap<String, bool> = nullable_rows
        .iter()
        .filter_map(|row| {
            Some((
                row.try_get::<String, _>(0).ok()?,
                read_nullable(engine, row),
            ))
        })
        .collect();

    let columns = assemble_columns(&names, &types, &nullable, primary_key.as_deref());

    let data_rows = sqlx::query(&build_rows_query(
        engine, schema, table, &names, limit, offset, filter, sort,
    ))
    .fetch_all(&mut *connection)
    .await
    .map_err(|error| error.to_string())?;

    let rows = data_rows
        .iter()
        .map(|row| {
            (0..names.len())
                .map(|index| row.try_get::<Option<String>, _>(index).unwrap_or(None))
                .collect()
        })
        .collect();

    Ok(TableRows {
        columns,
        rows,
        primary_key,
    })
}

// Reads the not-null flag from a metadata row per engine. PG/MySQL store the text 'YES'/'NO'
// in `is_nullable`; SQLite stores `notnull` as 0/1 (inverted). Either column shape collapses to
// a single `nullable: bool`.
fn read_nullable(engine: DbEngine, row: &sqlx::any::AnyRow) -> bool {
    match engine {
        DbEngine::Sqlite => {
            let not_null = row.try_get::<i64, _>(1).unwrap_or(0);
            not_null == 0
        }
        DbEngine::Postgres | DbEngine::Mysql => {
            let flag = row.try_get::<String, _>(1).unwrap_or_default();
            !flag.eq_ignore_ascii_case("NO")
        }
    }
}

// Reads a boolean metadata column across engines: Postgres returns a real `bool`, while MySQL/SQLite
// return it as an integer expression (`(non_unique = 0)`, `il."unique"`), so fall back to `i64 != 0`.
fn read_flag(row: &sqlx::any::AnyRow, index: usize) -> bool {
    if let Ok(flag) = row.try_get::<bool, _>(index) {
        return flag;
    }
    row.try_get::<i64, _>(index).map(|value| value != 0).unwrap_or(false)
}

// Folds one-row-per-column index metadata (already ordered by index name then column position) into
// grouped `IndexInfo`s, preserving first-seen order and appending each index's columns in order.
// Pure over plain tuples so composite-index grouping is unit-testable without a live database.
fn fold_indexes(rows: &[(String, String, bool, bool)]) -> Vec<IndexInfo> {
    let mut indexes: Vec<IndexInfo> = Vec::new();
    for (name, column, is_unique, is_primary) in rows {
        match indexes.iter_mut().find(|index| &index.name == name) {
            Some(index) => index.columns.push(column.clone()),
            None => indexes.push(IndexInfo {
                name: name.clone(),
                columns: vec![column.clone()],
                is_unique: *is_unique,
                is_primary: *is_primary,
            }),
        }
    }
    indexes
}

// Folds one-row-per-column foreign-key metadata (ordered by constraint name then column position)
// into grouped `ForeignKey`s. Pure over tuples so composite-FK grouping is unit-testable.
fn fold_foreign_keys(
    rows: &[(String, String, String, String, Option<String>)],
) -> Vec<ForeignKey> {
    let mut keys: Vec<ForeignKey> = Vec::new();
    for (name, column, referenced_table, referenced_column, referenced_schema) in rows {
        match keys.iter_mut().find(|key| &key.name == name) {
            Some(key) => {
                key.columns.push(column.clone());
                key.referenced_columns.push(referenced_column.clone());
            }
            None => keys.push(ForeignKey {
                name: name.clone(),
                columns: vec![column.clone()],
                referenced_table: referenced_table.clone(),
                referenced_schema: referenced_schema.clone(),
                referenced_columns: vec![referenced_column.clone()],
            }),
        }
    }
    keys
}

// Assembles the read-only Structure view for one table: full columns (+ default/ordinal/PK), grouped
// indexes, grouped foreign keys, and named check/unique constraints. Each section is one
// introspection query on the held pool; a table with none of a section yields an empty vec.
async fn read_table_structure(
    connection: &mut sqlx::AnyConnection,
    engine: DbEngine,
    schema: Option<&str>,
    table: &str,
) -> Result<TableStructure, String> {
    let has_schema = schema.is_some();

    // Primary-key column set marks `is_primary_key` (PG/MySQL structure query omits it; SQLite's
    // pragma carries it but we reuse the one pk query for all engines for consistency).
    let pk_bind = pk_regclass_bind(engine, schema, table);
    let pk_rows = sqlx::query(primary_key_query(engine))
        .bind(&pk_bind)
        .fetch_all(&mut *connection)
        .await
        .map_err(|error| error.to_string())?;
    let pk_columns: std::collections::HashSet<String> = pk_rows
        .iter()
        .filter_map(|row| row.try_get::<String, _>(0).ok())
        .collect();

    let column_rows =
        fetch_introspection(connection, &structure_columns_query(engine, has_schema), table, schema)
            .await?;
    let columns = column_rows
        .iter()
        .enumerate()
        .map(|(position, row)| {
            let name = row.try_get::<String, _>(0).unwrap_or_default();
            let data_type = row.try_get::<String, _>(1).unwrap_or_default();
            let nullable = read_nullable(engine, row);
            let default_value = row.try_get::<Option<String>, _>(3).unwrap_or(None);
            let ordinal = row
                .try_get::<i64, _>(4)
                .unwrap_or((position + 1) as i64);
            StructureColumn {
                is_primary_key: pk_columns.contains(&name),
                name,
                data_type,
                nullable,
                default_value,
                ordinal,
            }
        })
        .collect();

    let index_rows =
        fetch_introspection(connection, &index_query(engine, has_schema), table, schema).await?;
    let index_tuples = index_rows
        .iter()
        .filter_map(|row| {
            Some((
                row.try_get::<String, _>(0).ok()?,
                row.try_get::<String, _>(1).ok()?,
                read_flag(row, 2),
                read_flag(row, 3),
            ))
        })
        .collect::<Vec<_>>();
    let indexes = fold_indexes(&index_tuples);

    let fk_rows =
        fetch_introspection(connection, &foreign_key_query(engine, has_schema), table, schema).await?;
    let fk_tuples = fk_rows
        .iter()
        .filter_map(|row| {
            Some((
                read_text(row, 0)?,
                read_text(row, 1)?,
                read_text(row, 2)?,
                read_text(row, 3)?,
                row.try_get::<Option<String>, _>(4).unwrap_or(None),
            ))
        })
        .collect::<Vec<_>>();
    let foreign_keys = fold_foreign_keys(&fk_tuples);

    let constraint_rows =
        fetch_introspection(connection, &constraint_query(engine, has_schema), table, schema).await?;
    let constraints = constraint_rows
        .iter()
        .filter_map(|row| {
            let name = read_text(row, 0)?;
            let kind = read_text(row, 1).unwrap_or_default().to_ascii_lowercase();
            Some(ConstraintInfo {
                name,
                kind,
                definition: row.try_get::<Option<String>, _>(2).unwrap_or(None),
            })
        })
        .collect();

    Ok(TableStructure {
        columns,
        indexes,
        foreign_keys,
        constraints,
    })
}

// Reads a text column that some engines expose as a non-text type (SQLite `pragma_foreign_key_list`
// returns the FK `id` and `seq` as integers), coercing to a String so the fold keys stay uniform.
fn read_text(row: &sqlx::any::AnyRow, index: usize) -> Option<String> {
    if let Ok(text) = row.try_get::<String, _>(index) {
        return Some(text);
    }
    row.try_get::<i64, _>(index).ok().map(|value| value.to_string())
}

pub async fn fetch_table_structure(
    connection_id: String,
    schema: Option<String>,
    table: String,
) -> Result<TableStructure, String> {
    let mut handle = acquire_conn(&connection_id).await?;
    let engine = handle.engine();
    read_table_structure(handle.conn(), engine, schema.as_deref(), &table).await
}

// A batch of row-level changes the table card stages and applies on Save. Internally tagged by
// `kind`; the frontend `PendingMutation` carries extra UI-only fields (id, tableName, sql, ...)
// that serde ignores here.
#[derive(Debug, Clone, Deserialize)]
// `rename_all` renames only the variant tags (cell/insert/delete); `rename_all_fields` is what maps
// the per-variant fields to the camelCase the frontend sends (pkValue/newValue) - without it serde
// expects snake_case and rejects the payload with "missing field `pk_value`".
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum RowMutation {
    Cell {
        column: String,
        pk_value: String,
        #[serde(default)]
        new_value: Option<String>,
    },
    Insert {
        values: std::collections::BTreeMap<String, Option<String>>,
    },
    Delete {
        pk_value: String,
    },
    // MongoDB full-document replace (the edited document as a JSON string). Only the Mongo path
    // interprets it; the SQL `build_mutation` rejects it as unrepresentable.
    Replace {
        pk_value: String,
        document: String,
    },
}

fn column_types_query(engine: DbEngine, has_schema: bool) -> String {
    match engine {
        DbEngine::Postgres => format!(
            "SELECT column_name::text, udt_name::text FROM information_schema.columns \
             WHERE table_name = $1 AND {}",
            postgres_table_scope(has_schema)
        ),
        DbEngine::Mysql => "SELECT column_name, data_type FROM information_schema.columns \
             WHERE table_name = ? AND table_schema = DATABASE()"
            .to_string(),
        DbEngine::Sqlite => "SELECT name, type FROM pragma_table_info(?)".to_string(),
    }
}

// Per-column nullability. PG/MySQL report `is_nullable` as the text 'YES'/'NO';
// SQLite's pragma reports `notnull` as 0/1 (inverted), so the second column is the not-null
// flag and the assembler inverts it. The two PG/MySQL columns are (name, is_nullable text);
// SQLite returns (name, notnull int) - both read by `read_nullable` per engine.
fn nullable_query(engine: DbEngine, has_schema: bool) -> String {
    match engine {
        DbEngine::Postgres => format!(
            "SELECT column_name::text, is_nullable::text FROM information_schema.columns \
             WHERE table_name = $1 AND {}",
            postgres_table_scope(has_schema)
        ),
        DbEngine::Mysql => "SELECT column_name, is_nullable FROM information_schema.columns \
             WHERE table_name = ? AND table_schema = DATABASE()"
            .to_string(),
        DbEngine::Sqlite => "SELECT name, notnull FROM pragma_table_info(?)".to_string(),
    }
}

// ----- F6: schema browser (read-only structure + views) query builders -----

// The database's views, a sibling of `catalog_query` that filters for VIEW instead of BASE TABLE.
// Postgres/MySQL read `information_schema.tables` (`table_type = 'VIEW'`); SQLite reads
// `sqlite_master` (`type = 'view'`). Same shape as the table catalog so the frontend reuses TableRef.
pub fn views_query(engine: DbEngine) -> &'static str {
    match engine {
        DbEngine::Postgres => {
            "SELECT table_schema::text, table_name::text FROM information_schema.tables \
             WHERE table_type = 'VIEW' \
             AND table_schema NOT IN ('pg_catalog', 'information_schema') \
             ORDER BY table_schema, table_name"
        }
        DbEngine::Mysql => {
            "SELECT table_name FROM information_schema.tables \
             WHERE table_schema = DATABASE() AND table_type = 'VIEW' \
             ORDER BY table_name"
        }
        DbEngine::Sqlite => {
            "SELECT name FROM sqlite_master \
             WHERE type = 'view' AND name NOT LIKE 'sqlite_%' \
             ORDER BY name"
        }
    }
}

// Full per-column metadata for the Structure view: name, type, nullability, default, ordinal. Binds
// $1=table (Postgres schema-pins $2 like the other introspection queries via `postgres_table_scope`).
// SQLite reads `pragma_table_info`, whose `dflt_value` carries the DEFAULT and `notnull`/`pk` the
// flags; the assembler reads them positionally.
pub fn structure_columns_query(engine: DbEngine, has_schema: bool) -> String {
    match engine {
        DbEngine::Postgres => format!(
            "SELECT column_name::text, data_type::text, is_nullable::text, \
             column_default::text, ordinal_position::bigint \
             FROM information_schema.columns \
             WHERE table_name = $1 AND {} \
             ORDER BY ordinal_position",
            postgres_table_scope(has_schema)
        ),
        DbEngine::Mysql => "SELECT column_name, data_type, is_nullable, \
             column_default, ordinal_position \
             FROM information_schema.columns \
             WHERE table_name = ? AND table_schema = DATABASE() \
             ORDER BY ordinal_position"
            .to_string(),
        DbEngine::Sqlite => "SELECT name, type, notnull, dflt_value, cid, pk \
             FROM pragma_table_info(?) ORDER BY cid"
            .to_string(),
    }
}

// Every index on a table with its ordered columns and unique/primary flags. Postgres reads
// `pg_index`/`pg_class`/`pg_attribute` (resolving the table via `$1::regclass`-style name); MySQL
// reads `information_schema.statistics` (one row per column, ordered by `seq_in_index`); SQLite uses
// `pragma_index_list` + `pragma_index_info`. Rows come back one-per-(index, column); the assembler
// groups by index name preserving column order.
pub fn index_query(engine: DbEngine, has_schema: bool) -> String {
    match engine {
        DbEngine::Postgres => format!(
            "SELECT ic.relname::text AS index_name, a.attname::text AS column_name, \
             i.indisunique AS is_unique, i.indisprimary AS is_primary, \
             array_position(i.indkey, a.attnum) AS ordinal \
             FROM pg_index i \
             JOIN pg_class ic ON ic.oid = i.indexrelid \
             JOIN pg_class tc ON tc.oid = i.indrelid \
             JOIN pg_namespace n ON n.oid = tc.relnamespace \
             JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) \
             WHERE tc.relname = $1 AND {} \
             ORDER BY ic.relname, ordinal",
            if has_schema {
                "n.nspname = $2"
            } else {
                "n.nspname NOT IN ('pg_catalog', 'information_schema')"
            }
        ),
        DbEngine::Mysql => "SELECT index_name, column_name, \
             (non_unique = 0) AS is_unique, (index_name = 'PRIMARY') AS is_primary, \
             seq_in_index AS ordinal \
             FROM information_schema.statistics \
             WHERE table_name = ? AND table_schema = DATABASE() \
             ORDER BY index_name, seq_in_index"
            .to_string(),
        DbEngine::Sqlite => "SELECT il.name AS index_name, ii.name AS column_name, \
             il.\"unique\" AS is_unique, (il.origin = 'pk') AS is_primary, \
             ii.seqno AS ordinal \
             FROM pragma_index_list(?) il \
             JOIN pragma_index_info(il.name) ii \
             ORDER BY il.name, ii.seqno"
            .to_string(),
    }
}

// Foreign keys with their constrained column(s), referenced table, and referenced column(s).
// Postgres/MySQL join `referential_constraints` with `key_column_usage`; SQLite uses
// `pragma_foreign_key_list`. Rows come back one-per-column of a composite FK, ordered so the
// assembler groups by constraint name.
pub fn foreign_key_query(engine: DbEngine, has_schema: bool) -> String {
    match engine {
        DbEngine::Postgres => format!(
            "SELECT rc.constraint_name::text AS name, \
             kcu.column_name::text AS column_name, \
             ccu.table_name::text AS referenced_table, \
             ccu.column_name::text AS referenced_column, \
             ccu.table_schema::text AS referenced_schema, \
             kcu.ordinal_position AS ordinal \
             FROM information_schema.referential_constraints rc \
             JOIN information_schema.key_column_usage kcu \
               ON kcu.constraint_name = rc.constraint_name \
               AND kcu.constraint_schema = rc.constraint_schema \
             JOIN information_schema.key_column_usage ccu \
               ON ccu.constraint_name = rc.unique_constraint_name \
               AND ccu.constraint_schema = rc.unique_constraint_schema \
               AND ccu.ordinal_position = kcu.position_in_unique_constraint \
             WHERE kcu.table_name = $1 AND {} \
             ORDER BY rc.constraint_name, kcu.ordinal_position",
            if has_schema {
                "kcu.table_schema = $2"
            } else {
                "kcu.table_schema NOT IN ('pg_catalog', 'information_schema')"
            }
        ),
        DbEngine::Mysql => "SELECT kcu.constraint_name AS name, \
             kcu.column_name AS column_name, \
             kcu.referenced_table_name AS referenced_table, \
             kcu.referenced_column_name AS referenced_column, \
             NULL AS referenced_schema, \
             kcu.ordinal_position AS ordinal \
             FROM information_schema.key_column_usage kcu \
             WHERE kcu.table_name = ? AND kcu.table_schema = DATABASE() \
             AND kcu.referenced_table_name IS NOT NULL \
             ORDER BY kcu.constraint_name, kcu.ordinal_position"
            .to_string(),
        DbEngine::Sqlite => "SELECT id AS name, \"from\" AS column_name, \
             \"table\" AS referenced_table, \"to\" AS referenced_column, \
             NULL AS referenced_schema, seq AS ordinal \
             FROM pragma_foreign_key_list(?) \
             ORDER BY id, seq"
            .to_string(),
    }
}

// Named CHECK + UNIQUE constraints. Postgres/MySQL read `information_schema.table_constraints`
// (filtered to the two kinds); Postgres also joins `check_constraints` for the definition. SQLite
// has no constraint catalog - CHECK text lives only in the DDL, so this returns UNIQUE constraints
// from `pragma_index_list` where `origin = 'u'` (documented limitation, E-4).
pub fn constraint_query(engine: DbEngine, has_schema: bool) -> String {
    match engine {
        DbEngine::Postgres => format!(
            "SELECT tc.constraint_name::text AS name, \
             tc.constraint_type::text AS kind, \
             cc.check_clause::text AS definition \
             FROM information_schema.table_constraints tc \
             LEFT JOIN information_schema.check_constraints cc \
               ON cc.constraint_name = tc.constraint_name \
               AND cc.constraint_schema = tc.constraint_schema \
             WHERE tc.table_name = $1 \
             AND tc.constraint_type IN ('CHECK', 'UNIQUE') AND {} \
             ORDER BY tc.constraint_name",
            if has_schema {
                "tc.table_schema = $2"
            } else {
                "tc.table_schema NOT IN ('pg_catalog', 'information_schema')"
            }
        ),
        DbEngine::Mysql => "SELECT constraint_name AS name, constraint_type AS kind, \
             NULL AS definition \
             FROM information_schema.table_constraints \
             WHERE table_name = ? AND table_schema = DATABASE() \
             AND constraint_type IN ('CHECK', 'UNIQUE') \
             ORDER BY constraint_name"
            .to_string(),
        DbEngine::Sqlite => "SELECT name, 'UNIQUE' AS kind, NULL AS definition \
             FROM pragma_index_list(?) \
             WHERE origin = 'u' \
             ORDER BY name"
            .to_string(),
    }
}

// Zips column names with their type + nullability metadata and marks the primary key. Missing
// metadata degrades gracefully (empty type, nullable=true) rather than panicking - a column we
// can browse but couldn't introspect is still listed.
fn assemble_columns(
    names: &[String],
    types: &std::collections::HashMap<String, String>,
    nullable: &std::collections::HashMap<String, bool>,
    primary_key: Option<&str>,
) -> Vec<TableColumn> {
    names
        .iter()
        .map(|name| TableColumn {
            name: name.clone(),
            data_type: types.get(name).cloned().unwrap_or_default(),
            nullable: nullable.get(name).copied().unwrap_or(true),
            is_primary_key: primary_key == Some(name.as_str()),
        })
        .collect()
}

pub async fn apply_row_mutations(
    connection_id: String,
    schema: Option<String>,
    table: String,
    mutations: Vec<RowMutation>,
) -> Result<u64, String> {
    let mut handle = acquire_conn(&connection_id).await?;
    let engine = handle.engine();
    let pinned = handle.is_pinned();
    apply_mutations(handle.conn(), engine, schema.as_deref(), &table, &mutations, pinned).await
}

async fn apply_mutations(
    connection: &mut sqlx::AnyConnection,
    engine: DbEngine,
    schema: Option<&str>,
    table: &str,
    mutations: &[RowMutation],
    pinned: bool,
) -> Result<u64, String> {
    let pk_rows = sqlx::query(primary_key_query(engine))
        .bind(pk_regclass_bind(engine, schema, table))
        .fetch_all(&mut *connection)
        .await
        .map_err(|error| error.to_string())?;
    let pk_columns = pk_rows
        .iter()
        .map(|row| {
            row.try_get::<String, _>(0)
                .map_err(|error| error.to_string())
        })
        .collect::<Result<Vec<String>, String>>()?;
    let pk_column = pk_columns
        .first()
        .ok_or_else(|| format!("table '{table}' has no primary key; cannot edit"))?;

    let type_rows = fetch_introspection(
        connection,
        &column_types_query(engine, schema.is_some()),
        table,
        schema,
    )
    .await?;
    let column_types: std::collections::HashMap<String, String> = type_rows
        .iter()
        .filter_map(|row| {
            let name = row.try_get::<String, _>(0).ok()?;
            let kind = row.try_get::<String, _>(1).ok()?;
            Some((name, kind))
        })
        .collect();

    let mut affected = 0;
    for mutation in mutations {
        let (sql, binds) = build_mutation(engine, schema, table, pk_column, &column_types, mutation)?;
        // Inside an open manual-commit transaction, wrap each mutation in a SAVEPOINT so a failure
        // (e.g. a constraint violation) rolls back only that mutation and leaves the transaction
        // usable, instead of poisoning it (mirrors run_query_batch + DBeaver). No savepoint on the
        // pooled/auto-commit path.
        let result = execute_mutation_in_savepoint(connection, &sql, &binds, pinned).await?;
        affected += result;
    }
    Ok(affected)
}

// Executes one bound mutation, wrapping it in a SAVEPOINT when inside an open transaction so a
// failure leaves the transaction usable (rolls back only this mutation). Returns rows-affected.
async fn execute_mutation_in_savepoint(
    connection: &mut sqlx::AnyConnection,
    sql: &str,
    binds: &[String],
    pinned: bool,
) -> Result<u64, String> {
    use sqlx::Executor;
    if !pinned {
        return run_bound_mutation(connection, sql, binds).await;
    }
    (&mut *connection)
        .execute("SAVEPOINT dbui_stmt")
        .await
        .map_err(|error| error.to_string())?;
    match run_bound_mutation(connection, sql, binds).await {
        Ok(affected) => {
            let _ = (&mut *connection).execute("RELEASE SAVEPOINT dbui_stmt").await;
            Ok(affected)
        }
        Err(error) => {
            (&mut *connection)
                .execute("ROLLBACK TO SAVEPOINT dbui_stmt")
                .await
                .map_err(|rollback_error| {
                    format!("{error}; savepoint rollback failed: {rollback_error}")
                })?;
            Err(error)
        }
    }
}

// Binds + executes one mutation SQL, returning rows-affected.
async fn run_bound_mutation(
    connection: &mut sqlx::AnyConnection,
    sql: &str,
    binds: &[String],
) -> Result<u64, String> {
    let mut query = sqlx::query(sql);
    for bind in binds {
        query = query.bind(bind);
    }
    query
        .execute(&mut *connection)
        .await
        .map(|result| result.rows_affected())
        .map_err(|error| error.to_string())
}

// Translates one staged mutation into (sql, binds). Cell + Insert resolve each column's type from
// the introspected map (degrading to "" like the update path when a type is unknown); Delete needs
// only the pk. All three qualify the target with the schema when one is known.
fn build_mutation(
    engine: DbEngine,
    schema: Option<&str>,
    table: &str,
    pk_column: &str,
    column_types: &std::collections::HashMap<String, String>,
    mutation: &RowMutation,
) -> Result<(String, Vec<String>), String> {
    match mutation {
        RowMutation::Cell {
            column,
            pk_value,
            new_value,
        } => {
            let column_type = column_types
                .get(column)
                .ok_or_else(|| format!("unknown column '{column}'"))?;
            Ok(build_update_query_value(
                engine,
                schema,
                table,
                column,
                column_type,
                pk_column,
                new_value.as_deref(),
                pk_value,
            ))
        }
        RowMutation::Insert { values } => {
            let columns = values
                .keys()
                .map(|name| {
                    let column_type = column_types.get(name).map(String::as_str).unwrap_or("");
                    (name.as_str(), column_type)
                })
                .collect::<Vec<_>>();
            let cells = values.values().map(Option::as_deref).collect::<Vec<_>>();
            Ok(build_insert_query(engine, schema, table, &columns, &cells))
        }
        RowMutation::Delete { pk_value } => {
            Ok(build_delete_query(engine, schema, table, pk_column, pk_value))
        }
        // A full-document replace is a MongoDB-only mutation; no SQL engine can express it.
        RowMutation::Replace { .. } => {
            Err("replace is only supported for MongoDB collections".to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        assemble_columns, build_count_query, build_delete_query, build_insert_query,
        build_mutation, build_rows_query, build_update_query, build_update_query_value, build_url,
        cancel_query, catalog_query, column_types_query, columns_query, constraint_query,
        fold_foreign_keys, fold_indexes, foreign_key_query, group_schema, index_query,
        is_row_returning, is_subquery_wrappable, nullable_query, parse_json_rows, pk_regclass_bind,
        primary_key_query, qualified_table, quote_identifier, schema_query, split_sql_statements,
        structure_columns_query, views_query, with_pool, wrap_columns_probe, wrap_select_as_json,
        wrap_select_as_text, ConnectionConfig, DbEngine, RowMutation, Sort, CANCELS, CANCEL_SENTINEL,
    };
    use std::collections::HashMap;

    // behavior (the full-document Replace mutation is MongoDB-only; the SQL builder must reject it
    // rather than silently emit a wrong statement)
    #[test]
    fn should_reject_a_replace_mutation_on_the_sql_path() {
        let mutation = RowMutation::Replace {
            pk_value: "1".to_string(),
            document: "{}".to_string(),
        };
        let result = build_mutation(
            DbEngine::Postgres,
            None,
            "product",
            "id",
            &HashMap::new(),
            &mutation,
        );
        assert!(result.is_err(), "SQL path must reject Replace");
        assert!(result.unwrap_err().contains("MongoDB"));
    }

    fn cols() -> Vec<String> {
        vec!["id".to_string(), "price".to_string()]
    }

    fn postgres_config() -> ConnectionConfig {
        ConnectionConfig::Postgres {
            host: "localhost".to_string(),
            port: 5432,
            database: "app".to_string(),
            user: "app_user".to_string(),
            password: "app-secret".to_string(),
        }
    }

    fn mysql_config() -> ConnectionConfig {
        ConnectionConfig::Mysql {
            host: "db.internal".to_string(),
            port: 3306,
            database: "admin".to_string(),
            user: "seed_admin".to_string(),
            password: "s3cr3t".to_string(),
        }
    }

    // SQLite carries a single file path (no host/port/user/password). Per the F1 plan the
    // sqlite arm of the config is `{ engine: sqlite, file }`. A spaced path exercises E-4.
    fn sqlite_config() -> ConnectionConfig {
        ConnectionConfig::Sqlite {
            file: "/Users/me/My Data/app.sqlite".to_string(),
        }
    }

    // AC-008, TC-006 - behavior
    #[test]
    fn should_build_a_postgresql_url_when_engine_is_postgres() {
        assert_eq!(
            build_url(&postgres_config()),
            "postgresql://app_user:app-secret@localhost:5432/app"
        );
    }

    // AC-008, TC-006 - behavior
    #[test]
    fn should_build_a_mysql_url_when_engine_is_mysql() {
        assert_eq!(
            build_url(&mysql_config()),
            "mysql://seed_admin:s3cr3t@db.internal:3306/admin"
        );
    }

    // AC-008, E-4, TC-006 - behavior (percent-encode credentials + database)
    #[test]
    fn should_percent_encode_special_chars_in_user_password_and_database() {
        let config = ConnectionConfig::Postgres {
            host: "localhost".to_string(),
            port: 5432,
            database: "my db".to_string(),
            user: "p@ss:w/rd".to_string(),
            password: "p@ss:w/rd".to_string(),
        };

        let url = build_url(&config);

        assert!(
            !url.contains("p@ss:w/rd"),
            "raw special chars must not appear unencoded: {url}"
        );
        assert!(
            url.contains("p%40ss%3Aw%2Frd"),
            "expected encoded credentials in {url}"
        );
        assert!(
            url.contains("my%20db"),
            "expected encoded database in {url}"
        );
    }

    // AC-008, E-5 - behavior (scheme follows the engine)
    #[test]
    fn should_use_the_postgresql_scheme_for_postgres_and_mysql_scheme_for_mysql() {
        assert!(build_url(&postgres_config()).starts_with("postgresql://"));
        assert!(build_url(&mysql_config()).starts_with("mysql://"));
    }

    // AC-009, TC-006 - behavior (Postgres catalog query excludes system schemas)
    #[test]
    fn should_exclude_system_schemas_in_the_postgres_catalog_query() {
        let query = catalog_query(DbEngine::Postgres);
        assert!(
            query.contains("NOT IN ('pg_catalog', 'information_schema')"),
            "Postgres query must exclude system schemas via NOT IN: {query}"
        );
        assert!(
            query.contains("'BASE TABLE'"),
            "Postgres query must restrict to base tables: {query}"
        );
    }

    // AC-009 - behavior (Postgres `name` type must be cast to text for the Any driver)
    #[test]
    fn should_cast_table_name_to_text_in_the_postgres_catalog_query() {
        assert!(
            catalog_query(DbEngine::Postgres).contains("table_name::text"),
            "Postgres returns table_name as the `name` type, which the sqlx Any driver \
             cannot decode; it must be cast to text"
        );
    }

    // AC-009, TC-006 - behavior (MySQL catalog query scopes to the current database)
    #[test]
    fn should_scope_to_the_current_database_in_the_mysql_catalog_query() {
        let query = catalog_query(DbEngine::Mysql);
        assert!(
            query.contains("DATABASE()"),
            "MySQL query must scope to DATABASE(): {query}"
        );
    }

    // AC-009 - behavior (each engine gets a distinct catalog query)
    #[test]
    fn should_return_a_distinct_catalog_query_per_engine() {
        assert_ne!(
            catalog_query(DbEngine::Postgres),
            catalog_query(DbEngine::Mysql)
        );
    }

    // AC-001 - behavior (the Postgres catalog selects (schema, table) ordered by both, so the
    // sidebar can group by schema and qualify each table)
    #[test]
    fn should_select_schema_and_table_in_the_postgres_catalog_query() {
        let query = catalog_query(DbEngine::Postgres);
        assert!(
            query.contains("table_schema::text") && query.contains("table_name::text"),
            "Postgres catalog must return (schema, table), both cast to text: {query}"
        );
        assert!(
            query.contains("ORDER BY table_schema, table_name"),
            "Postgres catalog must order by schema then table: {query}"
        );
    }

    // AC-002 - behavior (MySQL/SQLite catalogs return the bare name only - no schema level)
    #[test]
    fn should_select_only_the_table_name_in_the_mysql_and_sqlite_catalog_queries() {
        assert!(!catalog_query(DbEngine::Mysql).contains("table_schema::text"));
        assert!(!catalog_query(DbEngine::Mysql).contains("ORDER BY table_schema"));
        assert!(!catalog_query(DbEngine::Sqlite).contains("table_schema"));
    }

    // AC-007, E-4 - behavior (qualified_table prefixes the quoted schema for Postgres, leaves a
    // bare quoted name when no schema, and doubles embedded quotes on both parts)
    #[test]
    fn should_qualify_a_table_with_its_schema_when_one_is_known() {
        assert_eq!(
            qualified_table(DbEngine::Postgres, Some("analytics"), "users"),
            "\"analytics\".\"users\""
        );
        assert_eq!(
            qualified_table(DbEngine::Postgres, None, "users"),
            "\"users\""
        );
        assert_eq!(
            qualified_table(DbEngine::Postgres, Some("we\"ird"), "ta\"ble"),
            "\"we\"\"ird\".\"ta\"\"ble\""
        );
    }

    // AC-008 - behavior (no schema -> bare quoted name, per engine quoting)
    #[test]
    fn should_quote_the_bare_table_when_no_schema_is_supplied() {
        assert_eq!(qualified_table(DbEngine::Mysql, None, "users"), "`users`");
        assert_eq!(qualified_table(DbEngine::Sqlite, None, "users"), "\"users\"");
    }

    // AC-007 - behavior (the rows query targets the schema-qualified table when a schema is known)
    #[test]
    fn should_build_a_schema_qualified_rows_query_for_postgres() {
        let query = build_rows_query(
            DbEngine::Postgres,
            Some("analytics"),
            "users",
            &cols(),
            200,
            0,
            None,
            None,
        );
        assert!(
            query.contains("FROM \"analytics\".\"users\""),
            "rows query must target the qualified table: {query}"
        );
    }

    // AC-007 - behavior (count/update/insert/delete all target the schema-qualified table)
    #[test]
    fn should_qualify_the_target_in_count_update_insert_and_delete_for_postgres() {
        assert!(build_count_query(DbEngine::Postgres, Some("s"), "t", None)
            .contains("FROM \"s\".\"t\""));

        let (update, _) =
            build_update_query(DbEngine::Postgres, Some("s"), "t", "c", "int4", "id", "1", "2");
        assert!(update.starts_with("UPDATE \"s\".\"t\" "), "got: {update}");

        let (insert, _) =
            build_insert_query(DbEngine::Postgres, Some("s"), "t", &[("c", "text")], &[Some("v")]);
        assert!(insert.starts_with("INSERT INTO \"s\".\"t\" "), "got: {insert}");

        let (delete, _) = build_delete_query(DbEngine::Postgres, Some("s"), "t", "id", "2");
        assert!(delete.starts_with("DELETE FROM \"s\".\"t\" "), "got: {delete}");
    }

    // AC-007/009 - behavior (the PG primary-key lookup binds the quoted, schema-qualified name so
    // `$1::regclass` resolves the table in the right schema, not via search_path; MySQL/SQLite bind
    // the bare table)
    #[test]
    fn should_bind_the_qualified_name_for_the_postgres_pk_regclass_lookup() {
        assert_eq!(
            pk_regclass_bind(DbEngine::Postgres, Some("analytics"), "users"),
            "\"analytics\".\"users\""
        );
        assert_eq!(
            pk_regclass_bind(DbEngine::Postgres, None, "users"),
            "\"users\""
        );
        assert_eq!(pk_regclass_bind(DbEngine::Mysql, None, "users"), "users");
        assert_eq!(pk_regclass_bind(DbEngine::Sqlite, None, "users"), "users");
    }

    // behavior (identifiers quoted per engine, injection-safe)
    #[test]
    fn should_quote_identifiers_with_double_quotes_for_postgres() {
        assert_eq!(
            quote_identifier(DbEngine::Postgres, "product"),
            "\"product\""
        );
        assert_eq!(
            quote_identifier(DbEngine::Postgres, "we\"ird"),
            "\"we\"\"ird\""
        );
    }

    // behavior (identifiers quoted per engine, injection-safe)
    #[test]
    fn should_quote_identifiers_with_backticks_for_mysql() {
        assert_eq!(quote_identifier(DbEngine::Mysql, "product"), "`product`");
        assert_eq!(quote_identifier(DbEngine::Mysql, "we`ird"), "`we``ird`");
    }

    // behavior (columns query is parameterized + scoped, Postgres `name` cast to text)
    #[test]
    fn should_build_a_parameterized_columns_query_per_engine() {
        let postgres = columns_query(DbEngine::Postgres, false);
        assert!(postgres.contains("column_name::text"));
        assert!(postgres.contains("$1"));
        assert!(postgres.contains("ORDER BY ordinal_position"));

        let mysql = columns_query(DbEngine::Mysql, false);
        assert!(mysql.contains("table_schema = DATABASE()"));
        assert!(mysql.contains('?'));
    }

    // AC-007/008 - behavior (the Postgres introspection query pins to a specific schema via $2 when
    // a schema is known, and falls back to the system-schema exclusion when not; MySQL/SQLite ignore
    // the flag)
    #[test]
    fn should_scope_the_postgres_columns_query_to_a_schema_when_one_is_known() {
        let pinned = columns_query(DbEngine::Postgres, true);
        assert!(
            pinned.contains("table_schema = $2"),
            "schema-pinned PG query must bind the schema as $2: {pinned}"
        );
        assert!(
            !pinned.contains("NOT IN"),
            "schema-pinned PG query must not also exclude system schemas: {pinned}"
        );

        let unpinned = columns_query(DbEngine::Postgres, false);
        assert!(
            unpinned.contains("NOT IN ('pg_catalog', 'information_schema')"),
            "unpinned PG query keeps the system-schema exclusion: {unpinned}"
        );
        assert!(!unpinned.contains("$2"), "unpinned PG query has no $2: {unpinned}");

        // MySQL/SQLite never carry a schema; the flag must not change their query.
        assert_eq!(
            columns_query(DbEngine::Mysql, true),
            columns_query(DbEngine::Mysql, false)
        );
        assert_eq!(
            columns_query(DbEngine::Sqlite, true),
            columns_query(DbEngine::Sqlite, false)
        );
    }

    // behavior (Postgres casts every column to text and applies the limit; no filter -> no WHERE)
    #[test]
    fn should_cast_each_column_to_text_and_limit_for_postgres() {
        let query =
            build_rows_query(DbEngine::Postgres, None, "product", &cols(), 200, 0, None, None);
        assert_eq!(
            query,
            "SELECT \"id\"::text, \"price\"::text FROM \"product\" LIMIT 200"
        );
    }

    // behavior (MySQL casts every column to CHAR and applies the limit; no filter -> no WHERE)
    #[test]
    fn should_cast_each_column_to_char_and_limit_for_mysql() {
        let query =
            build_rows_query(DbEngine::Mysql, None, "product", &cols(), 100, 0, None, None);
        assert_eq!(
            query,
            "SELECT CAST(`id` AS CHAR), CAST(`price` AS CHAR) FROM `product` LIMIT 100"
        );
    }

    // AC-005 - behavior (a raw filter expression is wrapped in parens as a WHERE clause)
    #[test]
    fn should_wrap_a_raw_filter_in_parens_as_a_where_clause() {
        let query = build_rows_query(
            DbEngine::Postgres,
            None,
            "product",
            &cols(),
            200,
            0,
            Some("price > 10"),
            None,
        );
        assert_eq!(
            query,
            "SELECT \"id\"::text, \"price\"::text FROM \"product\" WHERE (price > 10) LIMIT 200"
        );
    }

    // AC-005 - behavior (the parenthesized WHERE sits before LIMIT for MySQL too)
    #[test]
    fn should_place_the_where_before_the_limit_for_mysql() {
        let query = build_rows_query(
            DbEngine::Mysql,
            None,
            "product",
            &cols(),
            50,
            0,
            Some("price > 10"),
            None,
        );
        assert!(
            query.ends_with("WHERE (price > 10) LIMIT 50"),
            "unexpected: {query}"
        );
    }

    // behavior (a blank/whitespace filter is ignored -> no WHERE)
    #[test]
    fn should_ignore_a_blank_filter() {
        let query = build_rows_query(
            DbEngine::Postgres,
            None,
            "product",
            &cols(),
            200,
            0,
            Some("   "),
            None,
        );
        assert!(!query.contains("WHERE"));
    }

    // behavior (count query is COUNT(*) over the table; no filter -> no WHERE)
    #[test]
    fn should_build_a_count_query_without_a_filter() {
        let query = build_count_query(DbEngine::Postgres, None, "product", None);
        assert_eq!(query, "SELECT COUNT(*) FROM \"product\"");
    }

    // behavior (count query wraps the raw filter in parens like the rows query)
    #[test]
    fn should_wrap_the_filter_in_parens_for_the_count_query() {
        let query = build_count_query(DbEngine::Mysql, None, "product", Some("price > 10"));
        assert_eq!(query, "SELECT COUNT(*) FROM `product` WHERE (price > 10)");
    }

    // behavior (a blank filter is ignored in the count query)
    #[test]
    fn should_ignore_a_blank_filter_in_the_count_query() {
        let query = build_count_query(DbEngine::Sqlite, None, "product", Some("  "));
        assert_eq!(query, "SELECT COUNT(*) FROM \"product\"");
    }

    // AC-001 - behavior (a non-zero offset emits OFFSET after LIMIT; offset 0 emits none)
    #[test]
    fn should_append_offset_after_limit_when_offset_is_non_zero() {
        let query =
            build_rows_query(DbEngine::Postgres, None, "product", &cols(), 200, 200, None, None);
        assert_eq!(
            query,
            "SELECT \"id\"::text, \"price\"::text FROM \"product\" LIMIT 200 OFFSET 200"
        );
    }

    // behavior (regression): ORDER BY must reference the table-qualified REAL column, not the bare
    // identifier. The SELECT casts every column to text (`"id"::text`); Postgres preserves the
    // column name through that cast, so a bare `ORDER BY "id"` binds to the TEXT output alias and
    // sorts lexicographically (1, 10, 100, 11, ...). Qualifying with the table forces the original
    // numeric column.
    #[test]
    fn should_order_by_the_table_qualified_column_so_numeric_columns_sort_numerically() {
        let sort = Sort {
            column: "id".to_string(),
            descending: false,
        };
        let query = build_rows_query(
            DbEngine::Postgres,
            Some("public"),
            "users",
            &cols(),
            200,
            0,
            None,
            Some(&sort),
        );
        assert!(
            query.contains("ORDER BY \"public\".\"users\".\"id\""),
            "ORDER BY must qualify the real column, got: {query}"
        );
    }

    // AC-002 - behavior (ORDER BY uses the REAL quoted column, ascending by default, before LIMIT)
    #[test]
    fn should_order_by_the_real_column_ascending_for_postgres() {
        let sort = Sort {
            column: "price".to_string(),
            descending: false,
        };
        let query = build_rows_query(
            DbEngine::Postgres,
            None,
            "product",
            &cols(),
            200,
            0,
            None,
            Some(&sort),
        );
        assert_eq!(
            query,
            "SELECT \"id\"::text, \"price\"::text FROM \"product\" ORDER BY \"product\".\"price\" LIMIT 200"
        );
    }

    // AC-002 - behavior (descending appends DESC)
    #[test]
    fn should_order_by_descending_when_sort_is_descending() {
        let sort = Sort {
            column: "price".to_string(),
            descending: true,
        };
        let query = build_rows_query(
            DbEngine::Mysql,
            None,
            "product",
            &cols(),
            200,
            0,
            None,
            Some(&sort),
        );
        assert!(
            query.contains("ORDER BY `product`.`price` DESC LIMIT 200"),
            "unexpected: {query}"
        );
    }

    // AC-002 - behavior (a sort on an unknown column is ignored, defending against bad input)
    #[test]
    fn should_ignore_a_sort_on_an_unknown_column() {
        let sort = Sort {
            column: "evil; DROP".to_string(),
            descending: false,
        };
        let query = build_rows_query(
            DbEngine::Postgres,
            None,
            "product",
            &cols(),
            200,
            0,
            None,
            Some(&sort),
        );
        assert!(
            !query.contains("ORDER BY"),
            "unknown column must not order: {query}"
        );
    }

    // AC-001, AC-002, AC-005 - behavior (clause order: WHERE, then ORDER BY, then LIMIT, then OFFSET)
    #[test]
    fn should_emit_clauses_in_where_order_limit_offset_order() {
        let sort = Sort {
            column: "id".to_string(),
            descending: true,
        };
        let query = build_rows_query(
            DbEngine::Postgres,
            None,
            "product",
            &cols(),
            200,
            400,
            Some("price > 10"),
            Some(&sort),
        );
        assert_eq!(
            query,
            "SELECT \"id\"::text, \"price\"::text FROM \"product\" \
             WHERE (price > 10) ORDER BY \"product\".\"id\" DESC LIMIT 200 OFFSET 400"
        );
    }

    // AC-004 - behavior (assemble_columns zips names+types+nullable and marks the primary key)
    #[test]
    fn should_assemble_column_metadata_marking_pk_and_nullable() {
        let names = vec!["id".to_string(), "name".to_string()];
        let types = HashMap::from([
            ("id".to_string(), "int4".to_string()),
            ("name".to_string(), "text".to_string()),
        ]);
        let nullable = HashMap::from([("id".to_string(), false), ("name".to_string(), true)]);

        let columns = assemble_columns(&names, &types, &nullable, Some("id"));

        assert_eq!(columns[0].name, "id");
        assert_eq!(columns[0].data_type, "int4");
        assert!(!columns[0].nullable);
        assert!(columns[0].is_primary_key);
        assert_eq!(columns[1].name, "name");
        assert_eq!(columns[1].data_type, "text");
        assert!(columns[1].nullable);
        assert!(!columns[1].is_primary_key);
    }

    // AC-004 - behavior (a missing type/nullable entry degrades gracefully, never panics)
    #[test]
    fn should_default_missing_type_and_nullable_metadata() {
        let names = vec!["mystery".to_string()];
        let columns = assemble_columns(&names, &HashMap::new(), &HashMap::new(), None);
        assert_eq!(columns[0].name, "mystery");
        assert_eq!(columns[0].data_type, "");
        assert!(columns[0].nullable);
        assert!(!columns[0].is_primary_key);
    }

    // AC-004 - behavior (each engine exposes a parameterized nullable query)
    #[test]
    fn should_build_a_parameterized_nullable_query_per_engine() {
        assert!(nullable_query(DbEngine::Postgres, false).contains("is_nullable"));
        assert!(nullable_query(DbEngine::Postgres, false).contains("$1"));
        assert!(nullable_query(DbEngine::Mysql, false).contains("is_nullable"));
        assert!(nullable_query(DbEngine::Mysql, false).contains('?'));
        assert!(nullable_query(DbEngine::Sqlite, false).contains("pragma_table_info"));
        assert!(nullable_query(DbEngine::Sqlite, false).contains("notnull"));
    }

    // behavior (UPDATE casts the value to the column type, matches the pk as text - Postgres)
    #[test]
    fn should_build_a_typed_update_for_postgres() {
        let (sql, binds) = build_update_query(
            DbEngine::Postgres,
            None,
            "product",
            "price",
            "int4",
            "id",
            "1999",
            "abc-uuid",
        );
        assert_eq!(
            sql,
            "UPDATE \"product\" SET \"price\" = $1::int4 WHERE \"id\"::text = $2"
        );
        assert_eq!(binds, vec!["1999".to_string(), "abc-uuid".to_string()]);
    }

    // behavior (UPDATE binds positionally + matches pk as char - MySQL)
    #[test]
    fn should_build_an_update_for_mysql() {
        let (sql, binds) = build_update_query(
            DbEngine::Mysql,
            None,
            "product",
            "price",
            "int",
            "id",
            "1999",
            "7",
        );
        assert_eq!(
            sql,
            "UPDATE `product` SET `price` = ? WHERE CAST(`id` AS CHAR) = ?"
        );
        assert_eq!(binds, vec!["1999".to_string(), "7".to_string()]);
    }

    // behavior (NULL-typed value is sent as a literal NULL, not bound)
    #[test]
    fn should_set_null_literal_when_the_new_value_is_none() {
        let (sql, binds) = build_update_query_value(
            DbEngine::Postgres,
            None,
            "product",
            "deleted_at",
            "timestamptz",
            "id",
            None,
            "1",
        );
        assert_eq!(
            sql,
            "UPDATE \"product\" SET \"deleted_at\" = NULL WHERE \"id\"::text = $1"
        );
        assert_eq!(binds, vec!["1".to_string()]);
    }

    // behavior (pk-detection query is parameterized per engine)
    #[test]
    fn should_build_a_primary_key_query_per_engine() {
        assert!(primary_key_query(DbEngine::Postgres).contains("$1"));
        assert!(primary_key_query(DbEngine::Mysql).contains("DATABASE()"));
        assert!(primary_key_query(DbEngine::Mysql).contains('?'));
    }

    // behavior (a user SELECT is wrapped as a subquery with every column cast to text)
    #[test]
    fn should_wrap_a_select_casting_columns_to_text_for_postgres() {
        let sql = wrap_select_as_text(
            DbEngine::Postgres,
            "SELECT id, price FROM product",
            &["id".to_string(), "price".to_string()],
            200,
        );
        assert_eq!(
            sql,
            "SELECT \"id\"::text, \"price\"::text FROM (SELECT id, price FROM product) AS dbui_q LIMIT 200"
        );
    }

    // behavior (MySQL casts each wrapped column to CHAR)
    #[test]
    fn should_wrap_a_select_casting_columns_to_char_for_mysql() {
        let sql = wrap_select_as_text(
            DbEngine::Mysql,
            "SELECT id FROM product",
            &["id".to_string()],
            50,
        );
        assert_eq!(
            sql,
            "SELECT CAST(`id` AS CHAR) FROM (SELECT id FROM product) AS dbui_q LIMIT 50"
        );
    }

    // behavior (a trailing semicolon is stripped before wrapping so the subquery is valid)
    #[test]
    fn should_strip_a_trailing_semicolon_before_wrapping() {
        let sql = wrap_select_as_text(
            DbEngine::Postgres,
            "SELECT id FROM product;",
            &["id".to_string()],
            200,
        );
        assert!(sql.contains("(SELECT id FROM product) AS dbui_q"));
        assert!(!sql.contains(";)"));
    }

    // behavior (Postgres wraps a row-returning query as row_to_json text so the Any
    // driver never has to decode native column types like timestamp)
    #[test]
    fn should_wrap_a_postgres_select_as_row_to_json_text() {
        let sql = wrap_select_as_json("SELECT * FROM product", 200);
        assert_eq!(
            sql,
            "SELECT row_to_json(dbui_q)::text AS dbui_row FROM (SELECT * FROM product) AS dbui_q LIMIT 200"
        );
    }

    // behavior (the trailing semicolon is stripped so the json subquery stays valid)
    #[test]
    fn should_strip_a_trailing_semicolon_when_wrapping_as_json() {
        let sql = wrap_select_as_json("SELECT * FROM product;", 50);
        assert!(sql.contains("(SELECT * FROM product) AS dbui_q"));
        assert!(!sql.contains(";)"));
    }

    // behavior (the empty-result probe LATERAL-joins the user query to a single base row so
    // its column keys are emitted even when zero rows match)
    #[test]
    fn should_build_a_lateral_column_probe_for_an_empty_result() {
        let sql = wrap_columns_probe("SELECT * FROM email");
        assert!(sql.contains("LEFT JOIN LATERAL (SELECT * FROM email) AS dbui_q ON true"));
        // re-selects dbui_q.* into a derived table so the composite is non-null
        assert!(sql.contains("SELECT dbui_q.* FROM"));
        assert!(sql.contains("row_to_json(dbui_cols)"));
    }

    // behavior (the probe strips a trailing semicolon so the lateral subquery is valid)
    #[test]
    fn should_strip_a_trailing_semicolon_in_the_column_probe() {
        let sql = wrap_columns_probe("SELECT * FROM email;");
        assert!(sql.contains("(SELECT * FROM email) AS dbui_q"));
        assert!(!sql.contains(";)"));
    }

    // behavior (row-returning keywords are detected, write/DDL are not)
    #[test]
    fn should_classify_row_returning_statements() {
        assert!(is_row_returning("SELECT 1"));
        assert!(is_row_returning("  select * from t"));
        assert!(is_row_returning("WITH x AS (SELECT 1) SELECT * FROM x"));
        assert!(is_row_returning("VALUES (1), (2)"));
        assert!(is_row_returning("EXPLAIN SELECT 1"));
        assert!(is_row_returning("SHOW search_path"));
    }

    // behavior (SELECT/WITH/VALUES/TABLE can be subquery-wrapped; EXPLAIN/SHOW cannot)
    #[test]
    fn should_classify_subquery_wrappable_statements() {
        assert!(is_subquery_wrappable("SELECT * FROM product"));
        assert!(is_subquery_wrappable(
            "  with x as (select 1) select * from x"
        ));
        assert!(is_subquery_wrappable("VALUES (1), (2)"));
        assert!(is_subquery_wrappable("TABLE product"));
    }

    // behavior (EXPLAIN/SHOW return rows but must NOT be subquery-wrapped - PG rejects it)
    #[test]
    fn should_not_classify_explain_or_show_as_subquery_wrappable() {
        assert!(!is_subquery_wrappable("EXPLAIN SELECT * FROM product"));
        assert!(!is_subquery_wrappable(
            "explain analyze select * from product"
        ));
        assert!(!is_subquery_wrappable("SHOW search_path"));
        // still row-returning, just not wrappable
        assert!(is_row_returning("EXPLAIN SELECT * FROM product"));
        assert!(is_row_returning("explain analyze select * from product"));
        assert!(is_row_returning("SHOW search_path"));
    }

    // behavior (write/DDL statements are not treated as row-returning)
    #[test]
    fn should_not_classify_writes_as_row_returning() {
        assert!(!is_row_returning("UPDATE product SET price = 1"));
        assert!(!is_row_returning("INSERT INTO product VALUES (1)"));
        assert!(!is_row_returning("DELETE FROM product"));
        assert!(!is_row_returning("CREATE TABLE t (id int)"));
        assert!(!is_row_returning("  vacuum analyze"));
    }

    // behavior (leading line/block comments are skipped before reading the keyword)
    #[test]
    fn should_skip_leading_comments_when_classifying() {
        assert!(is_row_returning("-- a comment\nSELECT 1"));
        assert!(is_row_returning("/* block */ SELECT 1"));
        assert!(!is_row_returning("-- comment\nUPDATE t SET x = 1"));
    }

    // behavior (json rows are parsed into ordered columns; nulls -> None, scalars stringified)
    #[test]
    fn should_parse_json_rows_into_columns_and_cells() {
        let json = vec![
            r#"{"id":1,"name":"Ada","changed_at":null}"#.to_string(),
            r#"{"id":2,"name":"Linus","changed_at":"2026-06-20T13:00:00"}"#.to_string(),
        ];
        let (columns, rows) = parse_json_rows(&json).unwrap();
        assert_eq!(columns, vec!["id", "name", "changed_at"]);
        assert_eq!(
            rows,
            vec![
                vec![Some("1".to_string()), Some("Ada".to_string()), None],
                vec![
                    Some("2".to_string()),
                    Some("Linus".to_string()),
                    Some("2026-06-20T13:00:00".to_string()),
                ],
            ]
        );
    }

    // behavior (an empty result set yields no columns and no rows, not an error)
    #[test]
    fn should_parse_empty_json_rows_as_empty() {
        let (columns, rows) = parse_json_rows(&[]).unwrap();
        assert!(columns.is_empty());
        assert!(rows.is_empty());
    }

    // AC-009, TC-004 - behavior (SQLite URL uses the sqlite scheme and carries the file path)
    #[test]
    fn should_build_a_sqlite_url_from_the_file_path() {
        let url = build_url(&sqlite_config());
        assert!(
            url.starts_with("sqlite:"),
            "SQLite URL must use the sqlite scheme: {url}"
        );
        assert!(
            url.contains("app.sqlite"),
            "SQLite URL must carry the file path: {url}"
        );
    }

    // AC-009, TC-004, E-4 - behavior (a file path with spaces still produces an openable URL)
    #[test]
    fn should_build_a_sqlite_url_for_a_path_with_spaces() {
        let url = build_url(&ConnectionConfig::Sqlite {
            file: "/Users/me/My Data/app.sqlite".to_string(),
        });
        assert!(url.starts_with("sqlite:"), "unexpected scheme: {url}");
        assert!(
            !url.contains(' '),
            "a raw space breaks the connection URL; it must be encoded: {url}"
        );
        // the path is still recoverable (its non-space segments survive)
        assert!(url.contains("My"), "expected the path segments in {url}");
        assert!(url.contains("Data"), "expected the path segments in {url}");
    }

    // AC-004, TC-005 - behavior (SQLite catalog reads sqlite_master, user tables only)
    #[test]
    fn should_read_sqlite_master_excluding_internal_tables_in_the_sqlite_catalog_query() {
        let query = catalog_query(DbEngine::Sqlite);
        assert!(
            query.contains("sqlite_master"),
            "SQLite catalog must read sqlite_master: {query}"
        );
        assert!(
            query.contains("type") && query.contains("'table'"),
            "SQLite catalog must restrict to tables: {query}"
        );
        assert!(
            query.contains("NOT LIKE 'sqlite_%'"),
            "SQLite catalog must exclude internal sqlite_* tables: {query}"
        );
    }

    // AC-009 - behavior (each engine gets a distinct catalog query, sqlite included)
    #[test]
    fn should_return_a_distinct_catalog_query_for_sqlite() {
        assert_ne!(
            catalog_query(DbEngine::Sqlite),
            catalog_query(DbEngine::Postgres)
        );
        assert_ne!(
            catalog_query(DbEngine::Sqlite),
            catalog_query(DbEngine::Mysql)
        );
    }

    // behavior (SQLite quotes identifiers with double quotes, doubling embedded quotes)
    #[test]
    fn should_quote_identifiers_with_double_quotes_for_sqlite() {
        assert_eq!(quote_identifier(DbEngine::Sqlite, "product"), "\"product\"");
        assert_eq!(
            quote_identifier(DbEngine::Sqlite, "we\"ird"),
            "\"we\"\"ird\""
        );
    }

    // AC-009, TC-006 - behavior (columns query is parameterized over pragma_table_info)
    #[test]
    fn should_build_a_parameterized_sqlite_columns_query_over_pragma_table_info() {
        let query = columns_query(DbEngine::Sqlite, false);
        assert!(
            query.contains("pragma_table_info"),
            "SQLite columns query must use pragma_table_info: {query}"
        );
        assert!(
            query.contains('?'),
            "SQLite columns query must be parameterized: {query}"
        );
    }

    // AC-009, TC-006 - behavior (column-types query is parameterized over pragma_table_info)
    #[test]
    fn should_build_a_parameterized_sqlite_column_types_query_over_pragma_table_info() {
        let query = column_types_query(DbEngine::Sqlite, false);
        assert!(
            query.contains("pragma_table_info"),
            "SQLite column-types query must use pragma_table_info: {query}"
        );
        assert!(
            query.contains("type"),
            "SQLite column-types query must read the type: {query}"
        );
        assert!(
            query.contains('?'),
            "SQLite column-types query must be parameterized: {query}"
        );
    }

    // AC-009, TC-006 - behavior (primary-key query is parameterized over pragma_table_info, pk>0)
    #[test]
    fn should_build_a_parameterized_sqlite_primary_key_query_over_pragma_table_info() {
        let query = primary_key_query(DbEngine::Sqlite);
        assert!(
            query.contains("pragma_table_info"),
            "SQLite pk query must use pragma_table_info: {query}"
        );
        assert!(
            query.contains("pk"),
            "SQLite pk query must filter on the pk column: {query}"
        );
        assert!(
            query.contains('?'),
            "SQLite pk query must be parameterized: {query}"
        );
    }

    // AC-005, TC-007 - behavior (SQLite casts every column to TEXT, applies the limit, double-quotes)
    #[test]
    fn should_cast_each_column_to_text_and_limit_for_sqlite() {
        let query =
            build_rows_query(DbEngine::Sqlite, None, "product", &cols(), 200, 0, None, None);
        assert_eq!(
            query,
            "SELECT CAST(\"id\" AS TEXT), CAST(\"price\" AS TEXT) FROM \"product\" LIMIT 200"
        );
    }

    // AC-002 - behavior (SQLite orders by the double-quoted real column)
    #[test]
    fn should_order_by_the_real_column_for_sqlite() {
        let sort = Sort {
            column: "price".to_string(),
            descending: false,
        };
        let query = build_rows_query(
            DbEngine::Sqlite,
            None,
            "product",
            &cols(),
            200,
            0,
            None,
            Some(&sort),
        );
        assert!(
            query.contains("ORDER BY \"product\".\"price\" LIMIT 200"),
            "unexpected: {query}"
        );
    }

    // AC-006, TC-008 - behavior (SQLite UPDATE binds the value plainly with ?, matches pk as text)
    #[test]
    fn should_build_an_update_for_sqlite() {
        let (sql, binds) = build_update_query(
            DbEngine::Sqlite,
            None,
            "product",
            "price",
            "INTEGER",
            "id",
            "1999",
            "7",
        );
        assert_eq!(
            sql,
            "UPDATE \"product\" SET \"price\" = ? WHERE CAST(\"id\" AS TEXT) = ?"
        );
        assert_eq!(binds, vec!["1999".to_string(), "7".to_string()]);
    }

    // AC-006, TC-008 - behavior (a None value becomes a NULL literal, not a bind, for SQLite)
    #[test]
    fn should_set_null_literal_when_the_new_value_is_none_for_sqlite() {
        let (sql, binds) = build_update_query_value(
            DbEngine::Sqlite,
            None,
            "product",
            "deleted_at",
            "TEXT",
            "id",
            None,
            "1",
        );
        assert_eq!(
            sql,
            "UPDATE \"product\" SET \"deleted_at\" = NULL WHERE CAST(\"id\" AS TEXT) = ?"
        );
        assert_eq!(binds, vec!["1".to_string()]);
    }

    // AC-007, TC-009 - behavior (SQLite reuses the shared keyword classifier for run_query)
    #[test]
    fn should_classify_sqlite_statements_with_the_shared_row_returning_classifier() {
        assert!(is_row_returning("SELECT * FROM product"));
        assert!(is_row_returning("  values (1), (2)"));
        assert!(!is_row_returning("UPDATE product SET price = 1"));
        assert!(!is_row_returning("CREATE TABLE t (id integer)"));
    }

    // AC-007, TC-009 - behavior (SQLite wraps a row-returning query casting each column to TEXT)
    #[test]
    fn should_wrap_a_select_casting_columns_to_text_for_sqlite() {
        let sql = wrap_select_as_text(
            DbEngine::Sqlite,
            "SELECT id, price FROM product",
            &["id".to_string(), "price".to_string()],
            200,
        );
        assert_eq!(
            sql,
            "SELECT CAST(\"id\" AS TEXT), CAST(\"price\" AS TEXT) FROM (SELECT id, price FROM product) AS dbui_q LIMIT 200"
        );
    }

    // F3 row-mutation builders. `build_insert_query` takes the ordered set columns as
    // (column_name, column_type) and their parallel values; only the columns the user set are
    // listed. `build_delete_query` takes (engine, table, pk_column, pk_value). Both return
    // (sql, ordered binds), mirroring `build_update_query_value`'s engine matrix (PG `$n::type`
    // + `pk::text`; MySQL/SQLite `?` + `CAST(... AS CHAR/TEXT)`).

    // AC-006, TC-007 - behavior (Postgres INSERT lists only set columns and casts each value)
    #[test]
    fn should_build_a_typed_insert_for_postgres_when_some_columns_are_set() {
        let (sql, binds) = build_insert_query(
            DbEngine::Postgres,
            None,
            "users",
            &[("name", "text"), ("email", "text")],
            &[Some("Dee"), Some("dee@example.com")],
        );
        assert_eq!(
            sql,
            "INSERT INTO \"users\" (\"name\", \"email\") VALUES ($1::text, $2::text)"
        );
        assert_eq!(
            binds,
            vec!["Dee".to_string(), "dee@example.com".to_string()]
        );
    }

    // AC-006, TC-007 - behavior (MySQL INSERT binds positionally with ?, no casts)
    #[test]
    fn should_build_an_insert_binding_positionally_for_mysql() {
        let (sql, binds) = build_insert_query(
            DbEngine::Mysql,
            None,
            "users",
            &[("name", "varchar"), ("email", "varchar")],
            &[Some("Dee"), Some("dee@example.com")],
        );
        assert_eq!(sql, "INSERT INTO `users` (`name`, `email`) VALUES (?, ?)");
        assert_eq!(
            binds,
            vec!["Dee".to_string(), "dee@example.com".to_string()]
        );
    }

    // AC-006, TC-007 - behavior (SQLite INSERT binds plainly with ?)
    #[test]
    fn should_build_an_insert_binding_positionally_for_sqlite() {
        let (sql, binds) = build_insert_query(
            DbEngine::Sqlite,
            None,
            "users",
            &[("name", "TEXT")],
            &[Some("Dee")],
        );
        assert_eq!(sql, "INSERT INTO \"users\" (\"name\") VALUES (?)");
        assert_eq!(binds, vec!["Dee".to_string()]);
    }

    // AC-006 - behavior (a NULL value goes in as a literal NULL, not a bind, like the update path)
    #[test]
    fn should_emit_a_null_literal_for_an_unset_value_in_an_insert() {
        let (sql, binds) = build_insert_query(
            DbEngine::Postgres,
            None,
            "users",
            &[("name", "text"), ("note", "text")],
            &[Some("Dee"), None],
        );
        assert_eq!(
            sql,
            "INSERT INTO \"users\" (\"name\", \"note\") VALUES ($1::text, NULL)"
        );
        assert_eq!(binds, vec!["Dee".to_string()]);
    }

    // AC-007, TC-009 - behavior (Postgres DELETE matches the pk as text)
    #[test]
    fn should_build_a_delete_matching_the_pk_as_text_for_postgres() {
        let (sql, binds) = build_delete_query(DbEngine::Postgres, None, "users", "id", "2");
        assert_eq!(sql, "DELETE FROM \"users\" WHERE \"id\"::text = $1");
        assert_eq!(binds, vec!["2".to_string()]);
    }

    // AC-007, TC-009 - behavior (MySQL DELETE casts the pk to CHAR)
    #[test]
    fn should_build_a_delete_casting_the_pk_to_char_for_mysql() {
        let (sql, binds) = build_delete_query(DbEngine::Mysql, None, "users", "id", "2");
        assert_eq!(sql, "DELETE FROM `users` WHERE CAST(`id` AS CHAR) = ?");
        assert_eq!(binds, vec!["2".to_string()]);
    }

    // AC-007, TC-009 - behavior (SQLite DELETE casts the pk to TEXT)
    #[test]
    fn should_build_a_delete_casting_the_pk_to_text_for_sqlite() {
        let (sql, binds) = build_delete_query(DbEngine::Sqlite, None, "users", "id", "2");
        assert_eq!(sql, "DELETE FROM \"users\" WHERE CAST(\"id\" AS TEXT) = ?");
        assert_eq!(binds, vec!["2".to_string()]);
    }

    // AC-006, TC-010 - behavior (one schema query yields table/column/type per engine,
    // PG/MySQL via information_schema filtering system schemas, SQLite via sqlite_master
    // joined with pragma_table_info; ordered so grouping keeps columns in declaration order)
    #[test]
    fn should_build_a_schema_query_per_engine_yielding_table_column_type() {
        let postgres = schema_query(DbEngine::Postgres);
        assert!(
            postgres.contains("information_schema.columns"),
            "Postgres schema query must read information_schema.columns: {postgres}"
        );
        assert!(
            postgres.contains("NOT IN ('pg_catalog', 'information_schema')"),
            "Postgres schema query must exclude system schemas: {postgres}"
        );
        assert!(
            postgres.contains("table_schema"),
            "Postgres schema query must select table_schema so autocomplete can disambiguate \
             same-named tables across schemas: {postgres}"
        );
        assert!(
            postgres.contains("::text"),
            "Postgres schema query must cast name columns to text for the Any driver: {postgres}"
        );
        assert!(
            postgres.contains("ordinal_position"),
            "Postgres schema query must order columns by ordinal_position: {postgres}"
        );

        let mysql = schema_query(DbEngine::Mysql);
        assert!(
            mysql.contains("information_schema.columns"),
            "MySQL schema query must read information_schema.columns: {mysql}"
        );
        assert!(
            mysql.contains("DATABASE()"),
            "MySQL schema query must scope to the current DATABASE(): {mysql}"
        );
        assert!(
            mysql.contains("ordinal_position"),
            "MySQL schema query must order columns by ordinal_position: {mysql}"
        );

        let sqlite = schema_query(DbEngine::Sqlite);
        assert!(
            sqlite.contains("sqlite_master"),
            "SQLite schema query must read sqlite_master for tables: {sqlite}"
        );
        assert!(
            sqlite.contains("pragma_table_info"),
            "SQLite schema query must read pragma_table_info for columns: {sqlite}"
        );
        assert!(
            sqlite.contains("'table'"),
            "SQLite schema query must restrict sqlite_master to tables: {sqlite}"
        );
    }

    // AC-006, TC-010 - behavior (each engine gets a distinct schema query)
    #[test]
    fn should_return_a_distinct_schema_query_per_engine() {
        assert_ne!(
            schema_query(DbEngine::Postgres),
            schema_query(DbEngine::Mysql)
        );
        assert_ne!(
            schema_query(DbEngine::Postgres),
            schema_query(DbEngine::Sqlite)
        );
    }

    // AC-006, TC-010 - behavior (flat ordered rows fold into one entry per (schema, table),
    // columns kept in arrival order; the schema is stamped onto each entry)
    #[test]
    fn should_group_schema_rows_into_one_entry_per_table_preserving_column_order() {
        let rows = vec![
            (Some("public".into()), "users".into(), "id".into(), "int4".into()),
            (Some("public".into()), "users".into(), "email".into(), "text".into()),
            (Some("public".into()), "orders".into(), "id".into(), "int8".into()),
        ];

        let grouped = group_schema(rows);

        assert_eq!(grouped.len(), 2);
        assert_eq!(grouped[0].schema.as_deref(), Some("public"));
        assert_eq!(grouped[0].name, "users");
        let user_columns: Vec<&str> = grouped[0].columns.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(user_columns, vec!["id", "email"]);
        assert_eq!(grouped[0].columns[0].data_type, "int4");
        assert_eq!(grouped[1].name, "orders");
        assert_eq!(grouped[1].columns.len(), 1);
    }

    // AC-009, AC-011 - behavior (two tables that share a name in different schemas fold into TWO
    // distinct entries, not one - the group key is (schema, table), not table alone)
    #[test]
    fn should_keep_same_named_tables_in_different_schemas_distinct() {
        let rows = vec![
            (Some("public".into()), "users".into(), "id".into(), "int4".into()),
            (Some("analytics".into()), "users".into(), "id".into(), "int8".into()),
        ];

        let grouped = group_schema(rows);

        assert_eq!(grouped.len(), 2);
        assert_eq!(grouped[0].schema.as_deref(), Some("public"));
        assert_eq!(grouped[1].schema.as_deref(), Some("analytics"));
        assert_eq!(grouped[0].name, "users");
        assert_eq!(grouped[1].name, "users");
    }

    // AC-002 - behavior (MySQL/SQLite rows carry no schema -> the entry's schema is None)
    #[test]
    fn should_leave_schema_none_when_grouping_rows_without_a_schema() {
        let rows = vec![(None, "products".into(), "sku".into(), "text".into())];
        let grouped = group_schema(rows);
        assert_eq!(grouped.len(), 1);
        assert_eq!(grouped[0].schema, None);
        assert_eq!(grouped[0].name, "products");
    }

    // AC-006 - behavior (empty input yields no tables, no panic)
    #[test]
    fn should_group_an_empty_schema_into_no_tables() {
        assert!(group_schema(Vec::new()).is_empty());
    }

    // ----- F5: statement splitter (AC-005, TC-001..006) -----

    // TC-001, AC-005 - behavior (a top-level `;` splits a buffer into ordered statements,
    // each trimmed of surrounding whitespace)
    #[test]
    fn should_split_two_statements_on_a_top_level_semicolon() {
        assert_eq!(
            split_sql_statements("SELECT 1; SELECT 2"),
            vec!["SELECT 1".to_string(), "SELECT 2".to_string()]
        );
    }

    // TC-002, AC-005 - behavior (a `;` inside a single-quoted string literal is not a split point)
    #[test]
    fn should_not_split_on_a_semicolon_inside_a_single_quoted_string() {
        assert_eq!(
            split_sql_statements("SELECT 'a;b'"),
            vec!["SELECT 'a;b'".to_string()]
        );
    }

    // TC-003, AC-005 - behavior (a `;` inside a double-quoted identifier is not a split point)
    #[test]
    fn should_not_split_on_a_semicolon_inside_a_double_quoted_identifier() {
        assert_eq!(
            split_sql_statements("SELECT \"a;b\" FROM t"),
            vec!["SELECT \"a;b\" FROM t".to_string()]
        );
    }

    // TC-003, AC-005 - behavior (a `;` inside a backtick-quoted identifier is not a split point)
    #[test]
    fn should_not_split_on_a_semicolon_inside_a_backtick_identifier() {
        assert_eq!(
            split_sql_statements("SELECT `a;b` FROM t"),
            vec!["SELECT `a;b` FROM t".to_string()]
        );
    }

    // TC-004, AC-005 - behavior (a `;` inside a `--` line comment is not a split point)
    #[test]
    fn should_not_split_on_a_semicolon_inside_a_line_comment() {
        assert_eq!(
            split_sql_statements("SELECT 1 -- a;b\nFROM t"),
            vec!["SELECT 1 -- a;b\nFROM t".to_string()]
        );
    }

    // TC-004, AC-005 - behavior (a `;` inside a `/* */` block comment is not a split point)
    #[test]
    fn should_not_split_on_a_semicolon_inside_a_block_comment() {
        assert_eq!(
            split_sql_statements("SELECT 1 /* ; */ FROM t"),
            vec!["SELECT 1 /* ; */ FROM t".to_string()]
        );
    }

    // TC-005, AC-005 - behavior (a `;` inside a Postgres `$$ ... $$` dollar-quote is not a split
    // point - a function body with semicolons stays one statement)
    #[test]
    fn should_not_split_on_a_semicolon_inside_an_anonymous_dollar_quote() {
        let body = "DO $$ BEGIN PERFORM 1; PERFORM 2; END $$";
        assert_eq!(split_sql_statements(body), vec![body.to_string()]);
    }

    // TC-005, AC-005 - behavior (a `;` inside a tagged `$x$ ... $x$` dollar-quote is not a split
    // point; a `;` after the closing tag still splits)
    #[test]
    fn should_not_split_inside_a_tagged_dollar_quote_but_split_after_it() {
        let sql = "CREATE FUNCTION f() RETURNS int AS $x$ BEGIN RETURN 1; END $x$ LANGUAGE plpgsql; SELECT 2";
        assert_eq!(
            split_sql_statements(sql),
            vec![
                "CREATE FUNCTION f() RETURNS int AS $x$ BEGIN RETURN 1; END $x$ LANGUAGE plpgsql"
                    .to_string(),
                "SELECT 2".to_string(),
            ]
        );
    }

    // TC-006, AC-005 - behavior (a trailing `;` produces no empty final statement)
    #[test]
    fn should_drop_an_empty_final_statement_after_a_trailing_semicolon() {
        assert_eq!(
            split_sql_statements("SELECT 1;"),
            vec!["SELECT 1".to_string()]
        );
    }

    // TC-006, AC-005 - behavior (a buffer of only `;;` yields zero statements)
    #[test]
    fn should_yield_no_statements_for_only_semicolons() {
        assert!(split_sql_statements(";;").is_empty());
    }

    // TC-006, AC-005 - behavior (a whitespace/comment-only buffer yields zero statements)
    #[test]
    fn should_yield_no_statements_for_whitespace_or_comment_only_input() {
        assert!(split_sql_statements("   \n  ").is_empty());
        assert!(split_sql_statements("-- just a comment\n").is_empty());
        assert!(split_sql_statements("/* only a block comment */").is_empty());
    }

    // ----- F5: held-pool registry (AC-003, TC-010) -----

    // TC-010, AC-003 - side-effect-contract (looking up a pool for an id that was never stored
    // returns the not-connected error, never a panic; the Err branch needs no live DB)
    #[test]
    fn should_return_a_not_connected_error_when_no_pool_is_held_for_the_id() {
        let result = with_pool("missing-connection-id");
        assert!(
            result.is_err(),
            "an unknown connection id must return Err, not a pool"
        );
        let message = result.err().unwrap().to_lowercase();
        assert!(
            message.contains("not connected") || message.contains("no connection"),
            "expected a clear not-connected error, got: {message}"
        );
    }

    // ----- F5: cancel registry (AC-007, TC-008/009) -----

    // TC-008, AC-007 - side-effect-contract (a concurrent cancel of a slow run resolves to the
    // cancel sentinel and the request id is removed from the registry; races a slow future, not a
    // real DB). Mirrors requi's cancel test: register a token + guard, select! against the slow
    // future, fire cancel concurrently.
    #[tokio::test]
    async fn should_resolve_to_the_cancel_sentinel_and_clean_up_the_registry_when_cancelled() {
        use std::time::Duration;
        use tokio_util::sync::CancellationToken;

        let request_id = "f5-cancel".to_string();

        // The same select! cancel shape used by the production execute path, standing in for a
        // slow query with a sleep since there is no live DB.
        let run = {
            let request_id = request_id.clone();
            async move {
                let token = CancellationToken::new();
                CANCELS
                    .lock()
                    .unwrap()
                    .insert(request_id.clone(), token.clone());
                let _guard = super::CancelGuard {
                    request_id: request_id.clone(),
                };
                let outcome: Result<(), String> = tokio::select! {
                    biased;
                    _ = token.cancelled() => Err(CANCEL_SENTINEL.to_string()),
                    _ = tokio::time::sleep(Duration::from_secs(30)) => Ok(()),
                };
                outcome
            }
        };

        let handle = tokio::spawn(run);
        // Give the run a moment to register its token, then cancel it by id.
        tokio::time::sleep(Duration::from_millis(50)).await;
        cancel_query(request_id.clone()).await;

        let result = handle.await.expect("the run task should not panic");
        match result {
            Err(error) => assert_eq!(error, CANCEL_SENTINEL),
            Ok(_) => panic!("a cancelled run must not resolve to Ok"),
        }
        assert!(
            !CANCELS.lock().unwrap().contains_key(&request_id),
            "the request id must be removed from the registry after cancel"
        );
    }

    // TC-009, AC-007 - behavior (cancel for an unknown request id is a no-op: no panic, no error)
    #[tokio::test]
    async fn should_be_a_no_op_when_cancelling_an_unknown_request_id() {
        cancel_query("never-registered".to_string()).await;
        assert!(!CANCELS.lock().unwrap().contains_key("never-registered"));
    }

    // behavior (the frontend sends camelCase mutation fields; serde must accept pkValue/newValue)
    #[test]
    fn should_deserialize_a_cell_mutation_from_the_camel_case_payload_the_frontend_sends() {
        let raw = r#"{"kind":"cell","column":"balance","pkValue":"1","newValue":"23"}"#;
        let mutation: RowMutation =
            serde_json::from_str(raw).expect("a camelCase cell mutation must deserialize");
        match mutation {
            RowMutation::Cell {
                column,
                pk_value,
                new_value,
            } => {
                assert_eq!(column, "balance");
                assert_eq!(pk_value, "1");
                assert_eq!(new_value, Some("23".to_string()));
            }
            other => panic!("expected a Cell mutation, got {other:?}"),
        }
    }

    // behavior (a delete mutation also carries pkValue in camelCase)
    #[test]
    fn should_deserialize_a_delete_mutation_from_the_camel_case_payload_the_frontend_sends() {
        let raw = r#"{"kind":"delete","pkValue":"7"}"#;
        let mutation: RowMutation =
            serde_json::from_str(raw).expect("a camelCase delete mutation must deserialize");
        match mutation {
            RowMutation::Delete { pk_value } => assert_eq!(pk_value, "7"),
            other => panic!("expected a Delete mutation, got {other:?}"),
        }
    }

    // ----- F6: schema browser query builders (AC-001..004, AC-007, TC-006) -----

    // AC-001, TC-006 - behavior (the structure columns query returns full column metadata and, for
    // Postgres, binds the table as $1 while ordering by ordinal position)
    #[test]
    fn should_build_a_structure_columns_query_returning_full_metadata_for_postgres() {
        let unpinned = structure_columns_query(DbEngine::Postgres, false);
        assert!(
            unpinned.contains("information_schema.columns"),
            "PG structure columns query must read information_schema.columns: {unpinned}"
        );
        assert!(
            unpinned.contains("$1"),
            "PG structure columns query must bind the table as $1: {unpinned}"
        );
        assert!(
            unpinned.contains("ordinal_position"),
            "PG structure columns query must order by ordinal_position: {unpinned}"
        );
        assert!(
            unpinned.contains("NOT IN ('pg_catalog', 'information_schema')"),
            "unpinned PG structure columns query keeps the system-schema exclusion: {unpinned}"
        );
        assert!(
            !unpinned.contains("$2"),
            "unpinned PG structure columns query has no $2: {unpinned}"
        );
    }

    // AC-001, E-3, TC-006 - behavior (Postgres schema-pinned form binds $2 and drops the
    // system-schema exclusion, exactly like columns_query/postgres_table_scope)
    #[test]
    fn should_pin_the_postgres_structure_columns_query_to_a_schema_when_one_is_known() {
        let pinned = structure_columns_query(DbEngine::Postgres, true);
        assert!(
            pinned.contains("table_schema = $2"),
            "schema-pinned PG structure columns query must bind the schema as $2: {pinned}"
        );
        assert!(
            !pinned.contains("NOT IN"),
            "schema-pinned PG structure columns query must not also exclude system schemas: {pinned}"
        );
    }

    // AC-001, TC-006 - behavior (MySQL structure columns scope to DATABASE() and bind the table)
    #[test]
    fn should_scope_the_mysql_structure_columns_query_to_the_current_database() {
        let query = structure_columns_query(DbEngine::Mysql, false);
        assert!(
            query.contains("DATABASE()"),
            "MySQL structure columns query must scope to DATABASE(): {query}"
        );
        assert!(
            query.contains('?'),
            "MySQL structure columns query must be parameterized: {query}"
        );
        // MySQL never carries a schema; the flag must not change the query.
        assert_eq!(
            structure_columns_query(DbEngine::Mysql, true),
            structure_columns_query(DbEngine::Mysql, false)
        );
    }

    // AC-001, TC-004, TC-006 - behavior (SQLite structure columns read pragma_table_info, exposing
    // the default value via dflt_value)
    #[test]
    fn should_build_the_sqlite_structure_columns_query_over_pragma_table_info() {
        let query = structure_columns_query(DbEngine::Sqlite, false);
        assert!(
            query.contains("pragma_table_info"),
            "SQLite structure columns query must use pragma_table_info: {query}"
        );
        assert!(
            query.contains("dflt_value"),
            "SQLite structure columns query must read the default (dflt_value): {query}"
        );
        assert!(
            query.contains('?'),
            "SQLite structure columns query must be parameterized: {query}"
        );
    }

    // AC-002, TC-006 - behavior (Postgres index query reads pg_index/pg_class and exposes the
    // unique flag)
    #[test]
    fn should_build_the_postgres_index_query_over_pg_index_and_pg_class() {
        let query = index_query(DbEngine::Postgres, false);
        assert!(
            query.contains("pg_index"),
            "PG index query must read pg_index: {query}"
        );
        assert!(
            query.contains("pg_class"),
            "PG index query must join pg_class: {query}"
        );
        assert!(
            query.contains("indisunique"),
            "PG index query must expose the unique flag (indisunique): {query}"
        );
    }

    // AC-002, TC-006 - behavior (MySQL index query reads information_schema.statistics)
    #[test]
    fn should_build_the_mysql_index_query_over_information_schema_statistics() {
        let query = index_query(DbEngine::Mysql, false);
        assert!(
            query.contains("information_schema.statistics"),
            "MySQL index query must read information_schema.statistics: {query}"
        );
        assert!(
            query.contains("DATABASE()"),
            "MySQL index query must scope to DATABASE(): {query}"
        );
        assert!(
            query.contains('?'),
            "MySQL index query must be parameterized: {query}"
        );
    }

    // AC-002, TC-004, TC-006 - behavior (SQLite index query uses the pragma index list)
    #[test]
    fn should_build_the_sqlite_index_query_over_pragma_index_list() {
        let query = index_query(DbEngine::Sqlite, false);
        assert!(
            query.contains("pragma_index_list"),
            "SQLite index query must use pragma_index_list: {query}"
        );
        assert!(
            query.contains('?'),
            "SQLite index query must be parameterized: {query}"
        );
    }

    // AC-003, TC-006 - behavior (Postgres FK query reads the information_schema referential/key
    // usage views and returns the referenced table)
    #[test]
    fn should_build_the_postgres_foreign_key_query_over_information_schema() {
        let query = foreign_key_query(DbEngine::Postgres, false);
        assert!(
            query.contains("referential_constraints"),
            "PG FK query must read referential_constraints: {query}"
        );
        assert!(
            query.contains("key_column_usage"),
            "PG FK query must read key_column_usage: {query}"
        );
        assert!(
            query.contains("$1"),
            "PG FK query must bind the table as $1: {query}"
        );
        assert!(
            query.contains("ccu.table_schema"),
            "PG FK query must select the referenced schema: {query}"
        );
        // A composite FK must NOT fan out into a cartesian product. Joining the referenced side via
        // constraint_column_usage keyed only on constraint_name pairs every local column with every
        // referenced column (2-col FK -> 4 rows). Correlate the referenced column by position instead.
        assert!(
            !query.contains("constraint_column_usage"),
            "PG FK query must not use constraint_column_usage (cartesian for composite FKs): {query}"
        );
        assert!(
            query.contains("position_in_unique_constraint"),
            "PG FK query must correlate the referenced column by position_in_unique_constraint: {query}"
        );
    }

    // AC-003, E-3 - behavior (Postgres FK query pins to $2 when a schema is known and drops the
    // system-schema exclusion)
    #[test]
    fn should_pin_the_postgres_foreign_key_query_to_a_schema_when_one_is_known() {
        let pinned = foreign_key_query(DbEngine::Postgres, true);
        assert!(
            pinned.contains("$2"),
            "schema-pinned PG FK query must bind the schema as $2: {pinned}"
        );
        assert!(
            !pinned.contains("NOT IN"),
            "schema-pinned PG FK query must not also exclude system schemas: {pinned}"
        );
    }

    // AC-003, TC-006 - behavior (MySQL FK query reads the referential/key usage views scoped to the
    // current database)
    #[test]
    fn should_build_the_mysql_foreign_key_query_over_information_schema() {
        let query = foreign_key_query(DbEngine::Mysql, false);
        assert!(
            query.contains("key_column_usage"),
            "MySQL FK query must read key_column_usage: {query}"
        );
        assert!(
            query.contains("DATABASE()"),
            "MySQL FK query must scope to DATABASE(): {query}"
        );
        assert!(
            query.contains('?'),
            "MySQL FK query must be parameterized: {query}"
        );
        assert!(
            query.contains("referenced_schema"),
            "MySQL FK query must select a (null) referenced_schema column: {query}"
        );
    }

    // AC-003, TC-004, TC-006 - behavior (SQLite FK query uses pragma_foreign_key_list)
    #[test]
    fn should_build_the_sqlite_foreign_key_query_over_pragma_foreign_key_list() {
        let query = foreign_key_query(DbEngine::Sqlite, false);
        assert!(
            query.contains("pragma_foreign_key_list"),
            "SQLite FK query must use pragma_foreign_key_list: {query}"
        );
        assert!(
            query.contains('?'),
            "SQLite FK query must be parameterized: {query}"
        );
        assert!(
            query.contains("referenced_schema"),
            "SQLite FK query must select a (null) referenced_schema column: {query}"
        );
    }

    // AC-004, TC-006 - behavior (Postgres constraint query returns named check + unique constraints
    // via information_schema.table_constraints)
    #[test]
    fn should_build_the_postgres_constraint_query_for_check_and_unique() {
        let query = constraint_query(DbEngine::Postgres, false);
        assert!(
            query.contains("table_constraints"),
            "PG constraint query must read table_constraints: {query}"
        );
        assert!(
            query.contains("CHECK") && query.contains("UNIQUE"),
            "PG constraint query must cover both CHECK and UNIQUE constraints: {query}"
        );
        assert!(
            query.contains("$1"),
            "PG constraint query must bind the table as $1: {query}"
        );
    }

    // AC-004, TC-006 - behavior (MySQL constraint query scopes to DATABASE() and is parameterized)
    #[test]
    fn should_build_the_mysql_constraint_query_scoped_to_the_current_database() {
        let query = constraint_query(DbEngine::Mysql, false);
        assert!(
            query.contains("DATABASE()"),
            "MySQL constraint query must scope to DATABASE(): {query}"
        );
        assert!(
            query.contains('?'),
            "MySQL constraint query must be parameterized: {query}"
        );
    }

    // AC-004, E-4, TC-004, TC-006 - behavior (SQLite exposes only UNIQUE constraints via
    // pragma_index_list where origin='u'; check constraints live only in DDL text -> omitted)
    #[test]
    fn should_build_the_sqlite_constraint_query_reading_unique_indexes_only() {
        let query = constraint_query(DbEngine::Sqlite, false);
        assert!(
            query.contains("pragma_index_list"),
            "SQLite constraint query must read pragma_index_list: {query}"
        );
        assert!(
            query.contains("'u'"),
            "SQLite constraint query must select origin='u' unique constraints: {query}"
        );
        assert!(
            query.contains('?'),
            "SQLite constraint query must be parameterized: {query}"
        );
    }

    // AC-007, TC-003, TC-006 - behavior (the views catalog filters table_type='VIEW' for PG/MySQL,
    // sibling of catalog_query which filters 'BASE TABLE')
    #[test]
    fn should_filter_views_by_view_table_type_for_postgres_and_mysql() {
        let postgres = views_query(DbEngine::Postgres);
        assert!(
            postgres.contains("information_schema.views") || postgres.contains("'VIEW'"),
            "PG views query must select views (table_type='VIEW' or information_schema.views): {postgres}"
        );

        let mysql = views_query(DbEngine::Mysql);
        assert!(
            mysql.contains("'VIEW'") || mysql.contains("information_schema.views"),
            "MySQL views query must select views: {mysql}"
        );
        assert!(
            mysql.contains("DATABASE()"),
            "MySQL views query must scope to DATABASE(): {mysql}"
        );
    }

    // AC-007, TC-003, TC-006 - behavior (SQLite views come from sqlite_master type='view')
    #[test]
    fn should_filter_views_by_view_type_in_the_sqlite_views_query() {
        let query = views_query(DbEngine::Sqlite);
        assert!(
            query.contains("sqlite_master"),
            "SQLite views query must read sqlite_master: {query}"
        );
        assert!(
            query.contains("'view'"),
            "SQLite views query must filter type='view': {query}"
        );
    }

    // AC-007 - behavior (each engine gets a distinct views query, and it is not the table catalog)
    #[test]
    fn should_return_a_distinct_views_query_per_engine_that_differs_from_the_table_catalog() {
        assert_ne!(views_query(DbEngine::Postgres), views_query(DbEngine::Mysql));
        assert_ne!(views_query(DbEngine::Postgres), views_query(DbEngine::Sqlite));
        assert_ne!(
            views_query(DbEngine::Postgres),
            catalog_query(DbEngine::Postgres)
        );
        assert_ne!(views_query(DbEngine::Sqlite), catalog_query(DbEngine::Sqlite));
    }

    fn s(text: &str) -> String {
        text.to_string()
    }

    // AC-005, E-2 - behavior (one-row-per-column index metadata folds into grouped IndexInfos with
    // columns in row order and first-seen index order preserved)
    #[test]
    fn should_fold_composite_index_rows_into_one_index_with_ordered_columns() {
        let rows = vec![
            (s("pk_users"), s("id"), true, true),
            (s("users_name_email_idx"), s("name"), false, false),
            (s("users_name_email_idx"), s("email"), false, false),
        ];
        let indexes = fold_indexes(&rows);
        assert_eq!(indexes.len(), 2);
        assert_eq!(indexes[0].name, "pk_users");
        assert!(indexes[0].is_primary && indexes[0].is_unique);
        assert_eq!(indexes[1].name, "users_name_email_idx");
        assert_eq!(indexes[1].columns, vec!["name".to_string(), "email".to_string()]);
        assert!(!indexes[1].is_unique && !indexes[1].is_primary);
    }

    // AC-005, E-2 - behavior (composite FK rows fold into one ForeignKey pairing each local column
    // with its referenced column in order)
    #[test]
    fn should_fold_composite_foreign_key_rows_pairing_local_and_referenced_columns() {
        let rows = vec![
            (
                s("orders_customer_fk"),
                s("customer_org"),
                s("customers"),
                s("org"),
                Some(s("public")),
            ),
            (
                s("orders_customer_fk"),
                s("customer_id"),
                s("customers"),
                s("id"),
                Some(s("public")),
            ),
        ];
        let keys = fold_foreign_keys(&rows);
        assert_eq!(keys.len(), 1);
        assert_eq!(keys[0].referenced_table, "customers");
        assert_eq!(keys[0].referenced_schema, Some("public".to_string()));
        assert_eq!(
            keys[0].columns,
            vec!["customer_org".to_string(), "customer_id".to_string()]
        );
        assert_eq!(
            keys[0].referenced_columns,
            vec!["org".to_string(), "id".to_string()]
        );
    }
}

// F12 manual-commit transaction mode. These tests drive the planned command-layer transaction seam
// against a REAL, in-process SQLite database (no Docker) so BEGIN/COMMIT/ROLLBACK and read-routing
// through the pinned connection are exercised for real.
//
// ASSUMED SIGNATURES (adjust the calls below if the implementation lands them differently - the
// module is RED-by-compile until the four fns exist, so the sync/async detail is moot for the RED
// gate). `with_pool` is synchronous, so `transaction_state` is assumed synchronous too:
//   pub async fn begin_transaction(connection_id: String) -> Result<(), String>
//   pub async fn commit_transaction(connection_id: String) -> Result<(), String>
//   pub async fn rollback_transaction(connection_id: String) -> Result<(), String>
//   pub fn transaction_state(connection_id: String) -> bool   // false for an unknown id
#[cfg(test)]
mod tx_tests {
    use super::{
        begin_transaction, commit_transaction, connect_database, disconnect_database, rollback_transaction,
        run_query, transaction_state, ConnectionConfig, DEFAULT_ROW_LIMIT,
    };
    use std::sync::Once;

    // sqlx panics if the Any drivers are installed twice; production installs them in lib.rs::run,
    // the test binary must install them once itself before any pool opens.
    static DRIVERS: Once = Once::new();
    fn init_drivers() {
        DRIVERS.call_once(|| {
            sqlx::any::install_default_drivers();
        });
    }

    // A fresh, empty, file-backed SQLite database under /tmp (a 0-byte file is a valid empty SQLite
    // db; it must EXIST because connect_database opens without create_if_missing). /tmp is used
    // instead of env::temp_dir() so the path carries no `+`/space that PATH_ENCODE_SET would encode
    // and break the sqlite:// URL. Unique per test (nanos + tag) so parallel tests never collide.
    fn temp_sqlite(tag: &str) -> String {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = format!("/tmp/dbui-tx-{tag}-{nanos}.db");
        std::fs::write(&path, b"").expect("create empty sqlite file");
        path
    }

    fn cleanup(file: &str) {
        let _ = std::fs::remove_file(file);
        let _ = std::fs::remove_file(format!("{file}-journal"));
        let _ = std::fs::remove_file(format!("{file}-wal"));
        let _ = std::fs::remove_file(format!("{file}-shm"));
    }

    fn sqlite(file: &str) -> ConnectionConfig {
        ConnectionConfig::Sqlite {
            file: file.to_string(),
        }
    }

    // Convenience: run one statement on the held connection and unwrap. `req` must be unique per
    // call (it keys the cancel registry).
    async fn exec(id: &str, sql: &str, req: &str) -> Vec<super::QueryOutcome> {
        run_query(id.to_string(), sql.to_string(), DEFAULT_ROW_LIMIT, req.to_string())
            .await
            .unwrap_or_else(|error| panic!("run_query({sql}) failed: {error}"))
    }

    // TC-001, AC-002, AC-003 - behavior (begin opens the tx; an INSERT then a SELECT on the SAME id
    // route through the pinned connection, so the SELECT sees the uncommitted insert)
    #[tokio::test]
    async fn should_see_uncommitted_insert_through_the_pinned_connection_after_begin() {
        init_drivers();
        let file = temp_sqlite("tc001");
        let id = "tx-tc001";
        connect_database(id.to_string(), sqlite(&file))
            .await
            .expect("connect");

        exec(id, "CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)", "c1").await;

        begin_transaction(id.to_string()).await.expect("begin");
        assert!(
            transaction_state(id.to_string()),
            "transaction_state must be true right after begin_transaction"
        );

        exec(id, "INSERT INTO t (id, name) VALUES (1, 'alice')", "c2").await;

        let out = exec(id, "SELECT id, name FROM t", "c3").await;
        let rows = &out[0].rows;
        assert_eq!(
            rows.len(),
            1,
            "the pinned SELECT must see the uncommitted insert (reads route through the tx conn)"
        );
        assert_eq!(rows[0][1], Some("alice".to_string()));

        disconnect_database(id.to_string()).await;
        cleanup(&file);
    }

    // TC-002, AC-004 - behavior (commit persists the row; a later auto-commit SELECT still sees it,
    // and transaction_state reports the tx closed)
    #[tokio::test]
    async fn should_persist_the_row_and_close_the_tx_after_commit() {
        init_drivers();
        let file = temp_sqlite("tc002");
        let id = "tx-tc002";
        connect_database(id.to_string(), sqlite(&file))
            .await
            .expect("connect");

        exec(id, "CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)", "c1").await;
        begin_transaction(id.to_string()).await.expect("begin");
        exec(id, "INSERT INTO t (id, name) VALUES (1, 'alice')", "c2").await;

        commit_transaction(id.to_string()).await.expect("commit");
        assert!(
            !transaction_state(id.to_string()),
            "transaction_state must be false after commit"
        );

        // A fresh SELECT now runs on the pool (auto-commit path) - it must still see the committed row.
        let out = exec(id, "SELECT id FROM t", "c3").await;
        assert_eq!(out[0].rows.len(), 1, "a committed row must survive on a fresh connection");

        disconnect_database(id.to_string()).await;
        cleanup(&file);
    }

    // TC-003, AC-005 - behavior (rollback discards the insert; a later SELECT does NOT see it, and
    // transaction_state reports the tx closed)
    #[tokio::test]
    async fn should_discard_the_row_and_close_the_tx_after_rollback() {
        init_drivers();
        let file = temp_sqlite("tc003");
        let id = "tx-tc003";
        connect_database(id.to_string(), sqlite(&file))
            .await
            .expect("connect");

        exec(id, "CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)", "c1").await;
        begin_transaction(id.to_string()).await.expect("begin");
        exec(id, "INSERT INTO t (id, name) VALUES (1, 'alice')", "c2").await;

        rollback_transaction(id.to_string()).await.expect("rollback");
        assert!(
            !transaction_state(id.to_string()),
            "transaction_state must be false after rollback"
        );

        let out = exec(id, "SELECT id FROM t", "c3").await;
        assert_eq!(
            out[0].rows.len(),
            0,
            "the rolled-back insert must be gone on a fresh connection"
        );

        disconnect_database(id.to_string()).await;
        cleanup(&file);
    }

    // TC-004, AC-003, AC-005 - behavior (isolation, in-process form): inside the open tx the pinned
    // read sees its OWN uncommitted DELETE (0 rows), and after rollback the rows are restored on a
    // fresh connection. True cross-connection MVCC (a second connection NOT seeing the dirty delete)
    // is covered by the ignored live-Postgres test below - SQLite's rollback-journal locking makes a
    // deterministic cross-connection read brittle, so the reliable in-process assertion is used here.
    #[tokio::test]
    async fn should_hide_a_deleted_row_inside_the_tx_and_restore_it_on_rollback() {
        init_drivers();
        let file = temp_sqlite("tc004");
        let id = "tx-tc004";
        connect_database(id.to_string(), sqlite(&file))
            .await
            .expect("connect");

        exec(id, "CREATE TABLE t (id INTEGER PRIMARY KEY)", "c1").await;
        exec(id, "INSERT INTO t (id) VALUES (1), (2), (3)", "c2").await;

        begin_transaction(id.to_string()).await.expect("begin");
        exec(id, "DELETE FROM t", "c3").await;

        let in_tx = exec(id, "SELECT id FROM t", "c4").await;
        assert_eq!(
            in_tx[0].rows.len(),
            0,
            "the pinned read must see its own uncommitted DELETE (empty)"
        );

        rollback_transaction(id.to_string()).await.expect("rollback");

        let after = exec(id, "SELECT id FROM t", "c5").await;
        assert_eq!(
            after[0].rows.len(),
            3,
            "rollback must restore the deleted rows on a fresh connection"
        );

        disconnect_database(id.to_string()).await;
        cleanup(&file);
    }

    // TC-005, AC-007 - behavior (disconnecting with an open tx auto-rolls-back and cleans the tx
    // registry, so it never leaks an idle-in-transaction connection): after disconnect the state is
    // closed, and reconnecting the same file does NOT see the uncommitted insert.
    #[tokio::test]
    async fn should_auto_rollback_an_open_tx_on_disconnect() {
        init_drivers();
        let file = temp_sqlite("tc005");
        let id = "tx-tc005";
        connect_database(id.to_string(), sqlite(&file))
            .await
            .expect("connect");

        exec(id, "CREATE TABLE t (id INTEGER PRIMARY KEY)", "c1").await;
        begin_transaction(id.to_string()).await.expect("begin");
        exec(id, "INSERT INTO t (id) VALUES (1)", "c2").await;

        disconnect_database(id.to_string()).await;
        assert!(
            !transaction_state(id.to_string()),
            "disconnect must clear the tx registry (no leaked open tx)"
        );

        connect_database(id.to_string(), sqlite(&file))
            .await
            .expect("reconnect");
        let out = exec(id, "SELECT id FROM t", "c3").await;
        assert_eq!(
            out[0].rows.len(),
            0,
            "an uncommitted insert must be rolled back when its database is disconnected"
        );

        disconnect_database(id.to_string()).await;
        cleanup(&file);
    }

    // TC-006, AC-009 - side-effect-contract (begin/commit/rollback on an id with no held pool return
    // the clear not-connected error, and transaction_state returns false - never a panic)
    #[tokio::test]
    async fn should_report_not_connected_for_tx_commands_on_an_unknown_id() {
        init_drivers();
        let id = "tx-never-connected";

        assert!(
            !transaction_state(id.to_string()),
            "transaction_state on an unknown id must be false, not a panic"
        );

        for result in [
            begin_transaction(id.to_string()).await,
            commit_transaction(id.to_string()).await,
            rollback_transaction(id.to_string()).await,
        ] {
            assert!(result.is_err(), "a tx command on an unknown id must return Err");
            let message = result.err().unwrap().to_lowercase();
            assert!(
                message.contains("not connected") || message.contains("no connection"),
                "expected a clear not-connected error, got: {message}"
            );
        }
    }

    // SMOKE (SQLite): the per-statement SAVEPOINT / RELEASE / ROLLBACK-TO wrapping runs cleanly and
    // commits exactly the successful rows. NOTE this does NOT prove poisoning-recovery: SQLite does
    // not mark a tx aborted on a statement error (the "current transaction is aborted" symptom is
    // Postgres-specific), so a failed-then-valid write recovers here even WITHOUT the savepoint. The
    // real recovery guard is the #[ignore] live-PG test below; this pins that the savepoint SQL is
    // valid and a commit after a failed statement yields exactly the successful rows.
    #[tokio::test]
    async fn should_commit_only_successful_rows_with_savepoint_wrapping() {
        init_drivers();
        let file = temp_sqlite("tcsp");
        let id = "tx-savepoint";
        connect_database(id.to_string(), sqlite(&file))
            .await
            .expect("connect");

        exec(id, "CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)", "c1").await;
        begin_transaction(id.to_string()).await.expect("begin");
        exec(id, "INSERT INTO t (id, name) VALUES (1, 'alice')", "c2").await;

        // A duplicate primary key fails - the savepoint must roll back just this statement.
        let failed = run_query(
            id.to_string(),
            "INSERT INTO t (id, name) VALUES (1, 'dup')".to_string(),
            DEFAULT_ROW_LIMIT,
            "c3".to_string(),
        )
        .await;
        assert!(failed.is_err(), "the duplicate-key insert must fail");

        // The transaction is still usable: a fresh valid write succeeds instead of erroring with an
        // aborted-transaction message.
        let recovered = run_query(
            id.to_string(),
            "INSERT INTO t (id, name) VALUES (2, 'bob')".to_string(),
            DEFAULT_ROW_LIMIT,
            "c4".to_string(),
        )
        .await;
        assert!(
            recovered.is_ok(),
            "a valid write after a failed one must succeed (tx not poisoned): {recovered:?}"
        );

        commit_transaction(id.to_string()).await.expect("commit");

        // Exactly the two successful rows are committed; the failed duplicate left nothing behind.
        let out = exec(id, "SELECT id FROM t ORDER BY id", "c5").await;
        assert_eq!(
            out[0].rows.len(),
            2,
            "only the two successful inserts must be committed"
        );

        disconnect_database(id.to_string()).await;
        cleanup(&file);
    }

    // Live cross-connection isolation (true MVCC) against the docker test-stack Postgres (host port
    // 55432, dbui/dbui, db dbui_test). Ignored by default like the mongo smoke; run with:
    //   cargo test --manifest-path src-tauri/Cargo.toml live_pg_manual_commit -- --ignored --nocapture
    #[tokio::test]
    #[ignore]
    async fn live_pg_manual_commit_isolates_uncommitted_writes_across_connections() {
        init_drivers();
        let pg = || ConnectionConfig::Postgres {
            host: "localhost".to_string(),
            port: 55432,
            database: "dbui_test".to_string(),
            user: "dbui".to_string(),
            password: "dbui".to_string(),
        };
        let a = "live-tx-a";
        let b = "live-tx-b";
        connect_database(a.to_string(), pg()).await.expect("connect a");
        connect_database(b.to_string(), pg()).await.expect("connect b");

        exec(
            a,
            "DROP TABLE IF EXISTS tx_iso; CREATE TABLE tx_iso (id int primary key); \
             INSERT INTO tx_iso VALUES (1), (2), (3)",
            "seed",
        )
        .await;

        begin_transaction(a.to_string()).await.expect("begin a");
        exec(a, "DELETE FROM tx_iso", "del").await;

        // B is a DIFFERENT connection with no open tx: it must NOT see A's uncommitted delete.
        let vb = exec(b, "SELECT id FROM tx_iso", "vb1").await;
        assert_eq!(vb[0].rows.len(), 3, "B must still see all rows before A commits");

        // A (pinned) sees its own delete.
        let va = exec(a, "SELECT id FROM tx_iso", "va1").await;
        assert_eq!(va[0].rows.len(), 0, "A must see its own uncommitted delete");

        commit_transaction(a.to_string()).await.expect("commit a");
        let vb2 = exec(b, "SELECT id FROM tx_iso", "vb2").await;
        assert_eq!(vb2[0].rows.len(), 0, "after A commits, B must see the delete");

        exec(a, "DROP TABLE IF EXISTS tx_iso", "drop").await;
        disconnect_database(a.to_string()).await;
        disconnect_database(b.to_string()).await;
    }

    // Live-PG proof of the per-statement SAVEPOINT recovery: on Postgres a failed statement marks
    // the whole transaction aborted, so WITHOUT the savepoint the next command errors with "current
    // transaction is aborted". With the savepoint the failed statement is rolled back on its own and
    // a later valid write succeeds + commits. This is the DBeaver-parity behaviour the SQLite smoke
    // above cannot prove. Run with the docker stack up:
    //   cargo test --manifest-path src-tauri/Cargo.toml live_pg_savepoint -- --ignored --nocapture
    #[tokio::test]
    #[ignore]
    async fn live_pg_savepoint_keeps_tx_usable_after_a_failed_statement() {
        init_drivers();
        let pg = ConnectionConfig::Postgres {
            host: "localhost".to_string(),
            port: 55432,
            database: "dbui_test".to_string(),
            user: "dbui".to_string(),
            password: "dbui".to_string(),
        };
        let id = "live-tx-sp";
        connect_database(id.to_string(), pg).await.expect("connect");

        exec(
            id,
            "DROP TABLE IF EXISTS tx_sp; CREATE TABLE tx_sp (id int primary key)",
            "seed",
        )
        .await;

        begin_transaction(id.to_string()).await.expect("begin");
        exec(id, "INSERT INTO tx_sp VALUES (1)", "ok1").await;

        // Duplicate PK - fails, and on Postgres would abort the whole tx without the savepoint.
        let failed = run_query(
            id.to_string(),
            "INSERT INTO tx_sp VALUES (1)".to_string(),
            DEFAULT_ROW_LIMIT,
            "dup".to_string(),
        )
        .await;
        assert!(failed.is_err(), "duplicate-key insert must fail");

        // The savepoint rolled back only the failed insert; the tx is still usable.
        let recovered = run_query(
            id.to_string(),
            "INSERT INTO tx_sp VALUES (2)".to_string(),
            DEFAULT_ROW_LIMIT,
            "ok2".to_string(),
        )
        .await;
        assert!(
            recovered.is_ok(),
            "a valid write after a failed one must succeed on Postgres (savepoint recovery): {recovered:?}"
        );

        commit_transaction(id.to_string()).await.expect("commit");
        let out = exec(id, "SELECT id FROM tx_sp ORDER BY id", "check").await;
        assert_eq!(out[0].rows.len(), 2, "rows 1 and 2 committed; the duplicate left nothing");

        exec(id, "DROP TABLE IF EXISTS tx_sp", "drop").await;
        disconnect_database(id.to_string()).await;
    }
}
