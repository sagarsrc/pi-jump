# pi-jump

Jump between running [pi](https://github.com/earendil-works/pi) sessions across tmux windows — without `Ctrl-B w` hunting.

A [pi coding agent](https://pi.dev) extension that adds `/jump`: a picker of every live pi session on your tmux server. Hit Enter, you're there.

```
  Jump to pi session:

  → ○ pi-fleet-extension │ fleet-v2:1 │  1m ago
    ● pi-tmux-conf       │    tconf:1 │  2m ago
    ○ all-configs        │     work:2 │ 57m ago

  ↑↓ navigate  enter select  escape cancel
```

- `●` registered session (shows the name you gave it with `/name`)
- `○` detected via process scan (shows the project directory)
- Columns: session name │ tmux `session:window` │ last activity

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
