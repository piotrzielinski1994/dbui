import { beforeEach, describe, expect, it, vi } from "vitest";

import { logMessage } from "@/lib/logging/file-log";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

describe("logMessage", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  // AC-005, TC-004 - side-effect-contract: routes a level + message to the
  // `log_message` Tauri command with the exact camel-keyed payload.
  it("should invoke the log_message command with the level and message", async () => {
    mockedInvoke.mockResolvedValue(undefined);

    await logMessage("warn", "x");

    expect(mockedInvoke).toHaveBeenCalledWith("log_message", {
      level: "warn",
      message: "x",
    });
  });

  // AC-005, TC-005 - behavior/edge: best-effort - outside a Tauri host `invoke`
  // rejects; the helper swallows it and resolves void rather than throwing.
  it("should resolve and not throw if invoke rejects", async () => {
    mockedInvoke.mockRejectedValue(new Error("not a tauri host"));

    await expect(logMessage("error", "boom")).resolves.toBeUndefined();
  });
});
