import { describe, test, expect } from "vitest";
import { mergeEntries, sortByLastSeen, scanPaneToEntry, dedupeByPane } from "../src/discover";
import type { JumpEntry } from "../src/registry";
import type { PaneInfo } from "../src/tmux";

const entry = (over: Partial<JumpEntry> = {}): JumpEntry => ({
  piSessionId: "s1",
  cwd: "/work/a",
  tmuxSession: "work",
  tmuxWindow: "1",
  tmuxPaneId: "%1",
  pid: 100,
  lastSeen: "2026-07-31T10:00:00.000Z",
  ...over,
});

describe("mergeEntries", () => {
  test("registry entries win over scan entries on same pane", () => {
    const reg = entry({ tmuxPaneId: "%1" });
    const scan = entry({ piSessionId: "scan:%1", tmuxPaneId: "%1" });
    const merged = mergeEntries([reg], [scan]);
    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe("registry");
  });
  test("scan entries on other panes are included with source scan", () => {
    const merged = mergeEntries([entry({ tmuxPaneId: "%1" })], [entry({ piSessionId: "scan:%2", tmuxPaneId: "%2" })]);
    expect(merged).toHaveLength(2);
    expect(merged.find(e => e.tmuxPaneId === "%2")?.source).toBe("scan");
  });
});

describe("sortByLastSeen", () => {
  test("sorts newest first, does not mutate", () => {
    const a = entry({ piSessionId: "a", lastSeen: "2026-07-31T10:00:00.000Z" });
    const b = entry({ piSessionId: "b", lastSeen: "2026-07-31T12:00:00.000Z" });
    const input = [a, b];
    expect(sortByLastSeen(input).map(e => e.piSessionId)).toEqual(["b", "a"]);
    expect(input[0].piSessionId).toBe("a");
  });
});

describe("scanPaneToEntry", () => {
  test("builds entry from pane info with scan: id and activity-derived lastSeen", () => {
    const pane: PaneInfo = { tmuxSession: "work", tmuxWindow: "3", tmuxPaneId: "%7", pid: 50, activity: 1785517928 };
    const e = scanPaneToEntry(pane, 41049, "/Users/sagar/dotfiles");
    expect(e).toEqual({
      piSessionId: "scan:%7",
      cwd: "/Users/sagar/dotfiles",
      tmuxSession: "work",
      tmuxWindow: "3",
      tmuxPaneId: "%7",
      pid: 41049,
      lastSeen: new Date(1785517928 * 1000).toISOString(),
    });
  });
});

describe("dedupeByPane", () => {
  test("same pane keeps latest lastSeen", () => {
    const old = entry({ piSessionId: "old", lastSeen: "2026-07-31T10:00:00.000Z" });
    const fresh = entry({ piSessionId: "fresh", lastSeen: "2026-07-31T11:00:00.000Z" });
    expect(dedupeByPane([old, fresh]).map(e => e.piSessionId)).toEqual(["fresh"]);
    expect(dedupeByPane([fresh, old]).map(e => e.piSessionId)).toEqual(["fresh"]);
  });
  test("different panes all kept", () => {
    const a = entry({ piSessionId: "a", tmuxPaneId: "%1" });
    const b = entry({ piSessionId: "b", tmuxPaneId: "%2" });
    expect(dedupeByPane([a, b])).toHaveLength(2);
  });
  test("does not mutate input", () => {
    const input = [entry(), entry({ piSessionId: "s2", tmuxPaneId: "%2" })];
    dedupeByPane(input);
    expect(input).toHaveLength(2);
  });
});
