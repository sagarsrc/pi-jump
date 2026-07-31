---
title: "pi-jump-design"
experiment: 001-pi-extension
created: "2026-07-31 17:15 UTC"
---

# pi-jump — Design Spec

Jump between running `pi` sessions across tmux windows from inside any pi, replacing `Ctrl-B w` hunting.

## Scope (v1)

- `/jump` slash command + optional shortcut
- Picker listing all live pi sessions with tmux location
- Enter → `tmux switch-client` to that window
- Nothing else. Kill/new/rename/bookmarks = later.

## Problem

User runs multiple pi instances in tmux windows. Switching requires `Ctrl-B w` and visually scanning an unnamed window tree. No way to know which window holds which pi session.

## Architecture

Hybrid discovery: **self-registry (primary) + process scan (fallback)**.

```
pi instance A,B,C                pi-jump (in current pi)
   │ session_start                   │ /jump
   ▼                                 ▼
write entry ──► ~/.pi/agent/ ◄── read registry
(self-register)  tmux-registry.json     │
                                        ├─ prune dead panes (tmux list-panes)
                                        ├─ scan fallback for unregistered pi's
                                        ▼
                              ctx.ui.select picker
                                        ▼
                        tmux switch-client -t <session>:<window>
```

## Components

Single file: `~/.pi/agent/extensions/pi-jump.ts` (global, so every pi self-registers).

| Unit | Purpose |
|---|---|
| `register()` | On `session_start`: write/update entry in registry file |
| `discover()` | Read registry → prune entries whose tmux pane died → merge with process-scan results for unregistered pi's |
| `scan()` | `tmux list-panes -a` + pid/cwd correlation → find pi's without registry entries |
| `picker()` | `ctx.ui.select` list rendering |
| `jump()` | `tmux switch-client -t <session>:<window>` + `select-window` |

## Registry format

`~/.pi/agent/tmux-registry.json`:

```json
{
  "entries": [
    {
      "piSessionId": "019fb920-...",
      "title": "tmux switcher extension",
      "cwd": "/Users/sagar/work/pi-tmux-conf",
      "tmuxSession": "work",
      "tmuxWindow": "2",
      "tmuxPaneId": "%12",
      "pid": 48123,
      "lastSeen": "2026-07-31T17:00:00Z"
    }
  ]
}
```

- Tmux coordinates derived from `$TMUX` env var (`tmux display-message -p '#S #I #{pane_id}'` at registration).
- Pruning: entry dropped if `tmuxPaneId` no longer in `tmux list-panes -a` output.
- Concurrent writes: last-writer-wins JSON rewrite is acceptable at this scale (few pi instances, writes only on session_start).

## Process scan (fallback)

1. `tmux list-panes -a -F '#{session_name} #I #{pane_id} #{pane_pid}'`
2. For each pane pid, walk process tree for a `pi` process; get its cwd (`lsof -p` or `ps`)
3. cwd → `~/.pi/agent/sessions/<encoded-cwd>/` → newest `.jsonl` = active session
4. Entries found only via scan render with `○` and no title.

## Picker UX

```
╭─ Jump to pi session ──────────────── 3 active ─╮
│ ❯ ● pi-tmux-conf    tmux:work:2   "tmux switcher ext"  2m ago  │
│   ● api-refactor    tmux:work:4   "fix pagination"     40m ago │
│   ○ dotfiles        tmux:misc:1   (scan-detected)      3h ago  │
│   ↑↓ select   ⏎ jump   esc cancel                             │
╰────────────────────────────────────────────────────────────────╯
```

- Current session highlighted/excluded from jump targets.
- Sorted by last-active desc.

## Error handling

- Not inside tmux → notify "pi-jump requires tmux" and no-op.
- Registry file missing/corrupt → treat as empty, fall back to scan only.
- Target pane died between picker render and jump → tmux returns error → notify "session gone", re-open picker with fresh discovery.
- tmux binary missing → notify once, disable.

## Testing

- Manual: `pi -e ./pi-jump.ts` in a tmux window, open 2-3 pi instances, `/jump` between them.
- Edge: kill one pi's window, confirm entry pruned on next `/jump`.
- Edge: run a pi without extension loaded (scan fallback path).

## Deferred (v2+)

Kill session/pane, new session, rename, bookmarks, live preview pane, status widget, fuzzy filter.
