import { describe, expect, it } from "vitest";
import {
  isWorkspaceMode,
  loadWorkspaceMode,
  saveWorkspaceMode,
} from "./workspace-mode.js";

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

describe("workspace mode", () => {
  it("accepts only supported workspace modes", () => {
    expect(isWorkspaceMode("ide")).toBe(true);
    expect(isWorkspaceMode("terminal")).toBe(true);
    expect(isWorkspaceMode("editor")).toBe(false);
    expect(isWorkspaceMode(null)).toBe(false);
  });

  it("loads ide when storage is empty or invalid", () => {
    expect(loadWorkspaceMode(memoryStorage())).toBe("ide");
    expect(loadWorkspaceMode(memoryStorage("editor"))).toBe("ide");
  });

  it("loads persisted workspace mode", () => {
    expect(loadWorkspaceMode(memoryStorage("terminal"))).toBe("terminal");
  });

  it("saves selected workspace mode", () => {
    const storage = memoryStorage();

    saveWorkspaceMode("terminal", storage);

    expect(storage.read()).toBe("terminal");
  });
});
