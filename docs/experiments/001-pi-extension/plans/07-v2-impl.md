---
title: "v2-impl"
experiment: 001-pi-extension
created: "2026-07-31 17:15 UTC"
---

# pi-jump v2.0.0 Implementation Plan — preview + fuzzy filter

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the `/jump` `ui.select` picker with a custom component: fuzzy filter input + live `tmux capture-pane` preview of the highlighted session.

**Architecture:** `src/fuzzy.ts` (pure scorer), `src/preview.ts` (pure text cleanup), `src/overlay.ts` (`JumpOverlay` component), `index.ts` wiring via `ctx.ui.custom`.

**Tech Stack:** existing + `@earendil-works/pi-tui` helpers (`matchesKey`, `Key`, `truncateToWidth`) — already available to extensions at runtime (bundled by pi; add to peerDependencies).

**Spec:** `docs/experiments/001-pi-extension/plans/06-v2-design.md`.

## Global Constraints

- **tmux target (`session:window`) is NEVER truncated/compressed** — user requirement. Column layout from v1.3 unchanged: `{dot} {name} │ {target} │ {cwd} │ {age}{ [current]?}`.
- Fuzzy match key: `${e.name ?? basename(e.cwd)} ${e.tmuxSession}` (so typing tmux session names works).
- Preview: `tmux capture-pane -p -t <paneId> -S -25` — NO `-e` flag (plain text, no escape sequences).
- Preview debounce 150ms; stale async responses discarded via token counter.
- Component contract (pi-tui): `render(width): string[]` (no line exceeds width), `handleInput(data)`, `invalidate()`. Call `tui.requestRender()` after state changes.
- `ctx.ui.custom<T>((tui, theme, keybindings, done) => component)` → resolves `T` when `done(value)` called.
- All new pure code TDD. JumpOverlay tested headless with injected fake `fetchPreview` + `requestRender`.

---

### Task 1: fuzzy module (TDD)

**Files:**
- Create: `src/fuzzy.ts`
- Test: `tests/fuzzy.test.ts`

**Interfaces:**
- Produces:
```typescript
export function fuzzyScore(query: string, candidate: string): number | null
export function fuzzyFilter<T>(query: string, items: T[], key: (t: T) => string): T[]
```

- [ ] **Step 1: Write failing tests** `tests/fuzzy.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run, verify fail** — `npx vitest run tests/fuzzy.test.ts` → module missing.

- [ ] **Step 3: Implement** `src/fuzzy.ts`:

```typescript
/**
 * fzf-lite: subsequence matching with scoring.
 * Score: +1 per matched char, +4 per consecutive run continuation,
 * +6 if the match starts at index 0. Case-insensitive. null = no match.
 */
export function fuzzyScore(query: string, candidate: string): number | null {
  if (query.length === 0) return 0;
  const q = query.toLowerCase();
  const c = candidate.toLowerCase();
  let score = 0;
  let qi = 0;
  let prevMatch = -2;
  for (let ci = 0; ci < c.length && qi < q.length; ci++) {
    if (c[ci] === q[qi]) {
      score += 1;
      if (ci === prevMatch + 1) score += 4;
      if (qi === 0 && ci === 0) score += 6;
      prevMatch = ci;
      qi++;
    }
  }
  return qi === q.length ? score : null;
}

export function fuzzyFilter<T>(query: string, items: T[], key: (t: T) => string): T[] {
  if (query.length === 0) return [...items];
  const scored: { item: T; score: number; index: number }[] = [];
  items.forEach((item, index) => {
    const score = fuzzyScore(query, key(item));
    if (score !== null) scored.push({ item, score, index });
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.map((s) => s.item);
}
```

- [ ] **Step 4: Run, verify pass** — `npx vitest run tests/fuzzy.test.ts` → 9 PASS.

- [ ] **Step 5: Commit** — `git add src/fuzzy.ts tests/fuzzy.test.ts && git commit -m "feat: fuzzy subsequence matcher"`

---

### Task 2: preview module (TDD)

**Files:**
- Create: `src/preview.ts`
- Test: `tests/preview.test.ts`

**Interfaces:**
- Produces:
```typescript
export const PREVIEW_LINES = 20;
export function cleanPreview(raw: string, maxLines?: number): string[]
```

- [ ] **Step 1: Write failing tests** `tests/preview.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run, verify fail** — `npx vitest run tests/preview.test.ts` → module missing.

- [ ] **Step 3: Implement** `src/preview.ts`:

```typescript
export const PREVIEW_LINES = 20;

export function cleanPreview(raw: string, maxLines: number = PREVIEW_LINES): string[] {
  const lines = raw.split("\n").map((l) => l.replace(/\r/g, ""));
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
  return lines.slice(-maxLines);
}
```

- [ ] **Step 4: Run, verify pass** — `npx vitest run tests/preview.test.ts` → 5 PASS.

- [ ] **Step 5: Commit** — `git add src/preview.ts tests/preview.test.ts && git commit -m "feat: preview text cleanup"`

---

### Task 3: JumpOverlay component (TDD, headless)

**Files:**
- Create: `src/overlay.ts`
- Test: `tests/overlay.test.ts`
- Modify: `pi-types.d.ts` (extend stub if needed for pi-tui imports — imports come from `@earendil-works/pi-tui`, add `declare module "@earendil-works/pi-tui";` ONLY if tsc errors)

**Interfaces:**
- Consumes: `DiscoveredEntry` (discover.ts), `formatOptions` (format.ts), `fuzzyFilter` (fuzzy.ts), `cleanPreview` (preview.ts).
- Produces:
```typescript
export interface JumpOverlayOptions {
  entries: DiscoveredEntry[];
  currentPaneId?: string;
  fetchPreview: (paneId: string) => Promise<string>;
  onDone: (entry: DiscoveredEntry | null) => void;
  requestRender: () => void;
  previewDelayMs?: number;   // default 150; pass 0 in tests
}
export class JumpOverlay {
  constructor(opts: JumpOverlayOptions);
  render(width: number): string[];
  handleInput(data: string): void;
  invalidate(): void;
  waitForPreview(): Promise<void>;  // resolves when pending preview for current selection is loaded — test hook
}
```

- [ ] **Step 1: Write failing tests** `tests/overlay.test.ts`:

```typescript
import { describe, test, expect, vi } from "vitest";
import { JumpOverlay } from "../src/overlay";
import type { DiscoveredEntry } from "../src/discover";

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
```

Key-name contract for handleInput: tests use `"enter"`, `"escape"`, `"down"`, `"up"`, `"backspace"` — these are what `matchesKey(data, Key.x)` receives for single keypresses. Printable single chars arrive as themselves.

- [ ] **Step 2: Run, verify fail** — `npx vitest run tests/overlay.test.ts` → module missing.

- [ ] **Step 3: Implement** `src/overlay.ts`:

```typescript
import { matchesKey, Key, truncateToWidth } from "@earendil-works/pi-tui";
import { basename } from "node:path";
import type { DiscoveredEntry } from "./discover";
import { formatOptions } from "./format";
import { fuzzyFilter } from "./fuzzy";
import { cleanPreview, PREVIEW_LINES } from "./preview";

const MAX_LIST_ROWS = 10;

export interface JumpOverlayOptions {
  entries: DiscoveredEntry[];
  currentPaneId?: string;
  fetchPreview: (paneId: string) => Promise<string>;
  onDone: (entry: DiscoveredEntry | null) => void;
  requestRender: () => void;
  previewDelayMs?: number;
}

export class JumpOverlay {
  private query = "";
  private selected = 0;
  private previewLines: string[] = [];
  private previewToken = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private pending: Promise<void> = Promise.resolve();
  private cachedFiltered?: DiscoveredEntry[];

  constructor(private opts: JumpOverlayOptions) {
    this.schedulePreview();
  }

  private filtered(): DiscoveredEntry[] {
    if (!this.cachedFiltered) {
      this.cachedFiltered = fuzzyFilter(
        this.query,
        this.opts.entries,
        (e) => `${e.name ?? basename(e.cwd)} ${e.tmuxSession}`
      );
    }
    return this.cachedFiltered;
  }

  private currentEntry(): DiscoveredEntry | undefined {
    const list = this.filtered();
    if (list.length === 0) return undefined;
    this.selected = Math.min(this.selected, list.length - 1);
    return list[this.selected];
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.enter)) {
      const e = this.currentEntry();
      if (e) this.opts.onDone(e);
      return;
    }
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrlC)) {
      this.opts.onDone(null);
      return;
    }
    if (matchesKey(data, Key.up)) {
      if (this.selected > 0) {
        this.selected--;
        this.afterNav();
      }
      return;
    }
    if (matchesKey(data, Key.down)) {
      if (this.selected < this.filtered().length - 1) {
        this.selected++;
        this.afterNav();
      }
      return;
    }
    if (matchesKey(data, Key.backspace)) {
      if (this.query.length > 0) {
        this.query = this.query.slice(0, -1);
        this.afterQueryChange();
      }
      return;
    }
    if (/^[\x20-\x7e]+$/.test(data)) {
      this.query += data;
      this.afterQueryChange();
    }
  }

  private afterQueryChange(): void {
    this.cachedFiltered = undefined;
    this.selected = 0;
    this.afterNav();
  }

  private afterNav(): void {
    this.opts.requestRender();
    this.schedulePreview();
  }

  private schedulePreview(): void {
    if (this.timer) clearTimeout(this.timer);
    const token = ++this.previewToken;
    const delay = this.opts.previewDelayMs ?? 150;
    this.pending = new Promise<void>((resolve) => {
      this.timer = setTimeout(async () => {
        const e = this.currentEntry();
        if (!e) {
          this.previewLines = [];
          this.opts.requestRender();
          resolve();
          return;
        }
        try {
          const raw = await this.opts.fetchPreview(e.tmuxPaneId);
          if (token !== this.previewToken) {
            resolve();
            return; // stale — a newer preview was scheduled
          }
          const cleaned = cleanPreview(raw, PREVIEW_LINES);
          this.previewLines = cleaned.length > 0 ? cleaned : ["(empty pane)"];
        } catch {
          if (token === this.previewToken) this.previewLines = ["(no preview)"];
        }
        this.opts.requestRender();
        resolve();
      }, delay);
    });
  }

  /** Test hook: resolves when the pending preview (if any) has loaded. */
  waitForPreview(): Promise<void> {
    return this.pending;
  }

  invalidate(): void {
    this.cachedFiltered = undefined;
  }

  render(width: number): string[] {
    const list = this.filtered();
    const optionLines = formatOptions(list, new Date(), this.opts.currentPaneId);

    const leftW = Math.min(56, Math.max(30, Math.floor(width * 0.55)));
    const rightW = Math.max(10, width - leftW - 3); // 3 for " │ "

    // Scroll window over the list
    const sel = Math.min(this.selected, Math.max(0, list.length - 1));
    const start = Math.max(0, Math.min(sel - Math.floor(MAX_LIST_ROWS / 2), list.length - MAX_LIST_ROWS));
    const visible = list.slice(start, start + MAX_LIST_ROWS);

    const leftRows = visible.map((e, i) => {
      const idx = start + i;
      const prefix = idx === sel ? "→ " : "  ";
      const line = prefix + optionLines[idx];
      return line.padEnd(leftW).slice(0, leftW);
    });

    const rows = Math.max(leftRows.length, this.previewLines.length);
    const body: string[] = [];
    for (let i = 0; i < rows; i++) {
      const left = (leftRows[i] ?? " ".repeat(leftW));
      const right = this.previewLines[i] ? truncateToWidth(this.previewLines[i], rightW) : "";
      body.push(`${left} │ ${right}`);
    }

    return [
      "Jump to pi session",
      `> ${this.query}`,
      "─".repeat(Math.min(width, 20)),
      ...body,
      `${list.length}/${this.opts.entries.length}  ↑↓ navigate  ⏎ jump  esc cancel`,
    ];
  }
}
```

IMPORTANT implementer notes:
- The "never truncate target" test renders at width 50. `leftW` = max(30, floor(50*0.55)=27) = 30, and the target `very-long-session-name-here:12` (30 chars) sits inside the formatOptions line which gets `.slice(0, leftW)` — THAT WOULD TRUNCATE IT. To satisfy the constraint: do NOT slice formatted list lines to leftW. Instead, let list rows render at their natural width and truncate ONLY to full `width` (not leftW); drop the `│`-joined preview on rows where the list line is long. Simplest compliant approach: render list rows as `truncateToWidth(prefix + optionLines[idx], width)` on their OWN lines (no right-side preview on those rows), and render the preview block BELOW the list, separated by a divider. Implement that stacked layout instead:
  ```
  Jump to pi session
  > query
  ──────────
  → ● name │ target │ cwd │ age
    ○ ...
  ──────────
  (up to PREVIEW_LINES preview lines, truncateToWidth each to width)
  n/m  ↑↓ navigate  ⏎ jump  esc cancel
  ```
  This also matches the current v1.3 stacked look. Adjust render accordingly; all tests above are layout-agnostic (they check containment, not columns).
- If `@earendil-works/pi-tui` has no exported `Key.ctrlC`, use `matchesKey(data, "ctrl+c")` form — check the package's Key API via `grep` in node_modules or the pi-tui docs at /opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/tui.md (Keyboard Input section). Document what you used.

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all PASS (55 existing + 14 new), tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/overlay.ts tests/overlay.test.ts pi-types.d.ts
git commit -m "feat: JumpOverlay component with fuzzy filter and preview"
```

---

### Task 4: index.ts wiring + verification

**Files:**
- Modify: `index.ts`, `package.json` (peerDependencies), `pi-types.d.ts` (if `ui.custom` missing from stub)

**Interfaces:**
- Consumes: `JumpOverlay` from src/overlay.ts.

- [ ] **Step 1: Wire** — in `index.ts` /jump handler, replace the `ctx.ui.select` block:

```typescript
const chosen = await ctx.ui.custom<DiscoveredEntry | null>((tui, _theme, _kb, done) => {
  return new JumpOverlay({
    entries,
    currentPaneId: selfCoords?.tmuxPaneId,
    fetchPreview: async (paneId) => {
      const r = await pi.exec("tmux", ["capture-pane", "-p", "-t", paneId, "-S", "-25"], { timeout: 2000 });
      return r.code === 0 ? r.stdout : "";
    },
    onDone: done,
    requestRender: () => tui.requestRender(),
  });
});
if (!chosen) return;
const target = chosen;
```

Remove `formatOptions` import if now unused in index.ts; keep the existing self-jump guard, switch-client call, and failure re-open loop (`continue`). If `ctx.ui.custom` is missing from pi-types.d.ts stub, extend the stub minimally (document in report).

- [ ] **Step 2: package.json** — add `"@earendil-works/pi-tui": "*"` to peerDependencies.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npx vitest run` → clean, all PASS.
Headless load: `echo "what is 2+2" | pi -e ./index.ts -p 2>&1 | tail -5` → no extension load errors (interactive overlay not exercisable headless — noted for user verification).

- [ ] **Step 4: Commit**

```bash
git add index.ts package.json pi-types.d.ts
git commit -m "feat: wire JumpOverlay into /jump"
```

---

## Self-Review

- Spec coverage: preview ✅ (T2+T3+T4), fuzzy ✅ (T1+T3), full tmux target ✅ (constraint + dedicated test + stacked layout note).
- Placeholders: none — all code complete; overlay render layout adjusted to stacked per constraint (tests are layout-agnostic).
- Type consistency: `JumpOverlayOptions`, `waitForPreview`, `fuzzyFilter(query, items, key)`, `cleanPreview(raw, maxLines?)` consistent across tasks.
- Risk noted for T3: pi-tui `Key` API surface — implementer verifies against installed package.
