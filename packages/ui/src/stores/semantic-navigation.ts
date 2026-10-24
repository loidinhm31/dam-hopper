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
  readonly isCurrent?: () => boolean;
  readonly destinationContentSha256?: string;
  readonly destinationVersion?: number | null;
  readonly destinationIncarnation?: number | null;
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
    expectedIntent?: NavigationRevealIntent,
  ) => NavigationRevealIntent | null;
  getClient: (scopeKey: string) => SemanticClient | null;
  findClientForTab: (tabKey: string) => SemanticClient | null;
  getOrCreateClient: (options: SemanticClientOptions) => SemanticClient;
  releaseClient: (scopeKey: string, expectedClient?: SemanticClient) => void;
  disconnectClient: (scopeKey: string, expectedClient?: SemanticClient) => void;
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
            activeClients.delete(key);
            clientRefCounts.delete(key);
            client.disconnect();
            set((state) => {
              if (activeClients.has(key)) return state;
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

    consumeRevealIntent: (
      profileId,
      project,
      targetKey,
      relativePath,
      expectedIntent,
    ) => {
      const current = get().activeRevealIntent;
      if (!current) return null;
      if (expectedIntent && current !== expectedIntent) {
        return null;
      }

      // Enforce 10-second TTL and optional ephemeral validity predicate
      if (
        Date.now() - current.createdAt > 10_000 ||
        (current.isCurrent && !current.isCurrent())
      ) {
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
        if (client.canAccessModel(tabKey)) {
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

      const existing = activeClients.get(scopeKey);
      if (existing) {
        clientRefCounts.set(scopeKey, (clientRefCounts.get(scopeKey) ?? 0) + 1);
        return existing;
      }

      clientRefCounts.set(scopeKey, 1);

      const client = new SemanticClient({
        ...options,
        onStatusChange: (status, error) => {
          options.onStatusChange?.(status, error);
          if (activeClients.get(scopeKey) !== client) {
            return;
          }
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

    releaseClient: (scopeKey, expectedClient) => {
      const client = activeClients.get(scopeKey);
      if (!client) {
        clientRefCounts.delete(scopeKey);
        return;
      }
      if (expectedClient && client !== expectedClient) {
        return;
      }
      const currentCount = clientRefCounts.get(scopeKey) ?? 1;
      const nextCount = currentCount - 1;
      if (nextCount <= 0) {
        clientRefCounts.delete(scopeKey);
        activeClients.delete(scopeKey);
        client.disconnect();
        set((state) => {
          if (activeClients.has(scopeKey)) return state;
          const next = { ...state.clientStatuses };
          delete next[scopeKey];
          return { clientStatuses: next };
        });
      } else {
        clientRefCounts.set(scopeKey, nextCount);
      }
    },

    disconnectClient: (scopeKey, expectedClient) => {
      const client = activeClients.get(scopeKey);
      if (!client) {
        clientRefCounts.delete(scopeKey);
        return;
      }
      if (expectedClient && client !== expectedClient) {
        return;
      }
      clientRefCounts.delete(scopeKey);
      activeClients.delete(scopeKey);
      client.disconnect();
      set((state) => {
        if (activeClients.has(scopeKey)) return state;
        const next = { ...state.clientStatuses };
        delete next[scopeKey];
        return { clientStatuses: next };
      });
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
if (typeof window !== "undefined") {
  (window as unknown as { __dam_hopper_semantic_store?: unknown }).__dam_hopper_semantic_store =
    useSemanticNavigationStore;
}
