import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { QueryWrapper } from "@/test/query-wrapper";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { DatabaseCard } from "@/components/workspace/database-card";
import { fixtureTree } from "@/components/workspace/__tests__/fixtures";
import type { ConnectionConfig } from "@/components/workspace/mock-data";
import { connectDatabase } from "@/lib/tauri";

vi.mock("@/lib/tauri", () => ({
  connectDatabase: vi.fn(),
  fetchTable: vi.fn(),
  updateTable: vi.fn(),
  executeSql: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const mockConnect = vi.mocked(connectDatabase);

beforeEach(() => {
  vi.clearAllMocks();
  mockConnect.mockResolvedValue([]);
});

function renderCard(
  activeTabId?: string,
  initialConnections?: [string, ConnectionConfig][],
) {
  return render(
    <QueryWrapper>
      <WorkspaceProvider
        tree={fixtureTree}
        initialActiveTabId={activeTabId}
        initialConnections={initialConnections}
      >
        <DatabaseCard />
      </WorkspaceProvider>
    </QueryWrapper>,
  );
}

describe("DatabaseCard", () => {
  // AC-008, TC-006 — behavior (the four sub-tabs)
  it("should expose a database-sections tablist with SQL, Views, Script and Settings tabs", () => {
    renderCard("db-app");
    expect(
      screen.getByRole("tablist", { name: /database sections|workbench/i }),
    ).toBeInTheDocument();
    for (const name of ["SQL", "Views", "Script", "Settings"]) {
      expect(screen.getByRole("tab", { name })).toBeInTheDocument();
    }
  });

  // AC-008, TC-006 — behavior (the removed Tables sub-tab is gone)
  it("should not expose a Tables sub-tab", () => {
    renderCard("db-app");
    expect(
      screen.queryByRole("tab", { name: "Tables" }),
    ).not.toBeInTheDocument();
  });

  // AC-008 — behavior (SQL is the default active sub-tab; editor seeded from the sql)
  it("should render the SQL panel by default with the database sql text", () => {
    renderCard("db-app");
    const editor = screen.getByRole("textbox", { name: /sql editor/i });
    expect((editor as HTMLTextAreaElement).value).toContain("FROM users");
  });

  // AC-008, AC-012, TC-006 — behavior (switching to Views)
  it("should render the Views panel when the Views sub-tab is clicked", async () => {
    const user = userEvent.setup();
    renderCard("db-app");

    await user.click(screen.getByRole("tab", { name: "Views" }));
    expect(screen.getByText("active_users")).toBeInTheDocument();
    expect(screen.getByText("daily_signups")).toBeInTheDocument();
  });

  // AC-008, AC-013, TC-006 — behavior (switching to Script)
  it("should render the Script panel when the Script sub-tab is clicked", async () => {
    const user = userEvent.setup();
    renderCard("db-app");

    await user.click(screen.getByRole("tab", { name: "Script" }));
    expect(screen.getByText(/VACUUM ANALYZE users/)).toBeInTheDocument();
  });

  // AC-008, AC-014, TC-006 — behavior (switching to Settings)
  it("should render the Settings panel when the Settings sub-tab is clicked", async () => {
    const user = userEvent.setup();
    renderCard("db-app");

    await user.click(screen.getByRole("tab", { name: "Settings" }));
    expect(screen.getByRole("textbox", { name: /host/i })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /user/i })).toBeInTheDocument();
  });

  // AC-019, E-1 — behavior (no active tab -> no sub-tab tablist)
  it("should not render a database-sections tablist when no tab is active", () => {
    renderCard(undefined);
    expect(
      screen.queryByRole("tablist", { name: /database sections|workbench/i }),
    ).not.toBeInTheDocument();
  });
});

describe("DatabaseCard auto-connect", () => {
  // behavior (opening a database view connects it automatically, no manual Connect)
  it("should auto-connect the database when its view is opened", async () => {
    mockConnect.mockResolvedValue(["product"]);
    renderCard("db-app");

    await waitFor(() => {
      expect(mockConnect).toHaveBeenCalledWith(
        expect.objectContaining({
          host: "localhost",
          database: "app",
          user: "app_user",
        }),
      );
    });
  });

  // behavior (auto-connect fires once, not on every render)
  it("should auto-connect only once for the same database", async () => {
    mockConnect.mockResolvedValue(["product"]);
    renderCard("db-app");

    await waitFor(() => {
      expect(mockConnect).toHaveBeenCalledTimes(1);
    });
    // give any stray re-render effects a chance to (wrongly) re-fire
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  // behavior (no auto-connect when there is no active database)
  it("should not auto-connect when no database tab is active", async () => {
    renderCard(undefined);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(mockConnect).not.toHaveBeenCalled();
  });

  // behavior (restored connection still re-fetches its catalog on open)
  it("should auto-connect a restored connection with its saved config when its view is opened", async () => {
    const saved: ConnectionConfig = {
      engine: "postgres",
      host: "saved-host",
      port: 5432,
      database: "saved_db",
      user: "saved_user",
      password: "saved_pw",
    };
    mockConnect.mockResolvedValue(["restored_table"]);
    renderCard("db-app", [["db-app", saved]]);

    await waitFor(() => {
      expect(mockConnect).toHaveBeenCalledWith(saved);
    });
  });
});
