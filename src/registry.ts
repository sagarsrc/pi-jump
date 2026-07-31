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
