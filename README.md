# pi-jump

Jump between running [pi](https://github.com/earendil-works/pi) sessions across tmux windows — without `Ctrl-B w` hunting.

A [pi coding agent](https://pi.dev) extension that adds `/jump`: a picker of every live pi session on your tmux server. Hit Enter, you're there.

https://github.com/sagarsrc/pi-jump/releases/download/v2.1.2/pi-jump-demo.mp4

<img src="https://github.com/sagarsrc/pi-jump/releases/download/v2.1.2/pi-jump-modal.png" alt="pi-jump modal picker" width="900">

```
╭──────────────────── ◈ pi-jump ────────────────────╮
│ ❯ med█                                            │
│───────────────────────────────────────────────────│
│ → ● sidequest      │ main:1 │  2m ago [current]   │
│   ● media-project  │ work:1 │ 37m ago             │
│   ○ cryptobot      │  fun:1 │  3h ago             │
│┄┄┄┄┄┄┄┄┄ preview: media-project (work:1) ┄┄┄┄┄┄┄┄┄│
│   $ npm run dev                                   │
│   ✓ built in 380ms                                │
│   ➜ Local: http://localhost:5173                  │
│                                                   │
│ ↑↓ move · type to filter · ⏎ jump · esc close     │
╰───────────────────────────────────────────────────╯
```

- `●` your current session — everything else is `○`
- Scan-detected sessions (pi running without the extension) appear dimmed
- Columns: session name │ tmux `session:window` (never truncated) │ cwd (`~` = home) │ age — columns adapt to width, always aligned
- Preview: live tail of the highlighted pane, with the target's status line cropped out

## Why

You run pi in several tmux windows. Switching means `Ctrl-B w` and guessing which anonymous window holds the session you want. pi-jump knows: every pi self-registers its tmux coordinates on startup, and `/jump` switches your tmux client straight to the right session and window.

## Install

```bash
# from git (pinned ref recommended)
pi install git:github.com/sagarsrc/pi-jump@v1.1.0

# or from npm
pi install npm:pi-jump
```

Then `/reload` in any running pi (or start a new one). Requires pi to run **inside tmux**.

## Usage

```
/jump
```

Pick a session → your tmux client switches to it. Dead sessions are pruned automatically; if your target dies mid-pick, the picker re-opens with a fresh list.

**v2.1 picker:** a real modal that floats over your chat — bordered box, highlighted selection, live preview of the highlighted pane (its status line cropped out so you never confuse it with yours).

**v2.0 picker superpowers:**
- **Fuzzy filter** — just start typing; matches session names, directories, and tmux session names
- **Live preview** — the highlighted session's pane content renders below the list, refreshing as you move the cursor

Name your sessions with pi's built-in `/name` — the picker shows the name instead of the directory.

## How it works

- **Self-registry**: on `session_start`, each interactive pi writes its tmux coordinates (`session`, `window`, `pane id`, resolved via `$TMUX_PANE`) to `~/.pi/agent/tmux-registry.json`. Headless pi's (`pi -p`, subagents) never register — no noise.
- **Scan fallback**: panes running pi without the extension are discovered by walking the process tree (`ps` → `comm == "pi"` → `lsof` for cwd).
- **Jump**: `tmux switch-client -t <session>:<window>`. Entries are deduplicated per pane and pruned when panes die.

Registry file: `~/.pi/agent/tmux-registry.json` — safe to delete; it rebuilds.

## Development

```bash
npm install
npm test        # 43 unit tests (vitest)
npm run typecheck

# load locally without installing
pi -e ./index.ts
```

## Roadmap

- Kill session / open new session from the picker
- Fuzzy filter
- Status widget with session count

## License

[MIT](LICENSE) © Sagar Sarkale
