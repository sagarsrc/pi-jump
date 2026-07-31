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
  const pretty =
    home && (cwd === home || cwd.startsWith(home + "/"))
      ? "~" + cwd.slice(home.length)
      : cwd;
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
