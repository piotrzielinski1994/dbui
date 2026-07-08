# F9 - Real file logs (backend parity with vidui)

Feature folder: `docs/features/20260708110914-console-file-logs/`
Branch: `20260708110914-console-file-logs`
Source: `.pzielinski/todos.md` F9 `[#24]` (Console = real logs), scoped to the file-log slice.

## Overview

vidui writes rich per-launch file logs (`vidui-<ts>.log` via `tauri-plugin-log`), emitting a
`log::info!`/`log::error!` line for every meaningful backend operation (`media.rs`, HLS server,
etc.). dbui already has the SAME plumbing - `logging.rs` (per-launch `dbui-<ts>.log` in the OS
app-log dir) + the `log_message` FE bridge (`file-log.ts`) - but the backend emits almost nothing
beyond the startup line, so a session's log file is empty of the operations a user cares about.

This feature brings dbui's backend file logging to parity with vidui: every connection-addressed
command (connect / disconnect / query / mutations) writes a structured `key=value` log line with
outcome, row/table counts, and elapsed time. Logs land in the existing per-launch file (and
stdout) - no new plugin, no new target.

**Scope: backend file logs only.** The Console UI tab is explicitly OUT of scope (the user chose
"Tylko file logs (jak vidui)"). The tab stays as-is (empty `consoleLines`); History/Changes tabs
already show query/edit events in-app.

## Why

- The log file is the crash/debug artifact. vidui's is rich; dbui's is empty of operations, so a
  bug report ("connect hung", "a query failed") has nothing to correlate against.
- The plumbing (`logging.rs`, per-launch file, `log::` facade) already exists - the only gap is
  call sites. Cheap, high-value parity.
- Centralizing the emission at the `lib.rs` dispatcher (the existing SQL-vs-Mongo seam) covers
  both engines uniformly without duplicating log lines across `db.rs` and `mongo.rs`.

## Acceptance criteria

- AC-001: `logging.rs` exposes PURE, unit-tested formatters that build each log line as a
  `key=value` string (no clock, no I/O): a connect-ok line (id, engine, table count, ms), a
  connect-error line (id, engine, ms, error), a disconnect line (id), a query-ok line (kind
  `sql`/`mongo`, id, statement count, total rows, ms), a query-error line (kind, id, ms, error),
  and a mutations line (id, table, rows affected, ms).
- AC-002: `connect_database` logs exactly one line on completion: on success an info connect-ok
  line naming the engine and table count; on a real failure an error connect-error line carrying
  the error message. A user-cancelled connect (the `__cancelled__` sentinel) logs NO error line
  (it is neutral, mirroring the FE which suppresses its toast).
- AC-003: `disconnect_database` logs one info disconnect line for the connection id.
- AC-004: `execute_sql` and `execute_mongo` each log exactly one line per invocation: on success
  an info query-ok line with the statement count, summed row count across outcomes, and elapsed
  ms; on a real failure an error query-error line with the message. A cancelled run (the query
  cancel sentinel) logs NO error line.
- AC-005: `apply_mutations` logs one info mutations line (id, table, rows affected, ms) on success;
  on failure an error line carrying the message.
- AC-006: Elapsed time is measured with `std::time::Instant` around the awaited call in each
  command; the pure formatter receives the already-computed `u128` millis, so it stays clock-free
  and testable.
- AC-007: No behavior change to any command's return value or the existing tests: logging is a
  pure side channel. The full `cargo test` suite and the Vitest suite stay green.

## Test cases

- TC-001 (AC-001, behavior): `format_connect_ok("db1", "postgres", 12, 34)` ->
  `connect id=db1 engine=postgres tables=12 (34ms)`. Maps to: AC-001.
- TC-002 (AC-001, behavior): `format_connect_err("db1", "mysql", 40, "connection refused")` ->
  `connect id=db1 engine=mysql failed (40ms): connection refused`. Maps to: AC-001.
- TC-003 (AC-001, behavior): `format_disconnect("db1")` -> `disconnect id=db1`. Maps to: AC-001.
- TC-004 (AC-001, behavior): `format_query_ok("sql", "db1", 3, 150, 42)` ->
  `query kind=sql id=db1 statements=3 rows=150 (42ms)`. Maps to: AC-001.
- TC-005 (AC-001, behavior): `format_query_err("mongo", "db1", 5, "bad filter")` ->
  `query kind=mongo id=db1 failed (5ms): bad filter`. Maps to: AC-001.
- TC-006 (AC-001, behavior): `format_mutations("db1", "public.users", 4, 7)` ->
  `mutations id=db1 table=public.users affected=4 (7ms)`. Maps to: AC-001.
- TC-007 (AC-002, behavior): the connect-error formatter is NOT invoked for the `__cancelled__`
  sentinel - a helper (or the branch under test) returns `None`/skips for the sentinel so no error
  line is built. Maps to: AC-002, AC-004 (same cancel-suppression rule).
- TC-008 (AC-007, structural): full `cargo test` + Vitest suites pass; command return types
  unchanged. Maps to: AC-007.

## Log-line format (the durable contract these tests pin)

```
connect id=<id> engine=<engine> tables=<n> (<ms>ms)
connect id=<id> engine=<engine> failed (<ms>ms): <error>
disconnect id=<id>
query kind=<sql|mongo> id=<id> statements=<n> rows=<n> (<ms>ms)
query kind=<sql|mongo> id=<id> failed (<ms>ms): <error>
mutations id=<id> table=<table> affected=<n> (<ms>ms)
```

`key=value` (space-separated), elapsed in trailing `(<ms>ms)`, mirroring the terse structured
style vidui uses in `media.rs`. One line per command invocation (NOT per `;`-separated statement -
the in-app History tab already gives per-statement granularity; the file log stays low-noise).

## Data model

No shape change. New: pure formatter fns + a cancel-sentinel guard in `logging.rs`. The sentinel
constants already exist in `db.rs` (connect + query cancel); the dispatcher compares against them
before building an error line.

## Edge cases

- E-1 (cancel is not an error): a cancelled connect/query rejects with a sentinel string. It must
  NOT produce an error log line (would spam the log on every user Cancel). Guarded at the call
  site by comparing the error to the sentinel.
- E-2 (multi-statement query): `execute_sql` can return N outcomes; the query-ok line sums rows
  across them and reports the statement count - one line, not N.
- E-3 (engine unknown at connect-error time): `config_engine` returns `Option<&str>`; when absent
  (a malformed config) the line logs `engine=?` rather than crashing.
- E-4 (empty result / 0 rows / 0 affected): logs `rows=0` / `affected=0` normally - not an error.
- E-5 (log dir unwritable): already handled by `logging::init` (file logging is best-effort and
  skipped); these call sites just use the `log::` facade, which is a no-op if no target took.

## UI States

No UI. The only observable change is the content of the per-launch log file
(`~/Library/Logs/com.pzielinski.dbui/dbui-<ts>.log`) and stdout.

## Dependencies

- None new. `log`, `tauri-plugin-log`, `logging.rs` already present. Touches `logging.rs` (new
  formatters + tests) and `lib.rs` (call sites + `Instant` timing).

## Infrastructure Prerequisites

| Category              | Requirement |
| --------------------- | ----------- |
| Environment variables | N/A         |
| Registry images       | N/A         |
| Cloud quotas          | N/A         |
| Network reachability  | N/A         |
| CI status             | N/A         |
| External secrets      | N/A         |
| Database migrations   | N/A         |

Verification before implementation: N/A - purely additive backend logging, no runtime prerequisites.

## Out of scope

- The Console UI tab wiring (in-memory `consoleLines` from real events). Deferred; History/Changes
  already surface query/edit events in-app.
- Script-tab output to logs (F7 script runner is a dead `<pre>`, nothing to log yet).
- Per-statement file log lines (History tab covers per-statement in-app).
- `fetch_table`/`count_table`/`fetch_schema` logging (read paths, high-frequency, low debug value;
  can be added at `debug` level later if needed).

## Status

DONE (2026-07-08, branch `20260708110914-console-file-logs`). Backend file-log parity with vidui:
6 pure formatters + `is_cancel_sentinel` in `logging.rs` (10 unit tests), emission wired at the
`lib.rs` dispatcher for connect/disconnect/execute_sql/execute_mongo/apply_mutations with `Instant`
timing. Cancel sentinel suppresses error lines; a malformed-config connect now folds into the
logged result (no silent early-`?`). Console UI tab deferred (out of scope). `cargo test` 130 green,
Vitest 849 green, clippy clean on the diff.

## AC traceability

| AC     | Proven by |
| ------ | --------- |
| AC-001 | `logging::tests::should_format_connect_ok_line_*` / `_connect_err_*` / `_disconnect_*` / `_query_ok_*` / `_query_err_*` / `_mutations_*` / `should_detect_cancel_sentinel_*` (TC-001..007, exact-string asserts) |
| AC-002 | `connect_database` call site (`lib.rs`): single `match &result` arm, cancel guard via `is_cancel_sentinel`, deserialize error folded into `result`; TC-007 |
| AC-003 | `disconnect_database` call site: one `format_disconnect` info line; TC-003 |
| AC-004 | `execute_sql`/`execute_mongo` -> `log_query_outcome` (sums rows, statements=len, cancel-guarded); TC-004/005/007 |
| AC-005 | `apply_mutations` call site: `format_mutations` on ok, error line on failure; TC-006 |
| AC-006 | `Instant::now()` + `.elapsed().as_millis()` wraps the awaited call in all 4 commands (code) |
| AC-007 | full `cargo test` (130) + Vitest (849) green; return types unchanged |

## Decision Log

| Date       | Decision | Rationale |
| ---------- | -------- | --------- |
| 2026-07-08 | Domain-modeling gate: evaluated `pz-ddd` + `pz-archetypes`; neither invoked. | Pure infra/plumbing (structured file logging). No domain model, boundary, aggregate, or recurring domain shape - it is a cross-cutting side channel. |
| 2026-07-08 | Emit logs at the `lib.rs` dispatcher, not inside `db.rs`/`mongo.rs`. | The dispatcher is the existing SQL-vs-Mongo seam; one call site per command covers both engines and avoids duplicate lines. Pure formatters live in `logging.rs` (testable), the impure `Instant`+`log::` shell stays in `lib.rs`, mirroring vidui's pure/impure split (`launch_log_name` vs `current_launch_log_name`). |
| 2026-07-08 | One file-log line per command invocation, not per `;`-statement. | Keeps the log low-noise; the in-app History tab already gives per-statement granularity. |
| 2026-07-08 | Scope = file logs only, Console UI tab deferred. | User chose "Tylko file logs (jak vidui)". |

## Risks

- Log noise from read paths: mitigated by scoping to connect/disconnect/query/mutations only (read
  paths excluded).
- Cancel-sentinel spam: mitigated by E-1 guard (no error line for sentinels).
