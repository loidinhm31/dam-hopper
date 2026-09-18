import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TerminalFindController } from "./terminal-find-controller.js";
import {
  getTerminal,
  getTerminalRegistrySnapshot,
  registerTerminal,
  removeTerminal,
  subscribeToRegistryChanges,
} from "./terminal-registry.js";

const id = "shell:registry-reactivity";

afterEach(() => removeTerminal(id));

describe("terminal registry snapshots", () => {
  it("publishes immutable availability snapshots for registration changes", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToRegistryChanges(listener);

    registerTerminal(
      id,
      {} as Terminal,
      {} as FitAddon,
      {} as TerminalFindController,
    );
    const registered = getTerminalRegistrySnapshot();
    removeTerminal(id);
    const removed = getTerminalRegistrySnapshot();
    unsubscribe();

    expect(listener).toHaveBeenCalledTimes(2);
    expect(registered.has(id)).toBe(true);
    expect(removed.has(id)).toBe(false);
    expect(registered).not.toBe(removed);
  });
  it("keeps equal backend IDs isolated and refuses unqualified lookup", () => {
    const a = { profileId: "a", id };
    const b = { profileId: "b", id };
    try {
      const first = registerTerminal(a, {} as Terminal, {} as FitAddon, {} as TerminalFindController);
      const second = registerTerminal(b, {} as Terminal, {} as FitAddon, {} as TerminalFindController);
      expect(getTerminal(a)).toBe(first);
      expect(getTerminal(b)).toBe(second);
      expect(getTerminal(id)).toBeUndefined();
      removeTerminal(a);
      expect(getTerminal(a)).toBeUndefined();
      expect(getTerminal(b)).toBe(second);
    } finally {
      removeTerminal(a);
      removeTerminal(b);
    }
  });
});
