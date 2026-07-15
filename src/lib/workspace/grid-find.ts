import type { Cell } from "@/components/workspace/data-grid";

// A single grid cell that matches the current find query.
export type GridMatch = {
  rowIndex: number;
  columnId: string;
};

// Pure match finder for the grid find bar. Scans every cell's text for a case-insensitive substring
// of the query, returning one match per cell in row-major then column order. An empty query matches
// nothing; a NULL cell never matches (the "[NULL]" placeholder is a render-only glyph, not the
// cell's text - only a cell whose real string value contains the query counts).
export function findMatches(
  columns: string[],
  rows: Cell[][],
  query: string,
): GridMatch[] {
  if (query.length === 0) {
    return [];
  }
  const needle = query.toLowerCase();
  return rows.flatMap((row, rowIndex) =>
    columns.flatMap((columnId, columnIndex) => {
      const cell = row[columnIndex];
      if (cell === null || cell === undefined) {
        return [];
      }
      if (!cell.toLowerCase().includes(needle)) {
        return [];
      }
      return [{ rowIndex, columnId }];
    }),
  );
}
