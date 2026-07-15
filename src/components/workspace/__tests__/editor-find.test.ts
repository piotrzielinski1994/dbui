import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// AC-009/010 wire @codemirror/search into the full CodeMirror editors (SQL / JS / JSON) to power a
// dbui-styled find panel. jsdom cannot drive the CM search UI interactively, so the light contract
// here is that the search package is a DIRECT project dependency (the plan promotes it from the
// current transitive-only state) so the editors can import search({createPanel}).
const packageJson = JSON.parse(
  readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
) as { dependencies?: Record<string, string> };

const readSource = (relative: string) =>
  readFileSync(resolve(process.cwd(), relative), "utf8");

describe("editor find wiring", () => {
  // side-effect-contract: @codemirror/search is a direct dependency (AC-009, TC-008)
  it("should list @codemirror/search as a direct dependency", () => {
    expect(packageJson.dependencies ?? {}).toHaveProperty("@codemirror/search");
  });

  // side-effect-contract: each full editor wires the shared editorFind extension (AC-009, AC-010)
  const fullEditors = [
    "src/components/workspace/sql-editor.tsx",
    "src/components/workspace/js-editor.tsx",
    "src/components/workspace/json-view.tsx",
  ];
  fullEditors.forEach((path) => {
    it(`should wire editorFind into ${path}`, () => {
      const source = readSource(path);
      expect(source).toMatch(/editorFind\(/);
    });
  });

  // side-effect-contract: the single-line filter row must NOT get a find panel (AC-009) - it is only
  // added inside sql-editor's `singleLine ? [] : [...]` branch.
  it("should only add editorFind to the SQL editor outside the single-line branch", () => {
    const source = readSource("src/components/workspace/sql-editor.tsx");
    expect(source).toMatch(/singleLine \? \[\] : \[editorFind\(findKey\)\]/);
  });
});
