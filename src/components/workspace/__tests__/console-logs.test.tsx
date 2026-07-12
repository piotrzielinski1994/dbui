import { useEffect } from "react";
import { describe, it, expect } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  WorkspaceProvider,
  useLogLines,
  useWorkspace,
} from "@/components/workspace/workspace-context";
import { Console } from "@/components/workspace/console";
import {
  fixtureTree,
  fixtureConsoleLines,
} from "@/components/workspace/__tests__/fixtures";

// F18 Session Logs tab. `useLogLines` (logLines / appendLogLine / clearLogLines) and the fourth
// "Logs" tab do not exist yet - this whole file fails RED on the missing export / missing tab,
// which is the intended feature-shaped failure. The existing console.test.tsx (Console/History/
// Changes) stays untouched and green.

const LOG_LINES: ReadonlyArray<{ raw: string; level: number }> = [
  {
    raw: "[2026-07-10T12:34:56Z][INFO] connect connection_id=db1 engine=postgres tables=12 (34ms)",
    level: 3,
  },
  {
    raw: "[2026-07-10T12:34:56Z][ERROR] connect connection_id=db1 engine=mysql failed (40ms): connection refused",
    level: 5,
  },
  { raw: "[2026-07-10T12:34:56Z][INFO] disconnect connection_id=db1", level: 3 },
  {
    raw: "[2026-07-10T12:34:56Z][INFO] query kind=sql connection_id=db1 statements=3 rows=150 (42ms)",
    level: 3,
  },
  {
    raw: "[2026-07-10T12:34:56Z][ERROR] query kind=mongo connection_id=db1 failed (5ms): bad filter",
    level: 5,
  },
];

// Drives appendLogLine via the real hook (mirrors SeededConsole's use of useWorkspace), so the
// pipeline is exercised for real - no mock of the module under test.
function SeededLogs() {
  const { appendLogLine } = useLogLines();
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          for (const line of LOG_LINES) {
            appendLogLine(line.raw, line.level);
          }
        }}
      >
        seed logs
      </button>
      <Console />
    </div>
  );
}

function renderSeeded() {
  return render(
    <WorkspaceProvider tree={fixtureTree} consoleLines={fixtureConsoleLines}>
      <SeededLogs />
    </WorkspaceProvider>,
  );
}

function consoleRegion(): HTMLElement {
  return screen.getByRole("region", { name: /console/i });
}

// textContent of every rendered log <li>; [] when the list is empty (queryAll never throws).
function logItemTexts(): string[] {
  return within(consoleRegion())
    .queryAllByRole("listitem")
    .map((li) => li.textContent ?? "");
}

function getSearchInput(): HTMLInputElement {
  const region = consoleRegion();
  const input =
    within(region).queryByRole("searchbox") ??
    within(region).queryByRole("textbox");
  if (!input) {
    throw new Error("Logs search input not found");
  }
  return input as HTMLInputElement;
}

// True when the element itself carries the error-red level class, or contains a descendant that does
// (covers both "tint the whole line" and "only the error tail is red" implementations).
function hasRedClass(el: Element | undefined): boolean {
  if (!el) {
    return false;
  }
  return (
    /text-red-600/.test(el.className) ||
    el.querySelector(".text-red-600") !== null
  );
}

describe("Console Logs tab (F18)", () => {
  // AC-01, AC-12 - behavior: all four tabs coexist; the new Logs tab is present alongside the
  // existing three.
  it("should render a Logs tab next to History, Changes and Console", () => {
    renderSeeded();

    expect(screen.getByRole("tab", { name: /history/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /changes/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /console/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /logs/i })).toBeInTheDocument();
  });

  // AC-01 - behavior: opening Logs shows the appended application log lines, in order, newest last.
  it("should render appended log lines in order on the Logs tab", async () => {
    const user = userEvent.setup();
    renderSeeded();

    await user.click(screen.getByRole("button", { name: "seed logs" }));
    await user.click(screen.getByRole("tab", { name: /logs/i }));

    const texts = logItemTexts();
    expect(texts).toHaveLength(LOG_LINES.length);
    expect(texts[0]).toContain("connect connection_id=db1 engine=postgres");
    expect(texts.at(-1)).toContain("bad filter");
  });

  // AC-01 - behavior: the Logs tab shows a (n) count when non-empty, like History/Changes.
  it("should show a count on the Logs tab label when there are lines", async () => {
    const user = userEvent.setup();
    renderSeeded();

    await user.click(screen.getByRole("button", { name: "seed logs" }));

    expect(screen.getByRole("tab", { name: /logs/i }).textContent).toContain(
      "(5)",
    );
  });

  // AC-02 - behavior: an error (failed) line renders with the red level class; a successful line
  // does not.
  it("should render an error line red and a success line not red", async () => {
    const user = userEvent.setup();
    renderSeeded();

    await user.click(screen.getByRole("button", { name: "seed logs" }));
    await user.click(screen.getByRole("tab", { name: /logs/i }));

    const items = within(consoleRegion()).getAllByRole("listitem");
    const errorItem = items.find((li) =>
      li.textContent?.includes("connection refused"),
    );
    const okItem = items.find((li) => li.textContent?.includes("tables=12"));

    expect(hasRedClass(errorItem)).toBe(true);
    expect(hasRedClass(okItem)).toBe(false);
  });

  // AC-05 - behavior: typing `level:error` in the search box leaves only the two error lines.
  it("should filter to error lines when the search box holds level:error", async () => {
    const user = userEvent.setup();
    renderSeeded();

    await user.click(screen.getByRole("button", { name: "seed logs" }));
    await user.click(screen.getByRole("tab", { name: /logs/i }));

    await user.type(getSearchInput(), "level:error");

    const texts = logItemTexts();
    expect(texts).toHaveLength(2);
    expect(texts.some((t) => t.includes("connection refused"))).toBe(true);
    expect(texts.some((t) => t.includes("bad filter"))).toBe(true);
    expect(texts.some((t) => t.includes("disconnect"))).toBe(false);
    expect(texts.some((t) => t.includes("statements=3"))).toBe(false);
  });

  // AC-09 - behavior: Clear empties the Logs list and the Clear button disappears when empty.
  it("should clear the log lines and hide Clear when empty", async () => {
    const user = userEvent.setup();
    renderSeeded();

    await user.click(screen.getByRole("tab", { name: /logs/i }));
    // Nothing to clear yet -> no Clear button on an empty Logs tab.
    expect(
      screen.queryByRole("button", { name: /clear/i }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "seed logs" }));
    expect(logItemTexts().length).toBe(LOG_LINES.length);
    // Now that there are lines, Clear appears.
    const clear = screen.getByRole("button", { name: /clear/i });

    await user.click(clear);

    expect(logItemTexts()).toEqual([]);
    expect(
      screen.queryByRole("button", { name: /clear/i }),
    ).not.toBeInTheDocument();
  });

  // AC-09 (spec: no rising-edge auto-focus) - behavior: appending log lines must NOT steal focus
  // to the Logs tab; the previously active tab stays selected.
  it("should not auto-switch to the Logs tab when a line is appended", async () => {
    const user = userEvent.setup();
    renderSeeded();

    // Default active tab is Console (the "log"/script-output tab).
    expect(screen.getByRole("tab", { name: /console/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await user.click(screen.getByRole("button", { name: "seed logs" }));

    expect(screen.getByRole("tab", { name: /console/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: /logs/i })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  // AC-12 - behavior: the separate Console (script-output) tab still shows consoleLines, proving the
  // new Logs tab did not replace or break it.
  it("should keep the existing Console script-output tab working", async () => {
    const user = userEvent.setup();
    renderSeeded();

    await user.click(screen.getByRole("tab", { name: /console/i }));

    for (const line of fixtureConsoleLines) {
      expect(within(consoleRegion()).getByText(line)).toBeInTheDocument();
    }
  });

  // AC-10 - behavior: appending a log line must NOT rebuild the workspace value (logLines lives in
  // its own isolated context), so a component subscribed to useWorkspace does not re-render.
  it("should not re-render a useWorkspace consumer when a log line is appended", async () => {
    const user = userEvent.setup();
    const workspaceRenders = { count: 0 };
    function WorkspaceConsumer() {
      useWorkspace();
      useEffect(() => {
        workspaceRenders.count += 1;
      });
      return null;
    }
    function LogAppender() {
      const { appendLogLine } = useLogLines();
      return (
        <button
          type="button"
          onClick={() =>
            appendLogLine("[2026-07-10T12:34:56Z][INFO] disconnect connection_id=db1", 3)
          }
        >
          append log
        </button>
      );
    }
    render(
      <WorkspaceProvider tree={fixtureTree} consoleLines={fixtureConsoleLines}>
        <WorkspaceConsumer />
        <LogAppender />
      </WorkspaceProvider>,
    );

    const before = workspaceRenders.count;
    await user.click(screen.getByRole("button", { name: "append log" }));

    // The workspace consumer must not have re-rendered from the log append.
    expect(workspaceRenders.count).toBe(before);
  });

  // behavior: typing a `field:` search still filters (the transparent-text overlay input owns the
  // value) AND the highlight overlay renders the field key in the accent color.
  it("should highlight the field key in the search overlay while still filtering", async () => {
    const user = userEvent.setup();
    renderSeeded();

    await user.click(screen.getByRole("button", { name: "seed logs" }));
    await user.click(screen.getByRole("tab", { name: /logs/i }));
    await user.type(getSearchInput(), "engine:postgres");

    // Filtering still works through the overlay input.
    const texts = logItemTexts();
    expect(texts.some((t) => t.includes("engine=postgres"))).toBe(true);
    expect(texts.some((t) => t.includes("engine=mysql"))).toBe(false);

    // Overlay matches the log lines: the `engine:` KEY is orange, the VALUE is foreground (white).
    const region = consoleRegion();
    const key = within(region).getByText("engine:");
    expect(key.className).toContain("text-orange-600");
    const valueSpan = key.nextElementSibling;
    expect(valueSpan?.textContent).toBe("postgres");
    expect(valueSpan?.className ?? "").toContain("text-foreground");
  });

  // behavior: the search input opts out of auto-capitalization/correction so a `field:value` query
  // is never mangled (design.md input rule).
  it("should disable autocapitalize and autocorrect on the search input", async () => {
    const user = userEvent.setup();
    renderSeeded();

    await user.click(screen.getByRole("tab", { name: /logs/i }));
    const input = getSearchInput();

    expect(input.getAttribute("autocapitalize")).toBe("off");
    expect(input.getAttribute("autocorrect")).toBe("off");
    expect(input.getAttribute("autocomplete")).toBe("off");
  });

  // AC-01, AC-11 - behavior: an injected log stream (the noop-shaped port a real webview replaces)
  // drives the Logs tab through the provider's subscribe wiring, not just a direct appendLogLine.
  it("should render lines pushed through an injected log stream", async () => {
    const user = userEvent.setup();
    let emit: ((raw: string, level: number) => void) | null = null;
    const fakeStream = {
      subscribe: (onLine: (raw: string, level: number) => void) => {
        emit = onLine;
        return Promise.resolve(() => {});
      },
    };
    render(
      <WorkspaceProvider
        tree={fixtureTree}
        consoleLines={fixtureConsoleLines}
        logStream={fakeStream}
      >
        <Console />
      </WorkspaceProvider>,
    );

    await waitFor(() => expect(emit).not.toBeNull());
    await act(async () => {
      emit?.(
        "[2026-07-10T12:34:56Z][ERROR] query kind=mongo connection_id=db1 failed (5ms): bad filter",
        5,
      );
    });

    await user.click(screen.getByRole("tab", { name: /logs/i }));
    expect(logItemTexts().some((t) => t.includes("bad filter"))).toBe(true);
  });
});
