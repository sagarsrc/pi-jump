import { describe, test, expect } from "vitest";
import { relativeTime, formatOption } from "../src/format";
import type { DiscoveredEntry } from "../src/discover";

const NOW = new Date("2026-07-31T12:00:00.000Z");

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

describe("formatOption", () => {
  const base: DiscoveredEntry = {
    piSessionId: "s1",
    cwd: "/work/a",
    tmuxSession: "work",
    tmuxWindow: "2",
    tmuxPaneId: "%2",
    pid: 1,
    lastSeen: "2026-07-31T11:58:00.000Z",
    source: "registry",
  };
  test("registry entry shows filled dot and name", () => {
    expect(formatOption({ ...base, name: "api work" }, NOW)).toBe("● api work  tmux:work:2  2m ago");
  });
  test("scan entry shows hollow dot and project dir basename", () => {
    expect(formatOption({ ...base, source: "scan" }, NOW)).toBe("○ a  tmux:work:2  2m ago");
  });
  test("registry entry without name falls back to cwd basename", () => {
    expect(formatOption(base, NOW)).toBe("● a  tmux:work:2  2m ago");
  });
});
