import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  WorkspaceProvider,
  useWorkspace,
} from "@/components/workspace/workspace-context";
import { Console } from "@/components/workspace/console";
import {
  fixtureTree,
  fixtureConsoleLines,
} from "@/components/workspace/__tests__/fixtures";

// SQL is rendered through SqlText, which splits each statement into per-token <span>s, so a plain
// getByText on the whole statement fails ("broken up by multiple elements"). Match on the element's
// full textContent instead - the SqlText wrapper span whose combined text matches.
function sqlText(pattern: RegExp) {
  return (_content: string, element: Element | null): boolean => {
    if (!element) {
      return false;
    }
    // Only the innermost wrapper (a span whose direct children are the token spans) should match,
    // not every ancestor, so getByText stays unambiguous.
    const isLeafWrapper = element.tagName === "SPAN";
    return isLeafWrapper && pattern.test(element.textContent ?? "");
  };
}

// Seeds one query-history entry + one pending edit, then renders the Console.
function SeededConsole() {
  const { addHistoryEntry, upsertPendingEdit } = useWorkspace();
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          addHistoryEntry({
            id: "h1",
            sql: "explain analyze select from email;",
            status: "success",
            message: "SELECT 3",
            at: "19:55:46",
          });
          upsertPendingEdit({
            kind: "cell",
            id: "e1",
            tableId: "tbl-product",
            tableName: "product",
            column: "duration",
            rowIndex: 0,
            pkValue: "9db4cf53",
            oldValue: "14",
            newValue: "2",
            sql: 'UPDATE "product" SET "duration" = \'2\' WHERE "id" = \'9db4cf53\'',
          });
        }}
      >
        seed
      </button>
      <Console />
    </div>
  );
}

// Reproduces the user's exact sequence: run queries (History auto-focuses), then edit
// (auto-switch to Changes). Separate buttons so the actions happen in distinct renders.
let historyN = 0;
function SeededHistoryThenEdit() {
  const { addHistoryEntry, upsertPendingEdit } = useWorkspace();
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          historyN += 1;
          addHistoryEntry({
            id: `q${historyN}`,
            sql: 'SELECT * FROM "product" LIMIT 200',
            status: "success",
            message: "SELECT 38",
            at: "20:25:18",
          });
        }}
      >
        run query
      </button>
      <button
        type="button"
        onClick={() =>
          upsertPendingEdit({
            kind: "cell",
            id: "e1",
            tableId: "tbl-product",
            tableName: "product",
            column: "price",
            rowIndex: 0,
            pkValue: "d6fe542c",
            oldValue: "1199",
            newValue: "2",
            sql: 'UPDATE "product" SET "price" = \'2\' WHERE "id" = \'d6fe542c\'',
          })
        }
      >
        edit
      </button>
      <Console />
    </div>
  );
}

describe("Console", () => {
  // AC-016 — behavior
  it("should expose a console region", () => {
    render(
      <WorkspaceProvider tree={fixtureTree} consoleLines={fixtureConsoleLines}>
        <Console />
      </WorkspaceProvider>,
    );
    expect(
      screen.getByRole("region", { name: /console/i }),
    ).toBeInTheDocument();
  });

  // AC-016 — behavior
  it("should render each mock log line as text inside the console region", () => {
    render(
      <WorkspaceProvider tree={fixtureTree} consoleLines={fixtureConsoleLines}>
        <Console />
      </WorkspaceProvider>,
    );
    const region = screen.getByRole("region", { name: /console/i });
    for (const line of fixtureConsoleLines) {
      expect(within(region).getByText(line)).toBeInTheDocument();
    }
  });

  // behavior (Clear on the History tab empties the query history)
  it("should clear the query history when Clear is clicked on the History tab", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider tree={fixtureTree} consoleLines={fixtureConsoleLines}>
        <SeededConsole />
      </WorkspaceProvider>,
    );

    await user.click(screen.getByRole("button", { name: "seed" }));
    await user.click(screen.getByRole("tab", { name: /history/i }));
    expect(screen.getByText(sqlText(/explain analyze select from email/i))).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /clear/i }));

    expect(
      screen.queryByText(sqlText(/explain analyze select from email/i)),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/no queries run yet/i)).toBeInTheDocument();
  });

  // behavior (Clear on the Changes tab discards every pending edit)
  it("should discard all pending edits when Clear is clicked on the Changes tab", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider tree={fixtureTree} consoleLines={fixtureConsoleLines}>
        <SeededConsole />
      </WorkspaceProvider>,
    );

    await user.click(screen.getByRole("button", { name: "seed" }));
    await user.click(screen.getByRole("tab", { name: /changes/i }));
    expect(screen.getByText(sqlText(/UPDATE "product" SET "duration"/i))).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /clear/i }));

    expect(
      screen.queryByText(sqlText(/UPDATE "product" SET "duration"/i)),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/no pending changes/i)).toBeInTheDocument();
  });

  // behavior (no Clear button when the active tab has nothing to clear)
  it("should not show Clear on the History tab when there is no history", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider tree={fixtureTree} consoleLines={fixtureConsoleLines}>
        <Console />
      </WorkspaceProvider>,
    );

    await user.click(screen.getByRole("tab", { name: /history/i }));

    expect(
      screen.queryByRole("button", { name: /clear/i }),
    ).not.toBeInTheDocument();
  });

  // behavior (Changes shows ONLY pending edits, never query-history entries)
  it("should not show query-history entries in the Changes tab", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider tree={fixtureTree} consoleLines={fixtureConsoleLines}>
        <SeededConsole />
      </WorkspaceProvider>,
    );

    await user.click(screen.getByRole("button", { name: "seed" }));
    await user.click(screen.getByRole("tab", { name: /changes/i }));

    expect(
      screen.getByText(sqlText(/UPDATE "product" SET "duration"/i)),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(sqlText(/explain analyze select from email/i)),
    ).not.toBeInTheDocument();
  });

  // behavior (repro: History active, then an edit auto-switches to Changes -
  // the Changes tab must show ONLY the edit, never the history SELECTs)
  it("should show only the pending edit when an edit auto-switches from History to Changes", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider tree={fixtureTree} consoleLines={fixtureConsoleLines}>
        <SeededHistoryThenEdit />
      </WorkspaceProvider>,
    );

    // 1. run two queries -> History auto-focuses
    await user.click(screen.getByRole("button", { name: "run query" }));
    await user.click(screen.getByRole("button", { name: "run query" }));
    expect(screen.getByRole("tab", { name: /history/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // 2. make an edit -> auto-switches to Changes
    await user.click(screen.getByRole("button", { name: "edit" }));
    expect(screen.getByRole("tab", { name: /changes/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // Changes must show the UPDATE and NOT the history SELECTs
    expect(
      screen.getByText(sqlText(/UPDATE "product" SET "price"/i)),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(sqlText(/SELECT \* FROM "product"/i)),
    ).not.toBeInTheDocument();

    // The query-history list must not linger in the DOM under the Changes tab,
    // and the pending-changes list must contain only the edit row(s).
    expect(
      screen.queryByRole("list", { name: /query history/i }),
    ).not.toBeInTheDocument();
    const changes = screen.getByRole("list", { name: /pending changes/i });
    expect(within(changes).getAllByRole("listitem")).toHaveLength(1);
  });
});
