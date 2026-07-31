import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  loadRegistry,
  saveRegistry,
  upsertEntry,
  pruneEntries,
  type JumpEntry,
} from "./src/registry";
import {
  LIST_PANES_FORMAT,
  DISPLAY_FORMAT,
  parseListPanes,
  parseDisplayMessage,
  jumpTarget,
} from "./src/tmux";
import { parsePs, findPiDescendant, parseLsofCwd } from "./src/ps";
import { mergeEntries, sortByLastSeen, scanPaneToEntry } from "./src/discover";
import { formatOption } from "./src/format";

const REGISTRY_PATH = join(homedir(), ".pi", "agent", "tmux-registry.json");

export default function (pi: ExtensionAPI) {
  async function selfRegister(
    ctx: { sessionManager: { getSessionId(): string }; cwd: string },
    name?: string,
    explicitName = false
  ) {
    if (!process.env.TMUX) return;
    try {
      // Target the pane this pi process runs in; without -t tmux reports the client's active pane, which may differ.
      const displayArgs = process.env.TMUX_PANE
        ? ["display-message", "-p", "-t", process.env.TMUX_PANE, DISPLAY_FORMAT]
        : ["display-message", "-p", DISPLAY_FORMAT];
      const r = await pi.exec("tmux", displayArgs, { timeout: 3000 });
      const coords = parseDisplayMessage(r.stdout);
      if (!coords) return;
      const entries = loadRegistry(REGISTRY_PATH);
      const existing = entries.find((e) => e.piSessionId === ctx.sessionManager.getSessionId());
      const entry: JumpEntry = {
        piSessionId: ctx.sessionManager.getSessionId(),
        // explicitName=true from session_info_changed: undefined means the user cleared the name.
        // explicitName=false from session_start: preserve any existing name when no name is provided.
        name: explicitName ? name : (name ?? existing?.name),
        cwd: ctx.cwd,
        ...coords,
        pid: process.pid,
        lastSeen: new Date().toISOString(),
      };
      saveRegistry(REGISTRY_PATH, upsertEntry(entries, entry));
    } catch (err) {
      // Self-registration is best-effort; never crash session startup.
      console.error("pi-jump: self-register failed", err);
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    await selfRegister(ctx);
  });

  pi.on("session_info_changed", async (event, ctx) => {
    await selfRegister(ctx, event.name, true);
  });

  pi.registerCommand("jump", {
    description: "Jump to another pi session running in tmux",
    handler: async (_args, ctx) => {
      if (!process.env.TMUX) {
        ctx.ui.notify("pi-jump: not inside tmux", "error");
        return;
      }

      try {
        while (true) {
          const [panesR, selfR, psR] = await Promise.all([
            pi.exec("tmux", ["list-panes", "-a", "-F", LIST_PANES_FORMAT], { timeout: 5000 }),
            // Target this pane; untargeted display-message returns the client's active pane, not necessarily this one.
            pi.exec("tmux", process.env.TMUX_PANE
              ? ["display-message", "-p", "-t", process.env.TMUX_PANE, DISPLAY_FORMAT]
              : ["display-message", "-p", DISPLAY_FORMAT], { timeout: 3000 }),
            pi.exec("ps", ["-axo", "pid,ppid,comm"], { timeout: 5000 }),
          ]);

          if (panesR.code !== 0) {
            ctx.ui.notify("pi-jump: tmux list-panes failed", "error");
            return;
          }

          const panes = parseListPanes(panesR.stdout);
          const livePaneIds = new Set(panes.map((p) => p.tmuxPaneId));
          const selfCoords = parseDisplayMessage(selfR.stdout);

          // Prune dead registry entries and persist the pruning.
          const registry = pruneEntries(loadRegistry(REGISTRY_PATH), livePaneIds);
          saveRegistry(REGISTRY_PATH, registry);

          // Scan fallback: panes with a pi process that never registered.
          const registeredPanes = new Set(registry.map((e) => e.tmuxPaneId));
          const rows = parsePs(psR.stdout);
          const scanned: JumpEntry[] = [];
          for (const pane of panes) {
            if (registeredPanes.has(pane.tmuxPaneId)) continue;
            const piPid = findPiDescendant(pane.pid, rows);
            if (piPid === null) continue;
            const lsofR = await pi.exec("lsof", ["-a", "-p", String(piPid), "-d", "cwd", "-Fn"], { timeout: 3000 });
            const cwd = parseLsofCwd(lsofR.stdout);
            if (!cwd) continue;
            scanned.push(scanPaneToEntry(pane, piPid, cwd));
          }

          const entries = sortByLastSeen(
            mergeEntries(registry, scanned).filter((e) => e.tmuxPaneId !== selfCoords?.tmuxPaneId)
          );

          if (entries.length === 0) {
            ctx.ui.notify("pi-jump: no other pi sessions found", "info");
            return;
          }

          const options = entries.map((e) => formatOption(e));
          const choice = await ctx.ui.select("Jump to pi session:", options);
          if (!choice) return;
          const target = entries[options.indexOf(choice)];

          const jumpR = await pi.exec("tmux", ["switch-client", "-t", jumpTarget(target)], { timeout: 3000 });
          if (jumpR.code === 0) {
            return;
          }

          ctx.ui.notify(`pi-jump: ${jumpR.stderr.trim() || "switch failed (session gone?)"}`, "error");
          // Target pane died between render and jump; re-discover and re-open the picker.
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ctx.ui.notify(`pi-jump: ${message}`, "error");
      }
    },
  });
}
