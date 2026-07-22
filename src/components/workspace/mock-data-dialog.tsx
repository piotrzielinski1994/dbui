import { Button } from "@pziel/pureui";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type Cell, DataGrid } from "@/components/workspace/data-grid";
import { DEFAULT_SETTINGS } from "@/lib/settings/settings";
import { useSettingsOptional } from "@/lib/settings/settings-context";
import {
  autoStrategy,
  generateRows,
  MAX_MOCK_ROWS,
  type MockColumnConfig,
  type MockStrategyKind,
} from "@/lib/workspace/mock-data";

// Every strategy the picker offers, in menu order.
const STRATEGY_OPTIONS: { value: MockStrategyKind; label: string }[] = [
  { value: "sequence", label: "Sequence" },
  { value: "integer", label: "Integer" },
  { value: "decimal", label: "Decimal" },
  { value: "boolean", label: "Boolean" },
  { value: "uuid", label: "UUID" },
  { value: "date", label: "Date" },
  { value: "words", label: "Words" },
  { value: "fullName", label: "Full name" },
  { value: "email", label: "Email" },
  { value: "enum", label: "Enum" },
  { value: "fixed", label: "Fixed" },
  { value: "null", label: "Null" },
  { value: "skip", label: "Skip" },
];

const noop = () => {};
const alwaysFalse = () => false;
const emptySelection = new Set<number>();

export type MockColumnMeta = {
  name: string;
  dataType: string;
  isPrimaryKey: boolean;
};

// The Mock Data generator dialog (F17). Lists every column with a strategy picker (auto-defaulted),
// takes a row count + seed, previews the generated rows in the shared read-only DataGrid, and on
// Insert hands the generated value rows back to the caller to stage as draft inserts. It never
// touches the DB or the pending pipeline directly - staging is the caller's job.
export function MockDataDialog({
  open,
  columns,
  canGenerate,
  disabledReason,
  onStageInserts,
  onClose,
}: {
  open: boolean;
  columns: MockColumnMeta[];
  // False when the table is read-only or has no primary key (AC-008): Insert is disabled.
  canGenerate: boolean;
  disabledReason?: string;
  onStageInserts: (rows: Record<string, string | null>[]) => void;
  onClose: () => void;
}) {
  const shortcuts =
    useSettingsOptional()?.settings.shortcuts ?? DEFAULT_SETTINGS.shortcuts;

  const [configs, setConfigs] = useState<MockColumnConfig[]>([]);
  const [seedForColumns, setSeedForColumns] = useState<string>("");
  const [count, setCount] = useState(10);
  const [seed, setSeed] = useState(1);
  const [preview, setPreview] = useState<Cell[][] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Re-seed the per-column configs from the auto defaults whenever the column set changes (a
  // different table opened, or the columns arrived after the first render). adjust-state-on-render,
  // same pattern the table card uses for the filter draft.
  const columnKey = columns.map((column) => column.name).join("|");
  if (columnKey !== seedForColumns) {
    setSeedForColumns(columnKey);
    setConfigs(columns.map(autoStrategy));
    setPreview(null);
    setError(null);
  }

  const setKind = (column: string, kind: MockStrategyKind) => {
    setConfigs((current) =>
      current.map((config) =>
        config.column === column
          ? { column, kind, params: defaultParamsFor(kind) }
          : config,
      ),
    );
    setPreview(null);
  };

  const setParam = (column: string, params: MockColumnConfig["params"]) => {
    setConfigs((current) =>
      current.map((config) =>
        config.column === column ? { ...config, params } : config,
      ),
    );
    setPreview(null);
  };

  const build = () => generateRows(configs, count, seed);

  const runPreview = (withSeed: number) => {
    const result = generateRows(configs, count, withSeed);
    if (!result.ok) {
      setError(result.error);
      setPreview(null);
      return;
    }
    setError(null);
    setPreview(
      result.value.map((row) =>
        columns.map((column) => row[column.name] ?? null),
      ),
    );
  };

  const onPreview = () => runPreview(seed);

  // Re-roll: bump the seed (a fresh deterministic sequence - avoids Math.random, which is banned
  // repo-wide and would break the seeded-determinism contract) and re-preview with it.
  const onRegenerate = () => {
    const next = seed + 1;
    setSeed(next);
    runPreview(next);
  };

  const onInsert = () => {
    const result = build();
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onStageInserts(result.value);
    onClose();
  };

  const previewColumns = columns.map((column) => column.name);

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent
        className="max-w-3xl"
        onOpenAutoFocus={(event) => event.preventDefault()}
        aria-label="Mock data"
      >
        <DialogHeader>
          <DialogTitle>Generate mock data</DialogTitle>
          <DialogDescription>
            Pick a strategy per column, preview a sample, then stage the rows as
            draft inserts (reversible in the Changes tab).
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-4 text-xs">
          <label className="flex items-center gap-2">
            <span className="text-muted-foreground">Rows</span>
            <Input
              type="number"
              min={1}
              max={MAX_MOCK_ROWS}
              aria-label="Rows"
              value={count}
              onChange={(event) => {
                setCount(Number(event.target.value));
                setPreview(null);
              }}
              className="h-7 w-20"
            />
            <span className="text-muted-foreground">(1-{MAX_MOCK_ROWS})</span>
          </label>
          <label className="flex items-center gap-2">
            <span className="text-muted-foreground">Seed</span>
            <Input
              type="number"
              aria-label="Seed"
              value={seed}
              onChange={(event) => {
                setSeed(Number(event.target.value));
                setPreview(null);
              }}
              className="h-7 w-24"
            />
          </label>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Regenerate"
            onClick={onRegenerate}
            className="h-7"
          >
            Regenerate
          </Button>
        </div>

        <div className="max-h-64 overflow-auto border">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="px-3 py-1.5 font-medium">column</th>
                <th className="px-3 py-1.5 font-medium">type</th>
                <th className="px-3 py-1.5 font-medium">strategy</th>
                <th className="px-3 py-1.5 font-medium">params</th>
              </tr>
            </thead>
            <tbody>
              {configs.map((config) => {
                const meta = columns.find(
                  (column) => column.name === config.column,
                );
                return (
                  <tr key={config.column} className="border-b last:border-0">
                    <td className="px-3 py-1.5 font-mono font-medium">
                      <span>{config.column}</span>
                      {meta?.isPrimaryKey ? (
                        <span className="ml-1 text-muted-foreground">PK</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-muted-foreground">
                      {meta?.dataType ?? ""}
                    </td>
                    <td className="px-3 py-1.5">
                      <Select
                        value={config.kind}
                        onValueChange={(value) =>
                          setKind(config.column, value as MockStrategyKind)
                        }
                      >
                        <SelectTrigger
                          className="h-7 w-36"
                          aria-label={`${config.column} strategy`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent position="popper">
                          {STRATEGY_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-3 py-1.5">
                      <ParamEditor
                        config={config}
                        onChange={(params) => setParam(config.column, params)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {preview ? (
          <div className="max-h-64 overflow-auto border">
            <DataGrid
              columns={previewColumns}
              rows={preview}
              selectedRows={emptySelection}
              onSelectRow={noop}
              editable={false}
              editValueAt={(rowIndex, column) =>
                preview[rowIndex]?.[previewColumns.indexOf(column)] ?? null
              }
              isDirtyAt={alwaysFalse}
              onCommitEdit={noop}
              shortcuts={shortcuts}
            />
          </div>
        ) : null}

        {error ? (
          <p className="font-mono text-xs text-destructive">{error}</p>
        ) : null}
        {!canGenerate ? (
          <p className="text-xs text-muted-foreground">
            {disabledReason ??
              "This table cannot be generated into (read-only or no primary key)."}
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={onPreview}>
            Preview
          </Button>
          <Button onClick={onInsert} disabled={!canGenerate}>
            Insert
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function defaultParamsFor(kind: MockStrategyKind): MockColumnConfig["params"] {
  switch (kind) {
    case "sequence":
      return { start: 1 };
    case "integer":
    case "decimal":
      return { min: 1, max: 1000 };
    case "words":
      return { count: 3 };
    case "enum":
      return { values: [] };
    case "fixed":
      return { value: "" };
    default:
      return {};
  }
}

// The inline param controls for the strategies that take parameters; the rest render nothing.
function ParamEditor({
  config,
  onChange,
}: {
  config: MockColumnConfig;
  onChange: (params: MockColumnConfig["params"]) => void;
}) {
  const { kind, params } = config;
  if (kind === "sequence") {
    return (
      <Input
        type="number"
        aria-label={`${config.column} start`}
        value={params.start ?? 1}
        onChange={(event) => onChange({ start: Number(event.target.value) })}
        className="h-7 w-24"
      />
    );
  }
  if (kind === "integer" || kind === "decimal") {
    return (
      <span className="flex items-center gap-1">
        <Input
          type="number"
          aria-label={`${config.column} min`}
          value={params.min ?? 1}
          onChange={(event) =>
            onChange({ ...params, min: Number(event.target.value) })
          }
          className="h-7 w-20"
        />
        <Input
          type="number"
          aria-label={`${config.column} max`}
          value={params.max ?? 1000}
          onChange={(event) =>
            onChange({ ...params, max: Number(event.target.value) })
          }
          className="h-7 w-20"
        />
      </span>
    );
  }
  if (kind === "words") {
    return (
      <Input
        type="number"
        aria-label={`${config.column} word count`}
        value={params.count ?? 3}
        onChange={(event) => onChange({ count: Number(event.target.value) })}
        className="h-7 w-20"
      />
    );
  }
  if (kind === "enum") {
    return (
      <Input
        aria-label={`${config.column} values`}
        placeholder="a, b, c"
        value={(params.values ?? []).join(", ")}
        onChange={(event) =>
          onChange({
            values: event.target.value
              .split(",")
              .map((entry) => entry.trim())
              .filter((entry) => entry.length > 0),
          })
        }
        className="h-7 w-40"
      />
    );
  }
  if (kind === "fixed") {
    return (
      <Input
        aria-label={`${config.column} value`}
        value={params.value ?? ""}
        onChange={(event) => onChange({ value: event.target.value })}
        className="h-7 w-40"
      />
    );
  }
  return null;
}
