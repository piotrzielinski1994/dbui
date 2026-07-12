// Pure helper for the per-launch log file stem. Takes already-decomposed
// local-time date/time components so the test is fully deterministic - no clock,
// no filesystem, no time crate. Returns "dbui-<YYYYMMDDHHMMSS>" (14 digits,
// zero-padded), matching the docs/features/* folder timestamp convention.
pub fn launch_log_name(
    year: i32,
    month: u32,
    day: u32,
    hour: u32,
    minute: u32,
    second: u32,
) -> String {
    format!("dbui-{year:04}{month:02}{day:02}{hour:02}{minute:02}{second:02}")
}

// Per-launch log file stem from the current local wall-clock. Local time (not
// UTC) so the stamp matches the docs/features/* folder convention. Impure (reads
// the clock); the formatting it delegates to is the pure, tested part above.
pub fn current_launch_log_name() -> String {
    use chrono::{Datelike, Local, Timelike};
    let now = Local::now();
    launch_log_name(
        now.year(),
        now.month(),
        now.day(),
        now.hour(),
        now.minute(),
        now.second(),
    )
}

// Register file logging, best-effort. A fresh dbui-<YYYYMMDDHHMMSS>.log per launch
// in the OS app-log dir (macOS ~/Library/Logs/com.pzielinski.dbui/). KeepAll + a
// large size cap so a whole session lands in one file, never rotated away mid-run.
// Logging is a side channel: if the log dir is unwritable we skip it and the app
// still launches (the LogDir target would otherwise error out of app setup).
pub fn init<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    use tauri_plugin_log::{Target, TargetKind};

    let log_name = current_launch_log_name();
    // `targets` REPLACES the builder's seeded defaults ([Stdout, LogDir{None}]);
    // `target` would push, leaving a stray app-name `DbUI.log` + a duplicate
    // Stdout. We want exactly Stdout + our single per-launch file + the Webview
    // target, which forwards every record to the frontend as a `log://log` event
    // (F18 Session Logs tab, via attachLogger). Webview is ADDITIVE - the file
    // still receives each line exactly once.
    let plugin = tauri_plugin_log::Builder::new()
        .targets([
            Target::new(TargetKind::Stdout),
            Target::new(TargetKind::LogDir {
                file_name: Some(log_name.clone()),
            }),
            Target::new(TargetKind::Webview),
        ])
        .level(log::LevelFilter::Info)
        .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepAll)
        .max_file_size(50_000_000)
        .build();

    if app.plugin(plugin).is_err() {
        eprintln!("dbui: file logging disabled (log dir unwritable)");
        return;
    }
    log::info!("dbui starting (log file {log_name}.log)");
}

// Frontend -> file-log bridge. The webview calls invoke("log_message", { level,
// message }) and the line lands in the same per-launch file as the backend's own
// log::info! calls. Best-effort on the FE side; here we just map the level.
#[tauri::command]
pub fn log_message(level: String, message: String) {
    match level.as_str() {
        "error" => log::error!("{message}"),
        "warn" => log::warn!("{message}"),
        "debug" => log::debug!("{message}"),
        _ => log::info!("{message}"),
    }
}

// Structured `key=value` file-log lines, one per backend command invocation. Pure (no clock, no
// I/O): the impure `Instant` timing + `log::` emission lives at the lib.rs dispatcher, mirroring
// the launch_log_name pure/impure split above. Elapsed millis are passed in already computed.
pub fn format_connect_ok(id: &str, engine: &str, tables: usize, ms: u128) -> String {
    format!("connect connection_id={id} engine={engine} tables={tables} ({ms}ms)")
}

pub fn format_connect_err(id: &str, engine: &str, ms: u128, error: &str) -> String {
    format!("connect connection_id={id} engine={engine} failed ({ms}ms): {error}")
}

pub fn format_disconnect(id: &str) -> String {
    format!("disconnect connection_id={id}")
}

pub fn format_query_ok(kind: &str, id: &str, statements: usize, rows: usize, ms: u128) -> String {
    format!("query kind={kind} connection_id={id} statements={statements} rows={rows} ({ms}ms)")
}

pub fn format_query_err(kind: &str, id: &str, ms: u128, error: &str) -> String {
    format!("query kind={kind} connection_id={id} failed ({ms}ms): {error}")
}

pub fn format_mutations(id: &str, table: &str, affected: u64, ms: u128) -> String {
    format!("mutations connection_id={id} table={table} affected={affected} ({ms}ms)")
}

// A cancelled connect/query rejects with this sentinel (db::CANCEL_SENTINEL). The dispatcher uses
// this to suppress the error log line - a user Cancel is neutral, not a failure.
pub fn is_cancel_sentinel(error: &str) -> bool {
    error == crate::db::CANCEL_SENTINEL
}

#[cfg(test)]
mod tests {
    use super::{
        format_connect_err, format_connect_ok, format_disconnect, format_mutations,
        format_query_err, format_query_ok, is_cancel_sentinel, launch_log_name,
    };

    // behavior: connect-ok line reports id, engine, table count and elapsed ms
    #[test]
    fn should_format_connect_ok_line_with_id_engine_tables_and_ms() {
        assert_eq!(
            format_connect_ok("db1", "postgres", 12, 34),
            "connect connection_id=db1 engine=postgres tables=12 (34ms)"
        );
    }

    // behavior: connect-error line reports id, engine, elapsed ms and the error message
    #[test]
    fn should_format_connect_err_line_with_id_engine_ms_and_error() {
        assert_eq!(
            format_connect_err("db1", "mysql", 40, "connection refused"),
            "connect connection_id=db1 engine=mysql failed (40ms): connection refused"
        );
    }

    // behavior: disconnect line reports only the connection id
    #[test]
    fn should_format_disconnect_line_with_id() {
        assert_eq!(format_disconnect("db1"), "disconnect connection_id=db1");
    }

    // behavior: query-ok line reports kind, id, statement count, summed rows and ms
    #[test]
    fn should_format_query_ok_line_with_kind_id_statements_rows_and_ms() {
        assert_eq!(
            format_query_ok("sql", "db1", 3, 150, 42),
            "query kind=sql connection_id=db1 statements=3 rows=150 (42ms)"
        );
    }

    // behavior: query-error line reports kind, id, elapsed ms and the error message
    #[test]
    fn should_format_query_err_line_with_kind_id_ms_and_error() {
        assert_eq!(
            format_query_err("mongo", "db1", 5, "bad filter"),
            "query kind=mongo connection_id=db1 failed (5ms): bad filter"
        );
    }

    // behavior: mutations line reports id, table, rows affected and ms
    #[test]
    fn should_format_mutations_line_with_id_table_affected_and_ms() {
        assert_eq!(
            format_mutations("db1", "public.users", 4, 7),
            "mutations connection_id=db1 table=public.users affected=4 (7ms)"
        );
    }

    // behavior: the cancel sentinel is recognised, a normal error is not
    #[test]
    fn should_detect_cancel_sentinel_and_reject_normal_errors() {
        assert!(is_cancel_sentinel("__cancelled__"));
        assert!(!is_cancel_sentinel("connection refused"));
    }

    // behavior
    #[test]
    fn should_format_launch_name_as_dbui_plus_14_digits() {
        assert_eq!(
            launch_log_name(2026, 6, 25, 22, 38, 47),
            "dbui-20260625223847"
        );
    }

    // behavior
    #[test]
    fn should_zero_pad_single_digit_fields() {
        assert_eq!(launch_log_name(2026, 1, 2, 3, 4, 5), "dbui-20260102030405");
    }

    // behavior
    #[test]
    fn should_match_feature_folder_timestamp_shape() {
        let name = launch_log_name(2026, 6, 25, 22, 38, 47);
        let stamp = name
            .strip_prefix("dbui-")
            .expect("name must start with dbui-");
        assert_eq!(stamp.len(), 14);
        assert!(stamp.chars().all(|c| c.is_ascii_digit()));
    }
}
