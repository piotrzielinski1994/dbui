import { describe, it, expect } from "vitest";

import { DEFAULT_SETTINGS, mergeSettings } from "@/lib/settings/settings";

describe("mergeSettings workspacePath", () => {
  // TC-011 - behavior: DEFAULT has no workspacePath
  it("should default workspacePath to undefined", () => {
    expect(DEFAULT_SETTINGS.workspacePath).toBeUndefined();
  });

  // TC-011 - behavior: a string workspacePath is kept
  it("should keep a string workspacePath", () => {
    expect(
      mergeSettings(DEFAULT_SETTINGS, { workspacePath: "/ws/demo" })
        .workspacePath,
    ).toBe("/ws/demo");
  });

  // TC-011 - behavior: a non-string workspacePath is dropped
  it("should drop a non-string workspacePath", () => {
    expect(
      mergeSettings(DEFAULT_SETTINGS, { workspacePath: 42 }).workspacePath,
    ).toBeUndefined();
    expect(
      mergeSettings(DEFAULT_SETTINGS, { workspacePath: null }).workspacePath,
    ).toBeUndefined();
    expect(
      mergeSettings(DEFAULT_SETTINGS, { workspacePath: { path: "x" } })
        .workspacePath,
    ).toBeUndefined();
  });

  // TC-011 - behavior: an absent workspacePath stays undefined
  it("should leave workspacePath undefined if the partial omits it", () => {
    expect(
      mergeSettings(DEFAULT_SETTINGS, { sidebarHidden: true }).workspacePath,
    ).toBeUndefined();
  });
});
