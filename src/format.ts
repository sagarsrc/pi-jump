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
