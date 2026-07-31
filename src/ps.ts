export interface PsRow {
  pid: number;
  ppid: number;
  comm: string;
}

export function parsePs(output: string): PsRow[] {
  const lines = output.split("\n").slice(1); // drop header
  const rows: PsRow[] = [];
  for (const line of lines) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)/);
    if (!m) continue;
    rows.push({ pid: Number(m[1]), ppid: Number(m[2]), comm: m[3] });
  }
  return rows;
}

export function findPiDescendant(panePid: number, rows: PsRow[]): number | null {
  const byParent = new Map<number, PsRow[]>();
  for (const r of rows) {
    const list = byParent.get(r.ppid) ?? [];
    list.push(r);
    byParent.set(r.ppid, list);
  }
  const queue = [...(byParent.get(panePid) ?? [])];
  while (queue.length > 0) {
    const row = queue.shift()!;
    if (row.comm === "pi") return row.pid;
    queue.push(...(byParent.get(row.pid) ?? []));
  }
  return null;
}

export function parseLsofCwd(output: string): string | null {
  for (const line of output.split("\n")) {
    if (line.startsWith("n/")) return line.slice(1);
  }
  return null;
}
