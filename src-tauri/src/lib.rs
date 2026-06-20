mod db;

use db::{
    fetch_table_rows, list_tables, run_query, update_cells, CellEdit, ConnectionConfig,
    QueryOutcome, TableRows, DEFAULT_ROW_LIMIT,
};

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! Greetings from Tauri.", name)
}

#[tauri::command]
async fn connect_database(config: ConnectionConfig) -> Result<Vec<String>, String> {
    list_tables(config).await
}

#[tauri::command]
async fn fetch_table(
    config: ConnectionConfig,
    table: String,
    filter: Option<String>,
) -> Result<TableRows, String> {
    fetch_table_rows(config, table, DEFAULT_ROW_LIMIT, filter).await
}

#[tauri::command]
async fn update_table(
    config: ConnectionConfig,
    table: String,
    edits: Vec<CellEdit>,
) -> Result<u64, String> {
    update_cells(config, table, edits).await
}

#[tauri::command]
async fn execute_sql(config: ConnectionConfig, sql: String) -> Result<QueryOutcome, String> {
    run_query(config, sql, DEFAULT_ROW_LIMIT).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    sqlx::any::install_default_drivers();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            greet,
            connect_database,
            fetch_table,
            update_table,
            execute_sql
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
