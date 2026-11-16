import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TerminalFindController } from "./terminal-find-controller.js";
import {
  getTerminal,
  getTerminalRegistrySnapshot,
  hasTerminal,
  registerTerminal,
  removeTerminal,
  subscribeToRegistryChanges,
} from "./terminal-registry.js";
import { terminalKey } from "@/api/ownership.js";
import type { TerminalTarget } from "@/api/terminal-session-contract.js";

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
      const first = registerTerminal(
        a,
        {} as Terminal,
        {} as FitAddon,
        {} as TerminalFindController,
      );
      const second = registerTerminal(
        b,
        {} as Terminal,
        {} as FitAddon,
        {} as TerminalFindController,
      );
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
  it("resolves target by qualified key, terminalRef, and rawId", () => {
    const target: TerminalTarget = {
      profileId: "hub-profile",
      generation: 1,
      serverEpoch: "epoch-1",
      terminalId: "hub-term-1",
      incarnation: "inc-1",
    };
    const ref = { profileId: "hub-profile", id: "hub-term-1" };
    const qKey = terminalKey(ref);

    try {
      const entry = registerTerminal(
        target,
        {} as Terminal,
        {} as FitAddon,
        {} as TerminalFindController,
      );
      expect(getTerminal(target)).toBe(entry);
      expect(getTerminal(ref)).toBe(entry);
      expect(getTerminal(qKey)).toBe(entry);
      expect(getTerminal("hub-term-1")).toBe(entry);
      expect(hasTerminal(qKey)).toBe(true);

      removeTerminal(target);
      expect(getTerminal(target)).toBeUndefined();
      expect(getTerminal(ref)).toBeUndefined();
      expect(getTerminal(qKey)).toBeUndefined();
      expect(getTerminal("hub-term-1")).toBeUndefined();
    } finally {
      removeTerminal(target);
    }
  });

  it("refuses to leak raw ID to absent profile or wrong target lifecycle", () => {
    const target: TerminalTarget = {
      profileId: "profile-a",
      generation: 1,
      serverEpoch: "epoch-1",
      terminalId: "shared-term",
      incarnation: "inc-1",
    };
    try {
      const entry = registerTerminal(
        target,
        {} as Terminal,
        {} as FitAddon,
        {} as TerminalFindController,
      );
      expect(getTerminal(target)).toBe(entry);

      // Absent profile lookup with same terminalId must return undefined
      const refB = { profileId: "profile-b", id: "shared-term" };
      expect(getTerminal(refB)).toBeUndefined();
      expect(getTerminal(terminalKey(refB))).toBeUndefined();
      expect(hasTerminal(refB)).toBe(false);

      // Wrong generation / epoch / incarnation must return undefined
      const mismatchedTarget: TerminalTarget = {
        ...target,
        incarnation: "inc-2",
      };
      expect(getTerminal(mismatchedTarget)).toBeUndefined();
    } finally {
      removeTerminal(target);
    }
  });

  it("symmetrically removes canonical target when removing by qualified alias and preserves replacements", () => {
    const target: TerminalTarget = {
      profileId: "profile-sym",
      generation: 1,
      serverEpoch: "epoch-1",
      terminalId: "sym-term-1",
      incarnation: "inc-1",
    };
    const ref = { profileId: "profile-sym", id: "sym-term-1" };
    const qKey = terminalKey(ref);

    try {
      const first = registerTerminal(
        target,
        {} as Terminal,
        {} as FitAddon,
        {} as TerminalFindController,
      );
      expect(getTerminal(target)).toBe(first);

      // Remove by qualified string alias
      removeTerminal(qKey);
      expect(getTerminal(target)).toBeUndefined();
      expect(getTerminal(ref)).toBeUndefined();
      expect(getTerminal(qKey)).toBeUndefined();
      expect(getTerminal("sym-term-1")).toBeUndefined();

      // Test replacement entry preservation
      const targetOld: TerminalTarget = {
        ...target,
        incarnation: "inc-old",
      };
      const targetNew: TerminalTarget = {
        ...target,
        incarnation: "inc-new",
      };
      const oldEntry = registerTerminal(
        targetOld,
        {} as Terminal,
        {} as FitAddon,
        {} as TerminalFindController,
      );
      const newEntry = registerTerminal(
        targetNew,
        {} as Terminal,
        {} as FitAddon,
        {} as TerminalFindController,
      );

      // Both targets distinct, but alias points to newEntry
      expect(getTerminal(targetOld)).toBe(oldEntry);
      expect(getTerminal(targetNew)).toBe(newEntry);
      expect(getTerminal(qKey)).toBe(newEntry);

      // Removing oldEntry by its canonical target must NOT delete newEntry's alias
      removeTerminal(targetOld);
      expect(getTerminal(targetOld)).toBeUndefined();
      expect(getTerminal(targetNew)).toBe(newEntry);
      expect(getTerminal(qKey)).toBe(newEntry);

      removeTerminal(targetNew);
    } finally {
      removeTerminal(target);
    }
  });
});
