# Plan - F9 file logs (backend parity with vidui)

## Approach

Pure/impure split, mirroring vidui's `logging.rs` (`launch_log_name` pure + tested,
`current_launch_log_name` impure shell):

- **Pure, in `logging.rs`** (unit-tested): six `format_*` fns building the `key=value` line as a
  `String`, and one `is_cancel_sentinel(error)` guard so the cancel-suppression rule is testable in
  one place.
- **Impure, in `lib.rs` dispatcher**: wrap each command's awaited call in `Instant::now()`,
  compute `elapsed().as_millis()`, then `log::info!`/`log::error!` the formatted line. The
  dispatcher is the SQL-vs-Mongo seam - logging there covers both engines with one call site each.

No new crate, no new log target - reuses the per-launch file already registered by
`logging::init`.

## Files

- `src-tauri/src/logging.rs` (modify): add `format_connect_ok`, `format_connect_err`,
  `format_disconnect`, `format_query_ok`, `format_query_err`, `format_mutations`, and
  `is_cancel_sentinel`. Add `#[cfg(test)]` unit tests (TC-001..007) alongside the existing
  `launch_log_name` tests.
- `src-tauri/src/lib.rs` (modify): in `connect_database`, `disconnect_database`, `execute_sql`,
  `execute_mongo`, `apply_mutations` - time the awaited call and emit one line. Import the sentinels
  (`db::CANCEL_SENTINEL`, `db::connect_cancel_key` not needed; the connect + query cancel both use
  the same `__cancelled__` string via `CANCEL_SENTINEL`) - `is_cancel_sentinel` compares to it.
- `docs/features/20260708110914-console-file-logs/spec.md` (done).

## Key decisions

- Formatters take primitives (`&str`, `u64`, `u128`), never structs or the clock -> trivially
  testable, no fixtures.
- `engine` for the connect line comes from `config_engine(&config)` (already in `lib.rs`),
  defaulting to `"?"` when the tag is absent (E-3). Success path can read the engine off the held
  connection is unnecessary - the request config already carries it.
- Query `kind` is a literal `"sql"` / `"mongo"` at each call site (the two commands are already
  separate fns).
- Row sum for the query-ok line: `outcomes.iter().map(|o| o.rows.len()).sum()` (rows returned);
  statement count = `outcomes.len()`.

## Edge cases handled

- E-1 cancel: `if is_cancel_sentinel(err) { /* no log */ }` before the error line in connect + both
  query commands.
- E-2 multi-statement: sum + count in one line.
- E-3 unknown engine: `config_engine(...).unwrap_or("?")`.
- E-4 zero rows/affected: formatters print `0` unconditionally.
- E-5 unwritable log dir: pre-handled by `logging::init`; call sites just use the facade.

## Tests to write (RED first)

Rust unit tests in `logging.rs`:
- TC-001..006: one per formatter, exact string assertions.
- TC-007: `is_cancel_sentinel("__cancelled__")` is true; a normal error is false.

No new frontend tests (no FE change). TC-008 is the full-suite green gate.

## Execution order

1. RED: add the 7 formatter/guard tests (fail - fns don't exist).
2. GREEN: implement the pure fns in `logging.rs` -> tests pass.
3. GREEN: wire the call sites in `lib.rs` (timing + emit).
4. REFACTOR: dedupe any shared line-building; keep formatters flat.
5. VERIFY: `cargo test` (manifest `src-tauri/Cargo.toml`) + `npm test` both green; `cargo clippy`.

## Acceptance verification

- AC-001 <- TC-001..006 (formatter unit tests).
- AC-002 <- connect call-site branch + TC-007 (cancel guard); manual: connect ok/err lines in file.
- AC-003 <- disconnect call-site; TC-003.
- AC-004 <- execute_sql/execute_mongo call-sites + TC-007 cancel guard; TC-004/005.
- AC-005 <- apply_mutations call-site; TC-006.
- AC-006 <- `Instant` in each command (code review; formatters take the pre-computed ms).
- AC-007 <- full `cargo test` + Vitest green (TC-008), return types untouched.
