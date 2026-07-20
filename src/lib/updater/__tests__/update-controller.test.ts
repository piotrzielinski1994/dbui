import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createUpdateController,
  createNoopUpdateController,
} from "@/lib/updater/update-controller";
import type {
  UpdateControllerDeps,
  UpdateInfo,
} from "@/lib/updater/update-controller";

// The controller wraps the Tauri updater/process plugins behind an injectable
// `deps` seam. Every test drives it with a fake `deps` (a scripted PluginUpdate)
// so no real Tauri API is touched - the same port pattern as WindowController.

function scriptedDeps(): {
  deps: UpdateControllerDeps;
  downloadAndInstall: ReturnType<typeof vi.fn>;
  relaunch: ReturnType<typeof vi.fn>;
} {
  // A 100-byte artifact downloaded in two 50-byte chunks: Started resets, each
  // Progress accumulates chunkLength/contentLength, Finished lands on 100%.
  type DownloadEvent =
    | { event: "Started"; data: { contentLength?: number } }
    | { event: "Progress"; data: { chunkLength: number } }
    | { event: "Finished" };
  const downloadAndInstall = vi.fn(
    async (onEvent: (e: DownloadEvent) => void): Promise<void> => {
      onEvent({ event: "Started", data: { contentLength: 100 } });
      onEvent({ event: "Progress", data: { chunkLength: 50 } });
      onEvent({ event: "Progress", data: { chunkLength: 50 } });
      onEvent({ event: "Finished" });
    },
  );
  const relaunch = vi.fn(async (): Promise<void> => {});
  const deps: UpdateControllerDeps = {
    check: vi.fn(async () => ({ version: "0.2.0", downloadAndInstall })),
    relaunch,
  };
  return { deps, downloadAndInstall, relaunch };
}

describe("createUpdateController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // behavior: a null plugin check surfaces as a null UpdateInfo
  it("should resolve to null if the plugin reports no update", async () => {
    const deps: UpdateControllerDeps = {
      check: vi.fn(async () => null),
      relaunch: vi.fn(async () => {}),
    };

    const controller = createUpdateController(deps);

    expect(await controller.check()).toBeNull();
  });

  // behavior: an available plugin update surfaces its version on the UpdateInfo
  it("should surface the plugin update version if an update is available", async () => {
    const { deps } = scriptedDeps();

    const info = (await createUpdateController(deps).check()) as UpdateInfo;

    expect(info).not.toBeNull();
    expect(info.version).toBe("0.2.0");
  });

  // side-effect-contract (TC-004): downloadAndInstall maps the Started/Progress/
  // Finished plugin event stream to percentage values passed to onProgress
  it("should map download events to progress percentages passed to onProgress", async () => {
    const { deps, downloadAndInstall } = scriptedDeps();
    const info = (await createUpdateController(deps).check()) as UpdateInfo;

    const progress: number[] = [];
    await info.downloadAndInstall((pct) => progress.push(pct));

    expect(downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(typeof downloadAndInstall.mock.calls[0][0]).toBe("function");
    expect(progress).toContain(50);
    expect(progress).toContain(100);
    expect(progress[progress.length - 1]).toBe(100);
  });

  // side-effect-contract: relaunch on the UpdateInfo is wired to the deps.relaunch
  it("should relaunch via the injected relaunch dependency", async () => {
    const { deps, relaunch } = scriptedDeps();
    const info = (await createUpdateController(deps).check()) as UpdateInfo;

    await info.relaunch();

    expect(relaunch).toHaveBeenCalledTimes(1);
  });
});

describe("createNoopUpdateController", () => {
  // behavior (TC-012): the browser/test controller resolves null without any
  // Tauri interaction
  it("should resolve check to null in a non-Tauri environment", async () => {
    const controller = createNoopUpdateController();

    await expect(controller.check()).resolves.toBeNull();
  });
});
