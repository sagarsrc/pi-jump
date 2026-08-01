import { basename } from "node:path";
import { matchesKey, Key, truncateToWidth } from "@earendil-works/pi-tui";
import type { DiscoveredEntry } from "./discover";
import { computeColumnWidths, formatRow, rowParts, truncate } from "./format";
import { fuzzyFilter } from "./fuzzy";
import { cleanPreview, PREVIEW_LINES } from "./preview";
import { boxBottom, labelDivider } from "./box";

export const MODAL_LIST_ROWS = 8;
export const MODAL_PREVIEW_ROWS = 12;
export const MODAL_FRAME_LINES = 1 + 1 + 1 + MODAL_LIST_ROWS + 1 + MODAL_PREVIEW_ROWS + 1 + 1;

export interface JumpTheme {
  fg(color: string, text: string): string;
  bg(color: string, text: string): string;
}

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
  theme: JumpTheme;
  previewLabel?: (e: DiscoveredEntry) => string;
}

export class JumpOverlay {
  private query = "";
  private selected = 0;
  private previewLines: string[] = [];
  private cachedFiltered?: DiscoveredEntry[];
  private done = false;
  private widths: ReturnType<typeof computeColumnWidths>;
  private previewLabel: (e: DiscoveredEntry) => string;

  constructor(private opts: JumpOverlayOptions) {
    this.previewLabel =
      opts.previewLabel ??
      ((e) => `preview: ${e.name ?? basename(e.cwd)} (${e.tmuxSession}:${e.tmuxWindow})`);

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
    const innerW = Math.max(0, width - 2);
    const theme = this.opts.theme;

    const top = this.renderTop(innerW);
    const queryRow = this.borderRow(
      theme.fg("text", truncateToWidth(`❯ ${this.query}█`, innerW).padEnd(innerW)),
      innerW
    );
    const dividerRow = this.borderRow(theme.fg("border", "─".repeat(innerW)), innerW);

    const listRows = this.renderListRows(innerW);
    const previewLabelRow = this.renderPreviewLabel(innerW);
    const previewRows = this.renderPreviewRows(innerW);
    const footerRow = this.renderFooter(innerW);
    const bottom = theme.fg("border", boxBottom(innerW));

    return [
      top,
      queryRow,
      dividerRow,
      ...listRows,
      previewLabelRow,
      ...previewRows,
      footerRow,
      bottom,
    ];
  }

  private renderTop(innerW: number): string {
    const theme = this.opts.theme;
    const titleStr = " ◈ pi-jump ";
    const titleFit = titleStr.slice(0, innerW);
    const left = Math.max(0, Math.floor((innerW - titleFit.length) / 2));
    const right = Math.max(0, innerW - titleFit.length - left);
    return (
      theme.fg("border", "╭" + "─".repeat(left)) +
      theme.fg("accent", titleFit) +
      theme.fg("border", "─".repeat(right) + "╮")
    );
  }

  private borderRow(content: string, innerW: number): string {
    const theme = this.opts.theme;
    return theme.fg("border", "│") + content + theme.fg("border", "│");
  }

  private renderListRows(innerW: number): string[] {
    const theme = this.opts.theme;
    const now = new Date();
    const list = this.filtered();
    const sel = list.length > 0 ? Math.min(this.selected, list.length - 1) : -1;
    const contentW = Math.max(0, innerW - 2);

    const optionLines = list.map((e) =>
      this.renderRow(rowParts(e, now, this.opts.currentPaneId), contentW)
    );

    let start = 0;
    if (optionLines.length > MODAL_LIST_ROWS) {
      start = Math.min(
        Math.max(sel - Math.floor(MODAL_LIST_ROWS / 2), 0),
        optionLines.length - MODAL_LIST_ROWS
      );
    }

    const rows: string[] = [];
    for (let i = 0; i < MODAL_LIST_ROWS; i++) {
      const actualIndex = start + i;
      const isSelected = list.length > 0 && actualIndex === sel;
      const prefix = isSelected ? "→ " : "  ";
      const rawLine = optionLines[actualIndex] ?? "";
      const full = truncateToWidth(prefix + rawLine, innerW).padEnd(innerW);
      const styled = isSelected
        ? theme.bg("selectedBg", theme.fg("text", full))
        : theme.fg("text", full);
      rows.push(this.borderRow(styled, innerW));
    }
    return rows;
  }

  private renderPreviewLabel(innerW: number): string {
    const theme = this.opts.theme;
    const e = this.currentEntry();
    const label = e ? this.previewLabel(e) : "preview";
    const content = theme.fg("muted", labelDivider(label, innerW));
    return this.borderRow(content, innerW);
  }

  private renderPreviewRows(innerW: number): string[] {
    const theme = this.opts.theme;
    const rows: string[] = [];
    for (let i = 0; i < MODAL_PREVIEW_ROWS; i++) {
      const line = this.previewLines[i] ?? "";
      const content = theme.fg("muted", truncateToWidth(line, innerW).padEnd(innerW));
      rows.push(this.borderRow(content, innerW));
    }
    return rows;
  }

  private renderFooter(innerW: number): string {
    const theme = this.opts.theme;
    const list = this.filtered();
    const count = `${list.length}/${this.opts.entries.length}`;
    const hints = "↑↓ move · type to filter · ⏎ jump · esc close";
    const content = theme.fg(
      "muted",
      truncateToWidth(`${count}  ${hints}`, innerW).padEnd(innerW)
    );
    return this.borderRow(content, innerW);
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
