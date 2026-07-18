import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DataGrid, exportRowsToFile } from "@/components/workspace/data-grid";
import { toCsv, toJson } from "@/lib/export";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { toast } from "sonner";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  writeTextFile: vi.fn(() => Promise.resolve()),
}));

vi.mock("sonner", () => ({
  Toaster: () => null,
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const noop = () => {};
const alwaysFalse = () => false;

const COLUMNS = ["id", "name"];
const ROWS: (string | null)[][] = [
  ["1", "Ada"],
  ["2", "Linus"],
  ["3", "Grace"],
  ["4", "Edsger"],
];

// Mirror the real caller (sql-tab/table-card `copyRows`): resolve the clicked indices to rows and
// hand them to the exported helper. `base` is the table name (live table) or "results" (SQL grid).
function makeExportRows(base: string) {
  return (rowIndices: number[], format: "CSV" | "JSON") => {
    const picked = rowIndices
      .map((index) => ROWS[index])
      .filter((row): row is (string | null)[] => row !== undefined);
    return exportRowsToFile(COLUMNS, picked, format, base);
  };
}

// Mirror grid-copy-sql's harness: the grid drives the selection reducer, so a Cmd/Ctrl-click builds
// a real multi-selection exactly like the live callers do.
function ExportGrid({
  onExportRows,
  editable = true,
}: {
  onExportRows?: (rowIndices: number[], format: "CSV" | "JSON") => void;
  editable?: boolean;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set([0]));
  const [anchor, setAnchor] = useState<number | null>(0);

  const handleSelectRow = (index: number, mode: string) => {
    if (mode === "toggle") {
      const next = new Set(selected);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      setSelected(next);
      setAnchor(index);
      return;
    }
    if (mode === "range" && anchor !== null) {
      const start = Math.min(anchor, index);
      const end = Math.max(anchor, index);
      const next = new Set<number>();
      for (let i = start; i <= end; i += 1) next.add(i);
      setSelected(next);
      return;
    }
    setSelected(new Set([index]));
    setAnchor(index);
  };

  return (
    <DataGrid
      columns={COLUMNS}
      rows={ROWS}
      selectedRows={selected}
      onSelectRow={handleSelectRow}
      editable={editable}
      editValueAt={(rowIndex, column) =>
        ROWS[rowIndex]?.[COLUMNS.indexOf(column)] ?? null
      }
      isDirtyAt={alwaysFalse}
      onCommitEdit={noop}
      onDeleteRow={editable ? noop : undefined}
      onCopyRows={noop}
      onExportRows={onExportRows}
      shortcuts={{}}
    />
  );
}

const rowFor = (name: string) =>
  screen.getByText(name).closest("tr") as HTMLElement;

describe("grid export to file from context menu", () => {
  beforeEach(() => vi.clearAllMocks());

  // behavior (TC-001, AC-001): with onExportRows wired, the row menu offers Export CSV/JSON items.
  it("should render Export CSV and Export JSON items when onExportRows is supplied", () => {
    render(<ExportGrid onExportRows={vi.fn()} />);

    fireEvent.contextMenu(rowFor("Ada"));

    expect(
      screen.queryByRole("menuitem", { name: /export csv/i }) ??
        screen.getByText(/export csv/i),
    ).toBeTruthy();
    expect(
      screen.queryByRole("menuitem", { name: /export json/i }) ??
        screen.getByText(/export json/i),
    ).toBeTruthy();
  });

  // behavior (AC-007): without onExportRows the static/JS-script grid gets no Export items.
  it("should not render Export items when onExportRows is absent", () => {
    render(<ExportGrid />);

    fireEvent.contextMenu(rowFor("Ada"));

    expect(within(document.body).queryByText(/export csv/i)).toBeNull();
    expect(within(document.body).queryByText(/export json/i)).toBeNull();
  });

  // side-effect-contract (TC-003, AC-002): a right-clicked row inside the multi-selection exports the
  // whole selection, and the label carries the "(N rows)" suffix.
  it("should call onExportRows with every selected index and a (N rows) suffix when the target is in the selection", async () => {
    const user = userEvent.setup();
    const onExportRows = vi.fn();
    render(<ExportGrid onExportRows={onExportRows} />);

    await user.click(rowFor("Ada"));
    await user.keyboard("{Meta>}");
    await user.click(rowFor("Grace"));
    await user.keyboard("{/Meta}");

    fireEvent.contextMenu(rowFor("Ada"));
    const item =
      screen.queryByRole("menuitem", { name: /export csv.*\(2 rows\)/i }) ??
      screen.getByText(/export csv.*\(2 rows\)/i);
    await user.click(item);

    expect(onExportRows).toHaveBeenCalledTimes(1);
    expect([...onExportRows.mock.calls[0][0]].sort()).toEqual([0, 2]);
    expect(onExportRows.mock.calls[0][1]).toBe("CSV");
  });

  // side-effect-contract (TC-003, AC-002): a single unselected row exports just that row, no suffix.
  it("should call onExportRows with just the clicked index and no suffix for a single unselected row", async () => {
    const user = userEvent.setup();
    const onExportRows = vi.fn();
    render(<ExportGrid onExportRows={onExportRows} />);

    // Ada (index 0) is the initial selection; right-click Linus (index 1), an unselected row.
    fireEvent.contextMenu(rowFor("Linus"));

    expect(within(document.body).queryByText(/export csv.*\(\d+ rows\)/i)).toBeNull();
    const item =
      screen.queryByRole("menuitem", { name: /^export csv/i }) ??
      screen.getByText(/^export csv/i);
    await user.click(item);

    expect(onExportRows).toHaveBeenCalledWith([1], "CSV");
  });

  // side-effect-contract (TC-001, AC-003, AC-006): choosing a path writes the CSV bytes of that row
  // to the chosen path, then a success toast.
  it("should write the CSV bytes to the chosen path and toast success", async () => {
    vi.mocked(save).mockResolvedValueOnce("/tmp/users.csv");
    const user = userEvent.setup();
    render(<ExportGrid onExportRows={makeExportRows("users")} />);

    fireEvent.contextMenu(rowFor("Ada"));
    await user.click(
      screen.queryByRole("menuitem", { name: /^export csv/i }) ??
        screen.getByText(/^export csv/i),
    );

    await waitFor(() => expect(writeTextFile).toHaveBeenCalledTimes(1));
    const [path, contents] = vi.mocked(writeTextFile).mock.calls[0];
    expect(path).toBe("/tmp/users.csv");
    expect(contents).toBe(toCsv(COLUMNS, [["1", "Ada"]]));
    // AC-006: the save dialog is seeded with a `<base>-<stamp>.csv` default name + a CSV filter.
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: expect.stringMatching(/^users-\d{8}-\d{6}\.csv$/),
        filters: [
          { name: "CSV", extensions: ["csv"] },
          { name: "All files", extensions: ["*"] },
        ],
      }),
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        expect.stringContaining("/tmp/users.csv"),
      ),
    );
    expect(toast.error).not.toHaveBeenCalled();
  });

  // side-effect-contract (TC-002, AC-003): the JSON item writes toJson bytes.
  it("should write the JSON bytes when Export JSON is chosen", async () => {
    vi.mocked(save).mockResolvedValueOnce("/tmp/users.json");
    const user = userEvent.setup();
    render(<ExportGrid onExportRows={makeExportRows("users")} />);

    fireEvent.contextMenu(rowFor("Ada"));
    await user.click(
      screen.queryByRole("menuitem", { name: /^export json/i }) ??
        screen.getByText(/^export json/i),
    );

    await waitFor(() => expect(writeTextFile).toHaveBeenCalledTimes(1));
    const [path, contents] = vi.mocked(writeTextFile).mock.calls[0];
    expect(path).toBe("/tmp/users.json");
    expect(contents).toBe(toJson(COLUMNS, [["1", "Ada"]]));
  });

  // side-effect-contract (TC-004, AC-004): cancelling the save dialog writes nothing and toasts nothing.
  it("should be a no-op when the save dialog is cancelled", async () => {
    vi.mocked(save).mockResolvedValueOnce(null);
    const user = userEvent.setup();
    render(<ExportGrid onExportRows={makeExportRows("users")} />);

    fireEvent.contextMenu(rowFor("Ada"));
    await user.click(
      screen.queryByRole("menuitem", { name: /^export csv/i }) ??
        screen.getByText(/^export csv/i),
    );

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(writeTextFile).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  // side-effect-contract (TC-005, AC-005): a failed write surfaces a sticky error toast, no success.
  it("should show a sticky error toast when the write fails", async () => {
    vi.mocked(save).mockResolvedValueOnce("/tmp/users.csv");
    vi.mocked(writeTextFile).mockRejectedValueOnce(new Error("disk full"));
    const user = userEvent.setup();
    render(<ExportGrid onExportRows={makeExportRows("users")} />);

    fireEvent.contextMenu(rowFor("Ada"));
    await user.click(
      screen.queryByRole("menuitem", { name: /^export csv/i }) ??
        screen.getByText(/^export csv/i),
    );

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.error).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ duration: Infinity }),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  // side-effect-contract (TC-006, AC-007): the read-only SQL result grid gets Export items and writes
  // its rows to the chosen path (base "results").
  it("should offer Export items on the read-only SQL result grid and write its rows", async () => {
    vi.mocked(save).mockResolvedValueOnce("/tmp/results.csv");
    const user = userEvent.setup();
    render(<ExportGrid editable={false} onExportRows={makeExportRows("results")} />);

    fireEvent.contextMenu(rowFor("Ada"));
    expect(
      screen.queryByRole("menuitem", { name: /export csv/i }) ??
        screen.getByText(/export csv/i),
    ).toBeTruthy();

    await user.click(
      screen.queryByRole("menuitem", { name: /^export csv/i }) ??
        screen.getByText(/^export csv/i),
    );

    await waitFor(() => expect(writeTextFile).toHaveBeenCalledTimes(1));
    const [path, contents] = vi.mocked(writeTextFile).mock.calls[0];
    expect(path).toBe("/tmp/results.csv");
    expect(contents).toBe(toCsv(COLUMNS, [["1", "Ada"]]));
  });
});
