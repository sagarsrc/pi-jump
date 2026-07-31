import { matchesKey, Key, truncateToWidth } from "@earendil-works/pi-tui";
import { basename } from "node:path";
import type { DiscoveredEntry } from "./discover";
import { formatOptions } from "./format";
import { fuzzyFilter } from "./fuzzy";
import { cleanPreview, PREVIEW_LINES } from "./preview";

const MAX_LIST_ROWS = 10;

export interface JumpOverlayOptions {
  entries: DiscoveredEntry[];
  currentPaneId?: string;
  fetchPreview: (paneId: string) => Promise<string>;
  onDone: (entry: DiscoveredEntry | null) => void;
  requestRender: () => void;
  previewDelayMs?: number;
}

export class JumpOverlay {
  private query = "";
  private selected = 0;
  private previewLines: string[] = [];
  private previewToken = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private pending: Promise<void> = Promise.resolve();
  private cachedFiltered?: DiscoveredEntry[];

  constructor(private opts: JumpOverlayOptions) {
    this.schedulePreview();
  }

  private filtered(): DiscoveredEntry[] {
    if (!this.cachedFiltered) {
      this.cachedFiltered = fuzzyFilter(
        this.query,
        this.opts.entries,
        (e) => `${e.name ?? basename(e.cwd)} ${e.tmuxSession}`
      );
    }
    return this.cachedFiltered;
  }

  private currentEntry(): DiscoveredEntry | undefined {
    const list = this.filtered();
    if (list.length === 0) return undefined;
    this.selected = Math.min(this.selected, list.length - 1);
    return list[this.selected];
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.enter)) {
      const e = this.currentEntry();
      if (e) this.opts.onDone(e);
      return;
    }
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
      this.opts.onDone(null);
      return;
    }
    if (matchesKey(data, Key.up)) {
      if (this.selected > 0) {
        this.selected--;
        this.afterNav();
      }
      return;
    }
    if (matchesKey(data, Key.down)) {
      if (this.selected < this.filtered().length - 1) {
        this.selected++;
        this.afterNav();
      }
      return;
    }
    if (matchesKey(data, Key.backspace)) {
      if (this.query.length > 0) {
        this.query = this.query.slice(0, -1);
        this.afterQueryChange();
      }
      return;
    }
    if (/^[\x20-\x7e]$/.test(data)) {
      this.query += data;
      this.afterQueryChange();
    }
  }

  private afterQueryChange(): void {
    this.cachedFiltered = undefined;
    this.selected = 0;
    this.afterNav();
  }

  private afterNav(): void {
    this.opts.requestRender();
    this.schedulePreview();
  }

  private schedulePreview(): void {
    if (this.timer) clearTimeout(this.timer);
    const token = ++this.previewToken;
    const delay = this.opts.previewDelayMs ?? 150;
    this.pending = new Promise<void>((resolve) => {
      this.timer = setTimeout(async () => {
        const e = this.currentEntry();
        if (!e) {
          this.previewLines = [];
          this.opts.requestRender();
          resolve();
          return;
        }
        try {
          const raw = await this.opts.fetchPreview(e.tmuxPaneId);
          if (token !== this.previewToken) {
            resolve();
            return;
          }
          const cleaned = cleanPreview(raw, PREVIEW_LINES);
          this.previewLines = cleaned.length > 0 ? cleaned : ["(empty pane)"];
        } catch {
          if (token === this.previewToken) this.previewLines = ["(no preview)"];
        }
        this.opts.requestRender();
        resolve();
      }, delay);
    });
  }

  waitForPreview(): Promise<void> {
    return this.pending;
  }

  invalidate(): void {
    this.cachedFiltered = undefined;
  }

  render(width: number): string[] {
    const list = this.filtered();
    const sel = Math.min(this.selected, Math.max(0, list.length - 1));
    const optionLines = formatOptions(list, new Date(), this.opts.currentPaneId);

    // Stacked layout: list rows occupy full width, preview block below a divider.
    // This avoids the side-by-side layout that would truncate long tmux targets.
    const title = truncateToWidth("Jump to pi session", width);
    const queryLine = truncateToWidth(`> ${this.query}`, width);
    const divider = "─".repeat(Math.min(width, 20));
    const footer = truncateToWidth(
      `${list.length}/${this.opts.entries.length}  ↑↓ navigate  ⏎ jump  esc cancel`,
      width
    );

    const listRows = optionLines.map((line, i) => {
      const prefix = i === sel ? "→ " : "  ";
      return truncateToWidth(prefix + line, width);
    });

    const previewRows = this.previewLines.map((line) =>
      truncateToWidth(line, width)
    );

    return [
      title,
      queryLine,
      divider,
      ...listRows,
      divider,
      ...previewRows,
      footer,
    ];
  }
}
