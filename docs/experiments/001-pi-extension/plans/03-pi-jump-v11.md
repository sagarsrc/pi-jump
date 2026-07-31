---
title: "pi-jump-v1.1"
experiment: 001-pi-extension
created: "2026-07-31 17:15 UTC"
---

# pi-jump v1.1 Implementation Plan — picker polish + noise fixes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Fix picker noise (headless subagent self-registration, duplicate panes) and render aligned columns in the `/jump` picker.

**Architecture:** Three small changes to existing modules: (A) TTY guard skips self-registration for headless `pi -p` / subagents, (B) dedupe entries by tmuxPaneId keeping latest, (C) `formatOptions` renders padded columns with `│` separators.

**Tech Stack:** existing — TypeScript, vitest, tmux.

**Prior art:** v1 merged at commit 6ee0474; code at repo root (`index.ts`, `src/`, `tests/`). Design: `plans/01-pi-jump-design.md`.

## Global Constraints

- Column format exactly: `{dot} {name padded} │ {target right-aligned} │ {age right-aligned}` — dot+space, single `│` separators with one space each side.
- Name truncated with `…` at MAX_NAME = 32 chars (truncate to 31 + `…`).
- No ANSI colors (ui.select renders plain strings).
- `formatOption` (singular) is REPLACED by `formatOptions` (plural) — update all usages and tests.
- TTY guard: headless pi (`pi -p`, subagents) must NOT self-register. Rationale: they inherit parent's TMUX_PANE → duplicate/noise entries (observed live: `general-purpose#f83386ca`).
- ISO lastSeen strings compare lexicographically (all writers use `toISOString()`).

## File Structure

```
src/guard.ts        NEW  — shouldSelfRegister
src/discover.ts     MOD  — add dedupeByPane
src/format.ts       MOD  — replace formatOption with formatOptions
index.ts            MOD  — TTY guard + dedupe + formatOptions wiring
tests/guard.test.ts     NEW
tests/discover.test.ts  MOD  — add dedupe tests
tests/format.test.ts    MOD  — rewrite for formatOptions
```

---

### Task 1: guard + dedupe + column formatting (pure modules, TDD)

**Files:**
- Create: `src/guard.ts`, `tests/guard.test.ts`
- Modify: `src/discover.ts`, `src/format.ts`
- Modify: `tests/discover.test.ts`, `tests/format.test.ts`

**Interfaces:**
- Produces:
```typescript
// src/guard.ts
export function shouldSelfRegister(isTTY: boolean, tmuxEnv: string | undefined): boolean

// src/discover.ts (added)
export function dedupeByPane<T extends { tmuxPaneId: string; lastSeen: string }>(entries: T[]): T[]

// src/format.ts (replaces formatOption)
export function formatOptions(entries: DiscoveredEntry[], now?: Date): string[]
export function relativeTime(iso: string, now?: Date): string  // unchanged
```

- [ ] **Step 1: Write failing tests**

`tests/guard.test.ts`:
```typescript
import { describe, test, expect } from "vitest";
import { shouldSelfRegister } from "../src/guard";

describe("shouldSelfRegister", () => {
  test("interactive pi inside tmux registers", () => {
    expect(shouldSelfRegister(true, "tmux-env-value")).toBe(true);
  });
  test("headless pi (no tty) does not register", () => {
    expect(shouldSelfRegister(false, "tmux-env-value")).toBe(false);
  });
  test("interactive pi outside tmux does not register", () => {
    expect(shouldSelfRegister(true, undefined)).toBe(false);
  });
});
```

Append to `tests/discover.test.ts` (imports already exist there):
```typescript
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
```
(Add `dedupeByPane` to the discover import in that file.)

Rewrite `tests/format.test.ts`:
```typescript
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
    expect(lines[0]).toBe("● short            │   w:9 │ 20s ago");
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
```

- [ ] **Step 2: Run tests, verify fail**

Run: `npx vitest run tests/guard.test.ts tests/discover.test.ts tests/format.test.ts`
Expected: FAIL — guard module missing, dedupeByPane missing, formatOptions missing.

- [ ] **Step 3: Implement**

`src/guard.ts`:
```typescript
export function shouldSelfRegister(isTTY: boolean, tmuxEnv: string | undefined): boolean {
  return Boolean(tmuxEnv) && isTTY;
}
```

Append to `src/discover.ts`:
```typescript
export function dedupeByPane<T extends { tmuxPaneId: string; lastSeen: string }>(entries: T[]): T[] {
  const byPane = new Map<string, T>();
  for (const e of entries) {
    const existing = byPane.get(e.tmuxPaneId);
    if (!existing || e.lastSeen > existing.lastSeen) byPane.set(e.tmuxPaneId, e);
  }
  return [...byPane.values()];
}
```

Rewrite `src/format.ts`:
```typescript
import { basename } from "node:path";
import type { DiscoveredEntry } from "./discover";

const MAX_NAME = 32;

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

export function formatOptions(entries: DiscoveredEntry[], now: Date = new Date()): string[] {
  if (entries.length === 0) return [];
  const rows = entries.map((e) => ({
    dot: e.source === "registry" ? "●" : "○",
    name: truncate(e.name ?? basename(e.cwd), MAX_NAME),
    target: `${e.tmuxSession}:${e.tmuxWindow}`,
    age: relativeTime(e.lastSeen, now),
  }));
  const nameW = Math.max(...rows.map((r) => r.name.length));
  const targetW = Math.max(...rows.map((r) => r.target.length));
  const ageW = Math.max(...rows.map((r) => r.age.length));
  return rows.map(
    (r) => `${r.dot} ${r.name.padEnd(nameW)} │ ${r.target.padStart(targetW)} │ ${r.age.padStart(ageW)}`
  );
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npx vitest run`
Expected: all PASS except `index.ts`-adjacent nothing (index.ts still imports formatOption — typecheck will fail in Task 2; vitest doesn't typecheck index.ts so suite stays green).

- [ ] **Step 5: Commit**

```bash
git add src/guard.ts src/discover.ts src/format.ts tests/guard.test.ts tests/discover.test.ts tests/format.test.ts
git commit -m "feat: tty guard, pane dedupe, aligned picker columns"
```

---

### Task 2: index.ts wiring + live verification

**Files:**
- Modify: `index.ts`

**Interfaces:**
- Consumes: `shouldSelfRegister` (src/guard.ts), `dedupeByPane` (src/discover.ts), `formatOptions` (src/format.ts).

- [ ] **Step 1: Wire changes into index.ts**

Three edits:
1. Add imports: `shouldSelfRegister` from `./src/guard`, `dedupeByPane` added to the discover import; change `formatOption` import to `formatOptions` from `./src/format`.
2. In `selfRegister`, replace `if (!process.env.TMUX) return;` with:
```typescript
if (!shouldSelfRegister(Boolean(process.stdout.isTTY), process.env.TMUX)) return;
```
3. In the `/jump` handler, change the entries pipeline from:
```typescript
const entries = sortByLastSeen(
  mergeEntries(registry, scanned).filter((e) => e.tmuxPaneId !== selfCoords?.tmuxPaneId)
);
```
to:
```typescript
const entries = sortByLastSeen(
  dedupeByPane(mergeEntries(registry, scanned)).filter((e) => e.tmuxPaneId !== selfCoords?.tmuxPaneId)
);
```
and `entries.map((e) => formatOption(e))` → `formatOptions(entries)`.

- [ ] **Step 2: Typecheck + suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean, all PASS (35 existing + ~10 new).

- [ ] **Step 3: Commit**

```bash
git add index.ts
git commit -m "feat: wire tty guard, dedupe, column format into /jump"
```

- [ ] **Step 4: Live verification**

```bash
cp index.ts ~/.pi/agent/extensions/pi-jump/index.ts
cp src/guard.ts src/discover.ts src/format.ts ~/.pi/agent/extensions/pi-jump/src/
rm -f ~/.pi/agent/tmux-registry.json
# headless (piped) pi must NOT register:
pi -e ~/.pi/agent/extensions/pi-jump/index.ts -p "say ok" >/dev/null 2>&1
test ! -f ~/.pi/agent/tmux-registry.json && echo "PASS: headless did not register"
# pty pi MUST register (script allocates a tty):
script -q /dev/null pi -e ~/.pi/agent/extensions/pi-jump/index.ts -p "say ok" >/dev/null 2>&1
cat ~/.pi/agent/tmux-registry.json   # expect 1 entry, tmuxPaneId == $TMUX_PANE
```
Expected: headless run leaves registry absent; pty run writes exactly one entry.

- [ ] **Step 5: Commit verification note** — skip (controller writes docs).

---

## Self-Review

- Spec coverage: A (TTY guard) ✅ T1+T2, B (dedupe) ✅ T1+T2, C (columns) ✅ T1+T2.
- Placeholders: none — all code complete.
- Type consistency: `formatOptions(entries, now?)`, `dedupeByPane`, `shouldSelfRegister` match between tasks.
- D (current-project marker): deliberately cut — YAGNI, revisit if user runs same repo in many windows.
