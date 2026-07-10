import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { QueryWrapper } from "@/test/query-wrapper";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { WorkspaceLayout } from "@/components/workspace/workspace-layout";
import { fixtureTree } from "@/components/workspace/__tests__/fixtures";

const COMMAND = "Generate mock data";

function openPalette() {
  fireEvent.keyDown(window, { key: "k", metaKey: true });
}

describe("Generate mock data palette command (AC-001)", () => {
  // AC-001, TC-001 - behavior: the command is offered while a table tab is active.
  it("should offer the Generate mock data command when a table tab is active", () => {
    render(
      <QueryWrapper>
        <WorkspaceProvider tree={fixtureTree} initialActiveTabId="tbl-accounts">
          <WorkspaceLayout />
        </WorkspaceProvider>
      </QueryWrapper>,
    );

    openPalette();

    expect(screen.getByText(COMMAND)).toBeInTheDocument();
  });

  // AC-001 - behavior: the command is grouped under Create.
  it("should render the Generate mock data command under the Create group", () => {
    render(
      <QueryWrapper>
        <WorkspaceProvider tree={fixtureTree} initialActiveTabId="tbl-accounts">
          <WorkspaceLayout />
        </WorkspaceProvider>
      </QueryWrapper>,
    );

    openPalette();

    const createGroup = screen
      .getByText("Create")
      .closest("[cmdk-group]") as HTMLElement | null;
    expect(createGroup).not.toBeNull();
    expect(createGroup?.textContent).toContain(COMMAND);
  });

  // AC-001 - behavior: the command is hidden when a database (non-table) tab is active.
  it("should not offer the Generate mock data command when a database tab is active", () => {
    render(
      <QueryWrapper>
        <WorkspaceProvider tree={fixtureTree} initialActiveTabId="db-admin">
          <WorkspaceLayout />
        </WorkspaceProvider>
      </QueryWrapper>,
    );

    openPalette();

    expect(screen.queryByText(COMMAND)).not.toBeInTheDocument();
  });

  // AC-001 - behavior: the command is hidden when no tab is open.
  it("should not offer the Generate mock data command when no tab is open", () => {
    render(
      <QueryWrapper>
        <WorkspaceProvider tree={fixtureTree}>
          <WorkspaceLayout />
        </WorkspaceProvider>
      </QueryWrapper>,
    );

    openPalette();

    expect(screen.queryByText(COMMAND)).not.toBeInTheDocument();
  });
});
