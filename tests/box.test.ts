import { describe, test, expect } from "vitest";
import { boxTop, boxBottom, boxRow, labelDivider } from "../src/box";

describe("boxTop", () => {
  test("centers title between dashes", () => {
    expect(boxTop(" ◈ pi-jump ", 20)).toBe("╭───  ◈ pi-jump  ────╮");
  });
  test("width is exact", () => {
    expect(boxTop("x", 40)).toHaveLength(42); // innerW + 2 borders
  });
  test("truncates oversized title to keep exact width", () => {
    const result = boxTop("a very long title here", 10);
    expect(result).toHaveLength(12); // innerW + 2 borders
    expect(result.startsWith("╭")).toBe(true);
    expect(result.endsWith("╮")).toBe(true);
  });
  test("truncates even with tiny inner width", () => {
    expect(boxTop("x", 2)).toHaveLength(4); // innerW + 2 borders
  });
});

describe("boxBottom", () => {
  test("renders bottom border", () => {
    expect(boxBottom(20)).toBe("╰────────────────────╯");
  });
});

describe("boxRow", () => {
  test("pads content to inner width", () => {
    expect(boxRow("abc", 6)).toBe("│abc   │");
  });
  test("does not truncate (caller truncates)", () => {
    expect(boxRow("abcdefghij", 6)).toBe("│abcdefghij│");
  });
});

describe("labelDivider", () => {
  test("centers label in ┄ dashes", () => {
    const out = labelDivider("preview: a (w:1)", 30);
    expect(out).toContain("preview: a (w:1)");
    expect(out).toHaveLength(30);
    expect(/^┄+.*┄+$/.test(out)).toBe(true);
  });
});
