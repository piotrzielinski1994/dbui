# Plan - file logging

Mirror `requi`'s logging setup (the newest, most refined of the three sibling apps) into `dbui`, adapting the app name `requi`/`vidui` -> `dbui`. Omit requi's `log:default` capability: `log:default` gates the official `@tauri-apps/plugin-log` JS API (which dbui never imports); the custom `log_message` invoke command is covered by `core:default`. Build-time capability-schema validation confirms no permission error.

## Files to create / modify

### Backend (`src-tauri/`)

1. `Cargo.toml` - add deps:
   - `tauri-plugin-log = "2"`
   - `log = "0.4"`
   - `chrono = { version = "0.4", default-features = false, features = ["clock"] }`

2. `src/logging.rs` (NEW) - port of `requi/src-tauri/src/logging.rs`, `requi-` -> `dbui-`:
   - `launch_log_name(year, month, day, hour, minute, second) -> String` (pure, tested).
   - `current_launch_log_name() -> String` (reads `chrono::Local::now()`).
   - `init<R>(app: &AppHandle<R>)` - builds `tauri-plugin-log` with `targets([Stdout, LogDir{file_name: Some(stem)}])`, `Info`, `KeepAll`, `max_file_size(50_000_000)`; best-effort - on plugin error print `"dbui: file logging disabled (log dir unwritable)"` to stderr and return.
   - `log_message(level: String, message: String)` Tauri command - match level -> `log::error!/warn!/debug!/info!`.
   - `#[cfg(test)] mod tests` - 3 unit tests (TC-001..003).

3. `src/lib.rs`:
   - add `mod logging;`
   - add `.setup(|app| { logging::init(app.handle()); Ok(()) })` to the builder chain.
   - add `logging::log_message` to `generate_handler!`.

### Frontend (`src/`)

4. `src/lib/logging/file-log.ts` (NEW) - port of requi:
   - `export type LogLevel = "info" | "warn" | "error" | "debug";`
   - `logMessage(level, message)` -> `try { await invoke("log_message", { level, message }) } catch {}`.

5. `src/lib/logging/__tests__/file-log.test.ts` (NEW) - TC-004, TC-005 (vitest, mock `@tauri-apps/api/core`).

6. `src/lib/settings/tauri-store.ts` - replace `console.warn("Failed to persist settings", error)` with `logMessage("warn", \`Failed to persist settings: ${String(error)}\`)`.

7. `src/lib/workspace/tauri-store.ts` - replace `console.warn("Failed to persist workspace", error)` with `logMessage("warn", \`Failed to persist workspace: ${String(error)}\`)`.

## Chosen approach

Straight mirror of the established sibling-repo pattern (`tauri-plugin-log`). No alternatives debated - this is the codified convention across vidui + requi. `pz-ddd` / `pz-archetypes`: neither applies (pure infra plumbing, no domain model).

## Edge cases handled

- Unwritable log dir -> skip + stderr + continue (AC-003).
- Non-Tauri host on FE -> invoke rejects -> swallowed (AC-005).
- Unknown level -> `info` fallback (AC-004).

## Tests to write (TDD)

- Rust unit (`logging.rs` tests): TC-001, TC-002, TC-003 -> `cargo test`.
- Frontend (`file-log.test.ts`): TC-004, TC-005 -> `npm test`.
- AC-002/003/004/006 are runtime/wiring assertions verified via build + manual launch (no unit harness for plugin registration); covered by the verifier's gate run + diff review.

## Acceptance verification

- `cargo test` green (Rust helpers).
- `npm test` green (FE helper).
- `cargo build` / `npm run build` compile clean with new deps + wiring.
- Diff review confirms AC-002/004/006 wiring matches requi.
