// Module-level singleton registry for xterm.js Terminal instances.
// Terminals must NOT be stored in React state — this module provides
// imperative access keyed by sessionId.

import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import type { TerminalFindController } from "@/lib/terminal-find-controller.js";
import { cancelScheduledTerminalFit } from "@/lib/terminal-fit-scheduler.js";
import { toTerminalKey, type TerminalRef } from "@/api/ownership.js";

export interface TerminalEntry {
  terminal: Terminal;
  fitAddon: FitAddon;
  findController: TerminalFindController;
  attachmentElement?: HTMLElement;
  baseKeyEventHandler?: (event: KeyboardEvent) => boolean;
  invalidateSuggestionGeometry?: () => void;
  terminalRef?: TerminalRef;
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
  target: TerminalRef | string,
  terminal: Terminal,
  fitAddon: FitAddon,
  findController: TerminalFindController,
  attachmentElement?: HTMLElement,
  ref?: TerminalRef,
): TerminalEntry {
  const key = toTerminalKey(target);
  const terminalRef = typeof target === "object" ? target : ref;
  const entry: TerminalEntry = {
    terminal,
    fitAddon,
    findController,
    attachmentElement,
    terminalRef,
  };
  terminalRegistry.set(key, entry);
  const rawId =
    typeof target === "object" ? target.id : (terminalRef?.id ?? null);
  if (rawId && rawId !== key && !terminalRegistry.has(rawId)) {
    terminalRegistry.set(rawId, entry);
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
  target: TerminalRef | string,
): TerminalEntry | undefined {
  const key = toTerminalKey(target);
  const direct = terminalRegistry.get(key);
  if (direct) return direct;
  if (typeof target === "string") {
    const raw = terminalRegistry.get(target);
    if (raw) return raw;
    for (const entry of terminalRegistry.values()) {
      if (entry.terminalRef?.id === target) return entry;
    }
  }
  return undefined;
}

export function hasTerminal(target: TerminalRef | string): boolean {
  return getTerminal(target) !== undefined;
}

export function removeTerminal(target: TerminalRef | string): void {
  const key = toTerminalKey(target);
  const entry =
    terminalRegistry.get(key) ??
    (typeof target === "string" ? terminalRegistry.get(target) : undefined);
  cancelScheduledTerminalFit(entry);
  let deleted = terminalRegistry.delete(key);
  if (typeof target === "string") {
    deleted = terminalRegistry.delete(target) || deleted;
  }
  if (entry?.terminalRef?.id) {
    const rawEntry = terminalRegistry.get(entry.terminalRef.id);
    if (rawEntry === entry) {
      deleted = terminalRegistry.delete(entry.terminalRef.id) || deleted;
    }
  }
  if (deleted) notifyRegistryChange(key);
}
