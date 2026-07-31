import { describe, test, expect } from "vitest";
import { parsePs, findPiDescendant, parseLsofCwd } from "../src/ps";

describe("parsePs", () => {
  test("parses pid/ppid/comm columns, skips header", () => {
    const out = "  PID  PPID COMM\n40265  2561 -zsh\n41049 40265 pi\n";
    expect(parsePs(out)).toEqual([
      { pid: 40265, ppid: 2561, comm: "-zsh" },
      { pid: 41049, ppid: 40265, comm: "pi" },
    ]);
  });
});

describe("findPiDescendant", () => {
  const rows = [
    { pid: 100, ppid: 1, comm: "-zsh" },     // pane shell
    { pid: 200, ppid: 100, comm: "node" },   // unrelated child
    { pid: 300, ppid: 200, comm: "pi" },     // pi grandchild
    { pid: 400, ppid: 300, comm: "rg" },     // pi's own child — must not match as separate result
  ];
  test("finds pi at any depth below pane pid", () => {
    expect(findPiDescendant(100, rows)).toBe(300);
  });
  test("returns null when no pi below pane", () => {
    expect(findPiDescendant(999, rows)).toBeNull();
    expect(findPiDescendant(300, rows)).toBeNull(); // pi itself is not its own descendant
  });
});

describe("parseLsofCwd", () => {
  test("extracts path from n/ line", () => {
    expect(parseLsofCwd("p41049\nfcwd\nn/Users/sagar/work/pi-tmux-conf\n")).toBe("/Users/sagar/work/pi-tmux-conf");
  });
  test("returns null without n line", () => {
    expect(parseLsofCwd("p41049\n")).toBeNull();
  });
});
