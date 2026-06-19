import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  createRouter,
  createMemoryHistory,
  RouterProvider,
} from "@tanstack/react-router";

import { AppProviders } from "@/app/providers";
import { rootRoute } from "@/routes/__root";
import { indexRoute } from "@/routes/index";
import { settingsRoute } from "@/routes/settings";
import { DemoTable } from "@/components/demo-table";
import { DemoForm } from "@/components/demo-form";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

function renderApp(initialPath = "/") {
  const routeTree = rootRoute.addChildren([indexRoute, settingsRoute]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });

  return render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  );
}

describe("bootstrap scaffold", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue("Hello, World! Greetings from Tauri.");
  });

  // TC-001 / AC-002, AC-008 — behavior
  it("should render home route with heading and a button on launch", async () => {
    renderApp("/");

    expect(
      await screen.findByRole("heading", { name: /home/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /primary action/i }),
    ).toBeInTheDocument();
  });

  // TC-002 / AC-003 — behavior
  it("should navigate between routes when a nav link is activated", async () => {
    const user = userEvent.setup();
    renderApp("/");

    expect(
      await screen.findByRole("heading", { name: /home/i }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: /settings/i }));

    expect(
      await screen.findByText(/configuration lives here/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: /^home$/i }));

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /home/i }),
      ).toBeInTheDocument();
    });
  });

  // TC-003 / AC-004, AC-011 — behavior
  it("should resolve a query backed by a Tauri command and render the greeting", async () => {
    invokeMock.mockResolvedValue("Hello, World! Greetings from Tauri.");
    renderApp("/");

    expect(
      await screen.findByText("Hello, World! Greetings from Tauri."),
    ).toBeInTheDocument();
  });

  // UI state Loading / AC-004 — behavior
  it("should show a loading indicator before the greeting query resolves", async () => {
    let resolveGreet: ((value: string) => void) | undefined;
    invokeMock.mockReturnValue(
      new Promise<string>((resolve) => {
        resolveGreet = resolve;
      }),
    );

    renderApp("/");

    expect(await screen.findByText(/loading/i)).toBeInTheDocument();

    resolveGreet?.("Hello, World! Greetings from Tauri.");

    expect(
      await screen.findByText("Hello, World! Greetings from Tauri."),
    ).toBeInTheDocument();
  });

  // Edge case (greet rejects) / AC-004 — behavior
  it("should show an inline error and not crash when the greet command rejects", async () => {
    invokeMock.mockRejectedValue(new Error("IPC failed"));
    renderApp("/");

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    // app stays alive: home heading still present
    expect(screen.getByRole("heading", { name: /home/i })).toBeInTheDocument();
  });

  // TC-004 / AC-007 — behavior
  it("should toggle the command palette dialog on the Mod+K hotkey", async () => {
    const user = userEvent.setup();
    renderApp("/");

    await screen.findByRole("heading", { name: /home/i });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // Mod resolves to Control under jsdom (it reports as a non-mac platform).
    await user.keyboard("{Control>}k{/Control}");
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    await user.keyboard("{Control>}k{/Control}");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  // AC-005 — behavior
  it("should render a demo table with column headers and rows", () => {
    render(<DemoTable />);

    expect(
      screen.getByRole("columnheader", { name: /kind/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: /name/i }),
    ).toBeInTheDocument();

    const rows = screen.getAllByRole("row");
    // 1 header row + at least one data row
    expect(rows.length).toBeGreaterThan(1);
  });

  // AC-005 (empty state) — behavior
  it("should render an empty state when the demo table has no rows", () => {
    render(<DemoTable rows={[]} />);

    expect(screen.getByText(/no objects yet/i)).toBeInTheDocument();
  });

  // TC-006 / AC-006 — behavior
  it("should show a validation error and not confirm submit when the form field is empty", async () => {
    const user = userEvent.setup();
    render(<DemoForm />);

    await user.click(screen.getByRole("button", { name: /save connection/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/required/i);

    expect(screen.queryByText(/^saved:/i)).not.toBeInTheDocument();
  });

  // TC-002 (unknown route) / AC-003 — behavior
  it("should render a not-found view for an unknown route", async () => {
    renderApp("/this-route-does-not-exist");

    expect(await screen.findByText(/404/i)).toBeInTheDocument();
    expect(screen.getByText(/does not exist/i)).toBeInTheDocument();
  });
});
