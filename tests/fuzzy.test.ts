import { describe, test, expect } from "vitest";
import { fuzzyScore, fuzzyFilter } from "../src/fuzzy";

describe("fuzzyScore", () => {
  test("empty query matches everything with score 0", () => {
    expect(fuzzyScore("", "anything")).toBe(0);
  });
  test("returns null when query is not a subsequence", () => {
    expect(fuzzyScore("xyz", "abc")).toBeNull();
  });
  test("subsequence match is case-insensitive", () => {
    expect(fuzzyScore("API", "api-refactor")).not.toBeNull();
  });
  test("contiguous match beats scattered match", () => {
    const contiguous = fuzzyScore("api", "api-refactor")!;
    const scattered = fuzzyScore("api", "a-p-i-refactor")!;
    expect(contiguous).toBeGreaterThan(scattered);
  });
  test("match at start beats match later", () => {
    const atStart = fuzzyScore("api", "api-refactor")!;
    const later = fuzzyScore("api", "refactor-api")!;
    expect(atStart).toBeGreaterThan(later);
  });
});

describe("fuzzyFilter", () => {
  const items = ["api-refactor", "cryptobot", "chip8-emulator"];
  const key = (s: string) => s;
  test("empty query returns all in original order", () => {
    expect(fuzzyFilter("", items, key)).toEqual(items);
  });
  test("filters non-matches and ranks best first", () => {
    expect(fuzzyFilter("api", items, key)).toEqual(["api-refactor"]);
  });
  test("ranks contiguous above scattered", () => {
    const result = fuzzyFilter("ci", ["ci-cd", "c-x-i-x"], key);
    expect(result[0]).toBe("ci-cd");
  });
  test("does not mutate input", () => {
    const input = [...items];
    fuzzyFilter("api", input, key);
    expect(input).toEqual(items);
  });
});
