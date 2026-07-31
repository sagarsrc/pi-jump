---
title: "research-pi-tmux-ext"
experiment: 001-pi-extension
created: "2026-07-31 17:15 UTC"
---

# Research: Pi extension dev + existing tmux extensions

Two parallel research agents (Kimi K2.7) — one on Pi extension dev (local docs), one on existing tmux extensions (web). Findings below. No plan finalized yet.

## 1. How Pi extensions are developed

Source: local docs at `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md` + `examples/extensions/`.

### Loading & locations

- Extensions are TypeScript modules loaded by [jiti](https://github.com/unjs/jiti) — **no build step**.
- Auto-discovery paths:
  - Global single file: `~/.pi/agent/extensions/*.ts`
  - Global directory: `~/.pi/agent/extensions/*/index.ts`
  - Project single file: `.pi/extensions/*.ts` (requires project trust)
  - Project directory: `.pi/extensions/*/index.ts`
- Extra paths via `settings.json` → `"extensions": [...]`
- One-shot load: `pi -e ./ext.ts`; disable: `--no-extensions`

### API surface

- **Slash commands**: `pi.registerCommand(name, { description, handler, getArgumentCompletions? })`
- **Tools (LLM-callable)**: `pi.registerTool({ name, label, description, parameters, execute, renderCall?/renderResult? })`
- **Keybindings**: `pi.registerShortcut(key, { description, handler })`
- **TUI**: `ctx.ui.notify`, `ctx.ui.setStatus`, `ctx.ui.setWidget`, `ctx.ui.setFooter`, `ctx.ui.select`, `ctx.ui.confirm`, `ctx.ui.custom` (overlay/modal)
- **Events**: `pi.on("session_start" | "tool_call" | "agent_end" | ...)`

### Required signature & skeleton

Default-export factory receiving `ExtensionAPI` (sync or async):

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("tmux-ext loaded", "info");
  });

  pi.registerCommand("tmux-sessions", {
    description: "List/switch tmux sessions",
    handler: async (_args, ctx) => {
      const result = await pi.exec("tmux", ["list-sessions", "-F", "#S"]);
      const sessions = result.stdout.split("\n").filter(Boolean);
      const choice = await ctx.ui.select("Session:", sessions);
      if (choice) {
        await pi.exec("tmux", ["switch-client", "-t", choice]);
        ctx.ui.notify(`Switched to ${choice}`, "info");
      }
    },
  });

  pi.registerTool({
    name: "tmux_switch",
    label: "Tmux Switch",
    description: "Switch the active tmux session",
    parameters: Type.Object({
      session: Type.String({ description: "tmux session name" }),
    }),
    async execute(_id, params, signal, _onUpdate, _ctx) {
      const result = await pi.exec("tmux", ["switch-client", "-t", params.session], { signal });
      return { content: [{ type: "text", text: result.stdout || "switched" }], details: {} };
    },
  });
}
```

Command/shortcut handlers get `ExtensionCommandContext` (adds `waitForIdle`, `newSession`, `switchSession`, `reload`).

### Shell execution & permissions

- `pi.exec(cmd, args, { signal, timeout })` → `{ stdout, stderr, code, killed }`
- Or use `node:child_process` directly; or built-in `createBashTool(cwd)` for full bash semantics.
- **No per-command permission popup** — extensions run with full user perms. Project-local extensions need project trust.

### Dev loop

```bash
pi -e ./tmux-ext.ts          # quick test
cp tmux-ext.ts ~/.pi/agent/extensions/   # global install
/reload                      # hot reload inside pi
pi --verbose                 # debug load errors
```

### Packaging

npm package, keyword `pi-package`, manifest under `pi`:

```json
{
  "name": "pi-tmux-control",
  "keywords": ["pi-package"],
  "pi": { "extensions": ["./extensions"] }
}
```

Install: `pi install npm:pkg@ver` / `pi install git:github.com/user/repo@tag` / `pi install ./local-dir`.
Peer-deps (don't bundle): `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, `@earendil-works/pi-ai`, `typebox`.

## 2. Existing tmux-related Pi extensions (web search)

Registry: https://pi.dev/packages (filter `?type=extension`).

| Package | What it does |
|---|---|
| `@ogulcancelik/pi-tmux` | Pane-level tool: `run`, `read`, `send`, `stop`, `list` named panes (dev servers/watchers) |
| `pi-mux` | **Pi session** multiplexer: `/switch`, `/mux`, `/new`, `/fork` — swaps Pi sessions in visible tmux pane; backgrounds in hidden `_pi-mux` pool |
| `pi-live-terminal` | Live tmux widget inside Pi: `live_terminal_run`, attach, focus, full-screen modal, pipe-pane streaming |
| `@richardgill/pi-tmux-bash` | `bash` replacement using tmux windows for background tasks, with `peek`/`kill` |
| `pi-tmux-subagents` | Spawn Markdown-defined subagents as tmux-backed Pi sessions |
| `pi-agent-hub` | Dashboard for multiple Pi sessions across tmux panes |
| `pi-tmux-window-name` | Auto-names tmux windows/sessions for Pi |
| `@victor-software-house/pi-tmux` | One tmux session per git-root project |
| `@vanillagreen/pi-agents-tmux`, `pi-sidebar-tui`, `pi-terminal-mux` | Other tmux-flavored utilities |

Official docs: `docs/tmux.md` only covers `extended-keys` config. `examples/extensions/interactive-shell.ts` lists tmux as interactive command, not a controller.

## 3. The gap

**No existing extension = generic tmux session switcher inside Pi TUI** (list all tmux sessions → pick → `switch-client`). `pi-mux` closest but Pi-session-centric, not arbitrary tmux control.

Closest analogues outside Pi: Claude Code `claude --tmux` + community `claudemux`/`ccm` plugins; OpenCode `tmux-agent-sidebar`.

## 4. Capability candidates for the extension

From tmux CLI primitives:

- Session picker overlay (`tmux list-sessions` → `ctx.ui.select` → `switch-client`)
- new / kill / rename session (`new-session -d -s`, `kill-session`, `rename-session`)
- Window/pane selector (`list-windows`, `select-window`)
- Popup runner (`display-popup`)
- Send keys / capture output (`send-keys`, `capture-pane`)
- Bookmarks for frequent sessions
- Status widget showing current tmux session
