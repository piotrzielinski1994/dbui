import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DataGrid } from "@/components/workspace/data-grid";

const noop = () => {};
const alwaysFalse = () => false;

// A grid with one saved row (index 0) and one draft row (index 1), copy + delete + clone wired -
// exactly the editable table-card shape once a mock/insert draft is staged.
function DraftGrid({
  onCopyRows = vi.fn(),
  onCopySql = vi.fn(),
  onDeleteRow = vi.fn(),
  onCloneRow = vi.fn(),
}: {
  onCopyRows?: (rowIndices: number[], format: "CSV" | "JSON") => void;
  onCopySql?: (rowIndices: number[]) => void;
  onDeleteRow?: (rowIndex: number) => void;
  onCloneRow?: (rowIndex: number) => void;
}) {
  const columns = ["id", "name"];
  const rows = [
    ["1", "Ada"],
    ["99", "DraftBob"],
  ];
  const [selected, setSelected] = useState<Set<number>>(new Set());
  return (
    <DataGrid
      columns={columns}
      rows={rows}
      selectedRows={selected}
      onSelectRow={(index) => setSelected(new Set([index]))}
      editable
      editValueAt={(rowIndex, column) =>
        rows[rowIndex]?.[columns.indexOf(column)] ?? null
      }
      isDirtyAt={alwaysFalse}
      onCommitEdit={noop}
      isDraftRow={(rowIndex) => rowIndex === 1}
      onDeleteRow={onDeleteRow}
      onCloneRow={onCloneRow}
      onCopyRows={onCopyRows}
      onCopySql={onCopySql}
      shortcuts={{}}
    />
  );
}

const rowFor = (name: string) =>
  screen.getByText(name).closest("tr") as HTMLElement;

describe("draft row copy context menu", () => {
  // behavior: a draft (staged-insert) row exposes a context menu with Copy CSV / Copy JSON / Copy SQL,
  // so it can be copied to the clipboard like a saved row.
  it("should offer Copy CSV, Copy JSON and Copy SQL on a draft row", async () => {
    render(<DraftGrid />);

    fireEvent.contextMenu(rowFor("DraftBob"));

    expect(screen.getByText(/copy csv/i)).toBeInTheDocument();
    expect(screen.getByText(/copy json/i)).toBeInTheDocument();
    expect(screen.getByText(/copy sql/i)).toBeInTheDocument();
  });

  // side-effect-contract: copying a draft row calls onCopyRows with that row's grid index (drafts are
  // appended after the saved rows, so index 1 here).
  it("should copy the draft row by its grid index", async () => {
    const user = userEvent.setup();
    const onCopyRows = vi.fn();
    render(<DraftGrid onCopyRows={onCopyRows} />);

    fireEvent.contextMenu(rowFor("DraftBob"));
    await user.click(screen.getByText(/copy csv/i));

    expect(onCopyRows).toHaveBeenCalledWith([1], "CSV");
  });

  // behavior: a draft row must NOT offer Delete or Clone - drafts are discarded via the Changes tab,
  // and cloning/deleting a not-yet-saved row is meaningless. Only the copy items appear.
  it("should not offer Delete or Clone on a draft row", () => {
    render(<DraftGrid />);

    fireEvent.contextMenu(rowFor("DraftBob"));

    expect(screen.queryByRole("menuitem", { name: /^delete$/i })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /clone/i })).toBeNull();
  });

  // behavior: a SAVED row still offers Delete + Clone (the draft restriction must not regress it).
  it("should still offer Delete and Clone on a saved row", async () => {
    render(<DraftGrid />);

    fireEvent.contextMenu(rowFor("Ada"));

    expect(
      await screen.findByRole("menuitem", { name: /^delete$/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /clone/i })).toBeInTheDocument();
  });
});
