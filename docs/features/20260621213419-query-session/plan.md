# F5 - Query session: held pool + transactions + cancel - PLAN

Spec: `docs/features/20260621213419-query-session/spec.md`. Branch: `20260621213419-query-session`.

Coverage threshold: none (no `thresholds` in vitest.config / package.json).

## Chosen approach

Three layered slices, built bottom-up. Each is independently testable; together they deliver F5.

### Slice A - Held pool registry (#21, AC-001/002/003)

- Add a process-wide `static POOLS: LazyLock<Mutex<HashMap<String, AnyPool>>>` in `db.rs`,
  keyed by database id (string). Helpers:
  - `store_pool(id, pool)` / `remove_pool(id)` (closes the pool) / `with_pool(id) -> Result<AnyPool,
    String>` cloning the held pool out of the lock (sqlx `AnyPool` is `Clone` + cheap - it's an
    `Arc` over the inner pool, so commands clone the handle and never hold the mutex across `.await`).
  - `not connected` error string for a missing id.
- Pool is opened with `max_connections` > 1 (e.g. 5) so concurrent runs/tabs don't serialize.
- Rewrite every command (`lib.rs`) to take `connection_id: String` instead of `config`
  (except `connect_database`, which still takes `config` to build + store the pool, and returns the
  table list). `db.rs` public fns lose their `connect/close` boilerplate and take `&AnyPool`
  (most already have an inner `read_table_rows(&pool, ...)` / `apply_mutations(&pool, ...)` shape -
  the outer wrappers collapse onto `with_pool`).
- New command `disconnect_database(connection_id)` -> `remove_pool`.
- Tests at the registry seam: store/with/remove round-trip; `with_pool` on a missing id errors.
  (No live DB; can't open a real pool in CI, so the pure registry logic is unit-tested and the
  command wiring is exercised by the frontend mocks.)

### Slice B - Multi-statement + transactions (#8, AC-004/005/006)

- Pure `split_sql_statements(sql: &str) -> Vec<String>` in `db.rs`. A char-scanning splitter
  tracking state: in single-quote, in double-quote, in backtick, in `--` line comment, in `/* */`
  block comment, in `$tag$` dollar-quote. Only a top-level `;` splits. Trim each; drop blank /
  comment-only statements (reuse `strip_leading_noise` to test emptiness). This is the bulk of the
  unit tests (TC-001..006).
- `run_query` (rename internal to operate on a batch): acquire ONE connection from the pool
  (`pool.acquire()`), run each split statement in order on that connection (so `BEGIN`/`COMMIT`
  span them), collect `Vec<QueryOutcome>`. Stop at the first error, returning it. Each statement
  reuses the existing per-engine classify/wrap/execute logic (`run_query_postgres` /
  `run_query_prepared`), refactored to take a `&mut AnyConnection` (or `Executor`) instead of
  `&AnyPool` so they run on the held connection. Keep the Postgres row_to_json path and the
  MySQL/SQLite prepared path intact.
- `execute_sql` command returns `Vec<QueryOutcome>`.
- Frontend `sql-tab.tsx`: `run.data` becomes `QueryOutcome[]`. Show the LAST row-returning outcome
  in `OutcomeGrid` (or last outcome's message if none return rows). Status: "N statements - OK" for
  N>1, else current single-message behavior. Log each outcome to History (one entry per statement).

### Slice C - Cancel (#6, AC-007)

- Port requi verbatim where possible: `CANCEL_SENTINEL`, `static CANCELS: LazyLock<Mutex<HashMap<
  String, CancellationToken>>>`, `CancelGuard { request_id }` with `Drop` removing the token.
- `execute_sql(connection_id, sql, request_id)`: register a token, guard it, wrap the batch run in
  `tokio::select! { biased; _ = token.cancelled() => Err(CANCEL_SENTINEL), result = run_batch =>
  result }`. (The batch is a single future; cancel aborts between/within statements at the next
  await point - acceptable; sqlx has no mid-statement kill without a server-side `pg_cancel`, which
  is out of scope for this slice. Document that.)
- `cancel_query(request_id)` command: look up + `.cancel()` the token (no-op if absent).
- Frontend: `sql-tab.tsx` generates a `requestId` (`crypto.randomUUID()`) per run, passes it to
  `executeSql`, and the Run button becomes "Cancel" while `run.isPending`, calling
  `cancelQuery(requestId)`. A result equal to the sentinel (surfaced as a tagged error) renders as
  a neutral "Cancelled" status, not a red error / toast, and is NOT logged to History as an error.
- Test: requi-style concurrent-cancel against a slow future (a `tokio::time::sleep` stand-in for a
  slow query, since no live DB), asserting the sentinel + registry cleanup (TC-008); unknown-id
  no-op (TC-009).

## Files to change

Backend:

- `src-tauri/Cargo.toml` - add `tokio` (`sync`, `macros`, `rt-multi-thread`) + `tokio-util` (`rt`),
  mirroring requi.
- `src-tauri/src/db.rs` - pool registry helpers; `split_sql_statements`; refactor
  `run_query`/`run_query_postgres`/`run_query_prepared` onto a held connection + batch loop;
  `fetch_table_rows`/`count_table_rows`/`apply_row_mutations`/`fetch_schema`/`list_tables` to take
  the held pool via id; cancel registry + sentinel + guard; new tests.
- `src-tauri/src/lib.rs` - command signatures to `connection_id` (+ `request_id` on execute);
  `connect_database` stores the pool; new `disconnect_database`, `cancel_query`; register handlers.

Frontend:

- `src/lib/tauri.ts` - signatures to `connectionId`-first; `executeSql(connectionId, sql,
  requestId): Promise<QueryOutcome[]>`; add `disconnectDatabase`, `cancelQuery`; `QueryOutcome`
  unchanged.
- `src/components/workspace/use-connection.ts` - `connect(id, config)` passes id; `disconnect` calls
  `disconnectDatabase(id)`.
- `src/components/workspace/sql-tab.tsx` - request id per run; Cancel control; `QueryOutcome[]`
  handling (last row-returning result + per-statement History + cancelled status).
- `src/components/workspace/table-card.tsx` - `fetchTable`/`countTable`/`applyRowMutations` calls
  pass the database id instead of `config` (the card has `databaseId` already).
- Tests: update mocks/assertions for the id-first signatures (`sql-run`, `table-content`,
  `row-mutations`, `connection-schema`, `settings-tab`, `database-card`, `row-context-menu`,
  `tab-revisit`, `sidebar-tree`); new `sql-multi-statement` + cancel coverage.

## Edge cases handled (from spec)

Empty/comment-only/`;`-only buffer -> zero statements -> neutral no-op. `;` in
string/identifier/comment/dollar-quote not split. Cancel after finish / unknown id -> no-op.
Disconnect mid-run -> reported error, no panic, guard cleans up. Mid-batch error -> stop, prior
statements applied. Not-connected id -> error string.

## Tests to write (>= one per AC)

- Rust (db.rs): `split_sql_statements` (TC-001..006, ~8 cases incl. dollar-quote, identifiers,
  comments, trailing `;`); registry store/with/remove + missing-id error (TC-010); cancel sentinel
  + cleanup (TC-008) + unknown-id no-op (TC-009); batch runner returns Vec in order (TC-007, pure
  over the splitter where a live pool isn't needed - the batch loop's DB part is covered by FE
  mocks).
- Frontend: multi-statement result + History (TC-011); cancel control + neutral cancelled status
  (TC-012); id-first call signatures across the boundary (TC-013); single-statement regression
  (TC-014). Plus the existing suites updated to the new signatures.

## Acceptance verification

Verifier subagent (fresh context) runs: `npm test`, `cargo test` (in src-tauri), lint, typecheck;
checks each AC has a non-tautological test; probes the UI states + edge cases. Live smoke (user):
held pool persists across queries, `BEGIN; ...; COMMIT` in SQL tab, Cancel a slow query.

## Risks

- Signature churn breaks many FE tests (`toHaveBeenCalledWith(config, ...)`): mechanical but wide -
  mitigate by doing it in one pass, leaning on the test-writer + verifier to catch misses.
- sqlx `prepare()`/`execute()` on a `&mut AnyConnection` vs `&AnyPool` may need trait-import tweaks
  (`Executor` is impl'd for `&mut AnyConnection`): mitigate by keeping the per-statement fns generic
  over an executor or threading the connection explicitly.
- Cancel granularity: a statement already sent to the DB keeps running server-side until its await
  point yields; true server-side kill (pg_cancel) is out of scope - document the limitation.
- No live DB in CI: batch/pool DB round-trips can't be integration-tested here; covered by pure
  unit tests (splitter, registry, classifier) + FE mocks. Same constraint as every prior backend
  slice.
