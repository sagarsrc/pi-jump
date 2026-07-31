import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
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
