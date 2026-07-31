---
title: "pi-jump-impl"
experiment: 001-pi-extension
created: "2026-07-31 17:15 UTC"
---

# pi-jump Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pi extension that lists all live pi sessions across tmux windows and jumps to the chosen one via `/jump`.

**Architecture:** Single global extension file `index.ts` + testable pure modules under `src/`. Hybrid discovery: self-registry at `~/.pi/agent/tmux-registry.json` (primary) + process scan (fallback). Picker via `ctx.ui.select`, jump via `tmux switch-client -t session:window`.

**Tech Stack:** TypeScript (loaded by pi via jiti, no build), vitest for unit tests, tmux CLI, `ps`/`lsof` for process scan.

**Spec:** `docs/experiments/001-pi-extension/plans/01-pi-jump-design.md` (same repo).

## Global Constraints

- Registry file path is exactly `~/.pi/agent/tmux-registry.json`, format `{ "entries": JumpEntry[] }`.
- tmux formats use TAB separators (session names may contain spaces).
- `LIST_PANES_FORMAT` = `"#{session_name}\t#{window_index}\t#{pane_id}\t#{pane_pid}\t#{window_activity}"`
- `DISPLAY_FORMAT` = `"#S\t#I\t#{pane_id}"`
- pi appears in `ps` as a binary with `comm` exactly `pi` (verified on this machine).
- cwd of a pid via `lsof -a -p <pid> -d cwd -Fn` → line `n/path` (verified).
- Extension entry file must default-export a factory `(pi: ExtensionAPI) => void`.
- No new runtime dependencies. Dev deps only: `typescript`, `vitest`, `@types/node`.
- Verified Pi API: `pi.exec(cmd, args, {timeout})` → `{stdout, stderr, code, killed}`; `pi.registerCommand(name, {description, handler})`; `ctx.ui.select(title, string[])` → `string | undefined`; `ctx.ui.notify(msg, "info"|"error")`; `ctx.sessionManager.getSessionId()`; `ctx.cwd`; events `session_start`, `session_info_changed` (has `event.name`).

## File Structure

```
pi-tmux-conf/                     (repo root = extension package root)
├── package.json                  (type: module, scripts)
├── tsconfig.json
├── index.ts                      (extension entry — side effects, NOT unit tested)
├── src/
│   ├── registry.ts               (load/save/upsert/prune — pure + fs)
│   ├── tmux.ts                   (formats, parseListPanes, parseDisplayMessage, jumpTarget)
│   ├── ps.ts                     (parsePs, findPiDescendant, parseLsofCwd)
│   ├── discover.ts               (mergeEntries, sortByLastSeen, scanPaneToEntry)
│   └── format.ts                 (relativeTime, formatOption)
└── tests/
    ├── registry.test.ts
    ├── tmux.test.ts
    ├── ps.test.ts
    ├── discover.test.ts
    └── format.test.ts
```

---

### Task 1: Scaffold + registry module

**Files:**
- Create: `package.json`, `tsconfig.json`
- Create: `src/registry.ts`
- Test: `tests/registry.test.ts`

**Interfaces:**
- Produces (all later tasks consume):
```typescript
export interface JumpEntry {
  piSessionId: string;   // from ctx.sessionManager.getSessionId(), or "scan:<paneId>" for scan entries
  name?: string;         // session display name from /name
  cwd: string;
  tmuxSession: string;
  tmuxWindow: string;    // window index as string
  tmuxPaneId: string;    // e.g. "%6"
  pid: number;
  lastSeen: string;      // ISO 8601
}
export function loadRegistry(path: string): JumpEntry[]
export function saveRegistry(path: string, entries: JumpEntry[]): void
export function upsertEntry(entries: JumpEntry[], entry: JumpEntry): JumpEntry[]
export function pruneEntries(entries: JumpEntry[], livePaneIds: Set<string>): JumpEntry[]
```

- [ ] **Step 1: Scaffold**

`package.json`:
```json
{
  "name": "pi-jump",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "types": ["node"],
    "skipLibCheck": true
  },
  "include": ["index.ts", "src", "tests"]
}
```

Run: `npm install -D typescript vitest @types/node`

- [ ] **Step 2: Write failing test** `tests/registry.test.ts`:

```typescript
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadRegistry, saveRegistry, upsertEntry, pruneEntries, type JumpEntry } from "../src/registry";

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pi-jump-"));
  path = join(dir, "tmux-registry.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

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

describe("loadRegistry", () => {
  test("returns [] when file missing", () => {
    expect(loadRegistry(path)).toEqual([]);
  });
  test("returns [] when file is corrupt JSON", () => {
    writeFileSync(path, "not json{");
    expect(loadRegistry(path)).toEqual([]);
  });
  test("returns [] when entries is not an array", () => {
    writeFileSync(path, JSON.stringify({ entries: "nope" }));
    expect(loadRegistry(path)).toEqual([]);
  });
  test("drops malformed entries, keeps valid ones", () => {
    writeFileSync(path, JSON.stringify({ entries: [entry(), { bad: true }] }));
    expect(loadRegistry(path)).toEqual([entry()]);
  });
});

describe("saveRegistry", () => {
  test("creates parent dirs and writes { entries }", () => {
    const deep = join(dir, "a/b/reg.json");
    saveRegistry(deep, [entry()]);
    expect(JSON.parse(readFileSync(deep, "utf8"))).toEqual({ entries: [entry()] });
  });
  test("round-trips through loadRegistry", () => {
    saveRegistry(path, [entry(), entry({ piSessionId: "s2" })]);
    expect(loadRegistry(path)).toEqual([entry(), entry({ piSessionId: "s2" })]);
  });
});

describe("upsertEntry", () => {
  test("appends when piSessionId not present", () => {
    expect(upsertEntry([], entry())).toEqual([entry()]);
  });
  test("replaces existing entry with same piSessionId", () => {
    const old = entry({ name: "old" });
    const updated = entry({ name: "new", lastSeen: "2026-07-31T11:00:00.000Z" });
    expect(upsertEntry([old], updated)).toEqual([updated]);
  });
  test("does not mutate input array", () => {
    const input = [entry()];
    upsertEntry(input, entry({ piSessionId: "s2" }));
    expect(input).toHaveLength(1);
  });
});

describe("pruneEntries", () => {
  test("drops entries whose pane is dead", () => {
    const live = new Set(["%1"]);
    const result = pruneEntries([entry({ tmuxPaneId: "%1" }), entry({ piSessionId: "s2", tmuxPaneId: "%9" })], live);
    expect(result.map(e => e.piSessionId)).toEqual(["s1"]);
  });
});
```

- [ ] **Step 3: Run test, verify fail**

Run: `npx vitest run tests/registry.test.ts`
Expected: FAIL — module `../src/registry` does not exist.

- [ ] **Step 4: Implement** `src/registry.ts`:

```typescript
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { dirname } from "node:path";

export interface JumpEntry {
  piSessionId: string;
  name?: string;
  cwd: string;
  tmuxSession: string;
  tmuxWindow: string;
  tmuxPaneId: string;
  pid: number;
  lastSeen: string;
}

function isJumpEntry(e: unknown): e is JumpEntry {
  if (typeof e !== "object" || e === null) return false;
  const o = e as Record<string, unknown>;
  return (
    typeof o.piSessionId === "string" &&
    typeof o.cwd === "string" &&
    typeof o.tmuxSession === "string" &&
    typeof o.tmuxWindow === "string" &&
    typeof o.tmuxPaneId === "string" &&
    typeof o.pid === "number" &&
    typeof o.lastSeen === "string"
  );
}

export function loadRegistry(path: string): JumpEntry[] {
  try {
    const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof raw !== "object" || raw === null) return [];
    const entries = (raw as { entries?: unknown }).entries;
    if (!Array.isArray(entries)) return [];
    return entries.filter(isJumpEntry);
  } catch {
    return [];
  }
}

export function saveRegistry(path: string, entries: JumpEntry[]): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify({ entries }, null, 2));
  renameSync(tmp, path);
}

export function upsertEntry(entries: JumpEntry[], entry: JumpEntry): JumpEntry[] {
  const i = entries.findIndex((e) => e.piSessionId === entry.piSessionId);
  if (i === -1) return [...entries, entry];
  const next = entries.slice();
  next[i] = entry;
  return next;
}

export function pruneEntries(entries: JumpEntry[], livePaneIds: Set<string>): JumpEntry[] {
  return entries.filter((e) => livePaneIds.has(e.tmuxPaneId));
}
```

- [ ] **Step 5: Run test, verify pass**

Run: `npx vitest run tests/registry.test.ts`
Expected: all 9 PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json src/registry.ts tests/registry.test.ts
git commit -m "feat: registry module with load/save/upsert/prune"
```

---

### Task 2: tmux + ps parsing modules

**Files:**
- Create: `src/tmux.ts`, `src/ps.ts`
- Test: `tests/tmux.test.ts`, `tests/ps.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
```typescript
// src/tmux.ts
export const LIST_PANES_FORMAT = "#{session_name}\t#{window_index}\t#{pane_id}\t#{pane_pid}\t#{window_activity}";
export const DISPLAY_FORMAT = "#S\t#I\t#{pane_id}";
export interface PaneInfo { tmuxSession: string; tmuxWindow: string; tmuxPaneId: string; pid: number; activity: number; }
export function parseListPanes(output: string): PaneInfo[]
export function parseDisplayMessage(output: string): { tmuxSession: string; tmuxWindow: string; tmuxPaneId: string } | null
export function jumpTarget(e: { tmuxSession: string; tmuxWindow: string }): string

// src/ps.ts
export interface PsRow { pid: number; ppid: number; comm: string; }
export function parsePs(output: string): PsRow[]
export function findPiDescendant(panePid: number, rows: PsRow[]): number | null
export function parseLsofCwd(output: string): string | null
```

- [ ] **Step 1: Write failing tests**

`tests/tmux.test.ts`:
```typescript
import { describe, test, expect } from "vitest";
import { parseListPanes, parseDisplayMessage, jumpTarget } from "../src/tmux";

describe("parseListPanes", () => {
  test("parses tab-separated panes", () => {
    const out = "work\t1\t%0\t2818\t1785517928\ntconf\t1\t%6\t40265\t1785519068\n";
    expect(parseListPanes(out)).toEqual([
      { tmuxSession: "work", tmuxWindow: "1", tmuxPaneId: "%0", pid: 2818, activity: 1785517928 },
      { tmuxSession: "tconf", tmuxWindow: "1", tmuxPaneId: "%6", pid: 40265, activity: 1785519068 },
    ]);
  });
  test("handles session names with spaces", () => {
    const out = "my session\t2\t%12\t999\t1785517000\n";
    expect(parseListPanes(out)[0].tmuxSession).toBe("my session");
  });
  test("skips blank and malformed lines", () => {
    expect(parseListPanes("\n\nbad\tline\n")).toEqual([]);
  });
});

describe("parseDisplayMessage", () => {
  test("parses coords", () => {
    expect(parseDisplayMessage("tconf\t1\t%6\n")).toEqual({ tmuxSession: "tconf", tmuxWindow: "1", tmuxPaneId: "%6" });
  });
  test("returns null on garbage", () => {
    expect(parseDisplayMessage("oops\n")).toBeNull();
    expect(parseDisplayMessage("")).toBeNull();
  });
});

describe("jumpTarget", () => {
  test("joins session and window", () => {
    expect(jumpTarget({ tmuxSession: "work", tmuxWindow: "2" })).toBe("work:2");
  });
});
```

`tests/ps.test.ts`:
```typescript
import { describe, test, expect } from "vitest";
import { parsePs, findPiDescendant, parseLsofCwd } from "../src/ps";

describe("parsePs", () => {
  test("parses pid/ppid/comm columns, skips header", () => {
    const out = "  PID  PPID COMM\n40265  2561 -zsh\n41049 40265 pi\n";
    expect(parsePs(out)).toEqual([
      { pid: 40265, ppid: 2561, comm: "-zsh" },
      { pid: 41049, ppid: 40265, comm: "pi" },
    ]);
  });
});

describe("findPiDescendant", () => {
  const rows = [
    { pid: 100, ppid: 1, comm: "-zsh" },     // pane shell
    { pid: 200, ppid: 100, comm: "node" },   // unrelated child
    { pid: 300, ppid: 200, comm: "pi" },     // pi grandchild
    { pid: 400, ppid: 300, comm: "rg" },     // pi's own child — must not match as separate result
  ];
  test("finds pi at any depth below pane pid", () => {
    expect(findPiDescendant(100, rows)).toBe(300);
  });
  test("returns null when no pi below pane", () => {
    expect(findPiDescendant(999, rows)).toBeNull();
    expect(findPiDescendant(300, rows)).toBeNull(); // pi itself is not its own descendant
  });
});

describe("parseLsofCwd", () => {
  test("extracts path from n/ line", () => {
    expect(parseLsofCwd("p41049\nfcwd\nn/Users/sagar/work/pi-tmux-conf\n")).toBe("/Users/sagar/work/pi-tmux-conf");
  });
  test("returns null without n line", () => {
    expect(parseLsofCwd("p41049\n")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests, verify fail**

Run: `npx vitest run tests/tmux.test.ts tests/ps.test.ts`
Expected: FAIL — modules don't exist.

- [ ] **Step 3: Implement**

`src/tmux.ts`:
```typescript
export const LIST_PANES_FORMAT =
  "#{session_name}\t#{window_index}\t#{pane_id}\t#{pane_pid}\t#{window_activity}";
export const DISPLAY_FORMAT = "#S\t#I\t#{pane_id}";

export interface PaneInfo {
  tmuxSession: string;
  tmuxWindow: string;
  tmuxPaneId: string;
  pid: number;
  activity: number; // unix seconds
}

export function parseListPanes(output: string): PaneInfo[] {
  const panes: PaneInfo[] = [];
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    if (parts.length !== 5) continue;
    const [tmuxSession, tmuxWindow, tmuxPaneId, pidStr, actStr] = parts;
    const pid = Number(pidStr);
    const activity = Number(actStr);
    if (!tmuxSession || !tmuxWindow || !tmuxPaneId || !Number.isFinite(pid) || !Number.isFinite(activity)) continue;
    panes.push({ tmuxSession, tmuxWindow, tmuxPaneId, pid, activity });
  }
  return panes;
}

export function parseDisplayMessage(
  output: string
): { tmuxSession: string; tmuxWindow: string; tmuxPaneId: string } | null {
  const parts = output.trim().split("\t");
  if (parts.length !== 3) return null;
  const [tmuxSession, tmuxWindow, tmuxPaneId] = parts;
  if (!tmuxSession || !tmuxWindow || !tmuxPaneId) return null;
  return { tmuxSession, tmuxWindow, tmuxPaneId };
}

export function jumpTarget(e: { tmuxSession: string; tmuxWindow: string }): string {
  return `${e.tmuxSession}:${e.tmuxWindow}`;
}
```

`src/ps.ts`:
```typescript
export interface PsRow {
  pid: number;
  ppid: number;
  comm: string;
}

export function parsePs(output: string): PsRow[] {
  const lines = output.split("\n").slice(1); // drop header
  const rows: PsRow[] = [];
  for (const line of lines) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)/);
    if (!m) continue;
    rows.push({ pid: Number(m[1]), ppid: Number(m[2]), comm: m[3] });
  }
  return rows;
}

export function findPiDescendant(panePid: number, rows: PsRow[]): number | null {
  const byParent = new Map<number, PsRow[]>();
  for (const r of rows) {
    const list = byParent.get(r.ppid) ?? [];
    list.push(r);
    byParent.set(r.ppid, list);
  }
  const queue = [...(byParent.get(panePid) ?? [])];
  while (queue.length > 0) {
    const row = queue.shift()!;
    if (row.comm === "pi") return row.pid;
    queue.push(...(byParent.get(row.pid) ?? []));
  }
  return null;
}

export function parseLsofCwd(output: string): string | null {
  for (const line of output.split("\n")) {
    if (line.startsWith("n/")) return line.slice(1);
  }
  return null;
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npx vitest run tests/tmux.test.ts tests/ps.test.ts`
Expected: all 9 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tmux.ts src/ps.ts tests/tmux.test.ts tests/ps.test.ts
git commit -m "feat: tmux and ps parsing modules"
```

---

### Task 3: discover + format modules

**Files:**
- Create: `src/discover.ts`, `src/format.ts`
- Test: `tests/discover.test.ts`, `tests/format.test.ts`

**Interfaces:**
- Consumes: `JumpEntry` from `src/registry.ts`, `PaneInfo` from `src/tmux.ts`.
- Produces:
```typescript
// src/discover.ts
export interface DiscoveredEntry extends JumpEntry { source: "registry" | "scan"; }
export function mergeEntries(registry: JumpEntry[], scanned: JumpEntry[]): DiscoveredEntry[]
export function sortByLastSeen<T extends { lastSeen: string }>(entries: T[]): T[]
export function scanPaneToEntry(pane: PaneInfo, piPid: number, cwd: string): JumpEntry

// src/format.ts
export function relativeTime(iso: string, now?: Date): string
export function formatOption(e: DiscoveredEntry): string
```

- [ ] **Step 1: Write failing tests**

`tests/discover.test.ts`:
```typescript
import { describe, test, expect } from "vitest";
import { mergeEntries, sortByLastSeen, scanPaneToEntry } from "../src/discover";
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
```

`tests/format.test.ts`:
```typescript
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
    expect(formatOption({ ...base, name: "api work" })).toBe("● api work  tmux:work:2  2m ago");
  });
  test("scan entry shows hollow dot and project dir basename", () => {
    expect(formatOption({ ...base, source: "scan" })).toBe("○ a  tmux:work:2  2m ago");
  });
  test("registry entry without name falls back to cwd basename", () => {
    expect(formatOption(base)).toBe("● a  tmux:work:2  2m ago");
  });
});
```

Note: formatOption test depends on `now` — implement `formatOption(e, now?: Date)` with `now` defaulting to `new Date()`, and pass `NOW` in tests: `formatOption({...}, NOW)`. Adjust test calls accordingly (implementer: add the `now` param to all three formatOption assertions).

- [ ] **Step 2: Run tests, verify fail**

Run: `npx vitest run tests/discover.test.ts tests/format.test.ts`
Expected: FAIL — modules don't exist.

- [ ] **Step 3: Implement**

`src/discover.ts`:
```typescript
import type { JumpEntry } from "./registry";
import type { PaneInfo } from "./tmux";

export interface DiscoveredEntry extends JumpEntry {
  source: "registry" | "scan";
}

export function mergeEntries(registry: JumpEntry[], scanned: JumpEntry[]): DiscoveredEntry[] {
  const registeredPanes = new Set(registry.map((e) => e.tmuxPaneId));
  return [
    ...registry.map((e) => ({ ...e, source: "registry" as const })),
    ...scanned
      .filter((e) => !registeredPanes.has(e.tmuxPaneId))
      .map((e) => ({ ...e, source: "scan" as const })),
  ];
}

export function sortByLastSeen<T extends { lastSeen: string }>(entries: T[]): T[] {
  return [...entries].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
}

export function scanPaneToEntry(pane: PaneInfo, piPid: number, cwd: string): JumpEntry {
  return {
    piSessionId: `scan:${pane.tmuxPaneId}`,
    cwd,
    tmuxSession: pane.tmuxSession,
    tmuxWindow: pane.tmuxWindow,
    tmuxPaneId: pane.tmuxPaneId,
    pid: piPid,
    lastSeen: new Date(pane.activity * 1000).toISOString(),
  };
}
```

`src/format.ts`:
```typescript
import { basename } from "node:path";
import type { DiscoveredEntry } from "./discover";

export function relativeTime(iso: string, now: Date = new Date()): string {
  const s = Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function formatOption(e: DiscoveredEntry, now: Date = new Date()): string {
  const dot = e.source === "registry" ? "●" : "○";
  const label = e.name ?? basename(e.cwd);
  return `${dot} ${label}  tmux:${e.tmuxSession}:${e.tmuxWindow}  ${relativeTime(e.lastSeen, now)}`;
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npx vitest run`
Expected: all tests PASS (Task 1 + 2 + 3 suites).

- [ ] **Step 5: Commit**

```bash
git add src/discover.ts src/format.ts tests/discover.test.ts tests/format.test.ts
git commit -m "feat: discover and format modules"
```

---

### Task 4: extension entry wiring

**Files:**
- Create: `index.ts`
- No unit tests (side-effect wiring; verified by headless load + typecheck).

**Interfaces:**
- Consumes: everything from Tasks 1-3. Registry path constant: `join(homedir(), ".pi", "agent", "tmux-registry.json")`.

- [ ] **Step 1: Implement** `index.ts`:

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  loadRegistry,
  saveRegistry,
  upsertEntry,
  pruneEntries,
  type JumpEntry,
} from "./src/registry";
import {
  LIST_PANES_FORMAT,
  DISPLAY_FORMAT,
  parseListPanes,
  parseDisplayMessage,
  jumpTarget,
} from "./src/tmux";
import { parsePs, findPiDescendant, parseLsofCwd } from "./src/ps";
import { mergeEntries, sortByLastSeen, scanPaneToEntry } from "./src/discover";
import { formatOption } from "./src/format";

const REGISTRY_PATH = join(homedir(), ".pi", "agent", "tmux-registry.json");

export default function (pi: ExtensionAPI) {
  async function selfRegister(ctx: { sessionManager: { getSessionId(): string }; cwd: string }, name?: string) {
    if (!process.env.TMUX) return;
    const r = await pi.exec("tmux", ["display-message", "-p", DISPLAY_FORMAT], { timeout: 3000 });
    const coords = parseDisplayMessage(r.stdout);
    if (!coords) return;
    const entries = loadRegistry(REGISTRY_PATH);
    const existing = entries.find((e) => e.piSessionId === ctx.sessionManager.getSessionId());
    const entry: JumpEntry = {
      piSessionId: ctx.sessionManager.getSessionId(),
      name: name ?? existing?.name,
      cwd: ctx.cwd,
      ...coords,
      pid: process.pid,
      lastSeen: new Date().toISOString(),
    };
    saveRegistry(REGISTRY_PATH, upsertEntry(entries, entry));
  }

  pi.on("session_start", async (_event, ctx) => {
    await selfRegister(ctx);
  });

  pi.on("session_info_changed", async (event, ctx) => {
    await selfRegister(ctx, event.name);
  });

  pi.registerCommand("jump", {
    description: "Jump to another pi session running in tmux",
    handler: async (_args, ctx) => {
      if (!process.env.TMUX) {
        ctx.ui.notify("pi-jump: not inside tmux", "error");
        return;
      }

      const [panesR, selfR, psR] = await Promise.all([
        pi.exec("tmux", ["list-panes", "-a", "-F", LIST_PANES_FORMAT], { timeout: 5000 }),
        pi.exec("tmux", ["display-message", "-p", DISPLAY_FORMAT], { timeout: 3000 }),
        pi.exec("ps", ["-axo", "pid,ppid,comm"], { timeout: 5000 }),
      ]);
      const panes = parseListPanes(panesR.stdout);
      const livePaneIds = new Set(panes.map((p) => p.tmuxPaneId));
      const selfCoords = parseDisplayMessage(selfR.stdout);

      // Prune dead registry entries and persist the pruning.
      const registry = pruneEntries(loadRegistry(REGISTRY_PATH), livePaneIds);
      saveRegistry(REGISTRY_PATH, registry);

      // Scan fallback: panes with a pi process that never registered.
      const registeredPanes = new Set(registry.map((e) => e.tmuxPaneId));
      const rows = parsePs(psR.stdout);
      const scanned: JumpEntry[] = [];
      for (const pane of panes) {
        if (registeredPanes.has(pane.tmuxPaneId)) continue;
        const piPid = findPiDescendant(pane.pid, rows);
        if (piPid === null) continue;
        const lsofR = await pi.exec("lsof", ["-a", "-p", String(piPid), "-d", "cwd", "-Fn"], { timeout: 3000 });
        const cwd = parseLsofCwd(lsofR.stdout);
        if (!cwd) continue;
        scanned.push(scanPaneToEntry(pane, piPid, cwd));
      }

      const entries = sortByLastSeen(
        mergeEntries(registry, scanned).filter((e) => e.tmuxPaneId !== selfCoords?.tmuxPaneId)
      );

      if (entries.length === 0) {
        ctx.ui.notify("pi-jump: no other pi sessions found", "info");
        return;
      }

      const options = entries.map((e) => formatOption(e));
      const choice = await ctx.ui.select("Jump to pi session:", options);
      if (!choice) return;
      const target = entries[options.indexOf(choice)];

      const jumpR = await pi.exec("tmux", ["switch-client", "-t", jumpTarget(target)], { timeout: 3000 });
      if (jumpR.code !== 0) {
        ctx.ui.notify(`pi-jump: ${jumpR.stderr.trim() || "switch failed (session gone?)"}`, "error");
      }
    },
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean (ignore errors from `@earendil-works/pi-coding-agent` import resolution only if the package types are unavailable — if so, add `// @ts-expect-error` on the import line? NO — instead create `pi-types.d.ts` with `declare module "@earendil-works/pi-coding-agent";` and keep code unchanged. Record which was done in the report.)

- [ ] **Step 3: Full test suite still green**

Run: `npx vitest run`
Expected: all PASS.

- [ ] **Step 4: Headless load smoke test**

Run: `echo "what is 2+2" | pi -e ./index.ts -p 2>&1 | tail -20`
Expected: pi loads the extension with no extension load errors in output (a normal LLM answer is fine; any "failed to load extension" error is a FAILURE).

- [ ] **Step 5: Commit**

```bash
git add index.ts pi-types.d.ts 2>/dev/null || git add index.ts
git commit -m "feat: extension entry with self-register and /jump command"
```

---

### Task 5: global install + live verification

**Files:**
- Modify: none in repo. Copies into `~/.pi/agent/extensions/pi-jump/`.

- [ ] **Step 1: Install globally**

```bash
mkdir -p ~/.pi/agent/extensions/pi-jump
cp index.ts ~/.pi/agent/extensions/pi-jump/index.ts
cp -r src ~/.pi/agent/extensions/pi-jump/src
```

- [ ] **Step 2: Verify discovery by pi**

Run: `pi --verbose -e ~/.pi/agent/extensions/pi-jump/index.ts -p "say ok" 2>&1 | grep -i -E "extension|error" | head`
Expected: no load errors for pi-jump.

- [ ] **Step 3: Verify self-registration**

Run (from inside a tmux window, non-interactive check):
```bash
TMUX="$TMUX" pi -e ~/.pi/agent/extensions/pi-jump/index.ts -p "say ok" >/dev/null 2>&1
cat ~/.pi/agent/tmux-registry.json
```
Expected: registry file exists with at least one entry containing correct `tmuxSession`, `tmuxWindow`, `tmuxPaneId`, `cwd`. NOTE: session_start fires in print mode only if extensions load there; if registry stays empty in print mode, verify instead that the code path is correct by unit-level inspection and document that interactive verification is deferred to the user typing `/reload` then `/jump` inside a pi session.

- [ ] **Step 4: Write verification note**

Append results to `docs/experiments/001-pi-extension/findings/02-pi-jump-verification.md` (create with the doc skill: `finding.sh 1 "pi-jump-verification"`).

- [ ] **Step 5: Commit**

```bash
git add docs/
git commit -m "docs: pi-jump verification results"
```

---

## Self-Review

- Spec coverage: registry ✅ (T1), scan ✅ (T2 ps/tmux + T3 scanPaneToEntry, wired T4), picker/jump ✅ (T4), error handling not-in-tmux/dead-pane ✅ (T4), testing ✅ (T1-T3 unit, T4 headless, T5 live).
- Placeholders: none — all code complete.
- Type consistency: `JumpEntry`, `PaneInfo`, `DiscoveredEntry`, `formatOption(e, now?)` consistent across tasks. T3 test note about `now` param is deliberate.
