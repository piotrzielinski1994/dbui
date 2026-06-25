# F5 - Query session: held pool + transactions + cancel

Feature folder: `docs/features/20260621213419-query-session/` · Branch: `20260621213419-query-session`
Source: `.pzielinski/todos.md` F5 (`#21, #8, #6`).

## Overview

Reverse the "Connect is stateless" architecture. Today every Tauri command opens a fresh
`AnyPool`, runs one statement, and closes it. That blocks three things the user wants:

- `#21` **Held connection pool** - open a pool on connect, hold it keyed by database id, close
  it on disconnect. Commands reuse it instead of reconnecting every call. This is the foundation
  for the other two.
- `#8` **Multi-statement / transactions** - the SQL tab runs several `;`-separated statements in
  order on ONE acquired connection, so a user-written `BEGIN; ...; COMMIT` spans them. Per-statement
  outcomes are reported.
- `#6` **Cancel running query** - a long-running SQL run can be cancelled; the Run control becomes
  a Cancel control while pending. Mirrors requi's `CancellationToken` + `tokio::select!` pattern.

Reuse from `requi` (`~/projects/private/requi/src-tauri/src/lib.rs`): the cancel registry
(`static LazyLock<Mutex<HashMap<requestId, CancellationToken>>>`), the `CancelGuard` Drop that
removes the token on every exit, the `CANCEL_SENTINEL` string, and the `tokio::select! { biased;
_ = token.cancelled() => sentinel, result = work => result }` shape. requi has NO held-pool
precedent (it builds a reqwest client per send), so the registry is dbui-new.

ONE-grid invariant unchanged. The SQL result still renders through `DataGrid` (read-only).

## Acceptance Criteria

- **AC-001**: A connection pool is opened on connect and held in a process-wide registry keyed by
  the database id; it is closed and removed on disconnect. Table/query/schema/count/mutation
  commands reuse the held pool - no per-call open/close.
- **AC-002**: Commands address a connection by id, not by re-sending `config`.
  `connect_database(connectionId, config)` opens + stores the pool and returns the table list;
  `disconnect_database(connectionId)` closes it; `fetch_table(connectionId, ...)`,
  `count_table(connectionId, ...)`, `apply_mutations(connectionId, ...)`,
  `execute_sql(connectionId, sql, requestId)`, `fetch_schema(connectionId)` operate on the held
  pool. `config` is sent only on connect.
- **AC-003**: A command for an id with no held pool returns a clear "not connected" error
  (a `Result::Err` string, never a panic).
- **AC-004**: Multi-statement execution. The SQL tab can run several `;`-separated statements;
  they execute in declared order on ONE connection acquired from the held pool, so a user-written
  `BEGIN`/`COMMIT`/`ROLLBACK` spans the batch (transaction support is a consequence of
  same-connection execution, not an auto-wrap - the user owns transaction control).
- **AC-005**: Statement splitting respects single-quoted strings, double-quoted / backtick
  identifiers, `--` line comments, `/* */` block comments, and Postgres `$tag$` dollar-quoting -
  a `;` inside any of those does not split. Trailing and blank/whitespace/comment-only statements
  are dropped.
- **AC-006**: Per-statement reporting. `execute_sql` returns one outcome per statement
  (columns + rows, or rows-affected, + a message). The SQL tab shows the last row-returning
  statement's result in the grid (or the last outcome's message when none return rows) and logs
  each statement to History. A failing statement stops the batch; its error is reported and prior
  statements remain applied (unless the user wrapped them in a transaction).
- **AC-007**: Cancel. A running `execute_sql` is cancellable by its request id. The Run control
  shows "Cancel" while the run is pending; clicking it (or invoking `cancel_query(requestId)`)
  aborts the run and resolves it to a cancelled state - a neutral "Cancelled" status, NOT a red
  error toast. The registry entry is always cleaned up (success, error, or cancel).
- **AC-008** (regression): Existing behaviors preserved - single-statement run (row grid,
  rows-affected message, error display), History logging, client-side result sort, Copy CSV/JSON,
  table browse + Load more + page size, unbounded count, row mutations (insert/delete/clone/Save),
  schema autocomplete - all still work, now over the held pool.

## Test Cases

- **TC-001** (AC-005, happy): `split_sql_statements("SELECT 1; SELECT 2")` -> `["SELECT 1", "SELECT 2"]`.
- **TC-002** (AC-005): a `;` inside a single-quoted string is not a split point:
  `SELECT 'a;b'` -> one statement.
- **TC-003** (AC-005): a `;` inside a double-quoted identifier and inside a backtick identifier
  is not a split point.
- **TC-004** (AC-005): a `;` inside a `--` line comment and inside a `/* ; */` block comment is
  not a split point.
- **TC-005** (AC-005): a `;` inside a Postgres `$$ ... ; ... $$` (and tagged `$x$ ... $x$`) dollar
  quote is not a split point - a function body with semicolons stays one statement.
- **TC-006** (AC-005): a trailing `;` produces no empty final statement; input of only `;;` or
  only whitespace/comments yields zero statements.
- **TC-007** (AC-004, AC-006): given a multi-statement buffer, the executor runs each statement in
  order on one acquired connection and returns one outcome per statement, in order.
- **TC-008** (AC-007, side-effect-contract): a concurrent cancel of a slow run resolves to the
  cancel sentinel and the registry no longer contains the request id (mirror requi's cancel test;
  races a slow future, not a real DB).
- **TC-009** (AC-007): `cancel_query` for an unknown request id is a no-op (does not panic / error).
- **TC-010** (AC-003): a query/table/schema command for an id with no held pool returns the
  not-connected error (tested at the registry-lookup seam).
- **TC-011** (AC-006, frontend): running a buffer with two statements where the second returns
  rows shows that result set in the grid and logs two History entries.
- **TC-012** (AC-007, frontend): while a run is pending the control reads "Cancel" and clicking it
  calls `cancelQuery(requestId)`; a cancelled result shows a neutral "Cancelled" status, not an
  error.
- **TC-013** (AC-002, frontend regression): `executeSql` is called with `(connectionId, sql,
  requestId)`; `fetchTable`/`countTable`/`applyRowMutations` are called with `connectionId` as the
  first arg; connect calls `connectDatabase(connectionId, config)`; disconnect calls
  `disconnectDatabase(connectionId)`.
- **TC-014** (AC-008, regression): a single-statement SELECT still renders rows in the grid with a
  `SELECT N` message; a single UPDATE still reports rows-affected.

## UI States

| State                 | Behavior                                                                       |
| --------------------- | ------------------------------------------------------------------------------ |
| Not connected         | SQL tab Run disabled, "Connect first (Settings tab)" hint (unchanged).         |
| Idle (connected)      | Run enabled when buffer non-empty; status "Ready".                             |
| Running               | Control reads "Cancel" (enabled); status "Running..."; grid keeps prior result.|
| Cancelled             | Neutral status "Cancelled" (muted, not red); grid unchanged; no error toast.   |
| Success (1 statement) | Grid shows rows (row-returning) or message; status "Success" + message.        |
| Success (N statements)| Grid shows the last row-returning result; status "N statements - OK"; each logged. |
| Error                 | First failing statement's error shown red; prior statements already applied.   |

## Data model

- Rust registry: `static POOLS: LazyLock<Mutex<HashMap<String, AnyPool>>>` (database id -> held
  `AnyPool`), and the requi-style `static CANCELS: LazyLock<Mutex<HashMap<String,
  CancellationToken>>>` (request id -> token). (A Tauri-managed `State` was considered; a static
  matches requi and keeps the free-function command layer - see Decision Log.)
- `execute_sql` returns `Vec<QueryOutcome>` (one per statement) instead of a single `QueryOutcome`.
  `QueryOutcome` shape is unchanged (`columns`, `rows`, `rowsAffected`, `returnsRows`, `message`).
- Frontend `tauri.ts`: signatures change from `(config, ...)` to `(connectionId, ...)`; new
  `disconnectDatabase(connectionId)` and `cancelQuery(requestId)`. `config` is passed only by
  `connectDatabase(connectionId, config)`.

## Edge cases

- Empty buffer / only comments / only `;` -> zero statements -> no-op run (no DB call, neutral status).
- `;` inside string / identifier / comment / dollar-quote -> not split (TC-002..005).
- Cancel after the run already finished -> no-op (token removed by the Drop guard).
- Cancel / command for an unknown or disconnected id -> no-op / not-connected error, no panic.
- Disconnect while a run is in flight -> the run errors on the closed pool (reported), no panic;
  the in-flight token's guard still cleans up.
- A middle statement errors -> batch stops at it; earlier statements stay applied (no auto-rollback).
- Concurrent runs (two tabs, same or different DB) -> held pool has >1 max connections so they run
  concurrently; cancel by request id targets exactly one.
- Connection dropped by the server mid-session -> next command errors; sqlx pool may transparently
  reconnect on a later call. Acceptable for a desktop tool.

## Dependencies

- New Cargo deps: `tokio-util` (for `CancellationToken`), and `tokio` with the `time`/`macros`
  features as needed for `tokio::select!` (tauri already pulls tokio). Mirror requi's versions.
- No new frontend deps (`crypto.randomUUID()` already used for request ids).
- Reverses ADR 2026-06-20 "Connect is stateless" - a new ADR entry records the reversal.
