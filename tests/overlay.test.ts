import { describe, test, expect, vi } from "vitest";
import { JumpOverlay, MODAL_LIST_ROWS, MODAL_PREVIEW_ROWS, MODAL_FRAME_LINES, PREVIEW_CHROME_CROP } from "../src/overlay";
import type { JumpOverlayOptions, JumpTheme } from "../src/overlay";
import type { DiscoveredEntry } from "../src/discover";
import { visibleWidth } from "@earendil-works/pi-tui";

// Minimal mock for the peer/bundled pi-tui package so unit tests resolve.
// In the real TUI, handleInput receives raw terminal byte sequences; this test
// harness sends the canonical key-name strings that matchesKey() would parse.
vi.mock("@earendil-works/pi-tui", () => {
  function codepointWidth(ch: string) {
    const cp = ch.codePointAt(0)!;
    // Coarse wide-char approximation: CJK ideographs, Kana, Hangul syllables,
    // fullwidth forms, and emoji are 2 columns; everything else is 1. This keeps
    // arrows/bullets/box-drawing as 1-column symbols, matching the real pi-tui
    // wcwidth behavior for these glyphs while still catching CJK/emoji overflow.
    if (cp >= 0x4E00 && cp <= 0x9FFF) return 2; // CJK Unified Ideographs
    if (cp >= 0x3400 && cp <= 0x4DBF) return 2; // CJK Extension A
    if (cp >= 0x3040 && cp <= 0x309F) return 2; // Hiragana
    if (cp >= 0x30A0 && cp <= 0x30FF) return 2; // Katakana
    if (cp >= 0xAC00 && cp <= 0xD7AF) return 2; // Hangul Syllables
    if (cp >= 0xFF01 && cp <= 0xFF60) return 2; // Fullwidth ASCII
    if (cp >= 0xFFE0 && cp <= 0xFFE6) return 2; // Fullwidth symbol variants
    if (cp >= 0x1F000) return 2; // Emoji and other supplemental planes
    return 1;
  }

  function visibleWidth(s: string) {
    return [...s].reduce((acc, ch) => acc + codepointWidth(ch), 0);
  }

  // Coarse approximation of pi-tui's visible-width truncation. The default
  // ellipsis is empty in tests so assertions focus on content fit, not the
  // truncation marker; the real helper uses "…".
  function truncateToWidth(s: string, width: number, ellipsis = "") {
    if (visibleWidth(s) <= width) return s;
    const ellipsisW = visibleWidth(ellipsis);
    let budget = Math.max(0, width - ellipsisW);
    let result = "";
    for (const ch of s) {
      const chW = codepointWidth(ch);
      if (chW > budget) break;
      result += ch;
      budget -= chW;
    }
    return result + ellipsis;
  }

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
    truncateToWidth,
    visibleWidth,
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

const identityTheme: JumpTheme = {
  fg: (_c: string, t: string) => t,
  bg: (_c: string, t: string) => t,
};

function makeOverlayWithTheme(
  entries: DiscoveredEntry[],
  theme: JumpTheme,
  previewText: string | undefined = "$ npm run dev",
  currentPaneId = "%3"
) {
  const onDone = vi.fn();
  const overlay = new JumpOverlay({
    entries,
    currentPaneId,
    getPreview: () => previewText,
    onDone,
    requestRender: () => {},
    theme,
  });
  return { overlay, onDone };
}

function makeOverlay(entries: DiscoveredEntry[], previewText?: string) {
  return makeOverlayWithTheme(entries, identityTheme, previewText);
}

const WIDTH = 80;

describe("JumpOverlay", () => {
  test("initial render shows title, query line, all entries, footer", () => {
    const { overlay } = makeOverlay([entry(), entry({ piSessionId: "s2", tmuxPaneId: "%7", name: "cryptobot", tmuxSession: "fun", tmuxWindow: "1" })]);
    const lines = overlay.render(WIDTH);
    const joined = lines.join("\n");
    expect(joined).toContain("pi-jump");
    expect(joined).toContain("api-refactor");
    expect(joined).toContain("cryptobot");
    expect(joined).toContain("● api-refactor");
    expect(joined).toContain("2/2");
    expect(lines.every((l) => l.length <= WIDTH)).toBe(true);
  });

  test("typing filters the list", () => {
    const { overlay } = makeOverlay([entry(), entry({ piSessionId: "s2", tmuxPaneId: "%7", name: "cryptobot", tmuxSession: "fun", tmuxWindow: "1" })]);
    for (const ch of "crypt") overlay.handleInput(ch);
    const joined = overlay.render(WIDTH).join("\n");
    expect(joined).toContain("cryptobot");
    expect(joined).not.toContain("api-refactor");
    expect(joined).toContain("❯ crypt");
    expect(joined).toContain("1/2");
  });

  test("backspace restores filtered entries", () => {
    const { overlay } = makeOverlay([entry(), entry({ piSessionId: "s2", tmuxPaneId: "%7", name: "cryptobot", tmuxSession: "fun", tmuxWindow: "1" })]);
    for (const ch of "zzz") overlay.handleInput(ch);
    expect(overlay.render(WIDTH).join("\n")).toContain("0/2");
    for (let i = 0; i < 3; i++) overlay.handleInput("backspace");
    expect(overlay.render(WIDTH).join("\n")).toContain("2/2");
  });

  test("fuzzy also matches tmux session name", () => {
    const { overlay } = makeOverlay([entry(), entry({ piSessionId: "s2", tmuxPaneId: "%7", name: "cryptobot", tmuxSession: "fun", tmuxWindow: "1" })]);
    for (const ch of "fun") overlay.handleInput(ch);
    const joined = overlay.render(WIDTH).join("\n");
    expect(joined).toContain("cryptobot");
    expect(joined).not.toContain("api-refactor");
  });

  test("enter on first entry calls onDone with it", () => {
    const e1 = entry();
    const { overlay, onDone } = makeOverlay([e1]);
    overlay.handleInput("enter");
    expect(onDone).toHaveBeenCalledWith(e1);
  });

  test("down then enter selects the second entry", () => {
    const e2 = entry({ piSessionId: "s2", tmuxPaneId: "%7", name: "cryptobot", tmuxSession: "fun", tmuxWindow: "1" });
    const { overlay, onDone } = makeOverlay([entry(), e2]);
    overlay.handleInput("down");
    overlay.handleInput("enter");
    expect(onDone).toHaveBeenCalledWith(e2);
  });

  test("escape calls onDone with null", () => {
    const { overlay, onDone } = makeOverlay([entry()]);
    overlay.handleInput("escape");
    expect(onDone).toHaveBeenCalledWith(null);
  });

  test("ctrl+c calls onDone with null", () => {
    const { overlay, onDone } = makeOverlay([entry()]);
    overlay.handleInput("ctrl+c");
    expect(onDone).toHaveBeenCalledWith(null);
  });

  test("enter with empty filtered list does nothing", () => {
    const { overlay, onDone } = makeOverlay([entry()]);
    for (const ch of "zzz") overlay.handleInput(ch);
    overlay.handleInput("enter");
    expect(onDone).not.toHaveBeenCalled();
  });

  test("enter on empty filtered list does not lock overlay", () => {
    const { overlay, onDone } = makeOverlay([
      entry(),
      entry({ piSessionId: "s2", tmuxPaneId: "%7", name: "cryptobot", tmuxSession: "fun", tmuxWindow: "1" }),
    ]);
    for (const ch of "zzz") overlay.handleInput(ch);
    overlay.handleInput("enter");
    expect(onDone).not.toHaveBeenCalled();
    for (let i = 0; i < 3; i++) overlay.handleInput("backspace");
    expect(overlay.render(WIDTH).join("\n")).toContain("2/2");
  });

  test("preview text renders synchronously from getPreview", () => {
    const { overlay } = makeOverlay([entry()], "UNIQUE_PREVIEW_TEXT");
    expect(overlay.render(WIDTH).join("\n")).toContain("UNIQUE_PREVIEW_TEXT");
  });

  test("preview follows selection", () => {
    const onDone = vi.fn();
    const previews = new Map([
      ["%3", "FIRST_PANE"],
      ["%7", "SECOND_PANE"],
    ]);
    const overlay = new JumpOverlay({
      entries: [
        entry(),
        entry({ piSessionId: "s2", tmuxPaneId: "%7", name: "cryptobot", tmuxSession: "fun", tmuxWindow: "1" }),
      ],
      currentPaneId: "%3",
      getPreview: (id) => previews.get(id),
      onDone,
      requestRender: () => {},
      theme: identityTheme,
    });
    expect(overlay.render(WIDTH).join("\n")).toContain("FIRST_PANE");
    overlay.handleInput("down");
    expect(overlay.render(WIDTH).join("\n")).toContain("SECOND_PANE");
    expect(overlay.render(WIDTH).join("\n")).not.toContain("FIRST_PANE");
  });

  test("missing preview renders '(no preview)'", () => {
    const overlay = new JumpOverlay({
      entries: [entry()],
      currentPaneId: "%3",
      getPreview: () => undefined,
      onDone: vi.fn(),
      requestRender: () => {},
      theme: identityTheme,
    });
    expect(overlay.render(WIDTH).join("\n")).toContain("(no preview)");
  });

  test("empty preview renders '(empty pane)'", () => {
    const { overlay } = makeOverlay([entry()], "\n\n");
    expect(overlay.render(WIDTH).join("\n")).toContain("(empty pane)");
  });

  test("tmux target is never truncated in list rows", () => {
    const longSession = entry({ tmuxSession: "very-long-session-name-here", tmuxWindow: "12" });
    const { overlay } = makeOverlay([longSession]);
    expect(overlay.render(50).join("\n")).toContain("very-long-session-name-here:12");
  });

  test("render scrolls to show at most MODAL_LIST_ROWS and keeps selection visible", () => {
    const entries = Array.from({ length: 15 }, (_, i) =>
      entry({
        piSessionId: `s${i + 1}`,
        tmuxPaneId: `%${i + 1}`,
        name: `proj-${i + 1}`,
        tmuxSession: `sess-${i + 1}`,
      })
    );
    const { overlay } = makeOverlay(entries);

    // Move selection to index 12.
    for (let i = 0; i < 12; i++) overlay.handleInput("down");

    const lines = overlay.render(WIDTH);
    const listRows = lines.slice(3, 3 + MODAL_LIST_ROWS);

    expect(listRows.length).toBe(MODAL_LIST_ROWS);
    expect(listRows.some((l) => l.includes("→ "))).toBe(true);
    expect(lines.join("\n")).toContain("proj-13");
  });

  test("width 40 keeps full tmux target when name is long", () => {
    const longName = "a-really-long-pi-session-name-name-name";
    const session = "very-long-session-name-here";
    const target = `${session}:12`;
    const { overlay } = makeOverlay([
      entry({ name: longName, tmuxSession: session, tmuxWindow: "12" }),
    ]);
    const lines = overlay.render(40);
    const row = lines.find((l) => l.includes(target));
    expect(row).toBeDefined();
    expect(lines.every((l) => l.length <= 40)).toBe(true);
  });

  test("width 40 truncates long name with ellipsis and keeps full tmux target", () => {
    const longName = "a-really-long-pi-session-name-name-name";
    const session = "very-long-session-name-here";
    const target = `${session}:12`;
    const { overlay } = makeOverlay([
      entry({ name: longName, tmuxSession: session, tmuxWindow: "12" }),
    ]);
    const lines = overlay.render(40);
    const row = lines.find((l) => l.includes(target));
    expect(row).toBeDefined();
    expect(row).toContain("…");
    expect(lines.every((l) => l.length <= 40)).toBe(true);
  });

  test("width 30 truncates name but never the target", () => {
    const longName = "a-really-long-pi-session-name-name-name";
    const { overlay } = makeOverlay([entry({ name: longName, tmuxSession: "s", tmuxWindow: "1" })]);
    const lines = overlay.render(30);
    const row = lines.find((l) => l.includes("s:1"));
    expect(row).toBeDefined();
    expect(lines.every((l) => l.length <= 30)).toBe(true);
  });

  test("width 20 with pathologically long target never exceeds terminal width", () => {
    const { overlay } = makeOverlay([
      entry({
        name: "some-name",
        tmuxSession: "extremelylongsessionnamethatexceeds",
        tmuxWindow: "1",
      }),
    ]);
    const lines = overlay.render(20);
    expect(lines.every((l) => l.length <= 20)).toBe(true);
  });

  test("width 80 renders full row with all columns", () => {
    const { overlay } = makeOverlay([
      entry({ name: "api-refactor", cwd: "/work/api-refactor-long" }),
      entry({ piSessionId: "s2", tmuxPaneId: "%7", name: "cryptobot", tmuxSession: "fun", tmuxWindow: "1", cwd: "/work/fun/cryptobot" }),
    ]);
    const lines = overlay.render(80);
    const row = lines.find((l) => l.includes("api-refactor"));
    expect(row).toBeDefined();
    expect((row!.match(/│/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(row).toContain("ago");
    expect(lines.every((l) => l.length <= 80)).toBe(true);
  });

  test("filtered rows reuse column widths from the full entry list", () => {
    const { overlay } = makeOverlay([
      entry({ name: "short", tmuxSession: "s", tmuxWindow: "1" }),
      entry({ piSessionId: "s2", tmuxPaneId: "%7", name: "long", tmuxSession: "very-long-session-name-here", tmuxWindow: "12" }),
    ]);
    for (const ch of "short") overlay.handleInput(ch);
    const lines = overlay.render(80);
    const row = lines.find((l) => l.includes("s:1"));
    expect(row).toMatch(/│ {10,}s:1/);
  });

  test("wide-char session name keeps visible width within terminal bounds", () => {
    const { overlay } = makeOverlay([entry({ name: "日本語セッション" })]);
    for (const w of [40, 80]) {
      const row = overlay.render(w).find((l) => l.includes("日本語セッション"));
      expect(row).toBeDefined();
      expect(visibleWidth(row!)).toBeLessThanOrEqual(w);
    }
  });

  test("preview chrome lines are cropped before display", () => {
    const chrome = ["--- status ---", "--- command --", "--- pane title", "--- prompt ---"];
    const body = Array.from({ length: MODAL_PREVIEW_ROWS - PREVIEW_CHROME_CROP }, (_, i) => `body line ${i + 1}`);
    const { overlay } = makeOverlay([entry()], [...body, ...chrome].join("\n"));
    const rendered = overlay.render(80).join("\n");
    for (const line of chrome) {
      expect(rendered).not.toContain(line);
    }
    expect(rendered).toContain("body line 1");
    expect(rendered).toContain(`body line ${MODAL_PREVIEW_ROWS - PREVIEW_CHROME_CROP}`);
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
});

describe("JumpOverlay modal frame", () => {
  test("frame has exact constant line count", () => {
    const { overlay } = makeOverlay([entry()]);
    expect(overlay.render(80).length).toBe(MODAL_FRAME_LINES);
  });

  test("frame line count constant across filter and nav", () => {
    const { overlay } = makeOverlay([
      entry(),
      entry({ piSessionId: "s2", tmuxPaneId: "%7", name: "cryptobot", tmuxSession: "fun", tmuxWindow: "1" }),
    ]);
    const n = overlay.render(80).length;
    for (const ch of "crypt") overlay.handleInput(ch);
    expect(overlay.render(80).length).toBe(n);
    overlay.handleInput("down");
    expect(overlay.render(80).length).toBe(n);
  });

  test("box borders present", () => {
    const { overlay } = makeOverlay([entry()]);
    const lines = overlay.render(80);
    expect(lines[0]).toMatch(/^╭.*╮$/);
    expect(lines[lines.length - 1]).toMatch(/^╰.*╯$/);
    expect(lines[1].startsWith("│") && lines[1].endsWith("│")).toBe(true);
  });

  test("title contains pi-jump", () => {
    const { overlay } = makeOverlay([entry()]);
    expect(overlay.render(80)[0]).toContain("pi-jump");
  });

  test("preview label divider names the selected session and target", () => {
    const { overlay } = makeOverlay([entry({ name: "api-refactor" })]);
    expect(overlay.render(80).join("\n")).toContain("preview: api-refactor (work:3)");
  });

  test("footer hints present", () => {
    const { overlay } = makeOverlay([entry()]);
    expect(overlay.render(80).join("\n")).toContain("esc close");
  });

  test("query line shows prompt and query", () => {
    const { overlay } = makeOverlay([entry()]);
    for (const ch of "ab") overlay.handleInput(ch);
    expect(overlay.render(80).join("\n")).toContain("❯ ab");
  });

  test("selected row gets selectedBg styling", () => {
    const markTheme = {
      fg: (_c: string, t: string) => t,
      bg: (c: string, t: string) => (c === "selectedBg" ? `[SEL]${t}[/SEL]` : t),
    };
    const { overlay } = makeOverlayWithTheme([entry()], markTheme);
    expect(overlay.render(80).join("\n")).toContain("[SEL]");
  });

  test("every rendered line respects width accounting for borders", () => {
    const { overlay } = makeOverlay([entry()]);
    for (const w of [30, 50, 80]) {
      const lines = overlay.render(w);
      for (const l of lines) expect(l.length).toBeLessThanOrEqual(w);
    }
  });
});

describe("uniform column plan (padding consistency)", () => {
  test("all rows drop the same columns when space is tight", () => {
    // One row with a very long cwd would alone overflow; the other would fit.
    // Column inclusion must be decided globally so separators align.
    const { overlay } = makeOverlay([
      entry({ name: "a", cwd: "/extremely/long/working/directory/path/that/is/quite/big", tmuxSession: "work", tmuxWindow: "1" }),
      entry({ piSessionId: "s2", tmuxPaneId: "%7", name: "b", cwd: "/tmp", tmuxSession: "w", tmuxWindow: "2" }),
    ]);
    const lines = overlay.render(60);
    const rows = lines.filter((l) => l.includes("●") || l.includes("○"));
    expect(rows.length).toBe(2);
    const seps = rows.map((r) => (r.match(/│/g) ?? []).length);
    expect(seps[0]).toBe(seps[1]);
  });

  test("when all rows fit, every row has all columns", () => {
    const { overlay } = makeOverlay([
      entry({ name: "a", cwd: "/tmp" }),
      entry({ piSessionId: "s2", tmuxPaneId: "%7", name: "b", cwd: "/var" }),
    ]);
    const lines = overlay.render(120);
    const rows = lines.filter((l) => l.includes("●") || l.includes("○"));
    const seps = rows.map((r) => (r.match(/│/g) ?? []).length);
    // box borders (2) + 3 column separators per row
    expect(seps).toEqual([5, 5]);
  });
});
