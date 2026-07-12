mod db;
mod logging;
mod mongo;

use db::{
    apply_row_mutations, begin_transaction as begin_transaction_db, cancel_query as cancel_query_db,
    commit_transaction as commit_transaction_db, connect_database as connect_database_db,
    count_table_rows, disconnect_database as disconnect_database_db,
    fetch_schema as fetch_schema_db, fetch_table_rows,
    fetch_table_structure as fetch_table_structure_db, rollback_transaction as rollback_transaction_db,
    run_query, transaction_state as transaction_state_db, ConnectCatalog, ConnectionConfig,
    QueryOutcome, RowMutation, Sort, TableRows, TableSchema, TableStructure, DEFAULT_ROW_LIMIT,
};
use mongo::MongoConfig;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! Greetings from Tauri.", name)
}

// Reads the `engine` tag off a raw config so connect can route a `mongodb` config to the Mongo
// module and any SQL config to `db.rs`. The full config is deserialized by whichever path owns it
// (`ConnectionConfig` is the SQL serde-tagged enum; `MongoConfig` is the Mongo shape).
fn config_engine(config: &serde_json::Value) -> Option<&str> {
    config.get("engine").and_then(serde_json::Value::as_str)
}

// Opens + holds a connection for this id and returns the catalog (SQL tables or Mongo
// collections). The only command that takes `config`; the rest address the held connection by id
// and dispatch on which registry holds it. Takes a raw JSON value so the `mongodb` engine - which
// is not part of the SQL `ConnectionConfig` enum - can be routed before typed deserialization.
#[tauri::command]
async fn connect_database(
    connection_id: String,
    config: serde_json::Value,
) -> Result<ConnectCatalog, String> {
    let engine = config_engine(&config).unwrap_or("?").to_string();
    let started = std::time::Instant::now();
    // A deserialize failure folds into `result` (not an early `?`) so it is logged like any other
    // connect failure, per AC-002.
    let result = if engine == "mongodb" {
        match serde_json::from_value::<MongoConfig>(config) {
            Ok(mongo_config) => mongo::connect(connection_id.clone(), mongo_config).await,
            Err(error) => Err(error.to_string()),
        }
    } else {
        match serde_json::from_value::<ConnectionConfig>(config) {
            Ok(sql_config) => connect_database_db(connection_id.clone(), sql_config).await,
            Err(error) => Err(error.to_string()),
        }
    };
    let ms = started.elapsed().as_millis();
    match &result {
        Ok(catalog) => log::info!(
            "{}",
            logging::format_connect_ok(&connection_id, &engine, catalog.tables.len(), ms)
        ),
        Err(error) if !logging::is_cancel_sentinel(error) => log::error!(
            "{}",
            logging::format_connect_err(&connection_id, &engine, ms, error)
        ),
        Err(_) => {}
    }
    result
}

#[tauri::command]
async fn disconnect_database(connection_id: String) {
    log::info!("{}", logging::format_disconnect(&connection_id));
    if mongo::is_connected(&connection_id) {
        mongo::disconnect(connection_id).await;
        return;
    }
    disconnect_database_db(connection_id).await
}

#[tauri::command]
async fn fetch_table(
    connection_id: String,
    schema: Option<String>,
    table: String,
    limit: Option<u32>,
    offset: Option<u32>,
    filter: Option<String>,
    sort: Option<Sort>,
) -> Result<TableRows, String> {
    if mongo::is_connected(&connection_id) {
        return mongo::fetch_documents(
            connection_id,
            table,
            limit.unwrap_or(DEFAULT_ROW_LIMIT),
            offset.unwrap_or(0),
            filter,
            sort,
        )
        .await;
    }
    fetch_table_rows(
        connection_id,
        schema,
        table,
        limit.unwrap_or(DEFAULT_ROW_LIMIT),
        offset.unwrap_or(0),
        filter,
        sort,
    )
    .await
}

#[tauri::command]
async fn count_table(
    connection_id: String,
    schema: Option<String>,
    table: String,
    filter: Option<String>,
) -> Result<i64, String> {
    if mongo::is_connected(&connection_id) {
        return mongo::count_documents(connection_id, table, filter).await;
    }
    count_table_rows(connection_id, schema, table, filter).await
}

#[tauri::command]
async fn apply_mutations(
    connection_id: String,
    schema: Option<String>,
    table: String,
    mutations: Vec<RowMutation>,
) -> Result<u64, String> {
    let qualified = match &schema {
        Some(schema) => format!("{schema}.{table}"),
        None => table.clone(),
    };
    let started = std::time::Instant::now();
    let result = if mongo::is_connected(&connection_id) {
        mongo::apply_mutations(connection_id.clone(), table, mutations).await
    } else {
        apply_row_mutations(connection_id.clone(), schema, table, mutations).await
    };
    let ms = started.elapsed().as_millis();
    match &result {
        Ok(affected) => log::info!(
            "{}",
            logging::format_mutations(&connection_id, &qualified, *affected, ms)
        ),
        Err(error) => log::error!(
            "mutations connection_id={connection_id} table={qualified} failed ({ms}ms): {error}"
        ),
    }
    result
}

// Runs one or more `;`-separated statements on the held connection, returning one outcome per
// statement. Cancellable by `request_id`. SQL only - the Mongo path uses execute_mongo_*.
#[tauri::command]
async fn execute_sql(
    connection_id: String,
    sql: String,
    request_id: String,
) -> Result<Vec<QueryOutcome>, String> {
    let started = std::time::Instant::now();
    let result = run_query(connection_id.clone(), sql, DEFAULT_ROW_LIMIT, request_id).await;
    log_query_outcome("sql", &connection_id, started, &result);
    result
}

// One file-log line per query invocation (NOT per `;`-statement - the in-app History tab already
// gives per-statement granularity). A cancelled run logs nothing (neutral). Shared by SQL + Mongo.
fn log_query_outcome(
    kind: &str,
    connection_id: &str,
    started: std::time::Instant,
    result: &Result<Vec<QueryOutcome>, String>,
) {
    let ms = started.elapsed().as_millis();
    match result {
        Ok(outcomes) => {
            let rows = outcomes.iter().map(|outcome| outcome.rows.len()).sum();
            log::info!(
                "{}",
                logging::format_query_ok(kind, connection_id, outcomes.len(), rows, ms)
            )
        }
        Err(error) if !logging::is_cancel_sentinel(error) => log::error!(
            "{}",
            logging::format_query_err(kind, connection_id, ms, error)
        ),
        Err(_) => {}
    }
}

// Runs one or more `;`-separated MongoDB Query-tab commands (`db.<coll>.find({...})` /
// `db.<coll>.aggregate([...])`), returning one outcome per command. Cancellable by `request_id`,
// mirroring `execute_sql`.
#[tauri::command]
async fn execute_mongo(
    connection_id: String,
    command: String,
    request_id: String,
) -> Result<Vec<QueryOutcome>, String> {
    let started = std::time::Instant::now();
    let result = mongo::run_query(connection_id.clone(), command, DEFAULT_ROW_LIMIT, request_id).await;
    log_query_outcome("mongo", &connection_id, started, &result);
    result
}

#[tauri::command]
async fn cancel_query(request_id: String) {
    cancel_query_db(request_id).await
}

#[tauri::command]
async fn fetch_schema(connection_id: String) -> Result<Vec<TableSchema>, String> {
    if mongo::is_connected(&connection_id) {
        return mongo::fetch_schema(connection_id).await;
    }
    fetch_schema_db(connection_id).await
}

// Read-only per-table structure for the schema browser (F6 #14): columns/indexes/FK/constraints for
// SQL engines, indexes-only for MongoDB. Dispatched like every connection-addressed command.
#[tauri::command]
async fn fetch_table_structure(
    connection_id: String,
    schema: Option<String>,
    table: String,
) -> Result<TableStructure, String> {
    if mongo::is_connected(&connection_id) {
        return mongo::fetch_table_structure(connection_id, table).await;
    }
    fetch_table_structure_db(connection_id, schema, table).await
}

// Manual-commit transaction control (F12), SQL engines only. `begin_transaction` opens a tx on the
// first write (idempotent); `commit`/`rollback` finish it; `transaction_state` reports whether one
// is open (for the Commit/Rollback toolbar). MongoDB has no manual-commit (its NoSQL driver, like
// DBeaver's, offers no such toolbar) so these reject a Mongo connection with a clear error.
#[tauri::command]
async fn begin_transaction(connection_id: String) -> Result<(), String> {
    if mongo::is_connected(&connection_id) {
        return Err("manual-commit transactions are not supported for MongoDB".to_string());
    }
    let started = std::time::Instant::now();
    let result = begin_transaction_db(connection_id.clone()).await;
    log_transaction("begin", &connection_id, started, &result);
    result
}

#[tauri::command]
async fn commit_transaction(connection_id: String) -> Result<(), String> {
    if mongo::is_connected(&connection_id) {
        return Err("manual-commit transactions are not supported for MongoDB".to_string());
    }
    let started = std::time::Instant::now();
    let result = commit_transaction_db(connection_id.clone()).await;
    log_transaction("commit", &connection_id, started, &result);
    result
}

#[tauri::command]
async fn rollback_transaction(connection_id: String) -> Result<(), String> {
    if mongo::is_connected(&connection_id) {
        return Err("manual-commit transactions are not supported for MongoDB".to_string());
    }
    let started = std::time::Instant::now();
    let result = rollback_transaction_db(connection_id.clone()).await;
    log_transaction("rollback", &connection_id, started, &result);
    result
}

#[tauri::command]
fn transaction_state(connection_id: String) -> bool {
    // Mongo never has an open manual-commit tx; the SQL registry returns false for any unknown id.
    if mongo::is_connected(&connection_id) {
        return false;
    }
    transaction_state_db(connection_id)
}

// One file-log line per tx lifecycle command (begin/commit/rollback), mirroring log_query_outcome.
fn log_transaction(
    verb: &str,
    connection_id: &str,
    started: std::time::Instant,
    result: &Result<(), String>,
) {
    let ms = started.elapsed().as_millis();
    match result {
        Ok(()) => log::info!("transaction {verb} connection_id={connection_id} ok ({ms}ms)"),
        Err(error) => {
            log::error!("transaction {verb} connection_id={connection_id} failed ({ms}ms): {error}")
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    sqlx::any::install_default_drivers();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .setup(|app| {
            logging::init(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            connect_database,
            disconnect_database,
            fetch_table,
            count_table,
            apply_mutations,
            execute_sql,
            execute_mongo,
            cancel_query,
            fetch_schema,
            fetch_table_structure,
            begin_transaction,
            commit_transaction,
            rollback_transaction,
            transaction_state,
            logging::log_message
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::greet;

    #[test]
    fn should_greet_with_name_when_given_one() {
        assert_eq!(greet("World"), "Hello, World! Greetings from Tauri.");
    }

    #[test]
    fn should_greet_with_empty_name_when_name_is_blank() {
        assert_eq!(greet(""), "Hello, ! Greetings from Tauri.");
    }
}
