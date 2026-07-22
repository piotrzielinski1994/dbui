/// <reference types="node" />
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ScrollArea } from "@/components/ui/scroll-area";

// The scrollbar style lives in source text we can't fully render in jsdom: the
// global CSS rules (vitest mocks css imports) and the Radix thumb className (the
// thumb never mounts without a layout engine). Read the files straight off disk;
// the file-local node reference keeps node types out of the app tsconfig.
const REPO_ROOT = process.cwd();
const readRepoFile = (rel: string): string =>
  readFileSync(path.join(REPO_ROOT, rel), "utf8");

// Radix only mounts the scrollbar slot once overflow is detected, which needs a
// working ResizeObserver/layout - jsdom has neither, so the auto-hide
// type="hover" production default never renders a slot here. Force type="always"
// so the slot mounts and we can assert its rendered classes; the auto-hide config
// itself is asserted separately from source (TC-002).
function renderScrollArea() {
  return render(
    <ScrollArea type="always" className="h-10" data-testid="sa">
      <div style={{ height: "1000px", width: "1000px" }}>tall content</div>
    </ScrollArea>,
  );
}

describe("ScrollArea thumb styling (AC-001)", () => {
  // TC-001 - behavior: the scrollbar track is the thin 6px width, not the old 10px.
  it("should render a thin (w-1.5) scrollbar track and not the old w-2.5 if mounted", () => {
    const { container } = renderScrollArea();

    const scrollbar = container.querySelector<HTMLElement>(
      '[data-slot="scroll-area-scrollbar"]',
    );
    expect(scrollbar).not.toBeNull();

    const cls = scrollbar?.className ?? "";
    expect(cls).toMatch(/\bw-1\.5\b/);
    expect(cls).not.toMatch(/\bw-2\.5\b/);
  });

  // TC-001 - the thumb is semi-transparent foreground, square, not the old
  // bg-border. Radix only mounts the thumb once it has a measured size, which
  // jsdom never provides - so assert the thumb className from source.
  it("should render a semi-transparent foreground thumb that is square and not bg-border", () => {
    const source = readRepoFile("src/components/ui/scroll-area.tsx");
    const thumbClass =
      source.match(/scroll-area-thumb"[\s\S]*?className=\{?"([^"]*)"/)?.[1] ??
      "";

    expect(thumbClass).toMatch(/bg-foreground\/20/);
    expect(thumbClass).toMatch(/hover:bg-foreground\/30/);
    expect(thumbClass).not.toMatch(/bg-border/);
    expect(thumbClass).not.toMatch(/rounded-full/);
    expect(thumbClass).not.toMatch(/rounded-xs/);
  });
});

describe("ScrollArea horizontal opt-in", () => {
  // A wide data grid needs a horizontal scrollbar; Radix only scrolls (and mounts a
  // scrollbar for) an axis when a ScrollBar for it is present. Default = vertical only.
  it("should mount only a vertical scrollbar slot by default", () => {
    const { container } = render(
      <ScrollArea type="always" className="h-10 w-10">
        <div style={{ height: "1000px", width: "1000px" }}>content</div>
      </ScrollArea>,
    );

    const bars = container.querySelectorAll<HTMLElement>(
      '[data-slot="scroll-area-scrollbar"]',
    );
    const orientations = [...bars].map((el) =>
      el.getAttribute("data-orientation"),
    );
    expect(orientations).toContain("vertical");
    expect(orientations).not.toContain("horizontal");
  });

  // With `horizontal`, a horizontal scrollbar slot mounts too, so a wider-than-viewport
  // grid can scroll to its off-screen columns.
  it("should mount a horizontal scrollbar slot if horizontal is set", () => {
    const { container } = render(
      <ScrollArea type="always" horizontal className="h-10 w-10">
        <div style={{ height: "1000px", width: "1000px" }}>content</div>
      </ScrollArea>,
    );

    const orientations = [
      ...container.querySelectorAll<HTMLElement>(
        '[data-slot="scroll-area-scrollbar"]',
      ),
    ].map((el) => el.getAttribute("data-orientation"));
    expect(orientations).toContain("vertical");
    expect(orientations).toContain("horizontal");
  });
});

describe("ScrollArea auto-hide configuration (AC-001)", () => {
  // TC-002 - the root wires Radix type="hover" for auto-hide intent. jsdom won't
  // toggle the runtime fade, so we assert the configuration is passed in source.
  it("should configure the Radix scroll-area for hover auto-hide", () => {
    const source = readRepoFile("src/components/ui/scroll-area.tsx");
    expect(source).toMatch(/type=("|')hover\1/);
  });
});

describe("ScrollArea no-rounded / no-bg-border guard (AC-004)", () => {
  // TC-007 - no rendered scrollbar slot may carry rounded-full/rounded-xs/bg-border.
  it("should not carry rounded-full, rounded-xs or bg-border on any scrollbar slot", () => {
    const { container } = renderScrollArea();

    const slots = [
      ...container.querySelectorAll<HTMLElement>(
        '[data-slot="scroll-area-scrollbar"], [data-slot="scroll-area-thumb"]',
      ),
    ];
    expect(slots.length).toBeGreaterThan(0);

    for (const el of slots) {
      const cls = el.className;
      expect(cls).not.toMatch(/rounded-full/);
      expect(cls).not.toMatch(/rounded-xs/);
      expect(cls).not.toMatch(/bg-border/);
    }

    const source = readRepoFile("src/components/ui/scroll-area.tsx");
    const thumbClass =
      source.match(/scroll-area-thumb"[\s\S]*?className=\{?"([^"]*)"/)?.[1] ??
      "";
    expect(thumbClass).toMatch(/bg-foreground\//);
    expect(thumbClass).not.toMatch(/rounded-full/);
    expect(thumbClass).not.toMatch(/rounded-xs/);
    expect(thumbClass).not.toMatch(/bg-border/);
  });
});

describe("Global thin scrollbar CSS (AC-002)", () => {
  const css = readFileSync(
    createRequire(import.meta.url).resolve("@pziel/pureui/styles/theme.css"),
    "utf8",
  );

  // TC-003 - index.css declares scrollbar-width: thin on the universal rule.
  it("should declare scrollbar-width: thin in index.css", () => {
    expect(css).toMatch(/scrollbar-width:\s*thin/);
  });

  // TC-003 - a foreground-derived scrollbar-color is set.
  it("should set a --foreground-derived scrollbar-color in index.css", () => {
    expect(css).toMatch(/scrollbar-color:[^;]*var\(--foreground\)/);
  });

  // TC-003 - the ::-webkit-scrollbar block sizes the bar at 8px.
  it("should define a ::-webkit-scrollbar block with width 8px in index.css", () => {
    expect(css).toMatch(/::-webkit-scrollbar\b/);
    const block = css.split(/::-webkit-scrollbar\b/)[1]?.split("}")[0];
    expect(block ?? "").toMatch(/width:\s*8px/);
  });

  // TC-003 - the track is transparent (no painted gutter).
  it("should define a transparent ::-webkit-scrollbar-track in index.css", () => {
    const block = css.split(/::-webkit-scrollbar-track\b/)[1]?.split("}")[0];
    expect(block ?? "").toMatch(/background:\s*transparent/);
  });

  // TC-003 - the thumb background derives from --foreground.
  it("should define a --foreground-derived ::-webkit-scrollbar-thumb background in index.css", () => {
    const block = css.split(/::-webkit-scrollbar-thumb\b/)[1]?.split("}")[0];
    expect(block ?? "").toMatch(/background:[^;]*var\(--foreground\)/);
  });

  // TC-003 - the thumb rule must stay square: the webkit rules exist and carry no border-radius.
  it("should not set any border-radius on the ::-webkit-scrollbar rules in index.css", () => {
    const start = css.indexOf("::-webkit-scrollbar");
    expect(start).toBeGreaterThanOrEqual(0);
    const webkitRegion = css.slice(start);
    expect(webkitRegion).not.toMatch(/border-radius/);
  });
});
