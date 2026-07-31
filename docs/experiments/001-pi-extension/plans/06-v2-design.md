---
title: "v2-design"
experiment: 001-pi-extension
created: "2026-07-31 17:15 UTC"
---

# pi-jump v2.0 Design — preview + fuzzy filter

Approved by user 2026-08-01 ("i trust you"), with constraint: **tmux session name always full, never compressed.**

## Scope

1. **Live preview pane** — picker shows `tmux capture-pane` tail of the highlighted session's pane, right side of the list. Refreshes on cursor move (150ms debounce).
2. **Fuzzy filter** — type to narrow list (subsequence match, ranked).

Explicitly OUT (user rejected #6 shortcut; deferred): kill/new session, footer widget, LLM tool, busy indicator.

## UX

```
  Jump to pi session
  > api█
  ──────────────────────────┬──────────────────────
  → ● api-refactor  │ w:3   │  $ npm run dev
    ○ chip8-emul…   │ h:2   │  ✓ vite compiled 412ms
    ○ cryptobot     │ f:1   │  ➜ localhost:5173
                            │
    1/3  ↑↓ navigate  ⏎ jump  esc cancel
```

- Left: existing column format (name │ tmux target │ cwd │ age, `[current]` marker). **tmux target column is never truncated.**
- Right: last ~20 lines of highlighted pane via `tmux capture-pane -p -t <paneId> -S -25`.
- Keys: printable chars append to filter, backspace deletes, ↑↓ navigate, ⏎ jump, esc/ctrl-c cancel.
- Empty filter = full list (today's behavior). List scrolls if > 10 rows.
- Fuzzy matches against `name-or-dir + tmux session name` so typing a tmux session name works.

## Architecture

`ctx.ui.select` replaced by `ctx.ui.custom` component (`JumpOverlay`, non-overlay mode — replaces editor area, same feel as current picker).

| Module | Responsibility | Testing |
|---|---|---|
| `src/fuzzy.ts` | subsequence scorer + ranked filter (pure) | unit |
| `src/preview.ts` | capture-pane text cleanup: drop trailing blanks, tail N lines (pure) | unit |
| `src/overlay.ts` | `JumpOverlay` component: render(width), handleInput, preview scheduling (debounce, stale-response guard) | headless unit (fake fetchPreview, injected requestRender) |
| `index.ts` | wire ui.custom, fetchPreview = pi.exec capture-pane | manual/pty |

## Data flow

```
/jump → discover (unchanged) → ui.custom(JumpOverlay)
                                    │ type → fuzzyFilter → render
                                    │ ↑↓   → schedulePreview (150ms debounce)
                                    │        → pi.exec capture-pane → lines → requestRender
                                    └ ⏎ → done(entry) → tmux switch-client (unchanged)
```

## Error handling

- Preview exec fails (pane died) → preview area shows "(no preview)"; list unaffected.
- Selection race: token counter — stale async preview responses discarded.
- Jump-to-self, dead-target re-open loop: unchanged from v1.2/1.3.
- Entry pane gone between open and jump: existing re-open loop covers.

## Constraints carried forward

- Registry path, hybrid discovery, dedupe, TTY guard — all unchanged.
- No ANSI hand-rolling beyond pi-tui helpers (`truncateToWidth`, `matchesKey`, `Key`); capture-pane without `-e` = plain text.
- pi-types.d.ts stub must be extended for `ctx.ui.custom`.
