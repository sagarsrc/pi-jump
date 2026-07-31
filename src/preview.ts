export const PREVIEW_LINES = 20;

export function cleanPreview(raw: string, maxLines: number = PREVIEW_LINES): string[] {
  const lines = raw.split("\n").map((l) => l.replace(/\r/g, ""));
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
  return lines.slice(-maxLines);
}
