import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TerminalFindController } from "./terminal-find-controller.js";
import {
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
});
