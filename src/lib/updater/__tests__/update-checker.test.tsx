import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { toast } from "sonner";

import { UpdateChecker } from "@/lib/updater/update-checker";
import type {
  UpdateController,
  UpdateInfo,
} from "@/lib/updater/update-controller";

// sonner is the external boundary the show-update-toast path hits; asserting on
// it is the observable contract for "a toast appeared". The controller is the
// injected port (a fake), NOT mocked as it is the seam under test.
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

function controllerOf(
  check: () => Promise<UpdateInfo | null>,
): UpdateController & { check: ReturnType<typeof vi.fn> } {
  return { check: vi.fn(check) };
}

describe("UpdateChecker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // side-effect-contract (TC-001): an available update shows a toast on mount
  it("should show a toast if the startup check reports an available update", async () => {
    const controller = controllerOf(async () => makeUpdate("0.2.0"));

    render(<UpdateChecker controller={controller} />);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledTimes(1);
    });
    expect(String(mockToast.mock.calls[0][0])).toContain("0.2.0");
  });

  // behavior (TC-002): no update -> no toast
  it("should not show a toast if the startup check reports no update", async () => {
    const controller = controllerOf(async () => null);

    render(<UpdateChecker controller={controller} />);

    await waitFor(() => {
      expect(controller.check).toHaveBeenCalledTimes(1);
    });
    await Promise.resolve();
    expect(mockToast).not.toHaveBeenCalled();
  });

  // behavior (TC-003): a rejected check is swallowed - no throw, no toast
  it("should swallow a rejected check without showing a toast", async () => {
    const controller = controllerOf(async () => {
      throw new Error("offline");
    });

    expect(() =>
      render(<UpdateChecker controller={controller} />),
    ).not.toThrow();

    await waitFor(() => {
      expect(controller.check).toHaveBeenCalledTimes(1);
    });
    await Promise.resolve();
    expect(mockToast).not.toHaveBeenCalled();
  });

  // behavior (TC-006): the mount effect runs check exactly once even across a
  // re-render (ref guard)
  it("should run the check only once across a re-render", async () => {
    const controller = controllerOf(async () => null);

    const { rerender } = render(<UpdateChecker controller={controller} />);
    await waitFor(() => {
      expect(controller.check).toHaveBeenCalledTimes(1);
    });

    rerender(<UpdateChecker controller={controller} />);
    await Promise.resolve();

    expect(controller.check).toHaveBeenCalledTimes(1);
  });

  // behavior: the bridge renders nothing (headless)
  it("should render null", () => {
    const controller = controllerOf(async () => null);

    const { container } = render(<UpdateChecker controller={controller} />);

    expect(container).toBeEmptyDOMElement();
  });
});
