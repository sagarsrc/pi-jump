---
title: "pi-jump-verification"
experiment: 001-pi-extension
created: "2026-07-31 17:15 UTC"
---

# pi-jump Verification Results

## Unit / static

- `npx vitest run` → **35/35 pass** (5 suites: registry 10, tmux 5, ps 8, discover 4, format 8)
- `npx tsc --noEmit` → clean (with `pi-types.d.ts` stub for `@earendil-works/pi-coding-agent`)

## Headless load

- `echo "what is 2+2" | pi -e ./index.ts -p` → extension loads, no load errors, answers "4."

## Live (inside tmux session "tconf")

- Installed at `~/.pi/agent/extensions/pi-jump/` (index.ts + src/)
- `pi -e ~/.pi/agent/extensions/pi-jump/index.ts -p "say ok"` → `~/.pi/agent/tmux-registry.json` created with valid entry: tmuxSession `tconf`, tmuxWindow `1`, tmuxPaneId matching `$TMUX_PANE`, correct cwd. Works from any cwd (tested /tmp).
- Registry self-populates: every pi instance (including subagents) with the extension installed writes its entry on session_start; entries prune on next /jump when panes die.

## Bugs caught by review + live verification (all fixed)

1. `tmux display-message -p` untargeted → reported client active pane (%6) not running pane (%9). Fix: `-t $TMUX_PANE` (commit 4f55038).
2. Registry wipe risk: prune+save ran even when `tmux list-panes` failed (code≠0, empty stdout) → would delete all entries. Fix: gate on `panesR.code === 0` (commit 0459221).
3. Unhandled rejections if tmux binary missing → try/catch both handlers (0459221).
4. Dead-target jump now re-opens picker with fresh discovery (0459221).
5. Cleared session name (`/name` unset) now clears registry name (0459221).
6. `findPiDescendant` BFS cycle guard (987f64b).

## Known deferred minors (non-blocking)

- `switch-client` without `-c` client flag — fine single-client, untested multi-client
- `options.indexOf(choice)` ambiguous if two entries format identically (same target anyway → harmless)
- `pi-types.d.ts` hand-stub may drift from real package types
- Multi-socket tmux (multiple tmux servers) not supported — prune uses default socket
- Scan-fallback `lastSeen` uses window-level activity, not pane-level
- Pi subagent instances also self-register → transient noise entries (auto-pruned when pane dies)

## Interactive verification still owed by user

Type `/reload` in a running pi session, then `/jump` — picker should list live pi sessions; Enter switches the tmux client to that session:window.
