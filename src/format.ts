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
