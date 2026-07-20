import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

import { UpdatesSection } from "@/components/settings/updates-section";
import { UpdaterProvider } from "@/lib/updater/updater-context";
import type {
  UpdateController,
  UpdateInfo,
} from "@/lib/updater/update-controller";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

const mockToast = vi.mocked(toast);

function makeUpdate(version = "0.2.0"): UpdateInfo {
  return {
    version,
    downloadAndInstall: vi.fn(async () => {}),
    relaunch: vi.fn(async () => {}),
  };
}

function renderSection(opts: {
  check: () => Promise<UpdateInfo | null>;
  version?: string;
}): { controller: UpdateController & { check: ReturnType<typeof vi.fn> } } {
  const controller = { check: vi.fn(opts.check) };
  render(
    <UpdaterProvider
      controller={controller}
      getVersion={async () => opts.version ?? "1.2.3"}
    >
      <UpdatesSection />
    </UpdaterProvider>,
  );
  return { controller };
}

describe("UpdatesSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // behavior (TC-011): the current version from the injected source is shown
  it("should render the current app version from the version source", async () => {
    renderSection({ check: async () => null, version: "1.4.2" });

    await waitFor(() => {
      expect(screen.getByText(/1\.4\.2/)).toBeInTheDocument();
    });
  });

  // side-effect-contract (TC-007): a manual check with no update shows the
  // up-to-date toast and returns the button to idle
  it("should show a latest-version toast if the manual check finds no update", async () => {
    const user = userEvent.setup();
    const { controller } = renderSection({ check: async () => null });

    const button = await screen.findByRole("button", {
      name: /check for updates/i,
    });
    await user.click(button);

    await waitFor(() => {
      expect(controller.check).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(
        mockToast.mock.calls.some((c) =>
          /latest version/i.test(String(c[0])),
        ),
      ).toBe(true);
    });
    await waitFor(() => {
      expect(button).not.toBeDisabled();
    });
  });

  // side-effect-contract (TC-008): a manual check that finds an update shows the
  // update toast (message carries the version)
  it("should show the update toast if the manual check finds an available update", async () => {
    const user = userEvent.setup();
    renderSection({ check: async () => makeUpdate("0.2.0") });

    const button = await screen.findByRole("button", {
      name: /check for updates/i,
    });
    await user.click(button);

    await waitFor(() => {
      expect(
        mockToast.mock.calls.some((c) => /0\.2\.0/.test(String(c[0]))),
      ).toBe(true);
    });
  });

  // side-effect-contract (TC-009): a rejected manual check shows the failure
  // toast and returns the button to idle (not stuck disabled)
  it("should show a check-failed toast and re-enable the button if the check rejects", async () => {
    const user = userEvent.setup();
    renderSection({
      check: async () => {
        throw new Error("offline");
      },
    });

    const button = await screen.findByRole("button", {
      name: /check for updates/i,
    });
    await user.click(button);

    await waitFor(() => {
      expect(
        (mockToast.error as unknown as ReturnType<typeof vi.fn>).mock.calls
          .length +
          mockToast.mock.calls.length,
      ).toBeGreaterThan(0);
    });
    const failed = [
      ...mockToast.mock.calls.map((c) => String(c[0])),
      ...(
        mockToast.error as unknown as ReturnType<typeof vi.fn>
      ).mock.calls.map((c) => String(c[0])),
    ].some((m) => /update check failed/i.test(m));
    expect(failed).toBe(true);
    await waitFor(() => {
      expect(button).not.toBeDisabled();
    });
  });

  // behavior (TC-010): while a check is in flight the button is disabled and a
  // second click does not start a second check
  it("should disable the button in flight and ignore a second click", async () => {
    const user = userEvent.setup();
    let resolveCheck: (value: UpdateInfo | null) => void = () => {};
    const pending = new Promise<UpdateInfo | null>((resolve) => {
      resolveCheck = resolve;
    });
    const { controller } = renderSection({ check: () => pending });

    const button = await screen.findByRole("button", {
      name: /check for updates/i,
    });
    await user.click(button);

    await waitFor(() => {
      expect(button).toBeDisabled();
    });
    // a second click while in flight must not fire another check
    await user.click(button).catch(() => {});
    expect(controller.check).toHaveBeenCalledTimes(1);

    resolveCheck(null);
    await waitFor(() => {
      expect(button).not.toBeDisabled();
    });
  });

  // behavior (TC-005/TC-010 UI state): the in-flight label reads Checking…
  it("should show a Checking… label while a check is in flight", async () => {
    const user = userEvent.setup();
    const pending = new Promise<UpdateInfo | null>(() => {});
    renderSection({ check: () => pending });

    const button = await screen.findByRole("button", {
      name: /check for updates/i,
    });
    await user.click(button);

    await waitFor(() => {
      expect(screen.getByText(/checking…/i)).toBeInTheDocument();
    });
  });
});
