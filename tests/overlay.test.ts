import { describe, test, expect, vi } from "vitest";
import { JumpOverlay } from "../src/overlay";
import type { DiscoveredEntry } from "../src/discover";

// Minimal mock for the peer/bundled pi-tui package so unit tests resolve.
// In the real TUI, handleInput receives raw terminal byte sequences; this test
// harness sends the canonical key-name strings that matchesKey() would parse.
vi.mock("@earendil-works/pi-tui", () => {
  function parseKeyId(keyId: string) {
    const parts = keyId.toLowerCase().split("+");
    return {
      key: parts[parts.length - 1] ?? "",
      ctrl: parts.includes("ctrl"),
      shift: parts.includes("shift"),
      alt: parts.includes("alt"),
      super: parts.includes("super"),
    };
  }

  return {
    matchesKey(data: string, keyId: string) {
      const parsed = parseKeyId(keyId);
      const dataParts = data.toLowerCase().split("+");
      const dataKey = dataParts[dataParts.length - 1] ?? "";
      return (
        dataKey === parsed.key &&
        dataParts.includes("ctrl") === parsed.ctrl &&
        dataParts.includes("shift") === parsed.shift &&
        dataParts.includes("alt") === parsed.alt &&
        dataParts.includes("super") === parsed.super
      );
    },
    Key: {
      enter: "enter",
      escape: "escape",
      up: "up",
      down: "down",
      backspace: "backspace",
      ctrl: (k: string) => `ctrl+${k}`,
    },
    truncateToWidth(s: string, width: number, ellipsis = "…") {
      if (s.length <= width) return s;
      const take = Math.max(0, width - ellipsis.length);
      return s.slice(0, take) + ellipsis;
    },
    visibleWidth(s: string) {
      return s.length;
    },
  };
});

const NOW_ISO = "2026-07-31T11:58:00.000Z";
const entry = (over: Partial<DiscoveredEntry> = {}): DiscoveredEntry => ({
  piSessionId: "s1",
  name: "api-refactor",
  cwd: "/work/api",
  tmuxSession: "work",
  tmuxWindow: "3",
  tmuxPaneId: "%3",
  pid: 1,
  lastSeen: NOW_ISO,
  source: "registry",
  ...over,
});

function makeOverlay(entries: DiscoveredEntry[], previewText = "$ npm run dev") {
  const onDone = vi.fn();
  const overlay = new JumpOverlay({
    entries,
    currentPaneId: "%3",
    fetchPreview: async () => previewText,
    onDone,
    requestRender: () => {},
    previewDelayMs: 0,
  });
  return { overlay, onDone };
}

const WIDTH = 80;

describe("JumpOverlay", () => {
  test("initial render shows title, query line, all entries, footer", async () => {
    const { overlay } = makeOverlay([entry(), entry({ piSessionId: "s2", tmuxPaneId: "%7", name: "cryptobot", tmuxSession: "fun", tmuxWindow: "1" })]);
    await overlay.waitForPreview();
    const lines = overlay.render(WIDTH);
    const joined = lines.join("\n");
    expect(joined).toContain("Jump to pi session");
    expect(joined).toContain("api-refactor");
    expect(joined).toContain("cryptobot");
    expect(joined).toContain("[current]");
    expect(joined).toContain("2/2");
    expect(lines.every((l) => l.length <= WIDTH)).toBe(true);
  });

  test("typing filters the list", async () => {
    const { overlay } = makeOverlay([entry(), entry({ piSessionId: "s2", tmuxPaneId: "%7", name: "cryptobot", tmuxSession: "fun", tmuxWindow: "1" })]);
    await overlay.waitForPreview();
    for (const ch of "crypt") overlay.handleInput(ch);
    const joined = overlay.render(WIDTH).join("\n");
    expect(joined).toContain("cryptobot");
    expect(joined).not.toContain("api-refactor");
    expect(joined).toContain("> crypt");
    expect(joined).toContain("1/2");
  });

  test("backspace restores filtered entries", async () => {
    const { overlay } = makeOverlay([entry(), entry({ piSessionId: "s2", tmuxPaneId: "%7", name: "cryptobot", tmuxSession: "fun", tmuxWindow: "1" })]);
    await overlay.waitForPreview();
    for (const ch of "zzz") overlay.handleInput(ch);
    expect(overlay.render(WIDTH).join("\n")).toContain("0/2");
    for (let i = 0; i < 3; i++) overlay.handleInput("backspace");
    expect(overlay.render(WIDTH).join("\n")).toContain("2/2");
  });

  test("fuzzy also matches tmux session name", async () => {
    const { overlay } = makeOverlay([entry(), entry({ piSessionId: "s2", tmuxPaneId: "%7", name: "cryptobot", tmuxSession: "fun", tmuxWindow: "1" })]);
    await overlay.waitForPreview();
    for (const ch of "fun") overlay.handleInput(ch);
    const joined = overlay.render(WIDTH).join("\n");
    expect(joined).toContain("cryptobot");
    expect(joined).not.toContain("api-refactor");
  });

  test("enter on first entry calls onDone with it", async () => {
    const e1 = entry();
    const { overlay, onDone } = makeOverlay([e1]);
    await overlay.waitForPreview();
    overlay.handleInput("enter");
    expect(onDone).toHaveBeenCalledWith(e1);
  });

  test("down then enter selects the second entry", async () => {
    const e2 = entry({ piSessionId: "s2", tmuxPaneId: "%7", name: "cryptobot", tmuxSession: "fun", tmuxWindow: "1" });
    const { overlay, onDone } = makeOverlay([entry(), e2]);
    await overlay.waitForPreview();
    overlay.handleInput("down");
    await overlay.waitForPreview();
    overlay.handleInput("enter");
    expect(onDone).toHaveBeenCalledWith(e2);
  });

  test("escape calls onDone with null", async () => {
    const { overlay, onDone } = makeOverlay([entry()]);
    await overlay.waitForPreview();
    overlay.handleInput("escape");
    expect(onDone).toHaveBeenCalledWith(null);
  });

  test("enter with empty filtered list does nothing", async () => {
    const { overlay, onDone } = makeOverlay([entry()]);
    await overlay.waitForPreview();
    for (const ch of "zzz") overlay.handleInput(ch);
    overlay.handleInput("enter");
    expect(onDone).not.toHaveBeenCalled();
  });

  test("enter on empty filtered list does not lock overlay", async () => {
    const { overlay, onDone } = makeOverlay([
      entry(),
      entry({ piSessionId: "s2", tmuxPaneId: "%7", name: "cryptobot", tmuxSession: "fun", tmuxWindow: "1" }),
    ]);
    await overlay.waitForPreview();
    for (const ch of "zzz") overlay.handleInput(ch);
    overlay.handleInput("enter");
    expect(onDone).not.toHaveBeenCalled();
    for (let i = 0; i < 3; i++) overlay.handleInput("backspace");
    expect(overlay.render(WIDTH).join("\n")).toContain("2/2");
  });

  test("preview text appears after waitForPreview", async () => {
    const { overlay } = makeOverlay([entry()], "UNIQUE_PREVIEW_TEXT");
    await overlay.waitForPreview();
    expect(overlay.render(WIDTH).join("\n")).toContain("UNIQUE_PREVIEW_TEXT");
  });

  test("tmux target is never truncated in list rows", async () => {
    const longSession = entry({ tmuxSession: "very-long-session-name-here", tmuxWindow: "12" });
    const { overlay } = makeOverlay([longSession]);
    await overlay.waitForPreview();
    expect(overlay.render(50).join("\n")).toContain("very-long-session-name-here:12");
  });

  test("stale empty-selection preview callback cannot wipe a newer preview", async () => {
    const { overlay } = makeOverlay([entry()], "STALE_GUARD");
    await overlay.waitForPreview();
    expect(overlay.render(WIDTH).join("\n")).toContain("STALE_GUARD");

    // Force an old empty-list callback to fire after a newer non-empty preview is in place.
    const o = overlay as unknown as Record<string, any>;
    o.query = "zzz";
    o.schedulePreview();
    // Let the empty-list timer fire (it is now stale because the next schedule replaces it).
    await new Promise((r) => setTimeout(r, 30));
    o.query = "";
    o.schedulePreview();
    await (overlay as any).waitForPreview();

    expect(overlay.render(WIDTH).join("\n")).toContain("STALE_GUARD");
  });

  test("render scrolls to show at most MAX_LIST_ROWS and keeps selection visible", async () => {
    const entries = Array.from({ length: 15 }, (_, i) =>
      entry({
        piSessionId: `s${i + 1}`,
        tmuxPaneId: `%${i + 1}`,
        name: `proj-${i + 1}`,
        tmuxSession: `sess-${i + 1}`,
      })
    );
    const { overlay } = makeOverlay(entries);
    await overlay.waitForPreview();

    // Move selection to index 12.
    for (let i = 0; i < 12; i++) overlay.handleInput("down");
    await overlay.waitForPreview();

    const lines = overlay.render(WIDTH);
    const firstDivider = lines.findIndex((l) => /^─+$/.test(l));
    const secondDivider = lines.findIndex((l, i) => /^─+$/.test(l) && i > firstDivider);
    const listRows = lines.slice(firstDivider + 1, secondDivider);

    expect(listRows.length).toBeLessThanOrEqual(10);
    expect(listRows.some((l) => l.startsWith("→ "))).toBe(true);
    expect(lines.join("\n")).toContain("proj-13");
  });

  test("width 40 keeps full tmux target when name is long", async () => {
    const longName = "a-really-long-pi-session-name-name-name";
    const session = "very-long-session-name-here";
    const target = `${session}:12`;
    const { overlay } = makeOverlay([
      entry({ name: longName, tmuxSession: session, tmuxWindow: "12" }),
    ]);
    await overlay.waitForPreview();
    const lines = overlay.render(40);
    const row = lines.find((l) => l.includes(target));
    expect(row).toBeDefined();
    expect(lines.every((l) => l.length <= 40)).toBe(true);
  });

  test("width 30 truncates name but never the target", async () => {
    const longName = "a-really-long-pi-session-name-name-name";
    const { overlay } = makeOverlay([entry({ name: longName, tmuxSession: "s", tmuxWindow: "1" })]);
    await overlay.waitForPreview();
    const lines = overlay.render(30);
    const row = lines.find((l) => l.includes("s:1"));
    expect(row).toBeDefined();
    expect(lines.every((l) => l.length <= 30)).toBe(true);
  });

  test("width 20 with pathologically long target never exceeds terminal width", async () => {
    const { overlay } = makeOverlay([
      entry({
        name: "some-name",
        tmuxSession: "extremelylongsessionnamethatexceeds",
        tmuxWindow: "1",
      }),
    ]);
    await overlay.waitForPreview();
    const lines = overlay.render(20);
    expect(lines.every((l) => l.length <= 20)).toBe(true);
  });

  test("width 80 renders full row with all columns", async () => {
    const { overlay } = makeOverlay([
      entry({ name: "api-refactor", cwd: "/work/api-refactor-long" }),
      entry({ piSessionId: "s2", tmuxPaneId: "%7", name: "cryptobot", tmuxSession: "fun", tmuxWindow: "1", cwd: "/work/fun/cryptobot" }),
    ]);
    await overlay.waitForPreview();
    const lines = overlay.render(80);
    const row = lines.find((l) => l.includes("api-refactor"));
    expect(row).toBeDefined();
    expect((row!.match(/│/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(row).toContain("ago");
    expect(lines.every((l) => l.length <= 80)).toBe(true);
  });

  test("filtered rows reuse column widths from the full entry list", async () => {
    const { overlay } = makeOverlay([
      entry({ name: "short", tmuxSession: "s", tmuxWindow: "1" }),
      entry({ piSessionId: "s2", tmuxPaneId: "%7", name: "long", tmuxSession: "very-long-session-name-here", tmuxWindow: "12" }),
    ]);
    await overlay.waitForPreview();
    for (const ch of "short") overlay.handleInput(ch);
    const lines = overlay.render(80);
    const row = lines.find((l) => l.includes("s:1"));
    expect(row).toMatch(/│ {10,}s:1/);
  });

  test("fetchPreview rejection renders '(no preview)'", async () => {
    const onDone = vi.fn();
    const overlay = new JumpOverlay({
      entries: [entry()],
      currentPaneId: "%3",
      fetchPreview: async () => {
        throw new Error("dead pane");
      },
      onDone,
      requestRender: () => {},
      previewDelayMs: 0,
    });
    await overlay.waitForPreview();
    expect(overlay.render(80).join("\n")).toContain("(no preview)");
  });

  test("dispose clears pending preview timer", async () => {
    const fetchPreview = vi.fn().mockResolvedValue("x");
    const overlay = new JumpOverlay({
      entries: [entry()],
      currentPaneId: "%3",
      fetchPreview,
      onDone: vi.fn(),
      requestRender: () => {},
      previewDelayMs: 1000,
    });
    overlay.dispose();
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchPreview).not.toHaveBeenCalled();
  });

  test("currentEntry does not mutate selected", () => {
    const { overlay } = makeOverlay([entry(), entry({ piSessionId: "s2", tmuxPaneId: "%7", name: "cryptobot", tmuxSession: "fun", tmuxWindow: "1" })]);
    const o = overlay as unknown as Record<string, any>;
    o.selected = 99;
    const before = o.selected;
    o.currentEntry();
    expect(o.selected).toBe(before);
  });

  test("handleInput is a no-op after onDone fires", () => {
    const e1 = entry();
    const { overlay, onDone } = makeOverlay([e1]);
    overlay.handleInput("enter");
    expect(onDone).toHaveBeenCalledTimes(1);
    overlay.handleInput("enter");
    expect(onDone).toHaveBeenCalledTimes(1);
    overlay.handleInput("down");
    overlay.handleInput("escape");
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  test("superseded pending preview promise resolves instead of hanging", async () => {
    const { overlay } = makeOverlay([entry()]);
    const pending = overlay.waitForPreview();
    overlay.handleInput("a");
    await expect(pending).resolves.toBeUndefined();
  });
});
