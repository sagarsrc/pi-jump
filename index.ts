import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

/**
 * pi.exec never settles while a ui.custom component is open (and right after it
 * closes). Use child_process for every external command in this extension.
 */
async function run(cmd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileP(cmd, args, { timeout: 5000 });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: typeof e.code === "number" ? e.code : 1, stdout: e.stdout ?? "", stderr: e.stderr ?? String(err) };
  }
}
import { join } from "node:path";
import {
  loadRegistry,
  saveRegistry,
  upsertEntry,
  pruneEntries,
  type JumpEntry,
} from "./src/registry";
import { shouldSelfRegister } from "./src/guard";
import {
  LIST_PANES_FORMAT,
  DISPLAY_FORMAT,
  parseListPanes,
  parseDisplayMessage,
  jumpTarget,
} from "./src/tmux";
import { parsePs, findPiDescendant, parseLsofCwd } from "./src/ps";
import { mergeEntries, sortByLastSeen, scanPaneToEntry, dedupeByPane } from "./src/discover";
import { JumpOverlay } from "./src/overlay";
import type { DiscoveredEntry } from "./src/discover";
import type { JumpTheme } from "./src/overlay";

const REGISTRY_PATH = join(homedir(), ".pi", "agent", "tmux-registry.json");

export default function (pi: ExtensionAPI) {
  async function selfRegister(
    ctx: { sessionManager: { getSessionId(): string }; cwd: string },
    name?: string,
    explicitName = false
  ) {
    if (!shouldSelfRegister(Boolean(process.stdout.isTTY), process.env.TMUX)) return;
    try {
      // Target the pane this pi process runs in; without -t tmux reports the client's active pane, which may differ.
      const displayArgs = process.env.TMUX_PANE
        ? ["display-message", "-p", "-t", process.env.TMUX_PANE, DISPLAY_FORMAT]
        : ["display-message", "-p", DISPLAY_FORMAT];
      const r = await run("tmux", displayArgs);
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
            run("tmux", ["list-panes", "-a", "-F", LIST_PANES_FORMAT]),
            // Target this pane; untargeted display-message returns the client's active pane, not necessarily this one.
            run("tmux", process.env.TMUX_PANE
              ? ["display-message", "-p", "-t", process.env.TMUX_PANE, DISPLAY_FORMAT]
              : ["display-message", "-p", DISPLAY_FORMAT]),
            run("ps", ["-axo", "pid,ppid,comm"]),
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
            const lsofR = await run("lsof", ["-a", "-p", String(piPid), "-d", "cwd", "-Fn"]);
            const cwd = parseLsofCwd(lsofR.stdout);
            if (!cwd) continue;
            scanned.push(scanPaneToEntry(pane, piPid, cwd));
          }

          const sorted = sortByLastSeen(dedupeByPane(mergeEntries(registry, scanned)));
          // Current session first so the user can orient.
          const entries = [
            ...sorted.filter((e) => e.tmuxPaneId === selfCoords?.tmuxPaneId),
            ...sorted.filter((e) => e.tmuxPaneId !== selfCoords?.tmuxPaneId),
          ];

          if (entries.length === 0) {
            ctx.ui.notify("pi-jump: no pi sessions found", "info");
            return;
          }

          // Prefetch all pane previews BEFORE opening the overlay: pi's TUI
          // repaints custom components only on input events, so async previews
          // would never become visible. Panes are few and capture-pane is ~10ms.
          const previews = new Map<string, string>();
          await Promise.all(
            entries.map(async (e) => {
              try {
                const { stdout } = await execFileP(
                  "tmux",
                  ["capture-pane", "-p", "-t", e.tmuxPaneId, "-S", "-25"],
                  { timeout: 2000 }
                );
                previews.set(e.tmuxPaneId, stdout);
              } catch {
                // Dead/inaccessible pane -> no preview entry.
              }
            })
          );

      const chosen = await ctx.ui.custom<DiscoveredEntry | null>(
        (tui, theme, _kb, done) => {
          return new JumpOverlay({
            entries,
            currentPaneId: selfCoords?.tmuxPaneId,
            getPreview: (paneId) => previews.get(paneId),
            onDone: done,
            requestRender: () => tui.requestRender(),
            theme: theme as JumpTheme,
          });
        },
        {
          overlay: true,
          overlayOptions: { anchor: "center", width: "80%", maxHeight: "85%" },
          // Overlay mode does not auto-focus: without this, keystrokes go to
          // the editor behind the modal.
          onHandle: (handle: { focus(): void }) => handle.focus(),
        }
      );
          if (!chosen) return;
          const target = chosen;

          if (target.tmuxPaneId === selfCoords?.tmuxPaneId) {
            ctx.ui.notify("pi-jump: already here", "info");
            return;
          }

          // Resolve the client that owns OUR pane — with multiple tmux clients
          // attached, bare switch-client picks an arbitrary one.
          let switchArgs = ["switch-client", "-t", jumpTarget(target)];
          if (process.env.TMUX_PANE) {
            const clientR = await run(
              "tmux",
              ["display-message", "-p", "-t", process.env.TMUX_PANE, "#{client_tty}"]
            );
            const client = clientR.code === 0 ? clientR.stdout.trim() : "";
            if (client) switchArgs = ["switch-client", "-c", client, "-t", jumpTarget(target)];
          }
          const jumpR = await run("tmux", switchArgs);
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
