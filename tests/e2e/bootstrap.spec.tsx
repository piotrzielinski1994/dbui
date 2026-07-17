import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  createRouter,
  createMemoryHistory,
  RouterProvider,
} from "@tanstack/react-router";

import { AppProviders } from "@/app/providers";
import { rootRoute } from "@/routes/__root";
import { indexRoute } from "@/routes/index";
import { settingsRoute } from "@/routes/settings";

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

describe("workspace routing", () => {
  // AC-001 — behavior (first run with no workspacePath shows the Open-workspace prompt, no tree)
  it("should render the open-workspace prompt at the home route with no workspace open", async () => {
    renderApp("/");
    expect(
      await screen.findByRole("button", { name: /open workspace folder/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("tree", { name: /navigator/i })).not.toBeInTheDocument();
  });

  // AC-001 — behavior (the console region only mounts inside a loaded workspace, not the empty state)
  it("should not render the console region before a workspace is open", async () => {
    renderApp("/");
    await screen.findByRole("button", { name: /open workspace folder/i });
    expect(
      screen.queryByRole("region", { name: /console/i }),
    ).not.toBeInTheDocument();
  });

  // AC-015 — behavior (bootstrap demo nav removed)
  it("should not render the old bootstrap home nav link", async () => {
    renderApp("/");
    await screen.findByRole("button", { name: /open workspace folder/i });
    expect(
      screen.queryByRole("link", { name: /^home$/i }),
    ).not.toBeInTheDocument();
  });

  // AC-015 — behavior (no command palette dialog)
  it("should not render a command palette dialog", async () => {
    renderApp("/");
    await screen.findByRole("button", { name: /open workspace folder/i });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // behavior (settings route renders its content)
  it("should still render the settings route content", async () => {
    renderApp("/settings");
    // The settings route now hosts the Theme section (multi-theme feature).
    expect(
      await screen.findByRole("heading", { name: /^theme$/i }),
    ).toBeInTheDocument();
  });

  // behavior (no in-UI settings link on the home view)
  it("should not render an in-UI settings link on the home view", async () => {
    renderApp("/");
    await screen.findByRole("button", { name: /open workspace folder/i });
    expect(
      screen.queryByRole("link", { name: /^settings$/i }),
    ).not.toBeInTheDocument();
  });

  // behavior (unknown route -> 404)
  it("should render a not-found view for an unknown route", async () => {
    renderApp("/this-route-does-not-exist");
    expect(await screen.findByText(/404/i)).toBeInTheDocument();
    expect(screen.getByText(/does not exist/i)).toBeInTheDocument();
  });
});
