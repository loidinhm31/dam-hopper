// Module-level singleton registry for xterm.js Terminal instances.
// Terminals must NOT be stored in React state — this module provides
// imperative access keyed by sessionId.

import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import type { TerminalFindController } from "@/lib/terminal-find-controller.js";
import { cancelScheduledTerminalFit } from "@/lib/terminal-fit-scheduler.js";
import { toTerminalKey, type TerminalRef } from "@/api/ownership.js";
import type { TerminalTarget } from "@/api/terminal-session-contract.js";

export interface TerminalEntry {
  terminal: Terminal;
  fitAddon: FitAddon;
  findController: TerminalFindController;
  attachmentElement?: HTMLElement;
  baseKeyEventHandler?: (event: KeyboardEvent) => boolean;
  invalidateSuggestionGeometry?: () => void;
  terminalRef?: TerminalRef;
  commitDesiredRenderer?: () => void;
}

export const terminalRegistry = new Map<string, TerminalEntry>();

type RegistrySubscriber = (id: string) => void;
const subscribers = new Set<RegistrySubscriber>();
const changeSubscribers = new Set<() => void>();
let registrySnapshot: ReadonlySet<string> = new Set();

function notifyRegistryChange(id: string): void {
  registrySnapshot = new Set(terminalRegistry.keys());
  subscribers.forEach((callback) => callback(id));
  changeSubscribers.forEach((callback) => callback());
}

export function registerTerminal(
  target: TerminalTarget | TerminalRef | string,
  terminal: Terminal,
  fitAddon: FitAddon,
  findController: TerminalFindController,
  attachmentElement?: HTMLElement,
  ref?: TerminalRef,
  commitDesiredRenderer?: () => void,
): TerminalEntry {
  const key = toTerminalKey(target);
  const terminalRef: TerminalRef | undefined =
    typeof target === "object"
      ? ("terminalId" in target
          ? { profileId: target.profileId, id: target.terminalId }
          : target)
      : ref;
  const entry: TerminalEntry = {
    terminal,
    fitAddon,
    findController,
    attachmentElement,
    terminalRef,
    commitDesiredRenderer,
  };
  terminalRegistry.set(key, entry);
  const rawId =
    typeof target === "object"
      ? ("terminalId" in target ? target.terminalId : target.id)
      : (terminalRef?.id ?? null);
  if (rawId && rawId !== key) {
    if (!terminalRegistry.has(rawId)) {
      terminalRegistry.set(rawId, entry);
    } else {
      const existing = terminalRegistry.get(rawId);
      // Fail closed whenever multiple entries share rawId (different profile, generation, epoch, or incarnation)
      if (existing && existing !== entry) {
        terminalRegistry.delete(rawId);
      }
    }
  }
  // Notify subscribers that a new terminal is ready
  notifyRegistryChange(key);
  return entry;
}
export function subscribeToRegistry(callback: RegistrySubscriber): () => void {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}

/** React-safe subscription for consumers that render registry availability. */
export function subscribeToRegistryChanges(callback: () => void): () => void {
  changeSubscribers.add(callback);
  return () => changeSubscribers.delete(callback);
}

export function getTerminalRegistrySnapshot(): ReadonlySet<string> {
  return registrySnapshot;
}

export function getTerminal(
  target: TerminalTarget | TerminalRef | string,
): TerminalEntry | undefined {
  const direct = terminalRegistry.get(toTerminalKey(target));
  if (direct) return direct;
  if (typeof target === "string") {
    return terminalRegistry.get(target);
  }
  return undefined;
}

export function hasTerminal(target: TerminalTarget | TerminalRef | string): boolean {
  return getTerminal(target) !== undefined;
}

export function removeTerminal(target: TerminalTarget | TerminalRef | string): void {
  const key = toTerminalKey(target);
  const entry =
    terminalRegistry.get(key) ??
    (typeof target === "string" ? terminalRegistry.get(target) : undefined);
  cancelScheduledTerminalFit(entry);
  let deleted = terminalRegistry.delete(key);
  if (typeof target === "string") {
    deleted = terminalRegistry.delete(target) || deleted;
  }
  const rawId =
    typeof target === "object"
      ? ("terminalId" in target ? target.terminalId : target.id)
      : (entry?.terminalRef?.id ?? null);
  if (rawId && terminalRegistry.get(rawId) === entry) {
    deleted = terminalRegistry.delete(rawId) || deleted;
  }
  if (deleted) {
    notifyRegistryChange(key);
  }
}
