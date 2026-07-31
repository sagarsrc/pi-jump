import { describe, test, expect } from "vitest";
import { cleanPreview, PREVIEW_LINES } from "../src/preview";

describe("cleanPreview", () => {
  test("drops trailing blank lines", () => {
    expect(cleanPreview("a\nb\n\n\n")).toEqual(["a", "b"]);
  });
  test("keeps last maxLines lines", () => {
    const raw = Array.from({ length: 30 }, (_, i) => `line${i}`).join("\n");
    const out = cleanPreview(raw, 10);
    expect(out).toHaveLength(10);
    expect(out[9]).toBe("line29");
  });
  test("strips carriage returns", () => {
    expect(cleanPreview("a\r\nb\r\n")).toEqual(["a", "b"]);
  });
  test("empty input returns empty array", () => {
    expect(cleanPreview("")).toEqual([]);
    expect(cleanPreview("\n\n")).toEqual([]);
  });
  test("default maxLines is PREVIEW_LINES (20)", () => {
    expect(PREVIEW_LINES).toBe(20);
    const raw = Array.from({ length: 25 }, (_, i) => `l${i}`).join("\n");
    expect(cleanPreview(raw)).toHaveLength(20);
  });
});
