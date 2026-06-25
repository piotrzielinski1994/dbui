# File logging

## Overview

DbUI currently has no logging infrastructure: no `tauri-plugin-log`, no logger init, and the only logging-like calls are two frontend `console.warn` statements that vanish with the dev console. Mirror the file-logging setup already proven in the sibling Tauri apps `vidui` and (most recently) `requi`: backend logs to a per-launch file in the OS app-log dir, and the frontend forwards leveled lines into that same file via a custom Tauri command.

This is a plumbing/infra feature. It introduces no domain model.

## Why

- Diagnose user-reported issues from a durable artifact instead of an ephemeral dev console.
- Capture backend panics/errors and frontend persistence failures (settings/workspace save) in one timeline.
- Match the conventions of the sibling repos so the three apps are operationally identical.

## Acceptance criteria

- AC-001: A pure helper produces the per-launch log file stem `dbui-<YYYYMMDDHHMMSS>` (14 zero-padded digits) from decomposed local date/time components.
- AC-002: On app launch, file logging is registered best-effort - one file `dbui-<timestamp>.log` per launch in the OS app-log dir (macOS `~/Library/Logs/com.pzielinski.dbui/`), plus stdout, at `Info` level, `KeepAll` rotation, 50 MB max size.
- AC-003: If the log dir is unwritable, the app still launches (logging is skipped, a stderr line is printed) - logging never blocks startup.
- AC-004: A `log_message` Tauri command maps a string level (`error`/`warn`/`debug`/else->`info`) to the matching `log` macro, writing into the same per-launch file as the backend's own logs.
- AC-005: A frontend `logMessage(level, message)` helper invokes `log_message`; it is best-effort - a no-op outside a Tauri host (invoke rejects) and never throws.
- AC-006: The two existing `console.warn` persistence-failure sites (settings store, workspace store) route through `logMessage("warn", ...)` so the failures land in the file log.

## Test cases

- TC-001 (happy path): `launch_log_name(2026, 6, 25, 22, 38, 47)` -> `"dbui-20260625223847"`. Maps to: AC-001
- TC-002 (edge - padding): `launch_log_name(2026, 1, 2, 3, 4, 5)` -> `"dbui-20260102030405"`. Maps to: AC-001
- TC-003 (shape): stem after `dbui-` is exactly 14 ASCII digits. Maps to: AC-001
- TC-004 (side-effect-contract): `logMessage("warn", "x")` invokes `log_message` with `{ level: "warn", message: "x" }`. Maps to: AC-005
- TC-005 (edge - no host): when `invoke` rejects, `logMessage` resolves `undefined` and does not throw. Maps to: AC-005

## Edge cases

- Log dir unwritable -> skip plugin, print stderr, continue launch (AC-003).
- Frontend running outside a Tauri host (vitest/browser) -> `invoke` rejects -> swallow, no-op (AC-005).
- Backend `init` is idempotent per launch (called once in `.setup`); not re-entrant.
- Unknown/empty level string in `log_message` -> defaults to `info` (AC-004).

## Data model

N/A - no domain model. The only data shape is the wire payload `{ level: string, message: string }` for the `log_message` command.

## Dependencies

- Rust: `tauri-plugin-log = "2"`, `log = "0.4"`, `chrono = { version = "0.4", default-features = false, features = ["clock"] }`.
- No new frontend npm deps (`@tauri-apps/api` already present). No `log:default` capability needed: `log:default` gates the official `@tauri-apps/plugin-log` JS API, which dbui never imports - the frontend routes through our own custom `log_message` command, permitted by `core:default`. (requi keeps `log:default` because of unrelated history; it is not required here.)
