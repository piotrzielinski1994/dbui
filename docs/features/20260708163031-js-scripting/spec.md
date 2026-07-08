# F7 - JS scripting (Script tab)

**Version:** 0.1.0
**Created:** 2026-07-08
**Status:** Draft (spec)
**Source:** `.pzielinski/todos.md` F7.

## 1. Overview

Today the database-card **Script** tab is a dead panel: [script-tab.tsx](../../../src/components/workspace/script-tab.tsx)
renders `node.script` (a mock string) in a static `<pre>` and can execute nothing. F7 turns it into a
real **read-only JavaScript scratchpad** over the connected database.

A user writes JS in a CodeMirror editor, presses **Run**, and the script executes in an isolated
**Web Worker** with an injected `db` API that reads from the live connection (SQL or MongoDB) plus a
`console` that streams to the app's existing bottom **Console** panel. If the script returns a value
of the shape `{ header, rows }`, that value is rendered in the shared read-only `DataGrid`; any other
return renders no grid.

The tab mirrors the SQL tab's UX end to end: **saved-script document tabs** (`+` / `Cmd/Ctrl+S` /
`untitled` / X-delete), a **Run -> Cancel** toolbar bound to the `run-query` shortcut, and per-database
persistence in `workspace.json`. It is added to **all** engines - SQL cards gain a live Script tab and
the MongoDB card gains one alongside its Query tab.

### User Story

As a developer exploring a database, I want to write small JavaScript scripts that query the connected
database and print / tabulate the results, so I can do multi-step reads and light data transforms
(loop over tables, reshape rows, compute summaries) without leaving dbui or hand-writing one big SQL
statement.

### Approved decisions (from brainstorming)

- **Purpose: query DB + transform in JS.** Not a grid-only transform, not automation/seeding, not an
  editor-without-execution.
- **Runtime: frontend Web Worker + async `db` API** that RPCs back to the main thread, which calls the
  existing Tauri commands (`executeSql` / `executeMongo` / `fetchSchema`). NOT main-thread eval, NOT a
  backend JS engine (boa/quickjs). Rust backend is **unchanged** - F7 reuses existing commands only.
- **READ-ONLY.** Scripts cannot write. There are no write helpers (`db.exec` / `db.insert` / etc.), and
  the bridge **blocks** any write-shaped SQL passed to `db.query` (see AC-006) rather than staging it.
  (An earlier idea to route script writes through the Changes tab was dropped: read -> write -> read
  ordering was too ambiguous to be safe in a first cut.)
- **Output: reuse the existing bottom Console panel** for the run log (`console.log/error`, `print`,
  errors, status). A **result grid appears only** when the script returns `{ header, rows }`; any other
  return shows no grid. This is NOT a new dedicated output pane and NOT a fork of the data grid.
- **Persistence: saved-script document tabs**, same UX as the SQL tab, in a **separate** per-database
  array (`savedJsScripts`), NOT the single `script: string` field (which is removed).
- **Run/Cancel: mirror the SQL tab** - Run + `run-query` shortcut (`Cmd/Ctrl+Enter`), Run flips to
  Cancel while running, Cancel terminates the worker.
- **Engine scope: all engines incl. MongoDB.** The `db` API is engine-aware (SQL: `db.query`; Mongo:
  `db.find` / `db.aggregate`).
- **Safety: no auto-kill.** A run that exceeds a few seconds raises a **sticky warning toast**
  (`duration: Infinity`) with a Cancel affordance; it dismisses on click or when the run ends.

## 2. Acceptance Criteria

| ID | Criterion | Priority |
|----|-----------|----------|
| AC-001 | The Script tab is a real editor+runner on ALL engines: `database-card.tsx` shows Script on SQL cards (already listed) and adds it to `MONGO_SECTIONS`; [script-tab.tsx](../../../src/components/workspace/script-tab.tsx) is rewritten (no more mock `<pre>`) with a layout mirroring `sql-tab.tsx` (left: JS editor + saved-script tabs + Run/Cancel; right/bottom: status + optional result grid) | Must |
| AC-002 | Script executes in a **Web Worker** behind a `ScriptRunner` port (real Worker vs injectable mock, like `WindowController`): the user code is wrapped in an `AsyncFunction` inside the worker with `db`, `console`, `print` injected; a `while(true)` loop does NOT freeze the UI | Must |
| AC-003 | The worker reaches the DB via **async RPC to the main thread** (1 call per `await`, no batching): each `db.*` call posts a typed `{id, method, args}` message; a main-thread `ScriptHost` maps it to the existing tauri wrapper and posts back `{id, result|error}`; the worker cannot call Tauri `invoke` directly | Must |
| AC-004 | Injected read API - **SQL** engines: `await db.query(sql)` returns `Array<Record<string, string \| null>>`; `await db.tables()` returns table names; `await db.schema()` returns column metadata (via `fetchSchema`). **MongoDB**: `await db.find(coll, filter?)` and `await db.aggregate(coll, pipeline)` return documents; `db.tables()` / `db.collections()` return collection names; `db.schema()` returns sampled fields | Must |
| AC-005 | `console.log` / `console.error` / `print(...)` stream **live** (each call = one message, not batched at the end) to the existing bottom **Console** panel; a run starts by focusing the Console tab and emitting a run separator/header line; `console.error` lines are visually distinct | Must |
| AC-006 | The API is **read-only**: there are no write methods, and the bridge inspects every SQL string passed to `db.query` - a **write-shaped** statement (leading `INSERT`/`UPDATE`/`DELETE`/`DROP`/`ALTER`/`CREATE`/`TRUNCATE`/`REPLACE`/`MERGE`/`GRANT`/`REVOKE` after stripping leading comments/whitespace) is **rejected** (the call rejects with a `read-only script cannot write` error surfaced in Console) and raises a **sticky warning toast**; the statement never reaches the DB | Must |
| AC-007 | A **result grid** renders **only** when the script's return value validates as `{ header: string[], rows: (string \| null)[][] }` (rows are arrays of the same length as `header`; cells coerced to `string \| null`); it uses the shared read-only `DataGrid` (`editable={false}`, no-op edit handlers), honoring the "ONE data grid" rule. Any other return / `undefined` renders no grid; an ill-shaped `{header,rows}` logs a validation error to Console and renders no grid | Must |
| AC-008 | Run/Cancel mirrors the SQL tab: **Run** is bound to the `run-query` shortcut (`Cmd/Ctrl+Enter`, editor scope) and runs the editor selection if any, else the whole buffer; while running the button is **Cancel**; Cancel calls `worker.terminate()` and shows a neutral **Cancelled** status (not an error). Run requires a live connection (`isConnected`), else disabled with "Connect first (Settings tab)" | Must |
| AC-009 | Status line mirrors `LiveStatus`: `Ready` -> `Running...` -> `Done` (success, no error) / `Cancelled` (neutral, muted) / red `<error.message>` for a script runtime/syntax error (caught in the worker and reported over the bridge); the worker never leaves the UI stuck in `Running...` on an error | Must |
| AC-010 | Scripts persist as **saved-script document tabs** per database, mirroring the SQL tab: a new `savedJsScripts: SavedJsScript[]` (`{ name, code }`) on the database node persisted in `workspace.json`, with provider actions `saveJsScript`/`updateJsScript`/`renameJsScript`/`deleteJsScript`, `activeJsScriptByDb`/`setActiveJsScript`, `jsBuffers`/`setJsBuffer`/`clearJsBuffer`; same untitled + duplicate-name rules as SQL; the dead `script: string` field is removed | Must |
| AC-011 | A run exceeding a few seconds (e.g. 5s) raises a **sticky** warning toast (`duration: Infinity`) with a Cancel action; it is dismissed on click or automatically when the run finishes/cancels; no automatic worker kill | Must |
| AC-012 | Pure, unit-tested logic lives in `src/lib/script/*`: the message protocol, the `method -> tauri call` dispatch map, the write-SQL guard, and the `{header,rows}` validator/coercer. The worker glue and `ScriptHost` are thin wrappers over these | Must |
| AC-013 | `npm run lint`, `npm run typecheck`, `npm test` all exit 0 (no Rust changes; `cargo test` unaffected) | Must |

## 3. User Test Cases

### TC-001 (happy path, SQL): query + print + grid
Connect Postgres/MySQL/SQLite, open the Script tab, run:
```js
const rows = await db.query("select id, name from users limit 3");
console.log(`got ${rows.length} rows`);
return { header: ["id", "name"], rows: rows.map(r => [r.id, r.name]) };
```
**Expected:** Console shows `got 3 rows`; the result grid renders 3 rows / 2 columns; status `Done`.
**Maps to:** AC-001, AC-003, AC-004, AC-005, AC-007, AC-009.

### TC-002 (happy path, MongoDB): find + aggregate
Connect MongoDB, open the Script tab, run a `db.find("orders", {status:"paid"})` and a
`db.aggregate("orders", [...])`, `console.log` a count.
**Expected:** documents returned to the script, Console shows the count, optional grid on a
`{header,rows}` return. **Maps to:** AC-001, AC-004.

### TC-003 (read-only guard): write-SQL blocked
Run `await db.query("update users set name='x' where id=1")`.
**Expected:** the call rejects (`read-only script cannot write` line in Console, red status), a
**sticky** warning toast appears, and the DB is unchanged (the statement never executed).
**Maps to:** AC-006.

### TC-004 (runaway): infinite loop, UI alive, cancel
Run `while (true) {}`.
**Expected:** the app UI stays responsive (sidebar, other tabs clickable); after ~5s a sticky
warning toast appears; pressing **Cancel** (button or toast) terminates the worker and shows
`Cancelled`. **Maps to:** AC-002, AC-008, AC-011.

### TC-005 (error): thrown / syntax error
Run `throw new Error("boom")` (and separately `this is not js`).
**Expected:** red status showing `boom` (and the syntax error message); a Console error line; the UI
is not stuck in `Running...`. **Maps to:** AC-009.

### TC-006 (no grid): plain return
Run `console.log(await db.tables())` with no `{header,rows}` return.
**Expected:** Console lists the table names; **no** result grid; status `Done`. An ill-shaped
`return { header: 1, rows: "x" }` logs a validation error and renders no grid. **Maps to:** AC-005,
AC-007.

### TC-007 (persistence): saved document tabs
Create a new JS script via `+`, type code, `Cmd/Ctrl+S`, name it; reopen the database.
**Expected:** the named JS script persists per database (separate from SQL saved scripts); duplicate
names rejected; `untitled` first-save prompts for a name. **Maps to:** AC-010.

### TC-008 (not connected): Run disabled
Open the Script tab for a disconnected database.
**Expected:** Run is disabled with "Connect first (Settings tab)"; no worker spawned.
**Maps to:** AC-008.

### TC-009 (unit): pure libs
Unit-test the dispatch map, the write-SQL guard (comment/whitespace stripping, each keyword,
false-positives like `select ... -- update`), the `{header,rows}` validator/coercer, and the protocol
round-trip against a mock `ScriptRunner`. **Maps to:** AC-012.

## 4. UI States

| State | Behavior |
| ----- | -------- |
| Disconnected | Run disabled; "Connect first (Settings tab)"; editor + saved tabs still usable |
| Ready | Status `Ready`; no grid |
| Running | Button = **Cancel**; status `Running...`; Console streams lines live |
| Long-running (>5s) | Sticky warning toast with Cancel; still `Running...` until done/cancelled |
| Done (grid) | Status `Done`; result grid rendered from a valid `{header,rows}` |
| Done (no grid) | Status `Done`; no grid (plain/`undefined` return) |
| Cancelled | Neutral muted `Cancelled`; worker terminated |
| Error | Red `<error.message>`; Console error line; no grid |
| Empty database (no JS scripts) | Auto-creates a persisted `untitled` so the user can type immediately (mirrors SQL tab) |

## 5. Data Model

### Frontend model ([model.ts](../../../src/lib/workspace/model.ts))

```ts
export type SavedJsScript = { name: string; code: string };

// on DatabaseNodeBase:
//   savedJsScripts: SavedJsScript[];   // NEW - per-database JS document tabs (workspace.json)
//   script: string;                    // REMOVED (was the dead mock <pre> source)
```

`savedScripts: SavedScript[]` (SQL/Mongo Query) is unchanged and stays separate.

### Script bridge protocol (`src/lib/script/protocol.ts`)

```ts
// worker -> main
type ScriptRpc =
  | { kind: "rpc"; id: string; method: "query" | "tables" | "schema"
                                       | "find" | "aggregate" | "collections";
      args: unknown[] }
  | { kind: "log"; level: "log" | "error"; text: string }
  | { kind: "done"; value: unknown }        // resolved return value
  | { kind: "error"; message: string };     // uncaught error / rejection

// main -> worker
type ScriptReply =
  | { kind: "reply"; id: string; result?: unknown; error?: string }
  | { kind: "start"; code: string; engine: DbEngine };
```

### New / changed files

| File | Change |
| ---- | ------ |
| `src/lib/script/protocol.ts` | NEW - worker<->main message types |
| `src/lib/script/dispatch.ts` | NEW - `method -> tauri call` map + write-SQL guard (pure) |
| `src/lib/script/result.ts` | NEW - `{header,rows}` validator + cell coercion (pure) |
| `src/lib/script/runner.ts` | NEW - `ScriptRunner` port (real Worker vs mock), like `WindowController` |
| `src/lib/script/worker.ts` | NEW - worker entry (`?worker`): AsyncFunction wrap, `db`/`console` stubs |
| `src/components/workspace/script-tab.tsx` | REWRITE - editor + saved tabs + Run/Cancel + status + grid |
| `src/components/workspace/database-card.tsx` | Add `Script` to `MONGO_SECTIONS` |
| `src/components/workspace/workspace-context.tsx` | Add `savedJsScripts` actions + JS buffers + `appendConsoleLine`/`clearConsole`; remove `script` |
| `src/components/workspace/console.tsx` | `clearTarget` returns true for `log` when lines exist; live line append |
| `src/lib/workspace/model.ts` | `SavedJsScript` type; `savedJsScripts` field; remove `script` |
| `src/lib/tauri.ts` | Unchanged (reuse `executeSql`/`executeMongo`/`fetchSchema`) |

## 6. Edge Cases

- **No live connection** -> Run disabled; the worker is never spawned (`db.query` would have no pool).
- **Runaway loop (`while(true)`)** -> worker thread burns, UI stays live; Cancel = `worker.terminate()`;
  sticky toast after ~5s.
- **Thrown / syntax error in script** -> caught in the worker, posted as `{kind:"error"}`, shown red;
  UI never stuck in `Running...`.
- **Cancel mid-RPC** -> `terminate()` drops the worker and any in-flight RPC replies are discarded
  (the corresponding promises never resolve because the worker is gone).
- **Write-shaped SQL in `db.query`** -> rejected on the bridge before `executeSql`, sticky toast, DB
  untouched. Best-effort keyword prefix check (after stripping leading comments/whitespace) - not a
  full SQL parser; documented as such.
- **Non-`{header,rows}` return / ill-shaped** -> no grid; ill-shaped logs a Console validation error.
- **Many `console.log`** -> streamed live per call (not batched), so a long run shows progress.
- **Switching database / content tab mid-run** -> the Script pane is keyed per database (`key={id}`);
  a non-active pane retains its worker/state; switching back shows the same run.
- **jsdom has no real `Worker`** -> behavioral tests inject a mock `ScriptRunner` (no real worker
  spawned), same pattern as `WindowController` for window tests.

## 7. Dependencies

- **One new npm package: `@codemirror/lang-javascript`** (JS syntax highlighting for the editor;
  the repo has `lang-sql` / `lang-json` but not `lang-javascript`). Web Worker is a platform
  primitive; Vite's `?worker` import handles the build - no bundler package needed.
- No new Rust crates or Tauri commands: F7 reuses `execute_sql` / `execute_mongo` / `fetch_schema`.
- Reuses existing FE modules: `DataGrid` (read-only), `TabBar`/`Tab`, `SqlEditor` chrome + theme,
  `HorizontalSplit`, `sonner` toast, the `run-query` shortcut registry action, and the Console panel.

## 8. Out of Scope

- Script **writes** of any kind (Changes-tab staging for scripts, `db.exec`, structured write
  helpers) - explicitly dropped for this cut.
- A backend JS engine, npm module imports, `fetch`/network access, or filesystem access from scripts.
- Batching / connection-pinning RPC optimizations (1 call per `await` is accepted).
- Auto-timeout / hard kill of a long run (sticky toast only).
- Scheduling / saved-run automation.
