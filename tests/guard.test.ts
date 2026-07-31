import { describe, test, expect } from "vitest";
import { shouldSelfRegister } from "../src/guard";

describe("shouldSelfRegister", () => {
  test("interactive pi inside tmux registers", () => {
    expect(shouldSelfRegister(true, "tmux-env-value")).toBe(true);
  });
  test("headless pi (no tty) does not register", () => {
    expect(shouldSelfRegister(false, "tmux-env-value")).toBe(false);
  });
  test("interactive pi outside tmux does not register", () => {
    expect(shouldSelfRegister(true, undefined)).toBe(false);
  });
});
