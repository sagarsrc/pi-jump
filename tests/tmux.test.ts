import { describe, test, expect } from "vitest";
import { parseListPanes, parseDisplayMessage, jumpTarget } from "../src/tmux";

describe("parseListPanes", () => {
  test("parses tab-separated panes", () => {
    const out = "work\t1\t%0\t2818\t1785517928\ntconf\t1\t%6\t40265\t1785519068\n";
    expect(parseListPanes(out)).toEqual([
      { tmuxSession: "work", tmuxWindow: "1", tmuxPaneId: "%0", pid: 2818, activity: 1785517928 },
      { tmuxSession: "tconf", tmuxWindow: "1", tmuxPaneId: "%6", pid: 40265, activity: 1785519068 },
    ]);
  });
  test("handles session names with spaces", () => {
    const out = "my session\t2\t%12\t999\t1785517000\n";
    expect(parseListPanes(out)[0].tmuxSession).toBe("my session");
  });
  test("skips blank and malformed lines", () => {
    expect(parseListPanes("\n\nbad\tline\n")).toEqual([]);
  });
});

describe("parseDisplayMessage", () => {
  test("parses coords", () => {
    expect(parseDisplayMessage("tconf\t1\t%6\n")).toEqual({ tmuxSession: "tconf", tmuxWindow: "1", tmuxPaneId: "%6" });
  });
  test("returns null on garbage", () => {
    expect(parseDisplayMessage("oops\n")).toBeNull();
    expect(parseDisplayMessage("")).toBeNull();
  });
});

describe("jumpTarget", () => {
  test("joins session and window", () => {
    expect(jumpTarget({ tmuxSession: "work", tmuxWindow: "2" })).toBe("work:2");
  });
});
