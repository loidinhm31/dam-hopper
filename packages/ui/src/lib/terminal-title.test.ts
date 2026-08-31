import { describe, expect, it } from "vitest";
import {
  applyTerminalTitleOrdinals,
  freeTerminalBaseLabel,
  terminalBaseLabel,
} from "./terminal-title.js";

describe("freeTerminalBaseLabel", () => {
  it("uses indexed and readable pending labels", () => {
    expect(freeTerminalBaseLabel(1)).toBe("Terminal 1");
    expect(freeTerminalBaseLabel()).toBe("Terminal (starting…)");
  });
});

describe("terminalBaseLabel", () => {
  it("prefers a configured name and preserves fallback labels when absent", () => {
    expect(terminalBaseLabel("Release", "project:bash")).toBe("Release");
    expect(terminalBaseLabel("", "project:bash")).toBe("");
    expect(terminalBaseLabel(null, "project:bash")).toBe("project:bash");
    expect(terminalBaseLabel(undefined, "project:bash")).toBe("project:bash");
  });
});

describe("applyTerminalTitleOrdinals", () => {
  it("counts exact project groups in supplied order", () => {
    const tabs = [
      { sessionId: "a1", label: "same", project: "project-a" },
      { sessionId: "b1", label: "same", project: "project-b" },
      { sessionId: "a2", label: "same", project: "project-a" },
      { sessionId: "b2", label: "same", project: "project-b" },
    ];
    const projected = applyTerminalTitleOrdinals(tabs);

    expect(projected.map((tab) => tab.title)).toEqual([
      { baseLabel: "same", ordinal: 1, fullText: "same #1" },
      { baseLabel: "same", ordinal: 1, fullText: "same #1" },
      { baseLabel: "same", ordinal: 2, fullText: "same #2" },
      { baseLabel: "same", ordinal: 2, fullText: "same #2" },
    ]);
    expect(projected.map((tab) => tab.sessionId)).toEqual([
      "a1",
      "b1",
      "a2",
      "b2",
    ]);
    expect(tabs).toEqual([
      { sessionId: "a1", label: "same", project: "project-a" },
      { sessionId: "b1", label: "same", project: "project-b" },
      { sessionId: "a2", label: "same", project: "project-a" },
      { sessionId: "b2", label: "same", project: "project-b" },
    ]);
  });

  it("recomputes after reorder/removal and groups projectless tabs together", () => {
    const tabs = [
      { sessionId: "a1", label: "same", project: "a" },
      { sessionId: "free", label: "same" },
      { sessionId: "a2", label: "same", project: "a" },
      { sessionId: "empty", label: "same", project: "" },
    ];

    expect(applyTerminalTitleOrdinals(tabs).map((tab) => tab.title.ordinal)).toEqual([
      1,
      1,
      2,
      2,
    ]);
    expect(
      applyTerminalTitleOrdinals([tabs[2]!, tabs[0]!]).map(
        (tab) => tab.title.ordinal,
      ),
    ).toEqual([1, 2]);
    expect(
      applyTerminalTitleOrdinals([tabs[1]!, tabs[3]!]).map(
        (tab) => tab.title.ordinal,
      ),
    ).toEqual([1, 2]);
  });
});
