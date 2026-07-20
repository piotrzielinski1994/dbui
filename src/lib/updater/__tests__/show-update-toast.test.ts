import { describe, it, expect, vi, beforeEach } from "vitest";
import { toast } from "sonner";

import { showUpdateToast } from "@/lib/updater/show-update-toast";
import type { UpdateInfo } from "@/lib/updater/update-controller";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

const mockToast = vi.mocked(toast);

function makeUpdate(overrides: Partial<UpdateInfo> = {}): UpdateInfo {
  return {
    version: "0.2.0",
    downloadAndInstall: vi.fn(async () => {}),
    relaunch: vi.fn(async () => {}),
    ...overrides,
  };
}

// The toast IS the observable output for this feature, so asserting on the
// mocked sonner `toast` calls is the side-effect contract, not implementation
// coupling.
type ToastOptions = {
  duration?: number;
  closeButton?: boolean;
  action?: { label: string; onClick: () => void };
};

function firstToastOptions(): ToastOptions {
  const call = mockToast.mock.calls[0];
  return (call?.[1] ?? {}) as ToastOptions;
}

describe("showUpdateToast", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // side-effect-contract (TC-001/AC-002): the toast message carries the version
  it("should show a toast whose message contains the update version", () => {
    showUpdateToast(makeUpdate({ version: "0.2.0" }));

    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(String(mockToast.mock.calls[0][0])).toContain("0.2.0");
  });

  // side-effect-contract (TC-005/AC-002): persistent toast - duration Infinity,
  // never the finite default
  it("should pass duration Infinity so the toast never auto-expires", () => {
    showUpdateToast(makeUpdate());

    expect(firstToastOptions().duration).toBe(Infinity);
  });

  // side-effect-contract (AC-002): the toast carries an "Update now" action
  it("should include an Update now action on the toast", () => {
    showUpdateToast(makeUpdate());

    expect(firstToastOptions().action?.label).toBe("Update now");
    expect(typeof firstToastOptions().action?.onClick).toBe("function");
  });

  // side-effect-contract (AC-002): the persistent toast carries a dismiss (×)
  // control so a user who does not want to update can still clear it
  it("should render a close button so the persistent toast is dismissible", () => {
    showUpdateToast(makeUpdate());

    expect(firstToastOptions().closeButton).toBe(true);
  });

  // side-effect-contract (AC-003): progress events re-render the SAME toast with
  // a Downloading… NN% label (updated by stable id, not a new toast)
  it("should update the same toast with a Downloading… percentage while installing", async () => {
    const downloadAndInstall = vi.fn(
      async (onProgress: (pct: number) => void) => {
        onProgress(42);
      },
    );

    showUpdateToast(makeUpdate({ downloadAndInstall }));
    await firstToastOptions().action?.onClick();
    await Promise.resolve();

    const messages = mockToast.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => /downloading… 42%/i.test(m))).toBe(true);
  });

  // side-effect-contract (TC-004/AC-003): clicking Update now downloads+installs
  // then relaunches, in that order
  it("should download-and-install then relaunch when Update now is clicked", async () => {
    const order: string[] = [];
    const downloadAndInstall = vi.fn(async () => {
      order.push("install");
    });
    const relaunch = vi.fn(async () => {
      order.push("relaunch");
    });

    showUpdateToast(makeUpdate({ downloadAndInstall, relaunch }));
    await firstToastOptions().action?.onClick();
    // flush any post-download microtasks before asserting relaunch
    await Promise.resolve();
    await Promise.resolve();

    expect(downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(relaunch).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["install", "relaunch"]);
  });

  // side-effect-contract (AC-003): the click passes a progress callback into
  // downloadAndInstall (so the label can show Downloading… NN%)
  it("should pass a progress callback into downloadAndInstall", async () => {
    const downloadAndInstall = vi.fn(
      async (onProgress: (pct: number) => void) => {
        void onProgress;
      },
    );

    showUpdateToast(makeUpdate({ downloadAndInstall }));
    await firstToastOptions().action?.onClick();

    expect(typeof downloadAndInstall.mock.calls[0][0]).toBe("function");
  });
});
