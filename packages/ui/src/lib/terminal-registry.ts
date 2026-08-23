// Module-level singleton registry for xterm.js Terminal instances.
// Terminals must NOT be stored in React state — this module provides
// imperative access keyed by sessionId.

import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import type { TerminalFindController } from "@/lib/terminal-find-controller.js";
import { cancelScheduledTerminalFit } from "@/lib/terminal-fit-scheduler.js";

export interface TerminalEntry {
  terminal: Terminal;
  fitAddon: FitAddon;
  findController: TerminalFindController;
  attachmentElement?: HTMLElement;
  baseKeyEventHandler?: (event: KeyboardEvent) => boolean;
  invalidateSuggestionGeometry?: () => void;
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
  id: string,
  terminal: Terminal,
  fitAddon: FitAddon,
  findController: TerminalFindController,
  attachmentElement?: HTMLElement,
): TerminalEntry {
  const entry = { terminal, fitAddon, findController, attachmentElement };
  terminalRegistry.set(id, entry);
  // Notify subscribers that a new terminal is ready
  notifyRegistryChange(id);
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

export function getTerminal(id: string): TerminalEntry | undefined {
  return terminalRegistry.get(id);
}

export function removeTerminal(id: string): void {
  cancelScheduledTerminalFit(terminalRegistry.get(id));
  if (terminalRegistry.delete(id)) notifyRegistryChange(id);
}
