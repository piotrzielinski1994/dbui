import { describe, it, expect } from "vitest";

import { PALETTE_COMMANDS } from "@/components/workspace/command-registry";

describe("Find palette command", () => {
  const findCommand = () =>
    PALETTE_COMMANDS.find((def) => def.name === "Find");

  // behavior: a Find command is registered in the palette (AC-011, TC-009)
  it("should be registered", () => {
    expect(findCommand()).toBeDefined();
  });

  // behavior: it lives in the View group (AC-011, TC-009)
  it("should be in the View group", () => {
    expect(findCommand()?.group).toBe("View");
  });

  // behavior: its hint is derived from the open-find binding (AC-011, AC-003)
  it("should carry the open-find action id for its hint", () => {
    expect(findCommand()?.actionId).toBe("open-find");
  });
});
