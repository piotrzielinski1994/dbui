type Cell = string | null;

function csvField(value: Cell): string {
  if (value === null) {
    return "";
  }
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function toCsv(columns: string[], rows: Cell[][]): string {
  const header = columns.map(csvField).join(",");
  const body = rows.map((row) => row.map(csvField).join(",")).join("\n");
  return body ? `${header}\n${body}` : header;
}

export function toJson(columns: string[], rows: Cell[][]): string {
  const objects = rows.map((row) =>
    Object.fromEntries(columns.map((name, index) => [name, row[index] ?? null])),
  );
  return JSON.stringify(objects, null, 2);
}
