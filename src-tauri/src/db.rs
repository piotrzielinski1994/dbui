use percent_encoding::{utf8_percent_encode, AsciiSet, NON_ALPHANUMERIC};
use serde::{Deserialize, Serialize};
use sqlx::any::AnyPoolOptions;
use sqlx::Row;

pub const DEFAULT_ROW_LIMIT: u32 = 200;

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

pub fn catalog_query(engine: DbEngine) -> &'static str {
    match engine {
        DbEngine::Postgres => {
            "SELECT table_name::text FROM information_schema.tables \
             WHERE table_type = 'BASE TABLE' \
             AND table_schema NOT IN ('pg_catalog', 'information_schema') \
             ORDER BY table_name"
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

pub fn quote_identifier(engine: DbEngine, name: &str) -> String {
    match engine {
        DbEngine::Postgres | DbEngine::Sqlite => format!("\"{}\"", name.replace('"', "\"\"")),
        DbEngine::Mysql => format!("`{}`", name.replace('`', "``")),
    }
}

pub fn columns_query(engine: DbEngine) -> &'static str {
    match engine {
        DbEngine::Postgres => {
            "SELECT column_name::text FROM information_schema.columns \
             WHERE table_name = $1 \
             AND table_schema NOT IN ('pg_catalog', 'information_schema') \
             ORDER BY ordinal_position"
        }
        DbEngine::Mysql => {
            "SELECT column_name FROM information_schema.columns \
             WHERE table_name = ? AND table_schema = DATABASE() \
             ORDER BY ordinal_position"
        }
        DbEngine::Sqlite => "SELECT name FROM pragma_table_info(?) ORDER BY cid",
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
            format!(
                " ORDER BY {}{direction}",
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
        table = quote_identifier(engine, table),
    )
}

// The unbounded row count the table card shows in its status bar ("N of TOTAL"). Mirrors the
// rows query's filter handling (same parenthesized raw WHERE), minus columns/sort/limit.
pub fn build_count_query(engine: DbEngine, table: &str, filter: Option<&str>) -> String {
    let where_clause = match filter.map(str::trim).filter(|text| !text.is_empty()) {
        Some(expression) => format!(" WHERE ({expression})"),
        None => String::new(),
    };
    format!(
        "SELECT COUNT(*) FROM {table}{where_clause}",
        table = quote_identifier(engine, table),
    )
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
    table: &str,
    column: &str,
    column_type: &str,
    pk_column: &str,
    new_value: Option<&str>,
    pk_value: &str,
) -> (String, Vec<String>) {
    let quoted_table = quote_identifier(engine, table);
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

#[cfg(test)]
pub fn build_update_query(
    engine: DbEngine,
    table: &str,
    column: &str,
    column_type: &str,
    pk_column: &str,
    new_value: &str,
    pk_value: &str,
) -> (String, Vec<String>) {
    build_update_query_value(
        engine,
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
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Option<String>>>,
    pub rows_affected: u64,
    pub returns_rows: bool,
    pub message: String,
}

pub async fn run_query(
    config: ConnectionConfig,
    sql: String,
    limit: u32,
) -> Result<QueryOutcome, String> {
    let engine = config.engine();
    let pool = AnyPoolOptions::new()
        .max_connections(1)
        .connect(&build_url(&config))
        .await
        .map_err(|error| error.to_string())?;

    let outcome = match engine {
        DbEngine::Postgres => run_query_postgres(&pool, &sql, limit).await,
        // SQLite's Any type-describe handles `prepare().columns()` without Postgres's
        // exotic-type failure, so it shares MySQL's prepared path.
        DbEngine::Mysql | DbEngine::Sqlite => run_query_prepared(engine, &pool, &sql, limit).await,
    };

    pool.close().await;
    outcome
}

fn non_row_outcome(affected: u64) -> QueryOutcome {
    QueryOutcome {
        columns: Vec::new(),
        rows: Vec::new(),
        rows_affected: affected,
        returns_rows: false,
        message: format!("OK - {affected} row(s) affected"),
    }
}

async fn run_query_postgres(
    pool: &sqlx::AnyPool,
    sql: &str,
    limit: u32,
) -> Result<QueryOutcome, String> {
    use sqlx::Executor;

    if !is_row_returning(sql) {
        let result = pool
            .execute(sql.trim().trim_end_matches(';'))
            .await
            .map_err(|error| error.to_string())?;
        return Ok(non_row_outcome(result.rows_affected()));
    }

    // EXPLAIN / SHOW return rows but cannot be subquery-wrapped, so they can't go through
    // row_to_json. Their output columns are already text (QUERY PLAN, setting), which the Any
    // driver decodes directly - fetch as-is.
    if !is_subquery_wrappable(sql) {
        return fetch_plain_text_rows(pool, sql.trim().trim_end_matches(';')).await;
    }

    let wrapped = wrap_select_as_json(sql, limit);
    let data_rows = sqlx::query(&wrapped)
        .fetch_all(pool)
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
            .fetch_all(pool)
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
        columns,
        rows,
        rows_affected: count as u64,
        returns_rows: true,
        message: format!("SELECT {count}"),
    })
}

// Fetches a statement whose result columns are already Any-decodable text (EXPLAIN, SHOW).
// Column names come from the first row's metadata; every cell reads as Option<String>.
async fn fetch_plain_text_rows(pool: &sqlx::AnyPool, sql: &str) -> Result<QueryOutcome, String> {
    use sqlx::{Column, Row};

    let data_rows = sqlx::query(sql)
        .fetch_all(pool)
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
    pool: &sqlx::AnyPool,
    sql: &str,
    limit: u32,
) -> Result<QueryOutcome, String> {
    use sqlx::{Column, Executor, Statement};

    let prepared = pool
        .prepare(sql.trim().trim_end_matches(';'))
        .await
        .map_err(|error| error.to_string())?;
    let columns: Vec<String> = prepared
        .columns()
        .iter()
        .map(|column| column.name().to_string())
        .collect();

    if columns.is_empty() {
        let result = pool
            .execute(sql.trim().trim_end_matches(';'))
            .await
            .map_err(|error| error.to_string())?;
        return Ok(non_row_outcome(result.rows_affected()));
    }

    let wrapped = wrap_select_as_text(engine, sql, &columns, limit);
    let data_rows = sqlx::query(&wrapped)
        .fetch_all(pool)
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
        columns,
        rows,
        rows_affected: count as u64,
        returns_rows: true,
        message: format!("SELECT {count}"),
    })
}

pub async fn list_tables(config: ConnectionConfig) -> Result<Vec<String>, String> {
    let pool = AnyPoolOptions::new()
        .max_connections(1)
        .connect(&build_url(&config))
        .await
        .map_err(|error| error.to_string())?;

    let rows = sqlx::query(catalog_query(config.engine()))
        .fetch_all(&pool)
        .await
        .map_err(|error| error.to_string());

    pool.close().await;

    rows?
        .iter()
        .map(|row| {
            row.try_get::<String, _>(0)
                .map_err(|error| error.to_string())
        })
        .collect()
}

pub async fn count_table_rows(
    config: ConnectionConfig,
    table: String,
    filter: Option<String>,
) -> Result<i64, String> {
    let engine = config.engine();
    let pool = AnyPoolOptions::new()
        .max_connections(1)
        .connect(&build_url(&config))
        .await
        .map_err(|error| error.to_string())?;

    let row = sqlx::query(&build_count_query(engine, &table, filter.as_deref()))
        .fetch_one(&pool)
        .await
        .map_err(|error| error.to_string());

    pool.close().await;
    row?.try_get::<i64, _>(0).map_err(|error| error.to_string())
}

pub async fn fetch_table_rows(
    config: ConnectionConfig,
    table: String,
    limit: u32,
    offset: u32,
    filter: Option<String>,
    sort: Option<Sort>,
) -> Result<TableRows, String> {
    let engine = config.engine();
    let pool = AnyPoolOptions::new()
        .max_connections(1)
        .connect(&build_url(&config))
        .await
        .map_err(|error| error.to_string())?;

    let result = read_table_rows(
        &pool,
        engine,
        &table,
        limit,
        offset,
        filter.as_deref(),
        sort.as_ref(),
    )
    .await;

    pool.close().await;
    result
}

async fn read_table_rows(
    pool: &sqlx::AnyPool,
    engine: DbEngine,
    table: &str,
    limit: u32,
    offset: u32,
    filter: Option<&str>,
    sort: Option<&Sort>,
) -> Result<TableRows, String> {
    let column_rows = sqlx::query(columns_query(engine))
        .bind(table)
        .fetch_all(pool)
        .await
        .map_err(|error| error.to_string())?;

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

    let pk_rows = sqlx::query(primary_key_query(engine))
        .bind(table)
        .fetch_all(pool)
        .await
        .map_err(|error| error.to_string())?;
    let primary_key = pk_rows
        .first()
        .and_then(|row| row.try_get::<String, _>(0).ok());

    let type_rows = sqlx::query(column_types_query(engine))
        .bind(table)
        .fetch_all(pool)
        .await
        .map_err(|error| error.to_string())?;
    let types: std::collections::HashMap<String, String> = type_rows
        .iter()
        .filter_map(|row| {
            Some((
                row.try_get::<String, _>(0).ok()?,
                row.try_get::<String, _>(1).ok()?,
            ))
        })
        .collect();

    let nullable_rows = sqlx::query(nullable_query(engine))
        .bind(table)
        .fetch_all(pool)
        .await
        .map_err(|error| error.to_string())?;
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
        engine, table, &names, limit, offset, filter, sort,
    ))
    .fetch_all(pool)
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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellEdit {
    pub column: String,
    pub pk_value: String,
    pub value: Option<String>,
}

fn column_types_query(engine: DbEngine) -> &'static str {
    match engine {
        DbEngine::Postgres => {
            "SELECT column_name::text, udt_name::text FROM information_schema.columns \
             WHERE table_name = $1 \
             AND table_schema NOT IN ('pg_catalog', 'information_schema')"
        }
        DbEngine::Mysql => {
            "SELECT column_name, data_type FROM information_schema.columns \
             WHERE table_name = ? AND table_schema = DATABASE()"
        }
        DbEngine::Sqlite => "SELECT name, type FROM pragma_table_info(?)",
    }
}

// Per-column nullability. PG/MySQL report `is_nullable` as the text 'YES'/'NO';
// SQLite's pragma reports `notnull` as 0/1 (inverted), so the second column is the not-null
// flag and the assembler inverts it. The two PG/MySQL columns are (name, is_nullable text);
// SQLite returns (name, notnull int) - both read by `read_nullable` per engine.
fn nullable_query(engine: DbEngine) -> &'static str {
    match engine {
        DbEngine::Postgres => {
            "SELECT column_name::text, is_nullable::text FROM information_schema.columns \
             WHERE table_name = $1 \
             AND table_schema NOT IN ('pg_catalog', 'information_schema')"
        }
        DbEngine::Mysql => {
            "SELECT column_name, is_nullable FROM information_schema.columns \
             WHERE table_name = ? AND table_schema = DATABASE()"
        }
        DbEngine::Sqlite => "SELECT name, notnull FROM pragma_table_info(?)",
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

pub async fn update_cells(
    config: ConnectionConfig,
    table: String,
    edits: Vec<CellEdit>,
) -> Result<u64, String> {
    let engine = config.engine();
    let pool = AnyPoolOptions::new()
        .max_connections(1)
        .connect(&build_url(&config))
        .await
        .map_err(|error| error.to_string())?;

    let result = write_cells(&pool, engine, &table, &edits).await;

    pool.close().await;
    result
}

async fn write_cells(
    pool: &sqlx::AnyPool,
    engine: DbEngine,
    table: &str,
    edits: &[CellEdit],
) -> Result<u64, String> {
    let pk_rows = sqlx::query(primary_key_query(engine))
        .bind(table)
        .fetch_all(pool)
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

    let type_rows = sqlx::query(column_types_query(engine))
        .bind(table)
        .fetch_all(pool)
        .await
        .map_err(|error| error.to_string())?;
    let column_types: std::collections::HashMap<String, String> = type_rows
        .iter()
        .filter_map(|row| {
            let name = row.try_get::<String, _>(0).ok()?;
            let kind = row.try_get::<String, _>(1).ok()?;
            Some((name, kind))
        })
        .collect();

    let mut affected = 0;
    for edit in edits {
        let column_type = column_types
            .get(&edit.column)
            .ok_or_else(|| format!("unknown column '{}'", edit.column))?;
        let (sql, binds) = build_update_query_value(
            engine,
            table,
            &edit.column,
            column_type,
            pk_column,
            edit.value.as_deref(),
            &edit.pk_value,
        );
        let mut query = sqlx::query(&sql);
        for bind in &binds {
            query = query.bind(bind);
        }
        let result = query
            .execute(pool)
            .await
            .map_err(|error| error.to_string())?;
        affected += result.rows_affected();
    }
    Ok(affected)
}

#[cfg(test)]
mod tests {
    use super::{
        assemble_columns, build_count_query, build_rows_query, build_update_query,
        build_update_query_value, build_url, catalog_query, column_types_query, columns_query,
        is_row_returning, is_subquery_wrappable, nullable_query, parse_json_rows, primary_key_query,
        quote_identifier, wrap_columns_probe, wrap_select_as_json, wrap_select_as_text,
        ConnectionConfig, DbEngine, Sort,
    };
    use std::collections::HashMap;

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
        let postgres = columns_query(DbEngine::Postgres);
        assert!(postgres.contains("column_name::text"));
        assert!(postgres.contains("$1"));
        assert!(postgres.contains("ORDER BY ordinal_position"));

        let mysql = columns_query(DbEngine::Mysql);
        assert!(mysql.contains("table_schema = DATABASE()"));
        assert!(mysql.contains('?'));
    }

    // behavior (Postgres casts every column to text and applies the limit; no filter -> no WHERE)
    #[test]
    fn should_cast_each_column_to_text_and_limit_for_postgres() {
        let query = build_rows_query(DbEngine::Postgres, "product", &cols(), 200, 0, None, None);
        assert_eq!(
            query,
            "SELECT \"id\"::text, \"price\"::text FROM \"product\" LIMIT 200"
        );
    }

    // behavior (MySQL casts every column to CHAR and applies the limit; no filter -> no WHERE)
    #[test]
    fn should_cast_each_column_to_char_and_limit_for_mysql() {
        let query = build_rows_query(DbEngine::Mysql, "product", &cols(), 100, 0, None, None);
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
        let query = build_count_query(DbEngine::Postgres, "product", None);
        assert_eq!(query, "SELECT COUNT(*) FROM \"product\"");
    }

    // behavior (count query wraps the raw filter in parens like the rows query)
    #[test]
    fn should_wrap_the_filter_in_parens_for_the_count_query() {
        let query = build_count_query(DbEngine::Mysql, "product", Some("price > 10"));
        assert_eq!(query, "SELECT COUNT(*) FROM `product` WHERE (price > 10)");
    }

    // behavior (a blank filter is ignored in the count query)
    #[test]
    fn should_ignore_a_blank_filter_in_the_count_query() {
        let query = build_count_query(DbEngine::Sqlite, "product", Some("  "));
        assert_eq!(query, "SELECT COUNT(*) FROM \"product\"");
    }

    // AC-001 - behavior (a non-zero offset emits OFFSET after LIMIT; offset 0 emits none)
    #[test]
    fn should_append_offset_after_limit_when_offset_is_non_zero() {
        let query = build_rows_query(DbEngine::Postgres, "product", &cols(), 200, 200, None, None);
        assert_eq!(
            query,
            "SELECT \"id\"::text, \"price\"::text FROM \"product\" LIMIT 200 OFFSET 200"
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
            "product",
            &cols(),
            200,
            0,
            None,
            Some(&sort),
        );
        assert_eq!(
            query,
            "SELECT \"id\"::text, \"price\"::text FROM \"product\" ORDER BY \"price\" LIMIT 200"
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
            "product",
            &cols(),
            200,
            0,
            None,
            Some(&sort),
        );
        assert!(
            query.contains("ORDER BY `price` DESC LIMIT 200"),
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
             WHERE (price > 10) ORDER BY \"id\" DESC LIMIT 200 OFFSET 400"
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
        assert!(nullable_query(DbEngine::Postgres).contains("is_nullable"));
        assert!(nullable_query(DbEngine::Postgres).contains("$1"));
        assert!(nullable_query(DbEngine::Mysql).contains("is_nullable"));
        assert!(nullable_query(DbEngine::Mysql).contains('?'));
        assert!(nullable_query(DbEngine::Sqlite).contains("pragma_table_info"));
        assert!(nullable_query(DbEngine::Sqlite).contains("notnull"));
    }

    // behavior (UPDATE casts the value to the column type, matches the pk as text - Postgres)
    #[test]
    fn should_build_a_typed_update_for_postgres() {
        let (sql, binds) = build_update_query(
            DbEngine::Postgres,
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
        let query = columns_query(DbEngine::Sqlite);
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
        let query = column_types_query(DbEngine::Sqlite);
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
        let query = build_rows_query(DbEngine::Sqlite, "product", &cols(), 200, 0, None, None);
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
            "product",
            &cols(),
            200,
            0,
            None,
            Some(&sort),
        );
        assert!(
            query.contains("ORDER BY \"price\" LIMIT 200"),
            "unexpected: {query}"
        );
    }

    // AC-006, TC-008 - behavior (SQLite UPDATE binds the value plainly with ?, matches pk as text)
    #[test]
    fn should_build_an_update_for_sqlite() {
        let (sql, binds) = build_update_query(
            DbEngine::Sqlite,
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
}
