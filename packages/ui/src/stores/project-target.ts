import { create } from "zustand";
import { persist, type StorageValue } from "zustand/middleware";
import {
  normalizeProjectTarget,
  projectKey,
  type ProjectRef,
  type ProjectTargetRef,
  type ProjectTargetInput,
  type Worktree,
} from "@/api/client.js";
import { normalizeProjectTargetPath } from "@/lib/project-target-path.js";

export const PROJECT_TARGET_STORAGE_KEY = "dam-hopper:project-target-state";
export const PROJECT_TARGET_PERSIST_VERSION = 1;

export const ROOT_TARGET_KEY = "root";

export interface PersistedProjectTargetState {
  activeTargetByProject: Record<string, string>;
}

function createEmptyTargetMap<T = string>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

function copyTargetMap<T = string>(
  source?: Record<string, T>,
): Record<string, T> {
  const next = createEmptyTargetMap<T>();
  if (source) {
    Object.assign(next, source);
  }
  return next;
}

function isPlainObject(
  value: unknown,
): value is Record<string | symbol, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

/**
 * Validates and merges persisted project target state on every hydration.
 *
 * Enforces:
 * - Current live state / actions are preserved, not replaced by an untrusted spread.
 * - Missing or unreadable persisted state leaves current state unchanged.
 * - Accepted state validates `activeTargetByProject` as a plain object; missing or
 *   invalid shapes yield an empty null-prototype selection map.
 * - Entries are filtered individually: non-empty strings only. Whitespace-only values
 *   are rejected. Valid strings (including internal spaces and Windows/UNC paths)
 *   are preserved verbatim without trimming or normalization.
 * - Symbol keys in runtime payloads are rejected.
 * - Built on a null-prototype map to prevent prototype pollution or inherited method resolution.
 * - Transient failure maps, live action references, and unknown fields are excluded.
 * - Hydrated selections replace, rather than overlay, current selections.
 */
function validateAndMergeProjectTargetState(
  persistedState: unknown,
  currentState: ProjectTargetState,
): ProjectTargetState {
  if (!isPlainObject(persistedState)) {
    return currentState;
  }

  const rawMap = Object.prototype.hasOwnProperty.call(
    persistedState,
    "activeTargetByProject",
  )
    ? persistedState["activeTargetByProject"]
    : undefined;

  const sanitizedMap = createEmptyTargetMap();
  if (isPlainObject(rawMap)) {
    for (const key of Reflect.ownKeys(rawMap)) {
      if (typeof key !== "string" || key.trim().length === 0) {
        continue;
      }
      if (!Object.prototype.hasOwnProperty.call(rawMap, key)) {
        continue;
      }
      const val = rawMap[key];
      if (typeof val !== "string" || val.trim().length === 0) {
        continue;
      }
      sanitizedMap[key] = val;
    }
  }

  return {
    ...currentState,
    activeTargetByProject: sanitizedMap,
  };
}

export function areTargetMapsEqual(
  a?: Record<string, string>,
  b?: Record<string, string>,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

export function mergeTargetMapChanges(
  diskMap: Record<string, string>,
  localMap: Record<string, string>,
  baseMap: Record<string, string>,
): Record<string, string> {
  const merged = copyTargetMap(diskMap);

  // 1. Apply local additions and modifications (only keys where localMap differs from baseMap)
  for (const key of Object.keys(localMap)) {
    if (
      !Object.prototype.hasOwnProperty.call(baseMap, key) ||
      baseMap[key] !== localMap[key]
    ) {
      merged[key] = localMap[key]!;
    }
  }

  // 2. Apply local deletions (keys present in baseMap that localMap explicitly removed)
  for (const key of Object.keys(baseMap)) {
    if (!Object.prototype.hasOwnProperty.call(localMap, key)) {
      delete merged[key];
    }
  }

  return merged;
}

let lastSerializedPersistedValue: string | null = null;
let lastKnownPersistedMap: Record<string, string> = createEmptyTargetMap();

export function resetProjectTargetStorageTracker(): void {
  lastSerializedPersistedValue = null;
  lastKnownPersistedMap = createEmptyTargetMap();
}

/**
 * Safe synchronous storage adapter wrapping localStorage with error catching,
 * strict envelope validation, conflict-aware multi-tab merging, and redundant-write suppression.
 */
function createSafeProjectTargetStorage() {
  return {
    getItem: (
      name: string,
    ): StorageValue<PersistedProjectTargetState> | null => {
      try {
        if (typeof window === "undefined") {
          return null;
        }
        const storage = window.localStorage;
        if (!storage) {
          return null;
        }
        const raw = storage.getItem(name);
        if (raw === null) {
          lastSerializedPersistedValue = null;
          lastKnownPersistedMap = createEmptyTargetMap();
          return null;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          // Corrupt JSON: return null without writing or deleting records on read
          return null;
        }
        if (!isPlainObject(parsed)) {
          return null;
        }
        if (
          !Object.prototype.hasOwnProperty.call(parsed, "version") ||
          parsed["version"] !== PROJECT_TARGET_PERSIST_VERSION ||
          !Object.prototype.hasOwnProperty.call(parsed, "state")
        ) {
          return null;
        }
        const state = parsed["state"];
        if (!isPlainObject(state)) {
          return null;
        }
        if (isPlainObject(state["activeTargetByProject"])) {
          lastKnownPersistedMap = copyTargetMap(
            state["activeTargetByProject"] as Record<string, string>,
          );
          lastSerializedPersistedValue = raw;
        }
        return parsed as StorageValue<PersistedProjectTargetState>;
      } catch {
        // Storage access denied or unavailable
        return null;
      }
    },
    setItem: (
      name: string,
      value: StorageValue<PersistedProjectTargetState>,
    ): void => {
      try {
        if (typeof window === "undefined") {
          return;
        }
        const storage = window.localStorage;
        if (!storage) {
          return;
        }
        const incomingMap = value?.state?.activeTargetByProject;
        if (!isPlainObject(incomingMap)) {
          return;
        }

        // Skip writing when activeTargetByProject is identical to tracked state (e.g. transient failure map updates)
        if (areTargetMapsEqual(incomingMap, lastKnownPersistedMap)) {
          return;
        }

        // Conflict-aware merge: preserve concurrent project targets written by another tab
        let finalMap = copyTargetMap(incomingMap as Record<string, string>);
        const rawDisk = storage.getItem(name);
        if (rawDisk !== null && rawDisk !== lastSerializedPersistedValue) {
          try {
            const diskParsed = JSON.parse(rawDisk);
            if (
              isPlainObject(diskParsed) &&
              diskParsed["version"] === PROJECT_TARGET_PERSIST_VERSION &&
              isPlainObject(diskParsed["state"])
            ) {
              const diskState = diskParsed["state"] as Record<string, unknown>;
              if (isPlainObject(diskState["activeTargetByProject"])) {
                finalMap = mergeTargetMapChanges(
                  diskState["activeTargetByProject"] as Record<string, string>,
                  incomingMap as Record<string, string>,
                  lastKnownPersistedMap,
                );
              }
            }
          } catch {
            // Disk state corrupted, proceed with local incoming map
          }
        }

        const serialized = JSON.stringify({
          version: PROJECT_TARGET_PERSIST_VERSION,
          state: {
            activeTargetByProject: finalMap,
          },
        });
        storage.setItem(name, serialized);
        lastSerializedPersistedValue = serialized;
        lastKnownPersistedMap = copyTargetMap(finalMap);

        if (!areTargetMapsEqual(finalMap, incomingMap as Record<string, string>)) {
          useProjectTargetStore.setState({ activeTargetByProject: finalMap });
        }
      } catch {
        // Storage denied, quota exceeded, or disabled. In-memory state remains usable.
      }
    },
    removeItem: (name: string): void => {
      try {
        if (typeof window === "undefined") {
          return;
        }
        const storage = window.localStorage;
        if (!storage) {
          return;
        }
        storage.removeItem(name);
        lastSerializedPersistedValue = null;
        lastKnownPersistedMap = createEmptyTargetMap();
      } catch {
        // Storage access denied
      }
    },
  };
}

export interface ProjectTargetSnapshot {
  project: string;
  target: ProjectTargetRef;
  targetKey: string;
  label: string;
  isRoot: boolean;
  available: boolean;
  worktree?: Worktree;
}

export function projectScopeKey(project: string | ProjectRef): string {
  if (
    typeof project === "object" &&
    project !== null &&
    "profileId" in project &&
    Boolean(project.profileId)
  ) {
    return projectKey(project);
  }
  return typeof project === "string" ? project : project.project;
}

interface ProjectTargetState {
  /** Only non-root worktree paths are stored; absence means configured root. */
  activeTargetByProject: Record<string, string>;
  /** The last target replaced after discovery found it unavailable. */
  unavailableTargetByProject: Record<string, string>;
  /** All unavailable targets retained for orphan-session reconciliation. */
  unavailableTargetsByProject: Record<string, string[]>;
  selectTarget: (
    project: string | ProjectRef,
    worktreePath: string | null,
  ) => void;
  resetTarget: (project: string | ProjectRef) => void;
  markTargetUnavailable: (
    project: string | ProjectRef,
    worktreePath: string,
  ) => void;
  clearUnavailableTarget: (
    project: string | ProjectRef,
    worktreePath?: string,
  ) => void;
}

export function worktreeTargetKey(_project: string, worktreePath: string) {
  return `worktree:${normalizeProjectTargetPath(worktreePath)}`;
}

export const normalizeWorktreePath = normalizeProjectTargetPath;

function sameWorktreePath(left: string, right: string): boolean {
  return normalizeProjectTargetPath(left) === normalizeProjectTargetPath(right);
}

export function isSelectableWorktree(worktree: Worktree) {
  return worktree.isAvailable && !worktree.isPrunable;
}

export function worktreeStatusLabel(worktree: Worktree) {
  if (worktree.isPrunable) return "Prunable — unavailable";
  if (!worktree.isAvailable) {
    return worktree.isBare ? "Bare — unavailable" : "Unavailable";
  }

  const details = [
    worktree.isDetached ? "Detached" : null,
    worktree.isLocked ? "Locked" : null,
  ].filter((detail): detail is string => detail !== null);
  return details.length > 0 ? details.join(" · ") : "Available";
}

export function createProjectTargetSnapshot(
  project: string | ProjectRef,
  worktreePath: string | null | undefined,
  worktree?: Worktree,
): ProjectTargetSnapshot {
  const profileId =
    typeof project === "object" && project !== null && "profileId" in project
      ? project.profileId
      : undefined;
  const projectName = typeof project === "string" ? project : project.project;
  const target = normalizeProjectTarget(
    worktreePath == null
      ? (profileId
          ? { profileId, project: projectName }
          : { project: projectName })
      : (profileId
          ? { profileId, project: projectName, worktreePath }
          : { project: projectName, worktreePath }),
  );
  const targetPath = target.worktreePath;
  const isRoot = targetPath == null;

  if (targetPath == null) {
    return {
      project: projectName,
      target: profileId
        ? { profileId, project: projectName }
        : { project: projectName },
      targetKey: ROOT_TARGET_KEY,
      label: "Project root",
      isRoot: true,
      available: true,
      worktree,
    };
  }

  return {
    project: projectName,
    target,
    targetKey: worktreeTargetKey(projectName, targetPath),
    label: worktree?.branch || targetPath,
    isRoot,
    available: worktree != null && isSelectableWorktree(worktree),
    worktree,
  };
}

export const useProjectTargetStore = create<ProjectTargetState>()(
  persist(
    (set) => ({
      activeTargetByProject: createEmptyTargetMap<string>(),
      unavailableTargetByProject: createEmptyTargetMap<string>(),
      unavailableTargetsByProject: createEmptyTargetMap<string[]>(),
      selectTarget: (project, worktreePath) =>
        set((state) => {
          const key = projectScopeKey(project);
          const next = copyTargetMap(state.activeTargetByProject);
          if (worktreePath == null) {
            delete next[key];
            return {
              activeTargetByProject: next,
            };
          }
          next[key] = worktreePath;
          return {
            activeTargetByProject: next,
          };
        }),
      resetTarget: (project) =>
        set((state) => {
          const key = projectScopeKey(project);
          const next = copyTargetMap(state.activeTargetByProject);
          delete next[key];
          const nextUnavailable = copyTargetMap(state.unavailableTargetByProject);
          delete nextUnavailable[key];
          const nextUnavailableTargets = copyTargetMap(
            state.unavailableTargetsByProject,
          );
          delete nextUnavailableTargets[key];
          return {
            activeTargetByProject: next,
            unavailableTargetByProject: nextUnavailable,
            unavailableTargetsByProject: nextUnavailableTargets,
          };
        }),
      markTargetUnavailable: (project, worktreePath) =>
        set((state) => {
          const key = projectScopeKey(project);
          const next = copyTargetMap(state.activeTargetByProject);
          if (
            Object.prototype.hasOwnProperty.call(next, key) &&
            next[key] &&
            sameWorktreePath(next[key], worktreePath)
          ) {
            delete next[key];
          }
          const existing = Object.prototype.hasOwnProperty.call(
            state.unavailableTargetsByProject,
            key,
          )
            ? state.unavailableTargetsByProject[key] ?? []
            : [];
          const targets = existing.some((path) =>
            sameWorktreePath(path, worktreePath),
          )
            ? existing
            : [...existing, worktreePath];
          const nextUnavailable = copyTargetMap(state.unavailableTargetByProject);
          nextUnavailable[key] = worktreePath;
          const nextUnavailableTargets = copyTargetMap(
            state.unavailableTargetsByProject,
          );
          nextUnavailableTargets[key] = targets;
          return {
            activeTargetByProject: next,
            unavailableTargetByProject: nextUnavailable,
            unavailableTargetsByProject: nextUnavailableTargets,
          };
        }),
      clearUnavailableTarget: (project, worktreePath) =>
        set((state) => {
          const key = projectScopeKey(project);
          if (
            !Object.prototype.hasOwnProperty.call(
              state.unavailableTargetByProject,
              key,
            )
          ) {
            return state;
          }
          if (worktreePath == null) {
            const next = copyTargetMap(state.unavailableTargetByProject);
            const nextTargets = copyTargetMap(state.unavailableTargetsByProject);
            delete next[key];
            delete nextTargets[key];
            return {
              unavailableTargetByProject: next,
              unavailableTargetsByProject: nextTargets,
            };
          }

          const existingTargets = Object.prototype.hasOwnProperty.call(
            state.unavailableTargetsByProject,
            key,
          )
            ? state.unavailableTargetsByProject[key] ?? []
            : [];
          const remaining = existingTargets.filter(
            (path) => !sameWorktreePath(path, worktreePath),
          );
          const next = copyTargetMap(state.unavailableTargetByProject);
          const nextTargets = copyTargetMap(state.unavailableTargetsByProject);
          if (remaining.length === 0) {
            delete next[key];
            delete nextTargets[key];
          } else {
            nextTargets[key] = remaining;
            if (
              Object.prototype.hasOwnProperty.call(next, key) &&
              next[key] &&
              sameWorktreePath(next[key], worktreePath)
            ) {
              next[key] = remaining[remaining.length - 1]!;
            }
          }
          return {
            unavailableTargetByProject: next,
            unavailableTargetsByProject: nextTargets,
          };
        }),
    }),
    {
      name: PROJECT_TARGET_STORAGE_KEY,
      version: PROJECT_TARGET_PERSIST_VERSION,
      storage: createSafeProjectTargetStorage(),
      partialize: (state) => ({
        activeTargetByProject: state.activeTargetByProject,
      }),
      merge: (persistedState, currentState) =>
        validateAndMergeProjectTargetState(persistedState, currentState),
    },
  ),
);

/** Persist target loss even when the worktree panel is not mounted. */
export function markProjectTargetUnavailable(target: ProjectTargetInput): void {
  const normalized = normalizeProjectTarget(target);
  if (normalized.worktreePath == null) return;
  const projectInput = normalized.profileId
    ? { profileId: normalized.profileId, project: normalized.project }
    : normalized.project;
  useProjectTargetStore
    .getState()
    .markTargetUnavailable(projectInput, normalized.worktreePath);
}

/**
 * Subscribes to cross-tab storage events and synchronizes activeTargetByProject in real-time.
 */
export function initProjectTargetStorageSync(): () => void {
  if (typeof window === "undefined" || !window.addEventListener) {
    return () => {};
  }
  const handleStorageEvent = (event: StorageEvent) => {
    if (event.key !== PROJECT_TARGET_STORAGE_KEY) {
      return;
    }
    if (event.newValue === null) {
      resetProjectTargetStorageTracker();
      useProjectTargetStore.setState({
        activeTargetByProject: createEmptyTargetMap(),
      });
      return;
    }
    try {
      const parsed = JSON.parse(event.newValue);
      if (
        !isPlainObject(parsed) ||
        parsed["version"] !== PROJECT_TARGET_PERSIST_VERSION ||
        !isPlainObject(parsed["state"])
      ) {
        return;
      }
      const current = useProjectTargetStore.getState();
      const updated = validateAndMergeProjectTargetState(parsed["state"], current);
      lastSerializedPersistedValue = event.newValue;
      lastKnownPersistedMap = copyTargetMap(updated.activeTargetByProject);
      if (
        !areTargetMapsEqual(
          current.activeTargetByProject,
          updated.activeTargetByProject,
        )
      ) {
        useProjectTargetStore.setState({
          activeTargetByProject: updated.activeTargetByProject,
        });
      }
    } catch {
      // Malformed payload from another tab; safely ignore
    }
  };

  window.addEventListener("storage", handleStorageEvent);
  return () => {
    window.removeEventListener("storage", handleStorageEvent);
  };
}

if (typeof window !== "undefined") {
  initProjectTargetStorageSync();
}
