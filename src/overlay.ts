import { basename } from "node:path";
import { matchesKey, Key, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { DiscoveredEntry } from "./discover";
import { rowParts, type RowParts } from "./format";
import { fuzzyFilter } from "./fuzzy";
import { cleanPreview } from "./preview";
import { boxBottom, labelDivider } from "./box";

export const MODAL_LIST_ROWS = 8;
export const MODAL_PREVIEW_ROWS = 12;
export const PREVIEW_CHROME_CROP = 4;
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

function padToWidth(s: string, w: number): string {
  return s + " ".repeat(Math.max(0, w - visibleWidth(s)));
}

function padStartToWidth(s: string, w: number): string {
  return " ".repeat(Math.max(0, w - visibleWidth(s))) + s;
}

interface ColumnWidths {
  nameW: number;
  targetW: number;
  cwdW: number;
  ageW: number;
}

/** Which optional columns every row shows — decided GLOBALLY so all rows align. */
interface ColumnPlan {
  cwd: boolean;
  age: boolean;
}

export class JumpOverlay {
  private query = "";
  private selected = 0;
  private previewLines: string[] = [];
  private cachedFiltered?: DiscoveredEntry[];
  private done = false;
  private widths: ColumnWidths;
  private previewLabel: (e: DiscoveredEntry) => string;

  constructor(private opts: JumpOverlayOptions) {
    this.previewLabel =
      opts.previewLabel ??
      ((e) => `preview: ${e.name ?? basename(e.cwd)} (${e.tmuxSession}:${e.tmuxWindow})`);

    const parts = opts.entries.map((e) => rowParts(e, new Date(), opts.currentPaneId));
    this.widths = {
      nameW: Math.max(...parts.map((r) => visibleWidth(r.name))),
      targetW: Math.max(...parts.map((r) => visibleWidth(r.target))),
      cwdW: Math.max(...parts.map((r) => visibleWidth(r.cwd))),
      ageW: Math.max(...parts.map((r) => visibleWidth(r.age))),
    };
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
    let cleaned = cleanPreview(raw, MODAL_PREVIEW_ROWS, PREVIEW_CHROME_CROP);
    if (cleaned.length === 0) {
      cleaned = cleanPreview(raw, MODAL_PREVIEW_ROWS, 0);
    }
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
      theme.fg("text", padToWidth(truncateToWidth(`❯ ${this.query}█`, innerW), innerW))
    );
    const dividerRow = this.borderRow(theme.fg("border", "─".repeat(innerW)));

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
    const titleW = visibleWidth(titleStr);
    const titleFit = titleW > innerW ? truncateToWidth(titleStr, innerW) : titleStr;
    const titleFitW = visibleWidth(titleFit);
    const left = Math.max(0, Math.floor((innerW - titleFitW) / 2));
    const right = Math.max(0, innerW - titleFitW - left);
    return (
      theme.fg("border", "╭" + "─".repeat(left)) +
      theme.fg("accent", titleFit) +
      theme.fg("border", "─".repeat(right) + "╮")
    );
  }

  private borderRow(content: string): string {
    const theme = this.opts.theme;
    return theme.fg("border", "│") + content + theme.fg("border", "│");
  }

  private renderListRows(innerW: number): string[] {
    const theme = this.opts.theme;
    const now = new Date();
    const list = this.filtered();
    const sel = list.length > 0 ? Math.min(this.selected, list.length - 1) : -1;
    const contentW = Math.max(0, innerW - 2);

    const plan = this.columnPlan(contentW);
    const optionLines = list.map((e) =>
      this.renderRow(rowParts(e, now, this.opts.currentPaneId), contentW, plan)
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
      const full = padToWidth(truncateToWidth(prefix + rawLine, innerW), innerW);
      const styled = isSelected
        ? theme.bg("selectedBg", theme.fg("text", full))
        : list[actualIndex]?.source === "scan"
          ? theme.fg("dim", full)
          : theme.fg("text", full);
      rows.push(this.borderRow(styled));
    }
    return rows;
  }

  private renderPreviewLabel(innerW: number): string {
    const theme = this.opts.theme;
    const e = this.currentEntry();
    const label = e ? this.previewLabel(e) : "preview";
    const content = theme.fg("muted", labelDivider(label, innerW));
    return this.borderRow(content);
  }

  private renderPreviewRows(innerW: number): string[] {
    const theme = this.opts.theme;
    const rows: string[] = [];
    for (let i = 0; i < MODAL_PREVIEW_ROWS; i++) {
      const line = this.previewLines[i] ?? "";
      const content = theme.fg("muted", padToWidth(truncateToWidth(line, innerW), innerW));
      rows.push(this.borderRow(content));
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
      padToWidth(truncateToWidth(`${count}  ${hints}`, innerW), innerW)
    );
    return this.borderRow(content);
  }

  private columnPlan(contentW: number): ColumnPlan {
    const sepW = " │ ".length;
    const base = 2 /* dot+space */ + this.widths.nameW + sepW + this.widths.targetW;
    if (base + sepW + this.widths.cwdW + sepW + this.widths.ageW <= contentW) {
      return { cwd: true, age: true };
    }
    if (base + sepW + this.widths.ageW <= contentW) {
      return { cwd: false, age: true };
    }
    return { cwd: false, age: false };
  }

  private renderRow(parts: RowParts, contentWidth: number, plan: ColumnPlan): string {
    const sep = " │ ";
    const name =
      visibleWidth(parts.name) > this.widths.nameW
        ? truncateToWidth(parts.name, this.widths.nameW, "…")
        : padToWidth(parts.name, this.widths.nameW);
    const target = padStartToWidth(parts.target, this.widths.targetW);
    let row = `${parts.dot} ${name}${sep}${target}`;
    if (plan.cwd) row += sep + padToWidth(parts.cwd, this.widths.cwdW);
    if (plan.age) row += sep + padStartToWidth(parts.age, this.widths.ageW);

    if (visibleWidth(row) > contentWidth) {
      // Even name+target overflows: truncate the name — target is sacred.
      const coreW = visibleWidth(`${parts.dot} `) + sep.length + visibleWidth(target);
      const budget = Math.max(0, contentWidth - coreW);
      const trimmed = budget > 0 ? truncateToWidth(parts.name, budget, "…") : "";
      row = `${parts.dot} ${trimmed}${sep}${target}`;
    }

    return truncateToWidth(row, contentWidth, "…");
  }
}
