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
});
