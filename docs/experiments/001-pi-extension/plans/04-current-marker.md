---
title: "current-marker"
experiment: 001-pi-extension
created: "2026-07-31 17:15 UTC"
---

# pi-jump v1.2.0 Implementation Plan — current session marker

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Show the current pi session IN the `/jump` picker (first row, tagged `[current]`) so the user can orient; stop filtering it out.

**Architecture:** `formatOptions` gains an optional `currentPaneId` param — matching entry gets ` [current]` appended. index.ts stops excluding the current pane, orders it first, and short-circuits a jump-to-self with a notify.

**Prior art:** v1.1.1 at main. format.ts has `formatOptions(entries, now?)`; index.ts excludes self via `.filter((e) => e.tmuxPaneId !== selfCoords?.tmuxPaneId)`.

## Global Constraints

- Marker text exactly ` [current]` (leading space), appended after the age column.
- Current entry always row 1, regardless of lastSeen.
- Jump-to-self: do NOT call tmux; `ctx.ui.notify("pi-jump: already here", "info")` and return.
- Column alignment must not be affected by the marker (marker is outside the padded columns, appended at end).
- Existing tests must keep passing; formatOptions signature change is backward-compatible (new optional 3rd param).

---

### Task 1: current-marker (format + wiring, TDD)

**Files:**
- Modify: `src/format.ts`
- Modify: `index.ts`
- Test: `tests/format.test.ts`

**Interfaces:**
- Produces:
```typescript
export function formatOptions(entries: DiscoveredEntry[], now?: Date, currentPaneId?: string): string[]
```
- index.ts consumes: unchanged pipeline minus self-exclusion filter; new order + self-jump guard.

- [ ] **Step 1: Write failing tests** — append to `tests/format.test.ts`:

```typescript
describe("formatOptions currentPaneId", () => {
  test("entry matching currentPaneId gets [current] suffix", () => {
    const [line] = formatOptions([entry({ name: "here" })], NOW, "%2");
    expect(line).toBe("● here │ work:2 │ 2m ago [current]");
  });
  test("non-matching entries get no suffix", () => {
    const [line] = formatOptions([entry({ name: "there" })], NOW, "%99");
    expect(line).toBe("● there │ work:2 │ 2m ago");
  });
  test("omitted currentPaneId marks nothing", () => {
    const [line] = formatOptions([entry({ name: "plain" })], NOW);
    expect(line.endsWith("[current]")).toBe(false);
  });
  test("marker does not shift column alignment of other rows", () => {
    const lines = formatOptions(
      [
        entry({ name: "cur" }),
        entry({ piSessionId: "s2", tmuxPaneId: "%3", name: "other" }),
      ],
      NOW,
      "%2"
    );
    // both lines share identical text up to end of age column
    const ageColEnd = (l: string) => l.indexOf("2m ago") + "2m ago".length;
    expect(lines[0].slice(0, ageColEnd(lines[0]))).toBe("● cur   │ work:2 │ 2m ago");
    expect(lines[1].slice(0, ageColEnd(lines[1]))).toBe("● other │ work:2 │ 2m ago");
    expect(lines[0].endsWith(" [current]")).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests, verify fail**

Run: `npx vitest run tests/format.test.ts`
Expected: 4 new tests FAIL (no suffix produced).

- [ ] **Step 3: Implement**

In `src/format.ts`, change signature and row mapping:

```typescript
export function formatOptions(
  entries: DiscoveredEntry[],
  now: Date = new Date(),
  currentPaneId?: string
): string[] {
  if (entries.length === 0) return [];
  const rows = entries.map((e) => ({
    dot: e.source === "registry" ? "●" : "○",
    name: truncate(e.name ?? basename(e.cwd), MAX_NAME),
    target: `${e.tmuxSession}:${e.tmuxWindow}`,
    age: relativeTime(e.lastSeen, now),
    current: currentPaneId !== undefined && e.tmuxPaneId === currentPaneId,
  }));
  const nameW = Math.max(...rows.map((r) => r.name.length));
  const targetW = Math.max(...rows.map((r) => r.target.length));
  const ageW = Math.max(...rows.map((r) => r.age.length));
  return rows.map(
    (r) =>
      `${r.dot} ${r.name.padEnd(nameW)} │ ${r.target.padStart(targetW)} │ ${r.age.padStart(ageW)}${r.current ? " [current]" : ""}`
  );
}
```

In `index.ts` `/jump` handler:
1. Replace:
```typescript
const entries = sortByLastSeen(
  dedupeByPane(mergeEntries(registry, scanned)).filter((e) => e.tmuxPaneId !== selfCoords?.tmuxPaneId)
);
```
with:
```typescript
const sorted = sortByLastSeen(dedupeByPane(mergeEntries(registry, scanned)));
// Current session first so the user can orient.
const entries = [
  ...sorted.filter((e) => e.tmuxPaneId === selfCoords?.tmuxPaneId),
  ...sorted.filter((e) => e.tmuxPaneId !== selfCoords?.tmuxPaneId),
];
```
2. Replace `const options = formatOptions(entries);` with:
```typescript
const options = formatOptions(entries, new Date(), selfCoords?.tmuxPaneId);
```
3. Update the empty-list notify text: `pi-jump: no other pi sessions found` → `pi-jump: no pi sessions found` (current session now counts).
4. Before the switch-client call, add self-jump guard:
```typescript
if (target.tmuxPaneId === selfCoords?.tmuxPaneId) {
  ctx.ui.notify("pi-jump: already here", "info");
  return;
}
```

- [ ] **Step 4: Run tests + typecheck, verify pass**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean, all PASS (43 existing + 4 new = 47).

- [ ] **Step 5: Commit**

```bash
git add src/format.ts index.ts tests/format.test.ts
git commit -m "feat: show current session in picker with [current] marker"
```

- [ ] **Step 6: Live verification**

```bash
cp index.ts ~/.pi/agent/extensions/pi-jump/index.ts 2>/dev/null
cp src/format.ts ~/.pi/agent/extensions/pi-jump/src/ 2>/dev/null
npm test 2>&1 | grep Tests
```
(Interactive picker verified by user via /reload + /jump; unit tests cover the format logic.)

---

## Self-Review

- Spec coverage: current shown ✅, first row ✅, marker ✅, self-jump guard ✅, alignment preserved ✅ (test 4).
- Placeholders: none.
- Type consistency: formatOptions 3rd param optional — index.ts and tests match.
- options↔entries index mapping invariant: formatOptions maps 1:1 in order — reordering happens on entries BEFORE formatting — invariant holds.
