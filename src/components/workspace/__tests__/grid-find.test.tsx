import { describe, it, expect } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DataGrid } from "@/components/workspace/data-grid";

const noop = () => {};
const alwaysFalse = () => false;

const columns = ["id", "name"];
const gridRows: (string | null)[][] = [
  ["1", "Ada"], // "a" matches name
  ["2", "Alan"], // "a" matches name
  ["3", "Bob"], // no "a"
  ["4", "Carol"], // "a" matches name
];

function FindGrid() {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  return (
    <DataGrid
      columns={columns}
      rows={gridRows}
      selectedRows={selected}
      onSelectRow={(index) => setSelected(new Set([index]))}
      editable
      editValueAt={(rowIndex, column) =>
        gridRows[rowIndex]?.[columns.indexOf(column)] ?? null
      }
      isDirtyAt={alwaysFalse}
      onCommitEdit={noop}
      shortcuts={{}}
    />
  );
}

const rowFor = (name: string) =>
  screen.getByText(name).closest("tr") as HTMLElement;

// The deepest element whose entire text is an "N/total" count, normalized (spaces stripped).
function countText(): string {
  const els = Array.from(document.querySelectorAll<HTMLElement>("*")).reverse();
  const match = els.find((el) => /^\s*\d+\s*\/\s*\d+\s*$/.test(el.textContent ?? ""));
  return (match?.textContent ?? "").replace(/\s+/g, "");
}

async function openFind(user: ReturnType<typeof userEvent.setup>) {
  // Click a row to move focus into the grid container (mirrors the delete-rows keydown setup),
  // then fire the open-find binding (Cmd/Ctrl+F).
  await user.click(rowFor("Ada"));
  await user.keyboard("{Meta>}f{/Meta}");
}

describe("grid find bar", () => {
  // behavior: with the grid focused, Cmd+F opens a find bar (AC-004, TC-006)
  it("should open a find bar when Cmd+F is pressed with the grid focused", async () => {
    const user = userEvent.setup();
    render(<FindGrid />);

    expect(screen.queryByRole("textbox")).toBeNull();

    await openFind(user);

    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  // behavior: Cmd+F does nothing when focus is outside the grid (AC-004 negative)
  it("should not open a find bar when the grid is not focused", async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">outside</button>
        <FindGrid />
      </>,
    );

    await user.click(screen.getByRole("button", { name: "outside" }));
    await user.keyboard("{Meta>}f{/Meta}");

    expect(screen.queryByRole("textbox")).toBeNull();
  });

  // behavior: typing computes the match count as N/total (AC-005, TC-006)
  it("should show the N/total count as the query is typed", async () => {
    const user = userEvent.setup();
    render(<FindGrid />);

    await openFind(user);
    await user.type(screen.getByRole("textbox"), "a");

    // "a" matches Ada, Alan, Carol -> 3 matches, active is the first (1-based).
    expect(countText()).toBe("1/3");
  });

  // edge: a query matching nothing shows 0/0 (AC-005, TC-005, UI states)
  it("should show 0/0 when the query matches nothing", async () => {
    const user = userEvent.setup();
    render(<FindGrid />);

    await openFind(user);
    await user.type(screen.getByRole("textbox"), "zzz");

    expect(countText()).toBe("0/0");
  });

  // behavior: Enter advances to the next match and wraps at the end (AC-006, TC-006)
  it("should advance the active match on Enter and wrap around", async () => {
    const user = userEvent.setup();
    render(<FindGrid />);

    await openFind(user);
    const input = screen.getByRole("textbox");
    await user.type(input, "a");
    expect(countText()).toBe("1/3");

    await user.keyboard("{Enter}");
    expect(countText()).toBe("2/3");

    await user.keyboard("{Enter}");
    expect(countText()).toBe("3/3");

    // wrap back to the first match
    await user.keyboard("{Enter}");
    expect(countText()).toBe("1/3");
  });

  // behavior: Shift+Enter steps to the previous match, wrapping backwards (AC-006)
  it("should step to the previous match on Shift+Enter and wrap backwards", async () => {
    const user = userEvent.setup();
    render(<FindGrid />);

    await openFind(user);
    const input = screen.getByRole("textbox");
    await user.type(input, "a");
    expect(countText()).toBe("1/3");

    // from the first match, Shift+Enter wraps to the last
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    expect(countText()).toBe("3/3");
  });

  // behavior: Escape closes the find bar (AC-007, TC-006)
  it("should close the find bar on Escape", async () => {
    const user = userEvent.setup();
    render(<FindGrid />);

    await openFind(user);
    expect(screen.getByRole("textbox")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("textbox")).toBeNull();
  });

  // behavior: the active match's cell is visually highlighted and moves with the cursor (AC-006)
  it("should highlight the active match cell and move it on Enter", async () => {
    const user = userEvent.setup();
    render(<FindGrid />);

    await openFind(user);
    await user.type(screen.getByRole("textbox"), "a");

    // The active-match cell (match 1 of 3 -> Ada's name cell) carries the strong highlight.
    const activeCellFor = (name: string) =>
      screen.getByText(name).closest("td") as HTMLElement;
    expect(activeCellFor("Ada").className).toMatch(/bg-primary\/40/);
    expect(activeCellFor("Alan").className).not.toMatch(/bg-primary\/40/);

    // Advancing moves the strong highlight to the next match (Alan).
    await user.keyboard("{Enter}");
    expect(activeCellFor("Alan").className).toMatch(/bg-primary\/40/);
    expect(activeCellFor("Ada").className).not.toMatch(/bg-primary\/40/);
  });

  // behavior: find is non-destructive - all rows stay in the DOM (AC-008, TC-007)
  it("should keep every original row rendered after a matching find", async () => {
    const user = userEvent.setup();
    render(<FindGrid />);

    await openFind(user);
    await user.type(screen.getByRole("textbox"), "a");

    // Bob has no "a" but must still be rendered - find highlights, it does not filter.
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("Alan")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("Carol")).toBeInTheDocument();
  });
});
