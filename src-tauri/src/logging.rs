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
    // Stdout. We want exactly Stdout + our single per-launch file.
    let plugin = tauri_plugin_log::Builder::new()
        .targets([
            Target::new(TargetKind::Stdout),
            Target::new(TargetKind::LogDir {
                file_name: Some(log_name.clone()),
            }),
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

#[cfg(test)]
mod tests {
    use super::launch_log_name;

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
