import { describe, it, expect } from "vitest";

import { PALETTE_COMMANDS } from "@/components/workspace/command-registry";

describe("Open workspace palette command", () => {
  const command = () =>
    PALETTE_COMMANDS.find((def) => def.id === "open-workspace");

  // AC-002, TC-013 - behavior: the command is registered
  it("should be registered", () => {
    expect(command()).toBeDefined();
  });

  // AC-002, TC-013 - behavior: it lives in the View group
  it("should be in the View group", () => {
    expect(command()?.group).toBe("View");
  });

  // AC-002 - behavior: its hint derives from the open-workspace binding
  it("should carry the open-workspace action id for its hint", () => {
    expect(command()?.actionId).toBe("open-workspace");
  });

  // AC-001 - behavior: it is always available (needs no active table/tab)
  it("should always be visible", () => {
    expect(
      command()?.when({
        openTabCount: 0,
        isSplitView: false,
        isTableActive: false,
      }),
    ).toBe(true);
  });
});
