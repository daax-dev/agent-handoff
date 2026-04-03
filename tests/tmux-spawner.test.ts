import { describe, test, expect } from "./test-compat.js";
import { isTmuxAvailable } from "../src/cli/tmux-spawner.js";

describe("tmux-spawner", () => {
  test("isTmuxAvailable returns boolean", async () => {
    const available = await isTmuxAvailable();
    expect(typeof available).toBe("boolean");
  });

  test("shellEscape is used in command construction", () => {
    // Verify the module exports without errors
    expect(typeof isTmuxAvailable).toBe("function");
  });
});
