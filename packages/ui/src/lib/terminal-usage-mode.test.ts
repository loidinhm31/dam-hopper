import { describe, expect, it } from "vitest";
import {
  isTerminalUsageMode,
  loadTerminalUsageMode,
  saveTerminalUsageMode,
} from "./terminal-usage-mode.js";

function memoryStorage(initial?: string) {
  let value = initial;
  return {
    getItem: () => value ?? null,
    setItem: (_key: string, next: string) => {
      value = next;
    },
    read: () => value,
  };
}

describe("terminal usage mode", () => {
  it("accepts only supported terminal usage modes", () => {
    expect(isTerminalUsageMode("traditional")).toBe(true);
    expect(isTerminalUsageMode("runtime")).toBe(true);
    expect(isTerminalUsageMode("terminal")).toBe(false);
    expect(isTerminalUsageMode(null)).toBe(false);
  });

  it("loads traditional when storage is empty or invalid", () => {
    expect(loadTerminalUsageMode(memoryStorage())).toBe("traditional");
    expect(loadTerminalUsageMode(memoryStorage("split"))).toBe("traditional");
  });

  it("loads persisted terminal usage mode", () => {
    expect(loadTerminalUsageMode(memoryStorage("runtime"))).toBe("runtime");
  });

  it("saves selected terminal usage mode", () => {
    const storage = memoryStorage();

    saveTerminalUsageMode("runtime", storage);

    expect(storage.read()).toBe("runtime");
  });
});
