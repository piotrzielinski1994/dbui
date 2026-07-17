import { describe, it, expect } from "vitest";

import { slugify, uniqueSlug } from "@/lib/workspace/slug";

describe("slugify", () => {
  // TC-001 - behavior: lowercases + hyphenates
  it("should lowercase and hyphenate a spaced name", () => {
    expect(slugify("My DB!")).toBe("my-db");
  });

  // TC-001 - behavior: collapses runs of non-alnum into a single hyphen
  it("should collapse a run of separators into a single hyphen", () => {
    expect(slugify("app__db  name")).toBe("app-db-name");
  });

  // TC-001 - behavior: trims leading/trailing hyphens
  it("should trim leading and trailing separators", () => {
    expect(slugify("  --prod-- ")).toBe("prod");
  });

  // TC-001 - behavior: an empty / all-separator name falls back to "untitled"
  it("should fall back to untitled if the name has no alphanumerics", () => {
    expect(slugify("")).toBe("untitled");
    expect(slugify("!!!")).toBe("untitled");
    expect(slugify("   ")).toBe("untitled");
  });
});

describe("uniqueSlug", () => {
  // TC-001 - behavior: a fresh base is returned as-is and recorded
  it("should return the base unchanged if it is unused", () => {
    const used = new Set<string>();

    expect(uniqueSlug("prod", used)).toBe("prod");
    expect(used.has("prod")).toBe(true);
  });

  // TC-001 - behavior: a collision is suffixed -2, then -3
  it("should suffix a collision with -2 and then -3", () => {
    const used = new Set<string>();

    expect(uniqueSlug("db", used)).toBe("db");
    expect(uniqueSlug("db", used)).toBe("db-2");
    expect(uniqueSlug("db", used)).toBe("db-3");
  });
});
