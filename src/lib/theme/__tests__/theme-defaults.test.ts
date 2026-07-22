/// <reference types="node" />
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import type { AppTokenName, EditorTokenName } from "@/lib/settings/settings";
import {
  APP_TOKENS,
  DEFAULT_THEME_COLORS,
  EDITOR_TOKENS,
} from "@/lib/theme/theme-defaults";

// theme-defaults.ts is the single source of truth for the built-in (non-sparse)
// color values. App-token light values mirror the canonical `:root`, dark mirror
// `.dark`. Those tokens live in @pziel/pureui/styles/theme.css (imported by
// src/index.css); read it off disk to cross-check.
const nodeRequire = createRequire(import.meta.url);
const indexCss = readFileSync(
  nodeRequire.resolve("@pziel/pureui/styles/theme.css"),
  "utf8",
);

// All 18 app tokens (spec §5).
const EXPECTED_APP_TOKENS: AppTokenName[] = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "border",
  "input",
  "ring",
];

// All 9 editor-syntax tokens (spec §5).
const EXPECTED_EDITOR_TOKENS: EditorTokenName[] = [
  "caret",
  "selection",
  "gutter",
  "keyword",
  "string",
  "number",
  "property",
  "comment",
  "invalid",
];

// Pull a `--token: value;` declaration out of the `:root {...}` or `.dark {...}`
// block in index.css, whitespace-normalized.
function cssVar(block: ":root" | ".dark", token: string): string {
  const start = indexCss.indexOf(`${block} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  const body = indexCss.slice(start).split("}")[0];
  const match = body.match(new RegExp(`--${token}:\\s*([^;]+);`));
  expect(match).not.toBeNull();
  return (match![1] ?? "").trim();
}

const norm = (value: string): string => value.replace(/\s+/g, " ").trim();

describe("APP_TOKENS", () => {
  // AC-005, spec §5 - behavior
  it("should list exactly the 18 known app token names", () => {
    expect([...APP_TOKENS].sort()).toEqual([...EXPECTED_APP_TOKENS].sort());
    expect(APP_TOKENS).toHaveLength(18);
  });
});

describe("EDITOR_TOKENS", () => {
  // spec §5 - behavior
  it("should list exactly the 9 known editor token names", () => {
    expect([...EDITOR_TOKENS].sort()).toEqual(
      [...EXPECTED_EDITOR_TOKENS].sort(),
    );
    expect(EDITOR_TOKENS).toHaveLength(9);
  });
});

describe("DEFAULT_THEME_COLORS app tokens", () => {
  // AC-004 - behavior: a full (non-sparse) default for every app token in BOTH
  // modes, so an un-overridden token always has a built-in target.
  it("should have all 18 app tokens for the light mode", () => {
    for (const token of EXPECTED_APP_TOKENS) {
      expect(DEFAULT_THEME_COLORS.light.tokens[token]).toBeTypeOf("string");
    }
    expect(Object.keys(DEFAULT_THEME_COLORS.light.tokens).sort()).toEqual(
      [...EXPECTED_APP_TOKENS].sort(),
    );
  });

  it("should have all 18 app tokens for the dark mode", () => {
    for (const token of EXPECTED_APP_TOKENS) {
      expect(DEFAULT_THEME_COLORS.dark.tokens[token]).toBeTypeOf("string");
    }
    expect(Object.keys(DEFAULT_THEME_COLORS.dark.tokens).sort()).toEqual(
      [...EXPECTED_APP_TOKENS].sort(),
    );
  });

  // AC-004 - behavior: the stored values are oklch(...) strings (spec §5).
  it("should give every light app token a valid oklch(...) string", () => {
    for (const token of EXPECTED_APP_TOKENS) {
      expect(DEFAULT_THEME_COLORS.light.tokens[token]).toMatch(/^oklch\(.+\)$/);
    }
  });

  it("should give every dark app token a valid oklch(...) string", () => {
    for (const token of EXPECTED_APP_TOKENS) {
      expect(DEFAULT_THEME_COLORS.dark.tokens[token]).toMatch(/^oklch\(.+\)$/);
    }
  });

  // AC-008 - side-effect-contract: light values mirror index.css `:root`.
  it("should mirror the index.css :root --background for light background", () => {
    expect(norm(DEFAULT_THEME_COLORS.light.tokens.background)).toBe(
      norm(cssVar(":root", "background")),
    );
  });

  it("should mirror the index.css :root --primary for light primary", () => {
    expect(norm(DEFAULT_THEME_COLORS.light.tokens.primary)).toBe(
      norm(cssVar(":root", "primary")),
    );
  });

  // AC-008 - side-effect-contract: dark values mirror index.css `.dark`.
  it("should mirror the index.css .dark --background for dark background", () => {
    expect(norm(DEFAULT_THEME_COLORS.dark.tokens.background)).toBe(
      norm(cssVar(".dark", "background")),
    );
  });

  it("should mirror the index.css .dark --border alpha value for dark border", () => {
    // dark border ships with alpha (`oklch(1 0 0 / 10%)`) - it must survive verbatim.
    expect(norm(DEFAULT_THEME_COLORS.dark.tokens.border)).toBe(
      norm(cssVar(".dark", "border")),
    );
  });
});

describe("DEFAULT_THEME_COLORS editor sub-shape", () => {
  // spec §5 - behavior: the editor sub-maps exist for both modes.
  it("should expose an editor map for both modes", () => {
    expect(DEFAULT_THEME_COLORS.light.editor).toBeTypeOf("object");
    expect(DEFAULT_THEME_COLORS.dark.editor).toBeTypeOf("object");
  });

  // spec §5 - behavior: all 9 editor tokens present in both modes as strings.
  it("should have all 9 editor tokens for both modes", () => {
    for (const token of EXPECTED_EDITOR_TOKENS) {
      expect(DEFAULT_THEME_COLORS.light.editor[token]).toBeTypeOf("string");
      expect(DEFAULT_THEME_COLORS.dark.editor[token]).toBeTypeOf("string");
    }
  });
});
