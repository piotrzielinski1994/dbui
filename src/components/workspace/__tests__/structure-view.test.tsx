import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

// The read-only structure panel (F6 #14). It does not exist yet; the import fails at runtime until
// structure-view.tsx ships, so each test fails on the missing component, not a typo.
import { StructureView } from "@/components/workspace/structure-view";
import type { TableStructure } from "@/lib/workspace/model";

// A full SQL-engine structure: one column, one secondary index, one FK, one named constraint - so
// every section has a value to render.
const fullStructure: TableStructure = {
  columns: [
    {
      name: "email",
      dataType: "text",
      nullable: false,
      isPrimaryKey: false,
      defaultValue: null,
      ordinal: 2,
    },
  ],
  indexes: [
    {
      name: "users_email_idx",
      columns: ["email"],
      isUnique: true,
      isPrimary: false,
    },
  ],
  foreignKeys: [
    {
      name: "users_org_fk",
      columns: ["org_id"],
      referencedTable: "organizations",
      referencedSchema: null,
      referencedColumns: ["id"],
    },
  ],
  constraints: [
    {
      name: "users_email_unique",
      kind: "unique",
      definition: null,
    },
  ],
};

// A Mongo collection: only indexes are meaningful; columns/FK/constraints are empty.
const mongoStructure: TableStructure = {
  columns: [],
  indexes: [
    {
      name: "_id_",
      columns: ["_id"],
      isUnique: true,
      isPrimary: true,
    },
  ],
  foreignKeys: [],
  constraints: [],
};

describe("StructureView", () => {
  // AC-009, TC-001 - behavior: a SQL-engine structure renders all four labelled sections with the
  // real column/index/FK/constraint values.
  it("should render all four sections with their values for a SQL engine", () => {
    render(<StructureView structure={fullStructure} engine="postgres" />);

    expect(screen.getByText(/^columns$/i)).toBeInTheDocument();
    expect(screen.getByText(/^indexes$/i)).toBeInTheDocument();
    expect(screen.getByText(/^foreign keys$/i)).toBeInTheDocument();
    expect(screen.getByText(/^constraints$/i)).toBeInTheDocument();

    // `email` legitimately appears twice: the column name AND the index's field list, so match all.
    expect(screen.getAllByText("email").length).toBeGreaterThan(0);
    expect(screen.getByText("users_email_idx")).toBeInTheDocument();
    expect(screen.getByText(/organizations/)).toBeInTheDocument();
    expect(screen.getByText("users_email_unique")).toBeInTheDocument();
  });

  // AC-010, E-1, TC-005 - behavior: an empty section renders a muted "None" line rather than
  // collapsing.
  it("should render None for an empty section", () => {
    const noIndexes: TableStructure = { ...fullStructure, indexes: [] };
    render(<StructureView structure={noIndexes} engine="postgres" />);

    // Indexes still has a heading, and shows None since it has no rows.
    expect(screen.getByText(/^indexes$/i)).toBeInTheDocument();
    expect(screen.getByText(/^none$/i)).toBeInTheDocument();
  });

  // AC-006, AC-011, E-5, TC-002 - behavior: for a MongoDB collection only the Indexes section is
  // shown; Columns / Foreign keys / Constraints are hidden.
  it("should show only the Indexes section for a mongodb engine", () => {
    render(<StructureView structure={mongoStructure} engine="mongodb" />);

    expect(screen.getByText(/^indexes$/i)).toBeInTheDocument();
    expect(screen.getByText("_id_")).toBeInTheDocument();

    expect(screen.queryByText(/^columns$/i)).toBeNull();
    expect(screen.queryByText(/^foreign keys$/i)).toBeNull();
    expect(screen.queryByText(/^constraints$/i)).toBeNull();
  });
});
