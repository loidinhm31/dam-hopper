import { create } from "zustand";
import { persist, type StorageValue } from "zustand/middleware";
import {
  projectKey,
  parseProjectKey,
  projectTargetKey,
  normalizeProjectTargetRef,
  type ProjectTargetRef,
} from "@/api/ownership.js";
import { subscribeToProfileChanges } from "@/api/server-config.js";
import {
  toBranchCanonicalRef,
  isBranchCanonicalRef,
  resolveHistoryBranch,
  type HistoryBranchPreference,
  type ResolvedHistoryBranch,
} from "@/lib/git-branch-ref.js";
import { normalizeProjectTargetPath } from "@/lib/project-target-path.js";

export {
  toBranchCanonicalRef,
  isBranchCanonicalRef,
  resolveHistoryBranch,
  type HistoryBranchPreference,
  type ResolvedHistoryBranch,
};

export const GIT_HISTORY_STORAGE_KEY = "dam-hopper:git-history-state";
export const GIT_HISTORY_PERSIST_VERSION = 1;

/**
 * Persisted store schema for Git history preferences (version 1).
 */
export interface PersistedGitHistory {
  /**
   * Project keys selected on the Git page.
   * - null: never initialized (seeds once from Workspace canonical focus)
   * - []: explicit all projects selected
   * - string[]: sorted, deduplicated qualified project keys (projectKey() format)
   */
  gitPageSelection: string[] | null;

  /**
   * Selected root ID per qualified target.
   * Key: projectTargetKey([profileId, project, worktreePath|null])
   * Value: root ID (default is '.')
   */
  rootByTarget: Record<string, string>;

  /**
   * Branch preference per qualified scope.
   * Key: JSON tuple [profileId, project, worktreePath|null, rootId]
   * Value: HistoryBranchPreference (absence represents default follow-active)
   */
  branchByScope: Record<string, HistoryBranchPreference>;

  /**
   * Flag indicating corrupted or unknown-version saved selection.
   * When true, blocks Git bulk operations and automatic first-use seeding
   * until an explicit valid selection or Clear resets it.
   */
  selectionRecoveryRequired: boolean;
}

export interface GitHistoryScope {
  profileId: string;
  project: string;
  worktreePath?: string | null;
  rootId?: string | null;
}

export type GitHistoryScopeInput = GitHistoryScope | ProjectTargetRef;

/**
 * Normalizes a VCS root ID string. Empty, undefined, or '.' normalizes to '.'.
 */
export function normalizeRootId(rootId?: string | null): string {
  if (!rootId || typeof rootId !== "string") return ".";
  const trimmed = rootId.trim();
  return trimmed === "" || trimmed === "." ? "." : trimmed;
}

/**
 * Generates the deterministic JSON tuple key for a branch preference scope:
 * JSON.stringify([profileId, project, worktreePath | null, rootId])
 */
export function gitHistoryScopeKey(
  scope: GitHistoryScopeInput,
  rootIdOverride?: string | null,
): string {
  const profileId = scope.profileId?.trim();
  const project = scope.project?.trim();
  if (!profileId || !project) {
    throw new Error(
      "Git history scope requires nonempty profileId and project",
    );
  }

  const worktreePath = scope.worktreePath
    ? normalizeProjectTargetPath(scope.worktreePath)
    : null;
  const effectiveRoot =
    rootIdOverride !== undefined
      ? rootIdOverride
      : "rootId" in scope
        ? scope.rootId
        : null;
  const rootId = normalizeRootId(effectiveRoot);

  return JSON.stringify([profileId, project, worktreePath, rootId]);
}

/**
 * Parses a gitHistoryScopeKey JSON tuple.
 */
export function parseGitHistoryScopeKey(key: string): {
  profileId: string;
  project: string;
  worktreePath: string | null;
  rootId: string;
} | null {
  try {
    const parsed = JSON.parse(key);
    if (
      Array.isArray(parsed) &&
      parsed.length === 4 &&
      typeof parsed[0] === "string" &&
      parsed[0].trim().length > 0 &&
      typeof parsed[1] === "string" &&
      parsed[1].trim().length > 0 &&
      (parsed[2] === null || typeof parsed[2] === "string") &&
      typeof parsed[3] === "string" &&
      parsed[3].trim().length > 0
    ) {
      return {
        profileId: parsed[0].trim(),
        project: parsed[1].trim(),
        worktreePath: parsed[2] ? normalizeProjectTargetPath(parsed[2]) : null,
        rootId: normalizeRootId(parsed[3]),
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Parses a projectTargetKey JSON tuple: [profileId, project, worktreePath | null].
 */
export function parseProjectTargetKey(key: string): {
  profileId: string;
  project: string;
  worktreePath: string | null;
} | null {
  try {
    const parsed = JSON.parse(key);
    if (
      Array.isArray(parsed) &&
      parsed.length === 3 &&
      typeof parsed[0] === "string" &&
      parsed[0].trim().length > 0 &&
      typeof parsed[1] === "string" &&
      parsed[1].trim().length > 0 &&
      (parsed[2] === null || typeof parsed[2] === "string")
    ) {
      return {
        profileId: parsed[0].trim(),
        project: parsed[1].trim(),
        worktreePath: parsed[2] ? normalizeProjectTargetPath(parsed[2]) : null,
      };
    }
    return null;
  } catch {
    return null;
  }
}

function resolveTargetKey(target: ProjectTargetRef | string): string {
  if (typeof target === "string") {
    const parsed = parseProjectTargetKey(target);
    if (!parsed) {
      throw new Error(`Invalid project target key: ${target}`);
    }
    return JSON.stringify([
      parsed.profileId,
      parsed.project,
      parsed.worktreePath,
    ]);
  }
  const profileId = target.profileId?.trim();
  const project = target.project?.trim();
  if (!profileId || !project) {
    throw new Error(
      "Project target reference requires nonempty profileId and project",
    );
  }
  const norm = normalizeProjectTargetRef(target);
  return projectTargetKey(norm);
}

export interface GitHistoryStore extends PersistedGitHistory {
  /** Hydration readiness flag (transient; not persisted). */
  isHydrated: boolean;
  markHydrated: () => void;

  /** Set Git page checkbox selection (null = never initialized; [] = explicit all). */
  setGitPageSelection: (keys: string[] | null) => void;
  /** Clear Git page selection to explicit all ([]). */
  clearGitPageSelection: () => void;

  /** Set selected VCS root for a target. Absence represents default '.'. */
  setRootForTarget: (target: ProjectTargetRef | string, rootId: string) => void;
  /** Get selected VCS root for a target (defaults to '.'). */
  getRootForTarget: (target: ProjectTargetRef | string) => string;

  /** Set branch preference for a target/root scope. */
  setBranchPreference: (
    scope: GitHistoryScopeInput,
    preference: HistoryBranchPreference,
    rootIdOverride?: string | null,
  ) => void;
  /** Get branch preference for a target/root scope (defaults to follow-active). */
  getBranchPreference: (
    scope: GitHistoryScopeInput,
    rootIdOverride?: string | null,
  ) => HistoryBranchPreference;
  /** Reset pinned branch preference for a scope back to follow-active. */
  clearBranchPreference: (
    scope: GitHistoryScopeInput,
    rootIdOverride?: string | null,
  ) => void;

  /** Lifecycle handler for removed profile: clears its root/branch maps; retains selection keys. */
  handleProfileRemoved: (profileId: string) => void;

  /** Resets the selection recovery flag after explicit user selection or clear. */
  resetSelectionRecoveryRequired: () => void;
}

export const INITIAL_GIT_HISTORY_STATE: PersistedGitHistory = {
  gitPageSelection: null,
  rootByTarget: {},
  branchByScope: {},
  selectionRecoveryRequired: false,
};

/**
 * Validates and merges persisted data against current store state.
 * - Drops malformed root/branch records individually.
 * - Flags selectionRecoveryRequired on corrupt or unknown-version selection.
 * - Preserves valid independent entries.
 */
export function validateAndMergeGitHistoryState(
  persisted: unknown,
  current: GitHistoryStore,
): GitHistoryStore {
  if (persisted === null || persisted === undefined) {
    return current;
  }

  if (typeof persisted !== "object" || Array.isArray(persisted)) {
    return {
      ...current,
      selectionRecoveryRequired: true,
    };
  }

  let recoveryRequired = Boolean(current.selectionRecoveryRequired);
  if ("selectionRecoveryRequired" in persisted) {
    recoveryRequired =
      recoveryRequired || Boolean(persisted.selectionRecoveryRequired);
  }

  // Validate gitPageSelection
  let gitPageSelection: string[] | null = current.gitPageSelection;
  if ("gitPageSelection" in persisted) {
    const rawSel = persisted.gitPageSelection;
    if (rawSel === null) {
      gitPageSelection = null;
    } else if (Array.isArray(rawSel)) {
      const validKeys: string[] = [];
      let hadInvalidKey = false;
      for (const item of rawSel) {
        if (typeof item === "string") {
          const parsed = parseProjectKey(item);
          if (
            parsed &&
            parsed.profileId.trim().length > 0 &&
            parsed.project.trim().length > 0
          ) {
            validKeys.push(
              projectKey({
                profileId: parsed.profileId.trim(),
                project: parsed.project.trim(),
              }),
            );
            continue;
          }
        }
        hadInvalidKey = true;
      }
      if (hadInvalidKey) {
        recoveryRequired = true;
      }
      gitPageSelection =
        rawSel.length > 0 && validKeys.length === 0
          ? null
          : Array.from(new Set(validKeys)).sort();
    } else {
      recoveryRequired = true;
      gitPageSelection = null;
    }
  }

  // Validate rootByTarget
  const rootByTarget: Record<string, string> = {};
  if (
    "rootByTarget" in persisted &&
    persisted.rootByTarget &&
    typeof persisted.rootByTarget === "object" &&
    !Array.isArray(persisted.rootByTarget)
  ) {
    for (const [targetKey, rootId] of Object.entries(persisted.rootByTarget)) {
      const parsed = parseProjectTargetKey(targetKey);
      if (parsed && typeof rootId === "string" && rootId.trim().length > 0) {
        const normRoot = normalizeRootId(rootId);
        if (normRoot !== ".") {
          rootByTarget[targetKey] = normRoot;
        }
      }
      // Malformed root entries dropped individually
    }
  }

  // Validate branchByScope
  const branchByScope: Record<string, HistoryBranchPreference> = {};
  if (
    "branchByScope" in persisted &&
    persisted.branchByScope &&
    typeof persisted.branchByScope === "object" &&
    !Array.isArray(persisted.branchByScope)
  ) {
    for (const [scopeKey, pref] of Object.entries(persisted.branchByScope)) {
      const parsedScope = parseGitHistoryScopeKey(scopeKey);
      if (!parsedScope) continue;
      if (!pref || typeof pref !== "object" || Array.isArray(pref)) continue;

      if (!("mode" in pref)) continue;
      const mode = pref.mode;
      if (mode === "follow-active") {
        // absence is default; omit to keep store compact
      } else if (mode === "pinned") {
        if (
          "ref" in pref &&
          typeof pref.ref === "string" &&
          isBranchCanonicalRef(pref.ref)
        ) {
          branchByScope[scopeKey] = { mode: "pinned", ref: pref.ref.trim() };
        }
      }
      // Malformed or unknown mode entries dropped individually
    }
  }

  return {
    ...current,
    gitPageSelection,
    rootByTarget,
    branchByScope,
    selectionRecoveryRequired: recoveryRequired,
  };
}

function makeCorruptFallbackStorageValue(): StorageValue<PersistedGitHistory> {
  return {
    state: {
      ...INITIAL_GIT_HISTORY_STATE,
      selectionRecoveryRequired: true,
    },
    version: GIT_HISTORY_PERSIST_VERSION,
  };
}

/**
 * Resilient storage adapter wrapping localStorage with error catching and
 * corruption detection.
 */
function createSafeGitHistoryStorage() {
  return {
    getItem: (name: string): StorageValue<PersistedGitHistory> | null => {
      try {
        if (typeof window === "undefined" || !window.localStorage) return null;
        const raw = window.localStorage.getItem(name);
        if (raw === null) return null;
        try {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === "object") {
            return parsed as StorageValue<PersistedGitHistory>;
          }
          return makeCorruptFallbackStorageValue();
        } catch {
          // Corrupt raw JSON in localStorage
          return makeCorruptFallbackStorageValue();
        }
      } catch {
        // Storage access denied
        return null;
      }
    },
    setItem: (
      name: string,
      value: StorageValue<PersistedGitHistory>,
    ): void => {
      try {
        if (typeof window !== "undefined" && window.localStorage) {
          window.localStorage.setItem(name, JSON.stringify(value));
        }
      } catch {
        // Storage denied, quota exceeded, or disabled. In-memory state remains usable.
      }
    },
    removeItem: (name: string): void => {
      try {
        if (typeof window !== "undefined" && window.localStorage) {
          window.localStorage.removeItem(name);
        }
      } catch {
        // Storage denied
      }
    },
  };
}

export const useGitHistoryStore = create<GitHistoryStore>()(
  persist(
    (set, get) => ({
      ...INITIAL_GIT_HISTORY_STATE,
      isHydrated: false,

      markHydrated: () => {
        if (!get().isHydrated) {
          set({ isHydrated: true });
        }
      },

      setGitPageSelection: (keys) => {
        if (keys === null) {
          const current = get();
          if (
            current.gitPageSelection === null &&
            !current.selectionRecoveryRequired
          ) {
            return;
          }
          set({
            gitPageSelection: null,
            selectionRecoveryRequired: false,
          });
          return;
        }

        const validKeys: string[] = [];
        for (const item of keys) {
          if (typeof item === "string") {
            const parsed = parseProjectKey(item);
            if (
              parsed &&
              parsed.profileId.trim().length > 0 &&
              parsed.project.trim().length > 0
            ) {
              validKeys.push(
                projectKey({
                  profileId: parsed.profileId.trim(),
                  project: parsed.project.trim(),
                }),
              );
            }
          }
        }
        if (keys.length > 0 && validKeys.length === 0) {
          throw new Error("Git page selection contains no valid project keys");
        }
        const sorted = Array.from(new Set(validKeys)).sort();
        const current = get();
        const existing = current.gitPageSelection;
        const isSame =
          existing !== null &&
          existing.length === sorted.length &&
          existing.every((val, idx) => val === sorted[idx]) &&
          !current.selectionRecoveryRequired;

        if (isSame) return;

        set({
          gitPageSelection: sorted,
          selectionRecoveryRequired: false,
        });
      },

      clearGitPageSelection: () => {
        const current = get();
        if (
          current.gitPageSelection !== null &&
          current.gitPageSelection.length === 0 &&
          !current.selectionRecoveryRequired
        ) {
          return;
        }
        set({
          gitPageSelection: [],
          selectionRecoveryRequired: false,
        });
      },

      setRootForTarget: (target, rootId) => {
        const targetKey = resolveTargetKey(target);
        const normRoot = normalizeRootId(rootId);
        const current = get();
        const currentRoot = current.rootByTarget[targetKey] ?? ".";

        if (currentRoot === normRoot) return;

        const next = { ...current.rootByTarget };
        if (normRoot === ".") {
          delete next[targetKey];
        } else {
          next[targetKey] = normRoot;
        }

        set({ rootByTarget: next });
      },

      getRootForTarget: (target) => {
        const targetKey = resolveTargetKey(target);
        return get().rootByTarget[targetKey] ?? ".";
      },

      setBranchPreference: (scope, preference, rootIdOverride) => {
        const scopeKey = gitHistoryScopeKey(scope, rootIdOverride);
        const current = get();
        const existing = current.branchByScope[scopeKey] ?? {
          mode: "follow-active",
        };

        if (preference.mode === "pinned") {
          if (!isBranchCanonicalRef(preference.ref)) {
            throw new Error(
              `Branch preference requires canonical ref (refs/heads/... or refs/remotes/...): ${preference.ref}`,
            );
          }
          if (
            existing.mode === "pinned" &&
            existing.ref === preference.ref
          ) {
            return;
          }
          set({
            branchByScope: {
              ...current.branchByScope,
              [scopeKey]: { mode: "pinned", ref: preference.ref.trim() },
            },
          });
        } else {
          // follow-active mode: absence represents default follow-active
          if (existing.mode === "follow-active") return;
          const next = { ...current.branchByScope };
          delete next[scopeKey];
          set({ branchByScope: next });
        }
      },

      getBranchPreference: (scope, rootIdOverride) => {
        const scopeKey = gitHistoryScopeKey(scope, rootIdOverride);
        return (
          get().branchByScope[scopeKey] ?? {
            mode: "follow-active",
          }
        );
      },

      clearBranchPreference: (scope, rootIdOverride) => {
        const scopeKey = gitHistoryScopeKey(scope, rootIdOverride);
        const current = get();
        if (!current.branchByScope[scopeKey]) return;

        const next = { ...current.branchByScope };
        delete next[scopeKey];
        set({ branchByScope: next });
      },

      handleProfileRemoved: (profileId: string) => {
        if (!profileId || typeof profileId !== "string") return;
        const current = get();
        let rootsChanged = false;
        const nextRoots = { ...current.rootByTarget };
        for (const key of Object.keys(nextRoots)) {
          const parsed = parseProjectTargetKey(key);
          if (parsed && parsed.profileId === profileId) {
            delete nextRoots[key];
            rootsChanged = true;
          }
        }

        let branchesChanged = false;
        const nextBranches = { ...current.branchByScope };
        for (const key of Object.keys(nextBranches)) {
          const parsed = parseGitHistoryScopeKey(key);
          if (parsed && parsed.profileId === profileId) {
            delete nextBranches[key];
            branchesChanged = true;
          }
        }

        // Per design contract:
        // Clear only that profile's root/branch preferences using existing deleted lifecycle notification;
        // retain selected project keys as unavailable tombstones. Never turn last selected removed project into []/all.
        if (rootsChanged || branchesChanged) {
          set({
            rootByTarget: nextRoots,
            branchByScope: nextBranches,
          });
        }
      },

      resetSelectionRecoveryRequired: () => {
        if (!get().selectionRecoveryRequired) return;
        set({ selectionRecoveryRequired: false });
      },
    }),
    {
      name: GIT_HISTORY_STORAGE_KEY,
      version: GIT_HISTORY_PERSIST_VERSION,
      storage: createSafeGitHistoryStorage(),
      partialize: (state) => ({
        gitPageSelection: state.gitPageSelection,
        rootByTarget: state.rootByTarget,
        branchByScope: state.branchByScope,
        selectionRecoveryRequired: state.selectionRecoveryRequired,
      }),
      merge: (persistedState, currentState) =>
        validateAndMergeGitHistoryState(persistedState, currentState),
      migrate: (persistedState, version) => {
        const record =
          persistedState && typeof persistedState === "object"
            ? (persistedState as Record<string, unknown>)
            : {};
        const currentInitial = {
          ...INITIAL_GIT_HISTORY_STATE,
          selectionRecoveryRequired: version !== GIT_HISTORY_PERSIST_VERSION,
        };
        const merged = validateAndMergeGitHistoryState(record, {
          ...currentInitial,
          isHydrated: false,
          markHydrated: () => {},
          setGitPageSelection: () => {},
          clearGitPageSelection: () => {},
          setRootForTarget: () => {},
          getRootForTarget: () => ".",
          setBranchPreference: () => {},
          getBranchPreference: () => ({ mode: "follow-active" }),
          clearBranchPreference: () => {},
          handleProfileRemoved: () => {},
          resetSelectionRecoveryRequired: () => {},
        });
        return {
          gitPageSelection: merged.gitPageSelection,
          rootByTarget: merged.rootByTarget,
          branchByScope: merged.branchByScope,
          selectionRecoveryRequired: merged.selectionRecoveryRequired,
        };
      },
      onRehydrateStorage: () => () => {
        useGitHistoryStore.getState().markHydrated();
      },
    },
  ),
);

/**
 * Resets the in-memory and persistent state of useGitHistoryStore (primarily for testing).
 */
export function resetGitHistoryStore(
  initial?: Partial<PersistedGitHistory>,
): void {
  useGitHistoryStore.setState({
    ...INITIAL_GIT_HISTORY_STATE,
    ...initial,
    isHydrated: true,
  });
}

/**
 * Hook to observe hydration readiness of the Git history store.
 */
export function useGitHistoryHydrated(): boolean {
  return useGitHistoryStore((s) => s.isHydrated);
}

// Auto-subscribe to profile deletions
if (typeof window !== "undefined") {
  subscribeToProfileChanges((event) => {
    if (event.type === "deleted") {
      useGitHistoryStore
        .getState()
        .handleProfileRemoved(event.deletedProfileId);
    }
  });
}
