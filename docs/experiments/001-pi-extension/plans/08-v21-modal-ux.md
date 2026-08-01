---
title: "v2.1-modal-ux"
experiment: 001-pi-extension
created: "2026-07-31 17:15 UTC"
---

# pi-jump v2.1.0 Implementation Plan — modal overlay UX

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the inline bare-text picker with a bordered, floating modal overlay; crop pane chrome from previews so other pi's status lines don't confuse.

**Approved UX (user sign-off 2026-08-01):**

```
╭───────────────────── ◈ pi-jump ──────────────────────╮
│ ❯ media█                                              │
│───────────────────────────────────────────────────────│
│ ● media-project     work:1  ~/work/fpai/drama…   6h   │   ← selected row: selectedBg
│ ○ pi-fleet-ext…     fleet-v2:1  ~/work/pi-fleet… 5h   │
│┄┄┄┄┄┄┄┄┄ preview: media-project (work:1) ┄┄┄┄┄┄┄┄┄┄┄┄│
│ $ npm run dev                                         │
│ ✓ built in 380ms                                      │
│ ↑↓ move · type to filter · ⏎ jump · esc close         │
╰───────────────────────────────────────────────────────╯
```

**Spec deltas from v2.0.1:**
1. `ctx.ui.custom(..., { overlay: true, overlayOptions: { anchor: "center", width: "80%", maxHeight: "85%" } })`
2. Bordered box (pattern from pi's own `overlay-qa-tests.ts` BaseOverlay.box): `╭─ title ─╮` top with accent title, `│` sides, `╰───╯` bottom; theme colors `border`, `accent`, `dim`, `borderMuted`.
3. Selected row highlighted via `theme.bg("selectedBg", row)` (keeps `→ ` prefix too).
4. Preview gets a labeled dim divider: `┄ preview: <name> (<target>) ┄`.
5. Preview pane chrome cropped: drop the bottom 4 captured lines (target pi's status line + editor) before tailing.
6. Query line: `❯ <query>` + block cursor `█` (plain block char, no cursor API).
7. Footer hints inside box, dim: `↑↓ move · type to filter · ⏎ jump · esc close`.

## Global Constraints

- **Constant frame height remains mandatory** (v2.0.0 clipping lesson): total rendered lines FIXED = 25 (1 top + 1 query + 1 divider + 8 list + 1 preview-label + 12 preview + 1 footer + 1 bottom... verify: 1+1+1+8+1+12+1+1 = 26 — implementer computes and documents exact constant; tests assert it).
- tmux `session:window` target NEVER truncated (carried constraint).
- Theme accessed ONLY via `theme.fg(color, text)` / `theme.bg("selectedBg", text)`; colors used: `border`, `borderMuted`, `accent`, `dim`, `text`, `muted`.
- JumpOverlay receives theme via constructor (new param) — define minimal structural interface locally, do NOT import Theme type (pi-types.d.ts stub).
- Width-awareness: box inner width = render width - 2 (borders). Row composition rules from v2.0.1 unchanged (drop cwd → drop age → truncate name → never target), computed against inner width.
- ANSI width safety: `theme.fg/bg` add escape codes — only apply AFTER truncateToWidth/padding, never before. `visibleWidth` from pi-tui for any width math on styled strings.
- v2.0.1 lessons apply: sync preview (prefetch before open), execFile not pi.exec, requestRender on input only.

## File Structure

```
src/preview.ts   MOD — cleanPreview(raw, maxLines?, cropBottom?) 
src/overlay.ts   MOD — themed boxed modal rendering
src/box.ts       NEW — pure box-drawing helpers (testable without theme)
index.ts         MOD — overlay:true + overlayOptions + theme pass + cropBottom in capture
tests/preview.test.ts  MOD — crop tests
tests/box.test.ts      NEW
tests/overlay.test.ts  MOD — theme stub + modal assertions
```

---

### Task 1: box helpers + preview crop (TDD)

**Files:**
- Create: `src/box.ts`, `tests/box.test.ts`
- Modify: `src/preview.ts`, `tests/preview.test.ts`

**Interfaces:**
- Produces:
```typescript
// src/box.ts
export function boxTop(title: string, innerW: number): string      // "╭── ◈ pi-jump ──╮" (UNSTYLED)
export function boxBottom(innerW: number): string                  // "╰───╯"
export function boxRow(content: string, innerW: number): string    // "│" + content padded to innerW + "│"
export function labelDivider(label: string, innerW: number): string // "┄ preview: X ┄" (UNSTYLED)

// src/preview.ts (changed)
export function cleanPreview(raw: string, maxLines?: number, cropBottom?: number): string[]
```

- [ ] **Step 1: Write failing tests**

`tests/box.test.ts`:
```typescript
import { describe, test, expect } from "vitest";
import { boxTop, boxBottom, boxRow, labelDivider } from "../src/box";

describe("boxTop", () => {
  test("centers title between dashes", () => {
    expect(boxTop(" ◈ pi-jump ", 20)).toBe("╭───── ◈ pi-jump ─────╮");
  });
  test("width is exact", () => {
    expect(boxTop("x", 40)).toHaveLength(42); // innerW + 2 borders
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
```

Append to `tests/preview.test.ts`:
```typescript
describe("cleanPreview cropBottom", () => {
  test("drops bottom N lines after trailing-blank strip", () => {
    const raw = "keep1\nkeep2\nchrome1\nchrome2\nchrome3\nchrome4\n";
    expect(cleanPreview(raw, 20, 4)).toEqual(["keep1", "keep2"]);
  });
  test("cropBottom 0 behaves as before", () => {
    expect(cleanPreview("a\nb\n", 20, 0)).toEqual(["a", "b"]);
  });
  test("crop larger than content returns empty", () => {
    expect(cleanPreview("a\nb\n", 20, 10)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, verify fail** — `npx vitest run tests/box.test.ts tests/preview.test.ts` → box missing, crop failing.

- [ ] **Step 3: Implement**

`src/box.ts`:
```typescript
export function boxTop(title: string, innerW: number): string {
  const titleStr = ` ${title} `.trim().length > 0 ? ` ${title} ` : "";
  const left = Math.floor((innerW - titleStr.length) / 2);
  const right = Math.max(0, innerW - titleStr.length - left);
  return `╭${"─".repeat(Math.max(0, left))}${titleStr}${"─".repeat(right)}╮`;
}

export function boxBottom(innerW: number): string {
  return `╰${"─".repeat(innerW)}╯`;
}

export function boxRow(content: string, innerW: number): string {
  return `│${content.padEnd(innerW)}│`;
}

export function labelDivider(label: string, innerW: number): string {
  const text = ` ${label} `;
  if (text.length >= innerW) return text.slice(0, innerW);
  const left = Math.floor((innerW - text.length) / 2);
  const right = innerW - text.length - left;
  return `${"┄".repeat(left)}${text}${"┄".repeat(right)}`;
}
```

`src/preview.ts` — replace cleanPreview:
```typescript
export const PREVIEW_LINES = 20;

export function cleanPreview(raw: string, maxLines: number = PREVIEW_LINES, cropBottom = 0): string[] {
  const lines = raw.split("\n").map((l) => l.replace(/\r/g, ""));
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
  const cropped = cropBottom > 0 ? lines.slice(0, Math.max(0, lines.length - cropBottom)) : lines;
  return cropped.slice(-maxLines);
}
```

- [ ] **Step 4: Run, verify pass** — `npx vitest run` all green. NOTE: boxTop test expectation `╭───── ◈ pi-jump ─────╮` — verify dash counts against implementation; if off by one, fix the TEST string and document (implementation contract: total length = innerW + 2, title centered, left bias).

- [ ] **Step 5: Commit** — `git add src/box.ts src/preview.ts tests/box.test.ts tests/preview.test.ts && git commit -m "feat: box helpers + preview chrome crop"`

---

### Task 2: modal overlay rendering (TDD)

**Files:**
- Modify: `src/overlay.ts`
- Modify: `tests/overlay.test.ts`

**Interfaces:**
- Consumes: box helpers, cleanPreview unchanged signature usage.
- Produces:
```typescript
export interface JumpTheme {
  fg(color: string, text: string): string;
  bg(color: string, text: string): string;
}
export interface JumpOverlayOptions {
  entries: DiscoveredEntry[];
  currentPaneId?: string;
  getPreview: (paneId: string) => string | undefined;
  onDone: (entry: DiscoveredEntry | null) => void;
  requestRender: () => void;
  theme: JumpTheme;                    // NEW, required
  previewLabel?: (e: DiscoveredEntry) => string;  // default: `${name ?? basename(cwd)} (${target})`
}
// Constants exported for tests:
export const MODAL_LIST_ROWS = 8;
export const MODAL_PREVIEW_ROWS = 12;
export const MODAL_FRAME_LINES: number; // exact total render() line count
```

- [ ] **Step 1: Rewrite tests** — keep ALL existing behavioral tests (filter/nav/enter/escape/width/done-guard/scroll), adapting: every `makeOverlay` gains an identity theme `{ fg: (_c, t) => t, bg: (_c, t) => t }`. Replace the constant-height describe with:

```typescript
describe("JumpOverlay modal frame", () => {
  const identityTheme = { fg: (_c: string, t: string) => t, bg: (_c: string, t: string) => t };

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
```
(Add `makeOverlayWithTheme` helper; import MODAL_* constants.)

Scroll test adapts: list window is now MODAL_LIST_ROWS (8).

- [ ] **Step 2: Run, verify fail** — new API missing.

- [ ] **Step 3: Implement** — rewrite `src/overlay.ts`:

Structure (complete logic; implementer fills exact code):
- `JumpTheme` interface as specified.
- Constructor stores `opts.theme`; preview label default as specified.
- `render(width)`:
  1. `innerW = width - 2` (borders). All content truncated/padded to innerW BEFORE styling.
  2. Top: `theme.fg("border", boxTopRaw(titleParts))` with title in accent: build via boxTop BUT title segment wrapped: simplest — build top manually: left dashes in border color, title ` ◈ pi-jump ` in accent, right dashes + corners in border color.
  3. Query row: `boxRow(truncateToWidth("❯ " + query + "█", innerW), innerW)` styled with theme.fg("text", ...) — apply box border chars in border color: each row = `fg("border","│") + content + fg("border","│")`. NOTE boxRow from Task 1 is unstyled; style at this layer.
  4. Divider row: `─`.repeat(innerW) in borderMuted, with side borders.
  5. List rows (exactly MODAL_LIST_ROWS, blank-padded): selected row content wrapped in `theme.bg("selectedBg", paddedContent)` — pad FIRST to innerW, then bg-wrap the WHOLE inner-width row for full-width highlight.
  6. Preview label row: labelDivider(label, innerW) in dim, side borders.
  7. Preview rows (exactly MODAL_PREVIEW_ROWS, blank-padded): fg("muted") or plain.
  8. Footer row: hints string dim: `↑↓ move · type to filter · ⏎ jump · esc close`.
  9. Bottom: fg("border", boxBottom(innerW)).
- `MODAL_FRAME_LINES = 1 + 1 + 1 + MODAL_LIST_ROWS + 1 + MODAL_PREVIEW_ROWS + 1 + 1` = 26 with LIST=8, PREVIEW=12. Export it.
- Scroll window math: same as before with MODAL_LIST_ROWS.
- Row composition (renderRow) UNCHANGED but computed against `innerW - 2` (prefix). Selected marker `→ ` stays.

- [ ] **Step 4: Run tests + typecheck** — all green.

- [ ] **Step 5: Commit** — `git add src/overlay.ts tests/overlay.test.ts && git commit -m "feat: modal boxed rendering with theme"`

---

### Task 3: index.ts wiring + LIVE verification

**Files:**
- Modify: `index.ts`

**Interfaces:**
- Consumes: JumpOverlay with theme; capture uses cropBottom.

- [ ] **Step 1: Wire** — in the /jump handler:
1. Capture command adds chrome crop: keep `-S -25` (captures extra), and call `cleanPreview(stdout, MODAL_PREVIEW_ROWS + 4, 4)`? NO — simpler: pass raw stdout to previews map as now; the crop happens in overlay's loadPreview: `cleanPreview(raw, MODAL_PREVIEW_ROWS, 4)`. Implementer: change loadPreview call accordingly (cropBottom = 4 constant, export as `PREVIEW_CHROME_CROP = 4`).
2. `ctx.ui.custom<DiscoveredEntry | null>((tui, theme, _kb, done) => new JumpOverlay({ ..., theme }), { overlay: true, overlayOptions: { anchor: "center", width: "80%", maxHeight: "85%" } })`.
3. Theme type: pi's theme has fg/bg — structurally compatible; if tsc complains, cast `theme as unknown as JumpTheme` with a comment.

- [ ] **Step 2: Suite + typecheck** — `npx tsc --noEmit && npx vitest run` green.

- [ ] **Step 3: Commit** — `git add index.ts src/overlay.ts && git commit -m "feat: wire modal overlay mode with theme and chrome crop"`

- [ ] **Step 4: LIVE verification (MANDATORY — controller performs, implementer prepares)** — implementer: run the headless load check `echo "what is 2+2" | pi -e ./index.ts -p 2>&1 | tail -3` (no load errors). Controller then drives a real pi in a scratch tmux window (send-keys + capture-pane) and verifies: modal floats with borders, selection highlight, preview label, cropped chrome (no target status line), filter, nav, jump.

---

## Self-Review

- Coverage: modal overlay ✅ T2+T3, borders/title ✅ T1+T2, selection highlight ✅ T2, preview label ✅ T2, chrome crop ✅ T1+T3, constant height ✅ T2, live verification gate ✅ T3 step 4.
- Placeholders: overlay.ts is structural guidance (this is a rewrite of a known file) — implementer must produce complete code; review must reject stubs.
- Type consistency: JumpTheme, MODAL_* constants, cleanPreview 3rd param consistent across tasks.
