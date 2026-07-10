import type { Result } from "@/lib/result";

// The mock data generator (F17): pure, deterministic synthetic-row generation for the open table.
// One strategy per column; `generateRows` produces string|null cells matching the existing insert
// `values` shape, so the rows stage through the same pending-edits pipeline as Add-row/Clone.

export const MAX_MOCK_ROWS = 200;

export type MockStrategyKind =
  | "skip"
  | "null"
  | "sequence"
  | "integer"
  | "decimal"
  | "boolean"
  | "uuid"
  | "date"
  | "words"
  | "fullName"
  | "email"
  | "enum"
  | "fixed";

// Only the fields a kind consumes are read; the dialog carries a superset and each strategy picks
// what it needs (defaults applied here so a partially-filled config still generates).
export type MockParams = {
  min?: number;
  max?: number;
  start?: number;
  values?: string[];
  value?: string;
  count?: number;
};

export type MockColumnConfig = {
  column: string;
  kind: MockStrategyKind;
  params: MockParams;
};

type ColumnMetaInput = {
  name: string;
  dataType: string;
  isPrimaryKey: boolean;
};

const FIRST_NAMES = [
  "Ada",
  "Linus",
  "Grace",
  "Alan",
  "Edsger",
  "Barbara",
  "Donald",
  "Margaret",
  "Ken",
  "Dennis",
];
const LAST_NAMES = [
  "Lovelace",
  "Torvalds",
  "Hopper",
  "Turing",
  "Dijkstra",
  "Liskov",
  "Knuth",
  "Hamilton",
  "Thompson",
  "Ritchie",
];
const WORDS = [
  "lorem",
  "ipsum",
  "dolor",
  "sit",
  "amet",
  "consectetur",
  "adipiscing",
  "elit",
  "sed",
  "tempor",
];

// Deterministic PRNG (mulberry32): a fixed seed yields a fixed sequence, so a preview/insert with the
// same seed reproduces exactly (testable, per the "stub random" test-discipline rule).
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, items: T[]): T {
  return items[Math.floor(rng() * items.length)];
}

function intInRange(rng: () => number, min: number, max: number): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return lo + Math.floor(rng() * (hi - lo + 1));
}

function hex(rng: () => number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += Math.floor(rng() * 16).toString(16);
  }
  return out;
}

// A version-4-shaped uuid (deterministic under the seeded rng). Not RFC-crypto-random - it only needs
// to look like a uuid for test data.
function uuid(rng: () => number): string {
  const variant = (8 + Math.floor(rng() * 4)).toString(16);
  return `${hex(rng, 8)}-${hex(rng, 4)}-4${hex(rng, 3)}-${variant}${hex(rng, 3)}-${hex(rng, 12)}`;
}

// Maps a column to its default strategy: a name heuristic wins over the type (an `email varchar`
// generates emails, not words), then the (lowercased, prefix-matched) data type, else words.
export function autoStrategy(column: ColumnMetaInput): MockColumnConfig {
  const name = column.name.toLowerCase();
  const type = column.dataType.toLowerCase();
  const make = (kind: MockStrategyKind, params: MockParams = {}): MockColumnConfig => ({
    column: column.name,
    kind,
    params,
  });

  if (name === "_id") {
    return make("skip");
  }
  if (name.includes("email")) {
    return make("email");
  }
  if (name === "name" || name.endsWith("_name") || name.endsWith("name")) {
    return make("fullName");
  }

  const isInteger =
    type.includes("int") || type.startsWith("serial") || type === "integer";
  if (isInteger) {
    return column.isPrimaryKey
      ? make("sequence", { start: 1 })
      : make("integer", { min: 1, max: 1000 });
  }
  if (
    type.includes("numeric") ||
    type.includes("decimal") ||
    type.includes("real") ||
    type.includes("double") ||
    type.includes("float")
  ) {
    return make("decimal", { min: 1, max: 1000 });
  }
  if (type.includes("bool")) {
    return make("boolean");
  }
  if (type.includes("uuid")) {
    return make("uuid");
  }
  if (type.includes("date") || type.includes("time")) {
    return make("date");
  }
  return make("words", { count: 3 });
}

function cellFor(
  config: MockColumnConfig,
  rng: () => number,
  rowIndex: number,
): string | null {
  const { kind, params } = config;
  switch (kind) {
    case "null":
      return null;
    case "sequence":
      return String((params.start ?? 1) + rowIndex);
    case "integer":
      return String(intInRange(rng, params.min ?? 1, params.max ?? 1000));
    case "decimal": {
      const whole = intInRange(rng, params.min ?? 1, params.max ?? 1000);
      const frac = Math.floor(rng() * 100)
        .toString()
        .padStart(2, "0");
      return `${whole}.${frac}`;
    }
    case "boolean":
      return rng() < 0.5 ? "true" : "false";
    case "uuid":
      return uuid(rng);
    case "date": {
      const year = intInRange(rng, 2000, 2025);
      const month = String(intInRange(rng, 1, 12)).padStart(2, "0");
      const day = String(intInRange(rng, 1, 28)).padStart(2, "0");
      return `${year}-${month}-${day}`;
    }
    case "words": {
      const count = Math.max(1, params.count ?? 3);
      return Array.from({ length: count }, () => pick(rng, WORDS)).join(" ");
    }
    case "fullName":
      return `${pick(rng, FIRST_NAMES)} ${pick(rng, LAST_NAMES)}`;
    case "email": {
      const first = pick(rng, FIRST_NAMES).toLowerCase();
      const last = pick(rng, LAST_NAMES).toLowerCase();
      return `${first}.${last}${intInRange(rng, 1, 99)}@example.com`;
    }
    case "enum":
      return pick(rng, params.values ?? []);
    case "fixed":
      return params.value ?? "";
    case "skip":
      // Handled by the caller (the key is omitted); never reached.
      return null;
  }
}

// Validates the configs + count, then deterministically builds `count` rows. Each row is a
// `Record<column, string | null>`: a `skip` column is omitted entirely (DB fills default/serial), a
// `null` column is present with a null value. Returns an ADT error (never throws) on a bad count or
// invalid params (e.g. an empty enum list), staging nothing.
export function generateRows(
  configs: MockColumnConfig[],
  count: number,
  seed: number,
): Result<Record<string, string | null>[]> {
  if (!Number.isInteger(count) || count < 1) {
    return { ok: false, error: "Row count must be at least 1" };
  }
  if (count > MAX_MOCK_ROWS) {
    return { ok: false, error: `Row count cannot exceed ${MAX_MOCK_ROWS}` };
  }
  const emptyEnum = configs.find(
    (config) =>
      config.kind === "enum" && (config.params.values ?? []).length === 0,
  );
  if (emptyEnum) {
    return {
      ok: false,
      error: `Enum column "${emptyEnum.column}" needs at least one value`,
    };
  }

  const rng = mulberry32(seed);
  const active = configs.filter((config) => config.kind !== "skip");
  const rows = Array.from({ length: count }, (_, rowIndex) =>
    Object.fromEntries(
      active.map((config) => [config.column, cellFor(config, rng, rowIndex)]),
    ),
  );
  return { ok: true, value: rows };
}
