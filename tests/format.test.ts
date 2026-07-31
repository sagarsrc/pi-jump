import { describe, test, expect } from "vitest";
import { relativeTime, formatOptions } from "../src/format";
import type { DiscoveredEntry } from "../src/discover";

const NOW = new Date("2026-07-31T12:00:00.000Z");

const entry = (over: Partial<DiscoveredEntry> = {}): DiscoveredEntry => ({
  piSessionId: "s1",
  cwd: "/work/a",
  tmuxSession: "work",
  tmuxWindow: "2",
  tmuxPaneId: "%2",
  pid: 1,
  lastSeen: "2026-07-31T11:58:00.000Z",
  source: "registry",
  ...over,
});

describe("relativeTime", () => {
  test.each([
    ["2026-07-31T11:59:40.000Z", "20s ago"],
    ["2026-07-31T11:58:00.000Z", "2m ago"],
    ["2026-07-31T09:00:00.000Z", "3h ago"],
    ["2026-07-29T12:00:00.000Z", "2d ago"],
  ])("%s → %s", (iso, expected) => {
    expect(relativeTime(iso, NOW)).toBe(expected);
  });
  test("clamps future times to 0s ago", () => {
    expect(relativeTime("2026-07-31T13:00:00.000Z", NOW)).toBe("0s ago");
  });
});

describe("formatOptions", () => {
  test("empty list returns empty array", () => {
    expect(formatOptions([], NOW)).toEqual([]);
  });
  test("columns separated by │ with dot marker", () => {
    const [line] = formatOptions([entry({ name: "api work" })], NOW);
    expect(line).toBe("● api work │ work:2 │ 2m ago");
  });
  test("names padded to longest name, targets and ages right-aligned", () => {
    const lines = formatOptions(
      [
        entry({ name: "short", tmuxSession: "w", tmuxWindow: "9", lastSeen: "2026-07-31T11:59:40.000Z" }),
        entry({ piSessionId: "s2", tmuxPaneId: "%3", name: "much longer name", lastSeen: "2026-07-29T12:00:00.000Z" }),
      ],
      NOW
    );
    expect(lines[0]).toBe("● short            │    w:9 │ 20s ago");
    expect(lines[1]).toBe("● much longer name │ work:2 │  2d ago");
  });
  test("scan entry uses hollow dot and cwd basename", () => {
    const [line] = formatOptions([entry({ source: "scan", name: undefined })], NOW);
    expect(line.startsWith("○ a ")).toBe(true);
  });
  test("names longer than 32 chars truncated with …", () => {
    const [line] = formatOptions([entry({ name: "x".repeat(40) })], NOW);
    expect(line.startsWith("● " + "x".repeat(31) + "… ")).toBe(true);
  });
});

describe("formatOptions currentPaneId", () => {
  test("entry matching currentPaneId gets [current] suffix", () => {
    const [line] = formatOptions([entry({ name: "here" })], NOW, "%2");
    expect(line).toBe("● here │ work:2 │ 2m ago [current]");
  });
  test("non-matching entries get no suffix", () => {
    const [line] = formatOptions([entry({ name: "there" })], NOW, "%99");
    expect(line).toBe("● there │ work:2 │ 2m ago");
  });
  test("omitted currentPaneId marks nothing", () => {
    const [line] = formatOptions([entry({ name: "plain" })], NOW);
    expect(line.endsWith("[current]")).toBe(false);
  });
  test("marker does not shift column alignment of other rows", () => {
    const lines = formatOptions(
      [
        entry({ name: "cur" }),
        entry({ piSessionId: "s2", tmuxPaneId: "%3", name: "other" }),
      ],
      NOW,
      "%2"
    );
    // both lines share identical text up to end of age column
    const ageColEnd = (l: string) => l.indexOf("2m ago") + "2m ago".length;
    expect(lines[0].slice(0, ageColEnd(lines[0]))).toBe("● cur   │ work:2 │ 2m ago");
    expect(lines[1].slice(0, ageColEnd(lines[1]))).toBe("● other │ work:2 │ 2m ago");
    expect(lines[0].endsWith(" [current]")).toBe(true);
  });
});
