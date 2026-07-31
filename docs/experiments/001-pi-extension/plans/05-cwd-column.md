---
title: "cwd-column"
experiment: 001-pi-extension
created: "2026-07-31 17:15 UTC"
---

# pi-jump v1.3.0 Implementation Plan — cwd column

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a cwd column to the `/jump` picker: `● name │ tmux:s:w │ cwd │ age [current]`.

**Architecture:** `formatOptions` gains a cwd column between target and age. cwd shortened: `$HOME` → `~`, then left-truncated with leading `…` to MAX_CWD = 40 chars.

**Prior art:** v1.2.0 at main. format.ts `formatOptions(entries, now?, currentPaneId?)` renders `{dot} {name} │ {target} │ {age}{current?}`.

## Global Constraints

- Column order exactly: `{dot} {name padded} │ {target right-aligned} │ {cwd left-aligned} │ {age right-aligned}{ [current]?}`
- cwd shortening: replace leading `$HOME` with `~`; if still > 40 chars, keep the LAST 39 chars prefixed with `…` (left-truncate — the tail is the distinguishing part).
- All columns padded to their own max width; marker still last, outside columns.
- Backward compatible signature (no new params).

---

### Task 1: cwd column (TDD)

**Files:**
- Modify: `src/format.ts`
- Test: `tests/format.test.ts`

**Interfaces:**
- Produces: `export function shortenCwd(cwd: string, home: string): string` (new export, pure)
- `formatOptions` signature unchanged.

- [ ] **Step 1: Write failing tests** — append to `tests/format.test.ts`:

```typescript
import { shortenCwd } from "../src/format";

describe("shortenCwd", () => {
  test("replaces home prefix with ~", () => {
    expect(shortenCwd("/Users/sagar/work/api", "/Users/sagar")).toBe("~/work/api");
  });
  test("leaves non-home paths unchanged", () => {
    expect(shortenCwd("/opt/tools/x", "/Users/sagar")).toBe("/opt/tools/x");
  });
  test("left-truncates long paths keeping the tail", () => {
    const long = "/very/long/" + "segment/".repeat(10) + "tail";
    const out = shortenCwd(long, "/Users/sagar");
    expect(out.length).toBe(40);
    expect(out.startsWith("…")).toBe(true);
    expect(out.endsWith("tail")).toBe(true);
  });
  test("exactly 40 chars after ~ substitution is not truncated", () => {
    const cwd = "~/".padEnd(40, "x");
    expect(shortenCwd(cwd, "/Users/sagar")).toBe(cwd);
  });
});

describe("formatOptions cwd column", () => {
  test("renders cwd between target and age", () => {
    const [line] = formatOptions([entry({ name: "api", cwd: process.env.HOME + "/work/api" })], NOW);
    expect(line).toBe("● api │ work:2 │ ~/work/api │ 2m ago");
  });
  test("cwd column padded to longest cwd, marker still last", () => {
    const lines = formatOptions(
      [
        entry({ name: "a", cwd: "/tmp" }),
        entry({ piSessionId: "s2", tmuxPaneId: "%3", name: "b", cwd: process.env.HOME + "/work/pi-tmux-conf" }),
      ],
      NOW,
      "%3"
    );
    expect(lines[0]).toBe("● a │ work:2 │ /tmp                 │ 2m ago");
    expect(lines[1]).toBe("● b │ work:2 │ ~/work/pi-tmux-conf │ 2m ago [current]");
  });
});
```

- [ ] **Step 2: Run tests, verify fail**

Run: `npx vitest run tests/format.test.ts`
Expected: new tests FAIL (shortenCwd missing; no cwd column).

- [ ] **Step 3: Implement** `src/format.ts` (full file after change):

```typescript
import { basename } from "node:path";
import { homedir } from "node:os";
import type { DiscoveredEntry } from "./discover";

const MAX_NAME = 32;
const MAX_CWD = 40;

export function relativeTime(iso: string, now: Date = new Date()): string {
  const s = Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

export function shortenCwd(cwd: string, home: string): string {
  const pretty = home && cwd.startsWith(home) ? "~" + cwd.slice(home.length) : cwd;
  if (pretty.length <= MAX_CWD) return pretty;
  return "…" + pretty.slice(pretty.length - (MAX_CWD - 1));
}

export function formatOptions(
  entries: DiscoveredEntry[],
  now: Date = new Date(),
  currentPaneId?: string
): string[] {
  if (entries.length === 0) return [];
  const home = homedir();
  const rows = entries.map((e) => ({
    dot: e.source === "registry" ? "●" : "○",
    name: truncate(e.name ?? basename(e.cwd), MAX_NAME),
    target: `${e.tmuxSession}:${e.tmuxWindow}`,
    cwd: shortenCwd(e.cwd, home),
    age: relativeTime(e.lastSeen, now),
    current: currentPaneId !== undefined && e.tmuxPaneId === currentPaneId,
  }));
  const nameW = Math.max(...rows.map((r) => r.name.length));
  const targetW = Math.max(...rows.map((r) => r.target.length));
  const cwdW = Math.max(...rows.map((r) => r.cwd.length));
  const ageW = Math.max(...rows.map((r) => r.age.length));
  return rows.map(
    (r) =>
      `${r.dot} ${r.name.padEnd(nameW)} │ ${r.target.padStart(targetW)} │ ${r.cwd.padEnd(cwdW)} │ ${r.age.padStart(ageW)}${r.current ? " [current]" : ""}`
  );
}
```

NOTE for implementer: the test "renders cwd between target and age" and "padded" test use `process.env.HOME` — `homedir()` equals it on macOS. If a padded-test expectation is off by padding, trust the implementation's alignment math and fix the expected string, documenting the correction in your report.

- [ ] **Step 4: Run tests + typecheck**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean, all PASS (47 + 6 new = 53).

- [ ] **Step 5: Commit**

```bash
git add src/format.ts tests/format.test.ts
git commit -m "feat: cwd column in picker"
```

---

## Self-Review

- Coverage: cwd column ✅, shortening ✅, alignment ✅, marker unaffected ✅.
- Placeholders: none.
- Consistency: formatOptions signature unchanged; index.ts untouched.
