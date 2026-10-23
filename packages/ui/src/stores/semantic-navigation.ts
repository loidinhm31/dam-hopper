/**
 * Ephemeral Semantic Navigation Store and Reveal Coordinator.
 *
 * Invariants:
 * - Ephemeral only; no source or sensitive file content persistence.
 * - Manages active SemanticClient instances scoped to captured profile/target.
 * - Coordinates cross-file navigation reveal intents with target generation checks.
 * - Consumed reveal intents are cleared atomically to prevent stale jumps.
 */

import { create } from "zustand";
import {
  SemanticClient,
  type SemanticClientOptions,
  type SemanticClientStatus,
} from "@/api/semantic-client.js";
import { defaultSemanticModelRegistry } from "@/lib/semantic-model-uri.js";

type SemanticToggleCallback = (enabled: boolean) => void;
const toggleListeners = new Set<SemanticToggleCallback>();

export function registerSemanticToggleListener(
  listener: SemanticToggleCallback,
): () => void {
  toggleListeners.add(listener);
  return () => toggleListeners.delete(listener);
}

export interface NavigationRevealIntent {
  readonly targetId: string;
  readonly profileId: string;
  readonly project: string;
  readonly targetKey: string;
  readonly relativePath: string;
  readonly range: {
    readonly startLineNumber: number;
    readonly startColumn: number;
    readonly endLineNumber: number;
    readonly endColumn: number;
  };
  readonly createdAt: number;
}

export interface SemanticNavigationState {
  globalSemanticEnabled: boolean;
  profileSemanticEnabled: Record<string, boolean>;
  activeRevealIntent: NavigationRevealIntent | null;
  clientStatuses: Record<string, SemanticClientStatus>;
  setGlobalSemanticEnabled: (enabled: boolean) => void;
  setProfileSemanticEnabled: (profileId: string, enabled: boolean) => void;
  isSemanticEnabledForProfile: (profileId: string) => boolean;
  setRevealIntent: (intent: NavigationRevealIntent | null) => void;
  consumeRevealIntent: (
    profileId: string,
    project: string,
    targetKey: string,
    relativePath: string,
  ) => NavigationRevealIntent | null;
  getClient: (scopeKey: string) => SemanticClient | null;
  findClientForTab: (tabKey: string) => SemanticClient | null;
  getOrCreateClient: (options: SemanticClientOptions) => SemanticClient;
  releaseClient: (scopeKey: string) => void;
  disconnectClient: (scopeKey: string) => void;
  disconnectAll: () => void;
}

export function buildSemanticScopeKey(
  profileId: string,
  serverUrl: string,
  project: string,
  targetKey: string,
  connectionGeneration: number,
): string {
  return `${profileId}::${serverUrl}::${project}::${targetKey}::gen_${connectionGeneration}`;
}
const activeClients = new Map<string, SemanticClient>();
const clientRefCounts = new Map<string, number>();

export const useSemanticNavigationStore = create<SemanticNavigationState>(
  (set, get) => ({
    globalSemanticEnabled: false,
    profileSemanticEnabled: {},
    activeRevealIntent: null,
    clientStatuses: {},

    setProfileSemanticEnabled: (profileId, enabled) => {
      const prevGlobal = get().globalSemanticEnabled;
      const nextProfiles = {
        ...get().profileSemanticEnabled,
        [profileId]: enabled,
      };
      const nextGlobal = Object.values(nextProfiles).some(Boolean);

      set({
        profileSemanticEnabled: nextProfiles,
        globalSemanticEnabled: nextGlobal,
      });

      if (prevGlobal !== nextGlobal) {
        for (const listener of toggleListeners) {
          try {
            listener(nextGlobal);
          } catch {
            // Ignore listener errors
          }
        }
      }
      if (!enabled) {
        for (const [key, client] of Array.from(activeClients.entries())) {
          if (key.startsWith(`${profileId}::`)) {
            client.disconnect();
            activeClients.delete(key);
            clientRefCounts.delete(key);
            set((state) => {
              const next = { ...state.clientStatuses };
              delete next[key];
              return { clientStatuses: next };
            });
          }
        }
      }
    },

    isSemanticEnabledForProfile: (profileId) => {
      return get().profileSemanticEnabled[profileId] ?? get().globalSemanticEnabled;
    },

    setGlobalSemanticEnabled: (enabled) => {
      set({ globalSemanticEnabled: enabled });
      for (const listener of toggleListeners) {
        try {
          listener(enabled);
        } catch {
          // Ignore listener errors
        }
      }
      if (!enabled) {
        get().disconnectAll();
      }
    },

    setRevealIntent: (intent) => {
      set({ activeRevealIntent: intent });
    },

    consumeRevealIntent: (profileId, project, targetKey, relativePath) => {
      const current = get().activeRevealIntent;
      if (!current) return null;

      // Enforce 10-second TTL
      if (Date.now() - current.createdAt > 10_000) {
        set({ activeRevealIntent: null });
        return null;
      }

      // Validate full identity match
      if (
        current.profileId === profileId &&
        current.project === project &&
        current.targetKey === targetKey &&
        current.relativePath.replace(/\\/g, "/") ===
          relativePath.replace(/\\/g, "/")
      ) {
        set({ activeRevealIntent: null });
        return current;
      }

      return null;
    },

    getClient: (scopeKey) => {
      return activeClients.get(scopeKey) ?? null;
    },

    findClientForTab: (tabKey) => {
      const model = defaultSemanticModelRegistry.getByTabKey(tabKey);
      if (!model) return null;
      for (const client of activeClients.values()) {
        const opts = (client as unknown as { options: SemanticClientOptions })
          .options;
        if (
          opts.profileId === model.identity.profileId &&
          opts.project === model.identity.project &&
          opts.targetKey === model.identity.targetKey
        ) {
          return client;
        }
      }
      return null;
    },

    getOrCreateClient: (options) => {
      const canonicalServerUrl =
        options.serverUrl ??
        options.wsUrl
          .replace(/^ws/, "http")
          .replace(/\/ws\/semantic\/v1.*$/, "");
      const scopeKey = buildSemanticScopeKey(
        options.profileId,
        canonicalServerUrl,
        options.project,
        options.targetKey,
        options.connectionGeneration,
      );

      clientRefCounts.set(scopeKey, (clientRefCounts.get(scopeKey) ?? 0) + 1);

      const existing = activeClients.get(scopeKey);
      if (existing) {
        return existing;
      }

      const client = new SemanticClient({
        ...options,
        onStatusChange: (status, error) => {
          options.onStatusChange?.(status, error);
          set((state) => ({
            clientStatuses: {
              ...state.clientStatuses,
              [scopeKey]: status,
            },
          }));
        },
      });

      activeClients.set(scopeKey, client);
      return client;
    },

    releaseClient: (scopeKey) => {
      const currentCount = clientRefCounts.get(scopeKey) ?? 1;
      const nextCount = currentCount - 1;
      if (nextCount <= 0) {
        clientRefCounts.delete(scopeKey);
        const client = activeClients.get(scopeKey);
        if (client) {
          client.disconnect();
          activeClients.delete(scopeKey);
          set((state) => {
            const next = { ...state.clientStatuses };
            delete next[scopeKey];
            return { clientStatuses: next };
          });
        }
      } else {
        clientRefCounts.set(scopeKey, nextCount);
      }
    },

    disconnectClient: (scopeKey) => {
      clientRefCounts.delete(scopeKey);
      const client = activeClients.get(scopeKey);
      if (client) {
        client.disconnect();
        activeClients.delete(scopeKey);
        set((state) => {
          const next = { ...state.clientStatuses };
          delete next[scopeKey];
          return { clientStatuses: next };
        });
      }
    },

    disconnectAll: () => {
      clientRefCounts.clear();
      for (const client of activeClients.values()) {
        client.disconnect();
      }
      activeClients.clear();
      set({ clientStatuses: {}, activeRevealIntent: null });
    },
  }),
);
