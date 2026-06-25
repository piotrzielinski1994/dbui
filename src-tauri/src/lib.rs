mod db;
mod logging;

use db::{
    apply_row_mutations, cancel_query as cancel_query_db, connect_database as connect_database_db,
    count_table_rows, disconnect_database as disconnect_database_db,
    fetch_schema as fetch_schema_db, fetch_table_rows, run_query, ConnectionConfig, QueryOutcome,
    RowMutation, Sort, TableRows, TableSchema, DEFAULT_ROW_LIMIT,
};

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! Greetings from Tauri.", name)
}

// Opens + holds a pool for this connection id and returns the table catalog. The only command
// that takes `config`; the rest address the held pool by id.
#[tauri::command]
async fn connect_database(
    connection_id: String,
    config: ConnectionConfig,
) -> Result<Vec<String>, String> {
    connect_database_db(connection_id, config).await
}

#[tauri::command]
async fn disconnect_database(connection_id: String) {
    disconnect_database_db(connection_id).await
}

#[tauri::command]
async fn fetch_table(
    connection_id: String,
    table: String,
    limit: Option<u32>,
    offset: Option<u32>,
    filter: Option<String>,
    sort: Option<Sort>,
) -> Result<TableRows, String> {
    fetch_table_rows(
        connection_id,
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
    table: String,
    filter: Option<String>,
) -> Result<i64, String> {
    count_table_rows(connection_id, table, filter).await
}

#[tauri::command]
async fn apply_mutations(
    connection_id: String,
    table: String,
    mutations: Vec<RowMutation>,
) -> Result<u64, String> {
    apply_row_mutations(connection_id, table, mutations).await
}

// Runs one or more `;`-separated statements on the held connection, returning one outcome per
// statement. Cancellable by `request_id`.
#[tauri::command]
async fn execute_sql(
    connection_id: String,
    sql: String,
    request_id: String,
) -> Result<Vec<QueryOutcome>, String> {
    run_query(connection_id, sql, DEFAULT_ROW_LIMIT, request_id).await
}

#[tauri::command]
async fn cancel_query(request_id: String) {
    cancel_query_db(request_id).await
}

#[tauri::command]
async fn fetch_schema(connection_id: String) -> Result<Vec<TableSchema>, String> {
    fetch_schema_db(connection_id).await
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
            cancel_query,
            fetch_schema,
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
