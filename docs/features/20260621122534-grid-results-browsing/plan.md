# F2 - Grid & results browsing - Plan

How. Implements [spec.md](spec.md). Order is dependency-driven: #13 (shape change) first since
pagination/sort build on the same query + command surface.

## Approach & key decisions

- **#13 first (TableRows shape).** `columns: Vec<String>` -> `columns: Vec<TableColumn>` ripples
  everywhere `TableRows` is read. Land it before sort/paging so those build on the final shape.
- **Server-side sort + offset for the table card; client-side sort for SQL result.** Table card
  owns its query (`build_rows_query`) and `information_schema` types, so `ORDER BY`/`OFFSET` belong
  server-side over the whole table. The SQL result is arbitrary user SQL already capped at `LIMIT N`;
  re-running with ORDER BY would need to rewrite user SQL, so it sorts the in-memory rows
  client-side via `@tanstack/react-table`'s sorting model.
- **DataGrid stays presentation-only and shared.** It gains optional props (column meta, sort state,
  onSortColumn) that DEFAULT to today's behavior. It does NOT sort or page internally - the caller
  supplies ordered/accumulated rows. Keeps the ONE-grid invariant: table card and SQL result render
  through the same component; SQL result wires client sort, table card wires server sort.
- **#26 declined per user:** filter input wrapped verbatim as `WHERE (<input>)`. Add the parens in
  `build_rows_query` (was `WHERE <expr>`); a malformed expr errors at the DB. No builder, no params.
- **Export = clipboard.** Pure frontend `toCsv`/`toJson` over `(columns, rows)` + `navigator.clipboard`.
  No Tauri dialog/fs plugin. Copy CSV + Copy JSON controls on both grids' footers.
- **Pagination = load-more/append (DBeaver segment fetch).** Footer "Load more" appends the next
  `LIMIT/OFFSET` page; absent when a short page returns. Sort/filter change resets to offset 0.
- **Delete dead `result-grid.tsx`** (no importers; SQL tab already uses `DataGrid`).

## Files

### Backend (`src-tauri/src/db.rs`, `src-tauri/src/lib.rs`)

- `db.rs`: new `TableColumn { name, data_type, nullable, is_primary_key }` (Serialize, camelCase).
  `TableRows.columns: Vec<TableColumn>`.
- `db.rs`: `nullable_query(engine)` (or fold into a single metadata read): PG/MySQL
  `is_nullable` from `information_schema.columns`; SQLite `notnull` from `pragma_table_info`
  (invert: `notnull=0` => nullable). Reuse existing `column_types_query`/`primary_key_query`.
- `db.rs`: `read_table_rows` assembles `Vec<TableColumn>` (zip names+types+nullable, mark pk).
- `db.rs`: `Sort { column, descending }` (Deserialize). `build_rows_query(engine, table, columns,
  limit, offset, filter, sort)` -> appends `ORDER BY <quoted col>[ DESC]` then `LIMIT n OFFSET m`;
  filter becomes `WHERE (<expr>)`. Validate `sort.column` against known columns (ignore if unknown).
- `db.rs`: `fetch_table_rows(config, table, limit, offset, filter, sort)`.
- `lib.rs`: `fetch_table` command gains `offset`, `sort` params.

### Frontend

- `src/lib/workspace/model.ts`: `TableColumn` type; `TableRows.columns: TableColumn[]`.
- `src/lib/tauri.ts`: `fetchTable(config, table, opts?: { filter?; offset?; sort? })`; `Sort` type.
- `src/lib/export.ts` (new): `toCsv(columns, rows)`, `toJson(columns, rows)` - pure, unit-tested.
- `src/components/workspace/data-grid.tsx`: optional `columnMeta`, `sort`, `onSortColumn` props.
  Header renders name + type/PK/NN subheader (when meta present) + sort arrow; click calls
  `onSortColumn`. No internal sorting/paging.
- `src/components/workspace/table-card.tsx`: server sort state (column/dir cycle), accumulated
  pages (append), offset; Load-more footer; reset paging on filter/sort change; Copy CSV/JSON.
  `staticColumns`/`staticRows` updated for the new column shape.
- `src/components/workspace/sql-tab.tsx` (`OutcomeGrid`): client sort state over `outcome.rows`;
  pass `sort`/`onSortColumn` to DataGrid; Copy CSV/JSON footer.
- Delete `src/components/workspace/result-grid.tsx`.

## Execution order (TDD, one AC-ish per commit)

1. #13 backend: `TableColumn` + metadata assembly + `build_rows_query` accepts (unused yet) offset/sort. Rust tests.
2. #13 frontend: model + `DataGrid` type subheader; table-card consumes new shape. (AC-004)
3. #5 + #2/#3 sort server-side: `ORDER BY` in builder + table-card header click cycle + arrow. (AC-002)
4. #4 pagination: offset/append + Load more footer; reset on sort/filter. (AC-001, AC-003)
5. #5 filter parens: `WHERE (<expr>)`. (AC-005)
6. #5 client sort SQL result: `OutcomeGrid` sorting. (AC-006)
7. #7 export: `export.ts` + Copy controls on both grids. (AC-007, AC-008)
8. Delete `result-grid.tsx`; refactor; full suite + lint + typecheck + cargo test.

## Tests to write (RED first)

- Rust (`db.rs` #[cfg(test)]): `build_rows_query` with offset, with ORDER BY asc/desc, with
  `WHERE (<expr>)`, sort-column validation; per engine (PG/MySQL/SQLite) quoting.
- Frontend (`__tests__/`): table-content - Load more append (TC-001), absent on short page (TC-002),
  sort cycle re-fetch (TC-003), filter resets paging (TC-004), type/PK/NN subheader (TC-005),
  malformed filter error + `WHERE (...)` (TC-006). sql-run - client sort (TC-007), copy CSV/JSON
  (TC-010). export.test.ts - `toCsv`/`toJson` escaping + NULL (TC-008, TC-009).
- Clipboard: stub `navigator.clipboard.writeText` in test setup; assert the copied string.

## Acceptance verification

Each AC maps to >=1 TC above; Phase-4 verifier runs `npm test`, `npm run lint`,
`npm run typecheck`, and `cargo test`, and checks each AC has a non-tautological test.

## Status: DONE (2026-06-21)

Verifier verdict: PASS, no defects. Gates: 347 frontend tests, 58 Rust, typecheck 0 errors,
lint 0 errors (9 pre-existing warnings). result-grid.tsx deleted; ONE-grid invariant holds.

### AC -> test traceability

| AC | Test |
| -- | ---- |
| AC-001 | `table-content`: should show Load more for a full page and append...; should not show Load more when fewer than a full page returns |
| AC-002 | `table-content`: should re-fetch sorted ascending/descending...; should show asc then desc arrows and clear...; `db.rs`: should_order_by_the_real_column_* |
| AC-003 | `table-content`: should reset to the first page when the filter changes; ...when the sort changes |
| AC-004 | `table-content`: should show the column data type and a PK marker...; should mark a not-null column with NN...; `db.rs`: should_assemble_column_metadata_marking_pk_and_nullable |
| AC-005 | `db.rs`: should_wrap_a_raw_filter_in_parens_as_a_where_clause; `table-content`: should log a filtered fetch to History with its WHERE clause |
| AC-006 | `sql-run`: should sort the result rows client-side when a header is clicked |
| AC-007 | `table-content`: should copy the table-card rows to the clipboard as CSV; `export.test`: toCsv/toJson escaping + NULL |
| AC-008 | `sql-run`: should copy the result rows to the clipboard as CSV; `export.test` |
| AC-009 | sticky `thead` (`sticky top-0` + inset shadow divider); console tablist sits outside the ScrollArea - structural |
| AC-010 | `table-content`: should show a sort indicator on each header even when unsorted; should show a solid up triangle on the ascending-sorted column |
| AC-011 | `table-content`: should show the loaded-vs-total row count in the status bar; should re-fetch with the chosen page size from the first page; `db.rs`: should_build_a_count_query_*, should_wrap_the_filter_in_parens_for_the_count_query |

## Follow-up (2026-06-21, post-review)

User review of the live app added: sticky grid header + console tab bar (AC-009), always-visible
right-aligned sort triangle (AC-010), DBeaver-style status bar with unbounded total + page-size
selector (AC-011, new `count_table` command + configurable `limit` on `fetch_table`). Confirmed:
DROP-in-filter can't execute (single prepared statement + parens -> DB syntax error), and CSV
already quotes comma/quote/newline fields.

## Risks

- TableRows shape change breaks every `rowsResult`/fixture using `columns: string[]`: mitigate by
  updating the shared test fixture/helper in lockstep with the model change (step 1-2).
- jsdom can't sort/freeze-test the grid loop: keep `data`/`columns` memoized (existing learning) -
  new sort/page state re-renders DataGrid, so guard the stable-ref rule.
- Clipboard API absent in jsdom: stub in `src/test/setup.ts`.
- Server `ORDER BY` over a text-cast column sorts lexically, not numerically (acceptable - DBeaver
  ORDER BYs the real column; we ORDER BY the real column name, not the `::text` alias, so numeric
  sort is preserved). Note: builder must `ORDER BY <real col>`, not the text expression.

## Decision Log

| Date | Decision | Rationale |
| ---- | -------- | --------- |
| 2026-06-21 | All 5 F2 items in one branch | User chose single-branch scope over splitting. |
| 2026-06-21 | #26 declined: raw WHERE wrapped in parens, no builder | User wants the input wrapped verbatim in `.where()`; malformed -> DB error. No injection rework. |
| 2026-06-21 | Pagination = load-more/append | User asked "how does DBeaver do it" - DBeaver fetches segments and appends. |
| 2026-06-21 | Export = clipboard (CSV+JSON), no file dialog | User chose clipboard over Tauri dialog/fs plugins. |
| 2026-06-21 | Table-card sort/types server-side; SQL result sort client-side | Table card owns its query + information_schema; SQL result is opaque user SQL already LIMITed. |
| 2026-06-21 | Delete dead `result-grid.tsx` | Unused fork; violates ONE-grid rule. |
