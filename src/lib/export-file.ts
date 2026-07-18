export type ExportFormat = "CSV" | "JSON";

const EXTENSION_BY_FORMAT: Record<ExportFormat, "csv" | "json"> = {
  CSV: "csv",
  JSON: "json",
};

export function exportExtension(format: ExportFormat): "csv" | "json" {
  return EXTENSION_BY_FORMAT[format];
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

// Local-time stamp `YYYYMMDD-HHmmss` (mirrors backup.ts), so an exported file sorts chronologically
// and is unique per second.
function timestamp(now: Date): string {
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${date}-${time}`;
}

export function exportFileName(
  base: string,
  format: ExportFormat,
  now: Date,
): string {
  return `${base}-${timestamp(now)}.${exportExtension(format)}`;
}

export function exportFilters(
  format: ExportFormat,
): { name: string; extensions: string[] }[] {
  return [
    { name: format, extensions: [exportExtension(format)] },
    { name: "All files", extensions: ["*"] },
  ];
}
