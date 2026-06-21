# F2 - Grid & results browsing

What + why. Everything about reading data in the shared `DataGrid` (table card + SQL result):
pagination, sorting, column-type headers, and clipboard export. Raw-WHERE filter stays as-is.

## Overview

The grid today shows a fixed first 200 rows, no sort, bare column-name headers, and no export.
This feature makes the grid a real browsing surface:

- **#4 Pagination** - browse beyond the 200-row limit, DBeaver-style (load-more / append).
- **#5 Sorting** - click a header to sort. Table card sorts server-side (`ORDER BY`, whole table);
  SQL result sorts client-side (only the returned rows exist).
- **#13 Column type in header** - under each column name show its type + PK/nullable marker
  (table card only; arbitrary SQL result types are unknown).
- **#26 Structured filter** - **declined**. The filter input stays a raw SQL `WHERE` expression
  wrapped verbatim in parentheses; a malformed expression returns a DB error toast. No builder.
- **#7 Export** - copy the current grid (columns + rows) to the clipboard as CSV or JSON, from
  both the table card and the SQL result.

ONE grid invariant holds: all changes land in `DataGrid` so the table card and SQL result stay
identical. The dead `result-grid.tsx` (unused fork) is deleted.

## Acceptance Criteria

- AC-001: The table card fetches a first page of rows; when a full page (= row limit) comes back,
  a **Load more** control appears in the footer. Clicking it fetches and **appends** the next page
  (server `OFFSET`); when a short page returns, Load more disappears (no more rows).
- AC-002: Clicking a table-card column header sorts the whole table server-side via `ORDER BY`,
  cycling **asc -> desc -> none** on repeated clicks; the active column shows a direction arrow.
  Changing sort resets pagination to the first page.
- AC-003: Changing the filter resets pagination to the first page (re-fetches from offset 0).
- AC-004: Each table-card column header shows a subheader line with the column's data type and a
  marker for primary-key (`PK`) and not-null (`NN`) columns.
- AC-005: The filter input value is wrapped verbatim as `WHERE (<input>)` and sent to the backend;
  a malformed expression surfaces the backend error (existing raw-WHERE behavior preserved, now
  parenthesized).
- AC-006: Clicking a SQL-result column header sorts the returned rows client-side, cycling
  asc -> desc -> none, with a direction arrow on the active column.
- AC-007: From the table card, the user can copy the current rows to the clipboard as CSV and as
  JSON. The copied text round-trips the visible columns and rows (NULL preserved distinctly).
- AC-008: From the SQL result, the user can copy the returned rows to the clipboard as CSV and JSON.
- AC-009: The grid header is sticky - vertical scroll keeps column names + type subheader visible
  (1px bottom divider preserved per design.md). The console/history panel tab bar is likewise
  pinned above its scrolling list.
- AC-010: Each sortable column header shows an always-visible sort affordance, right-aligned in the
  cell: a dim neutral triangle when unsorted, a solid up/down triangle on the active sort column.
- AC-011: The table-card status bar shows `<loaded> of <total> rows` (total = unbounded
  `COUNT(*)` honoring the filter) and a page-size selector (50/100/200/500/1000); changing the page
  size re-fetches from the first page with the new limit.

## Test Cases

- TC-001 (happy, AC-001): table returns exactly `limit` rows -> Load more shows -> click ->
  backend called with offset=limit -> appended rows render below the first page.
- TC-002 (edge, AC-001): table returns fewer than `limit` rows -> Load more is absent.
- TC-003 (happy, AC-002): click "price" header -> backend re-fetched with `ORDER BY "price" ASC`
  and offset 0 -> arrow shows asc. Click again -> `DESC`. Third click -> no `ORDER BY`.
- TC-004 (happy, AC-003): with a second page loaded, type a filter + Enter -> re-fetched from
  offset 0 with the `WHERE`, accumulated pages reset to the first page.
- TC-005 (happy, AC-004): a column with a known type + PK renders its type text and a `PK` marker;
  a nullable column shows no `NN`, a not-null column shows `NN`.
- TC-006 (edge, AC-005): filter `price >` (malformed) -> backend rejects -> error state shown,
  sent as `WHERE (price >)`.
- TC-007 (happy, AC-006): SQL result with rows -> click a header -> rows reorder client-side
  asc/desc/none without re-running the query.
- TC-008 (happy, AC-007): click Copy CSV on the table card -> clipboard receives header row +
  CSV-escaped data rows; Copy JSON -> clipboard receives a JSON array of row objects.
- TC-009 (edge, AC-007): a cell containing a comma/quote/newline is CSV-quoted and escaped; a NULL
  cell serializes as empty in CSV and `null` in JSON.
- TC-010 (happy, AC-008): Copy CSV/JSON on the SQL result copies the returned columns + rows.

## UI States

| State   | Behavior                                                                             |
| ------- | ------------------------------------------------------------------------------------ |
| Loading | First page: existing "Loading..." text. Load-more in flight: control reads "Loading...". |
| Empty   | Headers (with type subheader) still render; "No rows." beneath; no Load more.         |
| Error   | Existing error text; a failed Load more keeps the already-loaded pages + re-enables.  |
| Success | Rows render; footer shows loaded-row count + Load more (when a full page returned).   |

## Wireframes

Table card - success (type subheader + sort arrow + load-more + copy):

```
+---------------------------------------------------------+
| price > 10                                     [Search] |   filter = raw WHERE
+---------------------------------------------------------+
| id A    | name        | price    | created_at        |
| int4 PK | text NN     | numeric  | timestamptz       |    subheader: type + PK/NN
+---------------------------------------------------------+
| 1       | Widget      | 999      | 2026-01-01 10:00  |
| 2       | Gadget      | 2499     | 2026-01-02 11:30  |
| 3       | [NULL]      | 150      | 2026-01-03 09:15  |
+---------------------------------------------------------+
| 200 rows             [Copy CSV] [Copy JSON] [Load more] |   footer
+---------------------------------------------------------+
```

Sort cycle on header click: asc (A) -> desc (V) -> none. Server-side ORDER BY, resets to page 1.

After Load more (page 2 appended), short page hides Load more:

```
+---------------------------------------------------------+
| 412 rows                       [Copy CSV] [Copy JSON]   |   no Load more
+---------------------------------------------------------+
```

Empty - headers + type subheader stay, "No rows." beneath:

```
+---------------------------------------------------------+
| id      | name        | price    | created_at        |
| int4 PK | text NN     | numeric  | timestamptz       |
+---------------------------------------------------------+
| No rows.                                                |
+---------------------------------------------------------+
| 0 rows                         [Copy CSV] [Copy JSON]   |
+---------------------------------------------------------+
```

SQL result grid - same DataGrid, client-side sort + copy, NO type subheader (QueryOutcome
carries no types), NO Load more:

```
+---------------------------------------------------------+
| Success   SELECT 2                                      |   status header
+---------------------------------------------------------+
| id A    | name                                          |   click = in-memory sort
+---------------------------------------------------------+
| 1       | Ada                                           |
| 2       | Linus                                         |
+---------------------------------------------------------+
| 2 rows                         [Copy CSV] [Copy JSON]   |
+---------------------------------------------------------+
```

## Data model

Backend `TableRows` gains per-column metadata (was `columns: string[]`):

```rust
struct TableColumn { name: String, data_type: String, nullable: bool, is_primary_key: bool }
struct TableRows { columns: Vec<TableColumn>, rows: Vec<Vec<Option<String>>>, primary_key: Option<String> }
```

`fetch_table` command + `fetch_table_rows` gain `offset: u32` and `sort: Option<Sort>` where
`Sort { column: String, descending: bool }` (column validated against the known column list, like
the filter). `build_rows_query` appends `ORDER BY <quoted col> [DESC]` before `LIMIT ... OFFSET ...`.

Frontend `DataGrid` gains optional, presentation-only props (defaults keep current behavior):
`columnMeta?: Record<string, {dataType: string; nullable: boolean; isPrimaryKey: boolean}>`,
`sort?: {column: string; descending: boolean} | null`, `onSortColumn?: (column: string) => void`.
DataGrid renders arrows + type subheader; it does NOT sort internally (caller supplies ordered rows).

## Edge cases

- Empty input filter -> no WHERE (unchanged). Filter wrapped as `WHERE (<expr>)`.
- Sort column not in the known column list -> ignored server-side (defensive; UI only offers real columns).
- Load more while a page is in flight -> control disabled.
- Failed page fetch -> keep prior pages, surface error, allow retry.
- CSV escaping: quote fields containing `,` `"` or newline; double embedded quotes; NULL -> empty (CSV) / `null` (JSON).
- SQLite `notnull` is inverted (0 = nullable); PG/MySQL `is_nullable` is `'YES'/'NO'`.

## Dependencies

- No new runtime deps (clipboard via `navigator.clipboard`; sorting via existing `@tanstack/react-table` for SQL client sort).
- #13's `TableRows` shape change is consumed later by F4 (autocomplete) and F6 (schema browser).
