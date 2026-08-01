import { basename } from "node:path";
import { matchesKey, Key, truncateToWidth } from "@earendil-works/pi-tui";
import type { DiscoveredEntry } from "./discover";
import { computeColumnWidths, formatRow, rowParts, truncate } from "./format";
import { fuzzyFilter } from "./fuzzy";
import { cleanPreview, PREVIEW_LINES } from "./preview";

const MAX_LIST_ROWS = 10;

export interface JumpOverlayOptions {
  entries: DiscoveredEntry[];
  currentPaneId?: string;
  /**
   * Synchronous preview source. Previews MUST be prefetched before the overlay
   * opens: pi's TUI only repaints custom components on input events, so an
   * async preview that resolves later never becomes visible.
   */
  getPreview: (paneId: string) => string | undefined;
  onDone: (entry: DiscoveredEntry | null) => void;
  requestRender: () => void;
}

export class JumpOverlay {
  private query = "";
  private selected = 0;
  private previewLines: string[] = [];
  private cachedFiltered?: DiscoveredEntry[];
  private done = false;
  private widths: ReturnType<typeof computeColumnWidths>;

  constructor(private opts: JumpOverlayOptions) {
    const parts = opts.entries.map((e) => rowParts(e, new Date(), opts.currentPaneId));
    this.widths = computeColumnWidths(parts);
    this.loadPreview();
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
    const clamped = Math.min(this.selected, list.length - 1);
    return list[clamped];
  }

  handleInput(data: string): void {
    if (this.done) return;
    if (matchesKey(data, Key.enter)) {
      const e = this.currentEntry();
      if (e) {
        this.done = true;
        this.opts.onDone(e);
      }
      return;
    }
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
      this.done = true;
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
    this.loadPreview();
    this.opts.requestRender();
  }

  private loadPreview(): void {
    const e = this.currentEntry();
    if (!e) {
      this.previewLines = [];
      return;
    }
    const raw = this.opts.getPreview(e.tmuxPaneId);
    if (raw === undefined) {
      this.previewLines = ["(no preview)"];
      return;
    }
    const cleaned = cleanPreview(raw, PREVIEW_LINES);
    this.previewLines = cleaned.length > 0 ? cleaned : ["(empty pane)"];
  }

  invalidate(): void {
    this.cachedFiltered = undefined;
  }

  render(width: number): string[] {
    const now = new Date();
    const list = this.filtered();
    const sel = Math.min(this.selected, Math.max(0, list.length - 1));
    const contentWidth = Math.max(0, width - 2);
    const optionLines = list.map((e) =>
      this.renderRow(rowParts(e, now, this.opts.currentPaneId), contentWidth)
    );

    const title = truncateToWidth("Jump to pi session", width);
    const queryLine = truncateToWidth(`> ${this.query}`, width);
    const divider = "─".repeat(Math.min(width, 20));
    const footer = truncateToWidth(
      `${list.length}/${this.opts.entries.length}  ↑↓ navigate  ⏎ jump  esc cancel`,
      width
    );

    const windowSize = MAX_LIST_ROWS;
    let start = 0;
    if (optionLines.length > windowSize) {
      start = Math.min(
        Math.max(sel - Math.floor(windowSize / 2), 0),
        optionLines.length - windowSize
      );
    }
    const visibleLines = optionLines.slice(start, start + windowSize);

    // Constant frame: exactly MAX_LIST_ROWS list rows, blank-padded.
    const listRows: string[] = [];
    for (let i = 0; i < windowSize; i++) {
      const line = visibleLines[i];
      if (line === undefined) {
        listRows.push("");
        continue;
      }
      const actualIndex = start + i;
      const prefix = actualIndex === sel ? "→ " : "  ";
      listRows.push(truncateToWidth(prefix + line, width));
    }

    // Constant frame: exactly PREVIEW_LINES preview rows, blank-padded.
    const previewRows: string[] = [];
    for (let i = 0; i < PREVIEW_LINES; i++) {
      const line = this.previewLines[i];
      previewRows.push(line !== undefined ? truncateToWidth(line, width) : "");
    }

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

  private renderRow(parts: ReturnType<typeof rowParts>, contentWidth: number): string {
    const full = formatRow(parts, this.widths);
    if (full.length <= contentWidth) return full;

    const sep = " │ ";
    const coreOverhead = `${parts.dot} `.length + sep.length + parts.target.length;
    const nameBudget = Math.max(0, contentWidth - coreOverhead);
    const name =
      nameBudget > 0
        ? nameBudget < parts.name.length
          ? truncate(parts.name, nameBudget)
          : parts.name
        : "";
    let row = `${parts.dot} ${name}${sep}${parts.target}`;

    const withAge = `${row}${sep}${parts.age.padStart(this.widths.ageW)}`;
    if (withAge.length <= contentWidth) {
      row = withAge;
    }

    if (parts.current) {
      const withMarker = `${row} [current]`;
      if (withMarker.length <= contentWidth) row = withMarker;
    }

    return truncateToWidth(row, contentWidth);
  }
}
