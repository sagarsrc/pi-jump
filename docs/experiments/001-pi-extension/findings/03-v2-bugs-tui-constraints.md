---
title: "v2-bugs-tui-constraints"
experiment: 001-pi-extension
created: "2026-07-31 17:15 UTC"
---

# v2.0.0 breakage — three pi TUI platform constraints (found via live tmux repro)

v2.0.0 shipped broken (user caught it). Unit tests (92) + headless load passed, but the interactive overlay was never driven before publish. Fixed in v2.0.1 after driving a real pi TUI via `tmux send-keys` + `capture-pane` against a scratch session.

## The three platform constraints (any pi extension with ui.custom should know)

1. **`pi.exec` never settles while a `ui.custom` component is open.** Promise pends forever (timeout ignored). Workaround: `child_process.execFile` directly.
2. **`tui.requestRender()` from a timer does NOT repaint.** Host calls `render()` again but the terminal doesn't update; only input events trigger visible repaints (verified: preview appeared only after a keypress; `requestRender(true)` didn't help). Consequence: anything async that completes after mount is effectively invisible → prefetch data BEFORE opening, keep the component synchronous.
3. **Inline custom components are mounted at their initial line count.** If `render()` later returns MORE lines, the extra lines are clipped/mis-rendered into scrollback (looks like duplicated frames). Consequence: render a CONSTANT number of lines from the first frame (blank-pad sections).

## Debugging technique that cracked it

- Scratch tmux window → `pi` → wait for idle (poll capture-pane for status bar) → type command char-by-char with sleeps → capture frames.
- Instrument installed copy under `~/.pi/agent/npm/node_modules/<pkg>` with `appendFileSync("/tmp/...log")` to trace constructor/timer/fetch/render inside the real host.
- Driving gotcha: typing while the agent is "Working..." gets queued as a PROMPT, not a command. Wait for idle; type "/" and text separately; verify palette shows the command before Enter.

## Process failure

Published v2.0.0 on unit tests alone. Checkpoint had flagged "interactive path not user-verified" — should have been a release gate. New rule: **any TUI-facing change requires tmux-driven live verification before npm publish.**

## Verification evidence (v2.0.1)

- Overlay opens with preview visible immediately (prefetch-all before `ui.custom`)
- Preview follows cursor (Down → selected pane's content)
- Fuzzy filter narrows ("media" → 1 entry)
- Enter → `switch-client` moved the real client tconf → work (observed via `tmux list-clients`)
- 96/96 unit tests, tsc clean, reviewer APPROVE
