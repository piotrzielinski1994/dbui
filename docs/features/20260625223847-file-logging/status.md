# Status - file logging - DONE

Branch: `20260625223847-file-logging`. All ACs + quality gates verified by a fresh verifier subagent.

## AC -> test/code traceability

| AC | What | Proof |
| --- | --- | --- |
| AC-001 | per-launch stem `dbui-<YYYYMMDDHHMMSS>` | `src-tauri/src/logging.rs:5` + tests `should_format_launch_name_as_dbui_plus_14_digits`, `should_zero_pad_single_digit_fields`, `should_match_feature_folder_timestamp_shape` (TC-001/002/003) |
| AC-002 | plugin: Stdout+LogDir, Info, KeepAll, 50MB | `src-tauri/src/logging.rs:37-61`; registered `src-tauri/src/lib.rs` `.setup` |
| AC-003 | best-effort, never blocks launch | `src-tauri/src/logging.rs:56-59` (stderr + return on plugin error) |
| AC-004 | `log_message` level mapping | `src-tauri/src/logging.rs:66-74`; registered in `generate_handler!` |
| AC-005 | FE `logMessage` best-effort | `src/lib/logging/file-log.ts` + tests `file-log.test.ts` (TC-004/005) |
| AC-006 | two `console.warn` sites routed to file log | `src/lib/settings/tauri-store.ts`, `src/lib/workspace/tauri-store.ts` (grep: zero `console.warn` left) |

## Gates (verifier-confirmed)

- FE lint: 0 errors (10 pre-existing warnings).
- FE typecheck: clean.
- FE tests: 398 passed.
- Rust tests: 89 passed (incl. 3 new logging).
- Rust build + clippy: clean (1 pre-existing db.rs warning only).

## Decision Log

| Date | Decision | Rationale |
| --- | --- | --- |
| 2026-06-25 | Mirror requi/vidui `tauri-plugin-log` setup verbatim (app name -> dbui) | Codified convention across the 3 sibling Tauri apps; no alternatives to debate |
| 2026-06-25 | pz-ddd / pz-archetypes: neither applies | Pure infra plumbing, no domain model, no boundaries/aggregates |
| 2026-06-25 | Omit `log:default` capability | Gates the official plugin-log JS API which dbui never imports; custom `log_message` covered by `core:default`; build-time schema validation passes |
| 2026-06-25 | Reword spec/plan rationale after verifier flagged "proven in vidui" as inaccurate | vidui has no FE log bridge; correct justification is the permission model |
