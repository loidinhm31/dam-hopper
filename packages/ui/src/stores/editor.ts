/**
 * Editor store — manages open tabs, content, view state, and save protocol.
 *
 * Tabs are keyed by a composite project + target + content identity.
 * - content: decoded UTF-8 string (what Monaco sees)
 * - binaryBase64: raw base64 bytes for binary hex-preview (binary tier only)
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { getTransport } from "@/api/transport.js";
import type { WsTransport } from "@/api/ws-transport.js";
import { fileTier, isPreviewOnlyFile } from "@/lib/file-tier.js";
import type { FileTier as FT } from "@/lib/file-tier.js";
import { isVideoFile } from "@/lib/video-file.js";
import type { FsArborNode } from "@/api/fs-types.js";
import {
  isProjectTargetError,
  normalizeProjectTarget,
  projectTargetCacheKey,
  type ProjectTargetInput,
  type ProjectTargetRef,
} from "@/api/client.js";
import { markProjectTargetUnavailable } from "@/stores/project-target.js";
export type FileTier = FT | "diff";

const EDITOR_PERSIST_VERSION = 1;

export function editorTargetScopeKey(target: ProjectTargetInput): string {
  const normalized = normalizeProjectTarget(target);
  return `${normalized.project}::${projectTargetCacheKey(normalized)}`;
}

/** Count unsaved editor tabs owned by one immutable project target. */
export function countDirtyTabsForTarget(
  tabs: ReadonlyArray<Pick<Tab, "project" | "target" | "dirty">>,
  target: ProjectTargetInput,
): number {
  const scopeKey = editorTargetScopeKey(target);
  return tabs.filter(
    (tab) =>
      tab.dirty && editorTargetScopeKey(tab.target ?? tab.project) === scopeKey,
  ).length;
}

function compositeTabKey(
  kind: "file" | "diff",
  target: ProjectTargetInput,
  path: string,
  extra: readonly unknown[] = [],
): string {
  const normalized = normalizeProjectTarget(target);
  return JSON.stringify([
    kind,
    normalized.project,
    projectTargetCacheKey(normalized),
    path,
    ...extra,
  ]);
}

export function editorFileTabKey(
  target: ProjectTargetInput,
  path: string,
): string {
  return compositeTabKey("file", target, path);
}

export function editorDiffTabKey(
  target: ProjectTargetInput,
  path: string,
  commitHash?: string,
  gitRootId?: string,
  diffPath?: string,
): string {
  return compositeTabKey("diff", target, path, [
    commitHash ?? null,
    gitRootId ?? ".",
    diffPath ?? path,
  ]);
}

function targetForTab(tab: Pick<Tab, "target" | "project">): ProjectTargetRef {
  return normalizeProjectTarget(tab.target ?? tab.project);
}

function targetUnavailableForError(
  target: ProjectTargetInput,
  ...values: Array<string | null | undefined>
): boolean {
  const unavailable = isProjectTargetError(...values);
  if (unavailable) markProjectTargetUnavailable(target);
  return unavailable;
}

function errorCode(value: unknown): string | undefined {
  return value && typeof value === "object" && "code" in value
    ? String((value as { code?: unknown }).code ?? "")
    : undefined;
}

export function editorActiveKeyForTarget(
  activeKeys: Record<string, string | null>,
  target: ProjectTargetInput,
): string | null {
  const normalized = normalizeProjectTarget(target);
  const scopeKey = editorTargetScopeKey(normalized);
  if (Object.prototype.hasOwnProperty.call(activeKeys, scopeKey)) {
    return activeKeys[scopeKey];
  }
  return normalized.worktreePath == null
    ? (activeKeys[normalized.project] ?? null)
    : null;
}

export interface Tab {
  /** Composite identity: project + target + content kind + path dimensions. */
  key: string;
  project: string;
  /** Immutable, normalized target captured when the tab was opened. */
  target: ProjectTargetRef;
  /** Stable root/worktree discriminator used by UI and cache boundaries. */
  targetKey: string;
  /** False after the server reports that this target disappeared. */
  targetAvailable: boolean;
  path: string;
  name: string;
  mtime: number; // Unix seconds; used for conflict detection
  size: number;
  tier: FileTier;
  mime?: string;
  /** Decoded UTF-8 content — used by Monaco (normal/degraded tiers). */
  content: string;
  /** Snapshot of content at last save/load — dirty = content !== savedContent. */
  savedContent: string;
  /** Raw base64 content for BinaryPreview (binary tier only). */
  binaryBase64?: string;
  dirty: boolean;
  viewState?: unknown; // monaco ICodeEditorViewState
  loading: boolean;
  saving: boolean;
  conflicted: boolean;
  /** File changed on disk while this tab has unsaved edits. */
  stale?: boolean;
  error?: string;
  /** Extra data for diff tabs. */
  fileStatus?: string;
  additions?: number;
  deletions?: number;
  commitHash?: string;
  gitRootId?: string;
  diffPath?: string;
  /** Whether the tab metadata was restored but content still needs to be loaded from server. */
  hydrated?: boolean;
  /** Session-only counter used to remount a clean video preview after external changes. */
  previewRevision?: number;
}

interface EditorState {
  tabs: Tab[];
  activeKeys: Record<string, string | null>;
  /** Ephemeral request generations invalidate responses after close/reopen. */
  requestGenerations: Record<string, number>;
  beginAsyncRequest: (key: string) => number;
  isCurrentAsyncRequest: (key: string, generation: number) => boolean;

  open: (target: ProjectTargetInput, node: FsArborNode) => Promise<void>;
  openDiff: (
    target: ProjectTargetInput,
    path: string,
    fileStatus: string,
    additions: number,
    deletions: number,
    commitHash?: string,
    gitRootId?: string,
    diffPath?: string,
  ) => void;
  close: (key: string) => void;
  closeOthers: (project: string, key: string) => void;
  closeAll: (project: string, target?: ProjectTargetInput) => void;
  setActive: (target: ProjectTargetInput, key: string | null) => void;
  setContent: (key: string, content: string) => void;
  save: (key: string) => Promise<boolean>;
  forceOverwrite: (key: string) => Promise<void>;
  reloadTab: (key: string) => Promise<void>;
  clearConflict: (key: string) => void;
  clearStale: (key: string) => void;
  reconcileGitMutationFiles: (
    target: ProjectTargetInput,
    paths: string[],
  ) => Promise<void>;
  reconcileGitProjectFiles: (target: ProjectTargetInput) => Promise<void>;
  markSaved: (key: string, mtime: number) => void;
  saveViewState: (key: string, vs: unknown) => void;
  getActiveTab: (target: ProjectTargetInput) => Tab | null;
  loadContent: (key: string) => Promise<void>;
  markTargetUnavailable: (
    target: ProjectTargetInput,
    worktreePath?: string,
  ) => void;
  markTargetAvailable: (
    target: ProjectTargetInput,
    worktreePath?: string,
  ) => void;
}

function availabilityTarget(
  target: ProjectTargetInput,
  worktreePath?: string,
): ProjectTargetRef {
  if (worktreePath === undefined) return normalizeProjectTarget(target);
  return normalizeProjectTarget({
    project: typeof target === "string" ? target : target.project,
    worktreePath,
  });
}

interface MigratedEditorTab {
  key: string;
  project: string;
  target: ProjectTargetRef;
  targetKey: string;
  targetAvailable: boolean;
  path: string;
  name: string;
  mtime: number;
  size: number;
  tier: FileTier;
  mime: string | undefined;
  content: string;
  savedContent: string;
  dirty: false;
  loading: false;
  saving: false;
  conflicted: false;
  stale: false;
  fileStatus: string | undefined;
  additions: number | undefined;
  deletions: number | undefined;
  commitHash: string | undefined;
  gitRootId: string | undefined;
  diffPath: string | undefined;
  hydrated: true;
}

function transport(): WsTransport {
  return getTransport() as WsTransport;
}

/** Decode base64 → UTF-8 string using TextDecoder (handles multi-byte chars). */
function b64ToUtf8(b64: string): string {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function persistedTarget(
  raw: Record<string, unknown>,
  project: string,
): ProjectTargetRef {
  const rawTarget = asRecord(raw.target);
  const worktreePath =
    typeof rawTarget?.worktreePath === "string"
      ? rawTarget.worktreePath
      : typeof raw.worktreePath === "string"
        ? raw.worktreePath
        : null;
  return normalizeProjectTarget(
    worktreePath == null ? { project } : { project, worktreePath },
  );
}

function persistedTab(value: unknown, keyMap: Map<string, string>): Tab | null {
  const raw = asRecord(value);
  if (!raw || typeof raw.project !== "string" || typeof raw.path !== "string") {
    return null;
  }

  const project = raw.project;
  const target = persistedTarget(raw, project);
  const tierValue = raw.tier;
  const tier: FileTier =
    tierValue === "normal" ||
    tierValue === "degraded" ||
    tierValue === "large" ||
    tierValue === "binary" ||
    tierValue === "image" ||
    tierValue === "video" ||
    tierValue === "diff"
      ? tierValue
      : "normal";
  const commitHash =
    typeof raw.commitHash === "string" ? raw.commitHash : undefined;
  const gitRootId =
    typeof raw.gitRootId === "string" ? raw.gitRootId : undefined;
  const diffPath = typeof raw.diffPath === "string" ? raw.diffPath : undefined;
  const key =
    tier === "diff"
      ? editorDiffTabKey(target, raw.path, commitHash, gitRootId, diffPath)
      : editorFileTabKey(target, raw.path);
  if (typeof raw.key === "string") keyMap.set(raw.key, key);
  keyMap.set(key, key);

  return {
    key,
    project,
    target,
    targetKey: projectTargetCacheKey(target),
    targetAvailable: raw.targetAvailable !== false,
    path: raw.path,
    name: typeof raw.name === "string" ? raw.name : raw.path,
    mtime: typeof raw.mtime === "number" ? raw.mtime : 0,
    size: typeof raw.size === "number" ? raw.size : 0,
    tier,
    mime: typeof raw.mime === "string" ? raw.mime : undefined,
    content: typeof raw.content === "string" ? raw.content : "",
    savedContent: typeof raw.savedContent === "string" ? raw.savedContent : "",
    dirty: false,
    loading: false,
    saving: false,
    conflicted: false,
    fileStatus: typeof raw.fileStatus === "string" ? raw.fileStatus : undefined,
    additions: typeof raw.additions === "number" ? raw.additions : undefined,
    deletions: typeof raw.deletions === "number" ? raw.deletions : undefined,
    commitHash,
    gitRootId,
    diffPath,
    hydrated: true,
    stale: false,
  };
}

export function migrateEditorState(persisted: unknown): {
  tabs: MigratedEditorTab[];
  activeKeys: Record<string, string | null>;
} {
  const rawState = asRecord(persisted) ?? {};
  const rawTabs = Array.isArray(rawState.tabs) ? rawState.tabs : [];
  const keyMap = new Map<string, string>();
  const tabs = rawTabs.flatMap((tab) => {
    const normalized = persistedTab(tab, keyMap);
    if (!normalized) return [];
    return [
      {
        key: normalized.key,
        project: normalized.project,
        target: normalized.target,
        targetKey: normalized.targetKey,
        targetAvailable: normalized.targetAvailable,
        path: normalized.path,
        name: normalized.name,
        mtime: normalized.mtime,
        size: normalized.size,
        tier: normalized.tier,
        mime: normalized.mime,
        content: normalized.content,
        savedContent: normalized.savedContent,
        dirty: false as const,
        loading: false as const,
        saving: false as const,
        conflicted: false as const,
        stale: false as const,
        fileStatus: normalized.fileStatus,
        additions: normalized.additions,
        deletions: normalized.deletions,
        commitHash: normalized.commitHash,
        gitRootId: normalized.gitRootId,
        diffPath: normalized.diffPath,
        hydrated: true as const,
      },
    ];
  });
  const activeKeys: Record<string, string | null> = {};
  const rawActiveKeys = asRecord(rawState.activeKeys);
  if (rawActiveKeys) {
    for (const [legacyScope, value] of Object.entries(rawActiveKeys)) {
      if (value !== null && typeof value !== "string") continue;
      const mappedKey = value === null ? null : (keyMap.get(value) ?? value);
      const tab = mappedKey
        ? tabs.find((candidate) => candidate.key === mappedKey)
        : undefined;
      if (tab) {
        activeKeys[editorTargetScopeKey(tab.target)] = tab.key;
      } else if (value === null && legacyScope.includes("::")) {
        activeKeys[legacyScope] = null;
      }
    }
  }
  return { tabs, activeKeys };
}

export const useEditorStore = create<EditorState>()(
  persist(
    (set, get) => {
      const beginRequest = (key: string) => {
        const generation = (get().requestGenerations[key] ?? 0) + 1;
        set((state) => ({
          requestGenerations: {
            ...state.requestGenerations,
            [key]: generation,
          },
        }));
        return generation;
      };

      const isCurrentRequest = (key: string, generation: number) => {
        const state = get();
        return (
          state.requestGenerations[key] === generation &&
          state.tabs.some((tab) => tab.key === key)
        );
      };

      return {
        tabs: [],
        activeKeys: {},
        requestGenerations: {},
        beginAsyncRequest: beginRequest,
        isCurrentAsyncRequest: isCurrentRequest,

        // ---------------------------------------------------------------------------
        // openDiff
        // ---------------------------------------------------------------------------
        openDiff: (
          target: ProjectTargetInput,
          path: string,
          fileStatus: string,
          additions: number,
          deletions: number,
          commitHash?: string,
          gitRootId?: string,
          diffPath?: string,
        ) => {
          const targetRef = normalizeProjectTarget(target);
          const project = targetRef.project;
          const scopeKey = editorTargetScopeKey(targetRef);
          const key = editorDiffTabKey(
            targetRef,
            path,
            commitHash,
            gitRootId,
            diffPath,
          );
          const existing = get().tabs.find((t) => t.key === key);
          if (existing) {
            set((s) => ({
              activeKeys: { ...s.activeKeys, [scopeKey]: key },
            }));
            return;
          }

          const newTab: Tab = {
            key,
            project,
            target: targetRef,
            targetKey: projectTargetCacheKey(targetRef),
            targetAvailable: true,
            path,
            name: commitHash
              ? `Diff[${commitHash.substring(0, 7)}]: ${path.split("/").pop()}`
              : `Diff: ${path.split("/").pop()}`,
            mtime: 0,
            size: 0,
            tier: "diff",
            content: "",
            savedContent: "",
            dirty: false,
            loading: false,
            saving: false,
            conflicted: false,
            fileStatus,
            additions,
            deletions,
            commitHash,
            gitRootId,
            diffPath,
          };

          set((s) => ({
            tabs: [...s.tabs, newTab],
            activeKeys: { ...s.activeKeys, [scopeKey]: key },
          }));
        },

        open: async (target: ProjectTargetInput, node: FsArborNode) => {
          if (node.kind !== "file") return;

          const targetRef = normalizeProjectTarget(target);
          const project = targetRef.project;
          const scopeKey = editorTargetScopeKey(targetRef);
          const key = editorFileTabKey(targetRef, node.id);
          const existing = get().tabs.find((t) => t.key === key);
          if (existing) {
            set((s) => ({
              activeKeys: { ...s.activeKeys, [scopeKey]: key },
            }));
            return;
          }

          // Optimistic tier guess from FsArborNode (no isBinary from tree)
          const optimisticTier = fileTier(node.name, node.size, false);

          const placeholder: Tab = {
            key,
            project,
            target: targetRef,
            targetKey: projectTargetCacheKey(targetRef),
            targetAvailable: true,
            path: node.id,
            name: node.name,
            mtime: node.mtime,
            size: node.size,
            tier: optimisticTier,
            content: "",
            savedContent: "",
            dirty: false,
            loading: !isPreviewOnlyFile(optimisticTier, node.name),
            saving: false,
            conflicted: false,
          };

          set((s) => ({
            tabs: [...s.tabs, placeholder],
            activeKeys: { ...s.activeKeys, [scopeKey]: key },
          }));

          // Video playback owns its native range requests; never materialize it via fsRead.
          // Large files remain handled by LargeFileViewer's bounded range reads.
          if (
            isPreviewOnlyFile(optimisticTier, node.name) ||
            optimisticTier === "large"
          ) {
            set((s) => ({
              tabs: s.tabs.map((t) =>
                t.key === key ? { ...t, loading: false } : t,
              ),
            }));
            return;
          }

          const requestGeneration = beginRequest(key);
          try {
            const result = await transport().fsRead(targetRef, node.id);
            if (!isCurrentRequest(key, requestGeneration)) return;

            if (!result.ok && result.code === "TOO_LARGE") {
              const tl = result as {
                ok: false;
                code: "TOO_LARGE";
                binary: boolean;
                mime?: string;
                mtime: number;
                size: number;
              };
              set((s) => ({
                tabs: s.tabs.map((t) =>
                  t.key === key
                    ? {
                        ...t,
                        loading: false,
                        tier: tl.binary ? "binary" : "large",
                        mime: tl.mime,
                        mtime: tl.mtime,
                        size: tl.size,
                      }
                    : t,
                ),
              }));
              return;
            }

            if (!result.ok) {
              const targetUnavailable = targetUnavailableForError(
                targetRef,
                result.code,
                "message" in result ? result.message : undefined,
              );
              set((s) => ({
                tabs: s.tabs.map((t) =>
                  t.key === key
                    ? {
                        ...t,
                        loading: false,
                        error: `Read error: ${result.code}`,
                        targetAvailable: !targetUnavailable,
                      }
                    : t,
                ),
              }));
              return;
            }

            const tier = fileTier(node.name, result.size, result.binary);
            const decoded = result.binary ? "" : b64ToUtf8(result.content);
            const binaryBase64 = result.binary ? result.content : undefined;

            set((s) => ({
              tabs: s.tabs.map((t) =>
                t.key === key
                  ? {
                      ...t,
                      loading: false,
                      tier,
                      mime: result.mime,
                      mtime: result.mtime,
                      size: result.size,
                      content: decoded,
                      savedContent: decoded,
                      binaryBase64,
                    }
                  : t,
              ),
            }));
          } catch (e) {
            const message = e instanceof Error ? e.message : "Unknown error";
            if (!isCurrentRequest(key, requestGeneration)) return;
            const targetUnavailable = targetUnavailableForError(
              targetRef,
              errorCode(e),
              message,
            );
            set((s) => ({
              tabs: s.tabs.map((t) =>
                t.key === key
                  ? {
                      ...t,
                      loading: false,
                      error: message,
                      targetAvailable: !targetUnavailable,
                    }
                  : t,
              ),
            }));
          }
        },

        // ---------------------------------------------------------------------------
        // close
        // ---------------------------------------------------------------------------
        close: (key: string) => {
          set((s) => {
            const tab = s.tabs.find((t) => t.key === key);
            if (!tab) return s;
            const project = tab.project;
            const target = targetForTab(tab);
            const scopeKey = editorTargetScopeKey(target);
            const scopeTabs = s.tabs.filter(
              (candidate) =>
                candidate.project === project &&
                editorTargetScopeKey(targetForTab(candidate)) === scopeKey,
            );
            const idx = scopeTabs.findIndex((t) => t.key === key);

            const nextTabs = s.tabs.filter((t) => t.key !== key);
            let nextActive = editorActiveKeyForTarget(s.activeKeys, target);
            if (nextActive === key) {
              nextActive =
                scopeTabs[idx - 1]?.key ?? scopeTabs[idx + 1]?.key ?? null;
            }
            const requestGenerations = { ...s.requestGenerations };
            requestGenerations[key] = (requestGenerations[key] ?? 0) + 1;
            return {
              tabs: nextTabs,
              activeKeys: { ...s.activeKeys, [scopeKey]: nextActive },
              requestGenerations,
            };
          });
        },

        closeOthers: (project: string, key: string) => {
          set((s) => {
            const keepTab = s.tabs.find(
              (tab) => tab.project === project && tab.key === key,
            );
            if (!keepTab) return s;
            const scopeKey = editorTargetScopeKey(targetForTab(keepTab));
            const removedKeys = s.tabs
              .filter(
                (tab) =>
                  tab.project === project &&
                  editorTargetScopeKey(targetForTab(tab)) === scopeKey &&
                  tab.key !== key,
              )
              .map((tab) => tab.key);
            const requestGenerations = { ...s.requestGenerations };
            for (const removedKey of removedKeys) {
              requestGenerations[removedKey] =
                (requestGenerations[removedKey] ?? 0) + 1;
            }

            return {
              tabs: s.tabs.filter(
                (tab) =>
                  tab.project !== project ||
                  editorTargetScopeKey(targetForTab(tab)) !== scopeKey ||
                  tab.key === key,
              ),
              activeKeys: { ...s.activeKeys, [scopeKey]: key },
              requestGenerations,
            };
          });
        },

        closeAll: (project: string, target?: ProjectTargetInput) => {
          set((s) => {
            if (target == null) {
              const removedKeys = s.tabs
                .filter((tab) => tab.project === project)
                .map((tab) => tab.key);
              const requestGenerations = { ...s.requestGenerations };
              for (const removedKey of removedKeys) {
                requestGenerations[removedKey] =
                  (requestGenerations[removedKey] ?? 0) + 1;
              }
              const activeKeys = Object.fromEntries(
                Object.entries(s.activeKeys).filter(
                  ([scope]) =>
                    scope !== project && !scope.startsWith(`${project}::`),
                ),
              );
              return {
                tabs: s.tabs.filter((tab) => tab.project !== project),
                activeKeys,
                requestGenerations,
              };
            }
            const scopeKey = editorTargetScopeKey(target);
            const removedKeys = s.tabs
              .filter(
                (tab) =>
                  tab.project === project &&
                  editorTargetScopeKey(targetForTab(tab)) === scopeKey,
              )
              .map((tab) => tab.key);
            const requestGenerations = { ...s.requestGenerations };
            for (const removedKey of removedKeys) {
              requestGenerations[removedKey] =
                (requestGenerations[removedKey] ?? 0) + 1;
            }
            return {
              tabs: s.tabs.filter(
                (tab) =>
                  tab.project !== project ||
                  editorTargetScopeKey(targetForTab(tab)) !== scopeKey,
              ),
              activeKeys: { ...s.activeKeys, [scopeKey]: null },
              requestGenerations,
            };
          });
        },

        setActive: (target: ProjectTargetInput, key: string | null) =>
          set((s) => ({
            activeKeys: {
              ...s.activeKeys,
              [editorTargetScopeKey(target)]: key,
            },
          })),

        setContent: (key: string, content: string) => {
          set((s) => ({
            tabs: s.tabs.map((t) =>
              t.key === key
                ? { ...t, content, dirty: content !== t.savedContent }
                : t,
            ),
          }));
        },

        // ---------------------------------------------------------------------------
        // save
        // ---------------------------------------------------------------------------
        save: async (key: string) => {
          const tab = get().tabs.find((t) => t.key === key);
          if (
            !tab ||
            tab.saving ||
            !tab.dirty ||
            !tab.targetAvailable ||
            tab.tier === "binary" ||
            tab.tier === "large" ||
            isPreviewOnlyFile(tab.tier, tab.name)
          )
            return false;

          const requestGeneration = beginRequest(key);
          set((s) => ({
            tabs: s.tabs.map((t) =>
              t.key === key ? { ...t, saving: true } : t,
            ),
          }));

          try {
            const result = await transport().fsWriteFile(
              tab.target,
              tab.path,
              tab.content,
              tab.mtime,
            );
            if (!isCurrentRequest(key, requestGeneration)) return false;

            if (result.ok) {
              set((s) => ({
                tabs: s.tabs.map((t) =>
                  t.key === key
                    ? {
                        ...t,
                        saving: false,
                        dirty: false,
                        stale: false,
                        savedContent: t.content,
                        mtime: result.newMtime,
                      }
                    : t,
                ),
              }));
              return true;
            } else if (!result.ok && result.conflict) {
              set((s) => ({
                tabs: s.tabs.map((t) =>
                  t.key === key ? { ...t, saving: false, conflicted: true } : t,
                ),
              }));
            } else {
              const errMsg =
                !result.ok && !result.conflict ? result.error : "unknown error";
              const targetUnavailable = targetUnavailableForError(
                tab.target,
                errMsg,
              );
              set((s) => ({
                tabs: s.tabs.map((t) =>
                  t.key === key
                    ? {
                        ...t,
                        saving: false,
                        targetAvailable: !targetUnavailable,
                        error: `Save failed: ${errMsg}`,
                      }
                    : t,
                ),
              }));
            }
          } catch (e) {
            const message = e instanceof Error ? e.message : "Save error";
            if (!isCurrentRequest(key, requestGeneration)) return false;
            const targetUnavailable = targetUnavailableForError(
              tab.target,
              errorCode(e),
              message,
            );
            set((s) => ({
              tabs: s.tabs.map((t) =>
                t.key === key
                  ? {
                      ...t,
                      saving: false,
                      error: message,
                      targetAvailable: !targetUnavailable,
                    }
                  : t,
              ),
            }));
          }
          return false;
        },

        // ---------------------------------------------------------------------------
        // forceOverwrite — after conflict: user chose to overwrite the server copy
        // ---------------------------------------------------------------------------
        forceOverwrite: async (key: string) => {
          const tab = get().tabs.find((t) => t.key === key);
          if (
            !tab ||
            !tab.targetAvailable ||
            isPreviewOnlyFile(tab.tier, tab.name)
          )
            return;

          const requestGeneration = beginRequest(key);
          set((s) => ({
            tabs: s.tabs.map((t) =>
              t.key === key ? { ...t, saving: true, conflicted: false } : t,
            ),
          }));

          try {
            // Fetch current server mtime (0-byte range read just to get mtime).
            const stat = await transport().fsRead(tab.target, tab.path, {
              offset: 0,
              len: 0,
            });
            if (!isCurrentRequest(key, requestGeneration)) return;

            const statTargetUnavailable =
              !stat.ok &&
              targetUnavailableForError(
                tab.target,
                stat.code,
                "message" in stat ? stat.message : undefined,
              );
            if (statTargetUnavailable) {
              set((s) => ({
                tabs: s.tabs.map((candidate) =>
                  candidate.key === key
                    ? {
                        ...candidate,
                        targetAvailable: false,
                        saving: false,
                        error:
                          "Target unavailable; edits are preserved locally.",
                      }
                    : candidate,
                ),
              }));
              return;
            }

            const currentMtime = stat.ok
              ? stat.mtime
              : "mtime" in stat
                ? (stat as { mtime: number }).mtime
                : tab.mtime;
            const result = await transport().fsWriteFile(
              tab.target,
              tab.path,
              tab.content,
              currentMtime,
            );
            if (!isCurrentRequest(key, requestGeneration)) return;
            if (result.ok) {
              set((s) => ({
                tabs: s.tabs.map((t) =>
                  t.key === key
                    ? {
                        ...t,
                        saving: false,
                        dirty: false,
                        stale: false,
                        savedContent: t.content,
                        mtime: result.newMtime,
                      }
                    : t,
                ),
              }));
            } else {
              const targetUnavailable = targetUnavailableForError(
                tab.target,
                "error" in result ? result.error : undefined,
              );
              set((s) => ({
                tabs: s.tabs.map((t) =>
                  t.key === key
                    ? {
                        ...t,
                        saving: false,
                        targetAvailable: !targetUnavailable,
                        error: "Force overwrite failed",
                      }
                    : t,
                ),
              }));
            }
          } catch (e) {
            const message =
              e instanceof Error ? e.message : "Force overwrite failed";
            if (!isCurrentRequest(key, requestGeneration)) return;
            const targetUnavailable = targetUnavailableForError(
              tab.target,
              errorCode(e),
              message,
            );
            set((s) => ({
              tabs: s.tabs.map((t) =>
                t.key === key
                  ? {
                      ...t,
                      saving: false,
                      targetAvailable: !targetUnavailable,
                      error: message,
                    }
                  : t,
              ),
            }));
          }
        },

        // ---------------------------------------------------------------------------
        // reloadTab — after conflict: discard local changes, load from server
        // ---------------------------------------------------------------------------
        reloadTab: async (key: string) => {
          const tab = get().tabs.find((t) => t.key === key);
          if (!tab || !tab.targetAvailable) return;

          if (isPreviewOnlyFile(tab.tier, tab.name)) {
            set((s) => ({
              tabs: s.tabs.map((t) =>
                t.key === key
                  ? {
                      ...t,
                      tier: isVideoFile(t.name) ? "video" : "image",
                      loading: false,
                      saving: false,
                      conflicted: false,
                      dirty: false,
                      stale: false,
                      hydrated: false,
                      content: "",
                      savedContent: "",
                      binaryBase64: undefined,
                      error: undefined,
                      previewRevision: (t.previewRevision ?? 0) + 1,
                    }
                  : t,
              ),
            }));
            return;
          }

          const requestGeneration = beginRequest(key);
          set((s) => ({
            tabs: s.tabs.map((t) =>
              t.key === key ? { ...t, loading: true, conflicted: false } : t,
            ),
          }));

          try {
            const result = await transport().fsRead(tab.target, tab.path);
            if (!isCurrentRequest(key, requestGeneration)) return;
            if (!result.ok) {
              const targetUnavailable = targetUnavailableForError(
                tab.target,
                result.code,
                "message" in result ? result.message : undefined,
              );
              set((s) => ({
                tabs: s.tabs.map((t) =>
                  t.key === key
                    ? {
                        ...t,
                        loading: false,
                        targetAvailable: !targetUnavailable,
                      }
                    : t,
                ),
              }));
              return;
            }
            const decoded = result.binary ? "" : b64ToUtf8(result.content);
            set((s) => ({
              tabs: s.tabs.map((t) =>
                t.key === key
                  ? {
                      ...t,
                      loading: false,
                      content: decoded,
                      savedContent: decoded,
                      mtime: result.mtime,
                      dirty: false,
                      stale: false,
                      binaryBase64: result.binary ? result.content : undefined,
                    }
                  : t,
              ),
            }));
          } catch (e) {
            const message = e instanceof Error ? e.message : "Reload failed";
            if (!isCurrentRequest(key, requestGeneration)) return;
            const targetUnavailable = targetUnavailableForError(
              tab.target,
              errorCode(e),
              message,
            );
            set((s) => ({
              tabs: s.tabs.map((t) =>
                t.key === key
                  ? {
                      ...t,
                      loading: false,
                      targetAvailable: !targetUnavailable,
                      error: message,
                    }
                  : t,
              ),
            }));
          }
        },

        clearConflict: (key: string) => {
          set((s) => ({
            tabs: s.tabs.map((t) =>
              t.key === key ? { ...t, conflicted: false } : t,
            ),
          }));
        },

        clearStale: (key: string) => {
          set((s) => ({
            tabs: s.tabs.map((t) =>
              t.key === key ? { ...t, stale: false } : t,
            ),
          }));
        },

        reconcileGitMutationFiles: async (
          target: ProjectTargetInput,
          paths: string[],
        ) => {
          const scopeKey = editorTargetScopeKey(target);
          const affected = new Set(paths);
          const tabs = get().tabs.filter(
            (tab) =>
              editorTargetScopeKey(targetForTab(tab)) === scopeKey &&
              tab.tier !== "diff" &&
              affected.has(tab.path),
          );
          const previewTabs = tabs.filter((tab) =>
            isPreviewOnlyFile(tab.tier, tab.name),
          );
          const editableTabs = tabs.filter(
            (tab) => !isPreviewOnlyFile(tab.tier, tab.name),
          );
          const cleanTabs = editableTabs.filter((tab) => !tab.dirty);
          const dirtyKeys = editableTabs
            .filter((tab) => tab.dirty)
            .map((tab) => tab.key);

          if (dirtyKeys.length > 0) {
            set((s) => ({
              tabs: s.tabs.map((tab) =>
                dirtyKeys.includes(tab.key) ? { ...tab, stale: true } : tab,
              ),
            }));
          }

          for (const tab of [...previewTabs, ...cleanTabs]) {
            await get().reloadTab(tab.key);
          }
        },

        reconcileGitProjectFiles: async (target: ProjectTargetInput) => {
          const scopeKey = editorTargetScopeKey(target);
          const tabs = get().tabs.filter(
            (tab) =>
              editorTargetScopeKey(targetForTab(tab)) === scopeKey &&
              tab.tier !== "diff",
          );
          const previewTabs = tabs.filter((tab) =>
            isPreviewOnlyFile(tab.tier, tab.name),
          );
          const editableTabs = tabs.filter(
            (tab) => !isPreviewOnlyFile(tab.tier, tab.name),
          );
          const cleanTabs = editableTabs.filter((tab) => !tab.dirty);
          const dirtyKeys = editableTabs
            .filter((tab) => tab.dirty)
            .map((tab) => tab.key);

          if (dirtyKeys.length > 0) {
            set((s) => ({
              tabs: s.tabs.map((tab) =>
                dirtyKeys.includes(tab.key) ? { ...tab, stale: true } : tab,
              ),
            }));
          }

          for (const tab of [...previewTabs, ...cleanTabs]) {
            await get().reloadTab(tab.key);
          }
        },

        markSaved: (key: string, mtime: number) => {
          set((s) => ({
            tabs: s.tabs.map((t) =>
              t.key === key
                ? {
                    ...t,
                    saving: false,
                    dirty: false,
                    stale: false,
                    savedContent: t.content,
                    mtime,
                  }
                : t,
            ),
          }));
        },

        saveViewState: (key: string, vs: unknown) => {
          set((s) => ({
            tabs: s.tabs.map((t) =>
              t.key === key ? { ...t, viewState: vs } : t,
            ),
          }));
        },

        getActiveTab: (target: ProjectTargetInput) => {
          const { tabs, activeKeys } = get();
          const activeKey = editorActiveKeyForTarget(activeKeys, target);
          return tabs.find((t) => t.key === activeKey) ?? null;
        },

        loadContent: async (key: string) => {
          const tab = get().tabs.find((t) => t.key === key);
          if (!tab || !tab.hydrated || tab.loading || !tab.targetAvailable)
            return;

          if (isPreviewOnlyFile(tab.tier, tab.name)) {
            set((s) => ({
              tabs: s.tabs.map((t) =>
                t.key === key
                  ? {
                      ...t,
                      tier: isVideoFile(t.name) ? "video" : "image",
                      loading: false,
                      hydrated: false,
                      content: "",
                      savedContent: "",
                      binaryBase64: undefined,
                      dirty: false,
                      saving: false,
                      conflicted: false,
                      stale: false,
                      error: undefined,
                    }
                  : t,
              ),
            }));
            return;
          }

          const requestGeneration = beginRequest(key);
          set((s) => ({
            tabs: s.tabs.map((t) =>
              t.key === key ? { ...t, loading: true } : t,
            ),
          }));

          try {
            const result = await transport().fsRead(tab.target, tab.path);
            if (!isCurrentRequest(key, requestGeneration)) return;

            if (!result.ok && result.code === "TOO_LARGE") {
              const tl = result as {
                ok: false;
                code: "TOO_LARGE";
                binary: boolean;
                mime?: string;
                mtime: number;
                size: number;
              };
              set((s) => ({
                tabs: s.tabs.map((t) =>
                  t.key === key
                    ? {
                        ...t,
                        loading: false,
                        tier: tl.binary ? "binary" : "large",
                        mime: tl.mime,
                        mtime: tl.mtime,
                        size: tl.size,
                        hydrated: false,
                      }
                    : t,
                ),
              }));
              return;
            }

            if (!result.ok) {
              const targetUnavailable = targetUnavailableForError(
                tab.target,
                result.code,
                "message" in result ? result.message : undefined,
              );
              set((s) => ({
                tabs: s.tabs.map((t) =>
                  t.key === key
                    ? {
                        ...t,
                        loading: false,
                        error: `Read error: ${result.code}`,
                        targetAvailable: !targetUnavailable,
                        hydrated: false,
                      }
                    : t,
                ),
              }));
              return;
            }

            const tier = fileTier(tab.name, result.size, result.binary);
            const decoded = result.binary ? "" : b64ToUtf8(result.content);
            const binaryBase64 = result.binary ? result.content : undefined;

            set((s) => ({
              tabs: s.tabs.map((t) =>
                t.key === key
                  ? {
                      ...t,
                      loading: false,
                      tier,
                      mime: result.mime,
                      mtime: result.mtime,
                      size: result.size,
                      content: decoded,
                      savedContent: decoded,
                      binaryBase64,
                      hydrated: false,
                    }
                  : t,
              ),
            }));
          } catch (e) {
            const message = e instanceof Error ? e.message : "Unknown error";
            if (!isCurrentRequest(key, requestGeneration)) return;
            const targetUnavailable = targetUnavailableForError(
              tab.target,
              errorCode(e),
              message,
            );
            set((s) => ({
              tabs: s.tabs.map((t) =>
                t.key === key
                  ? {
                      ...t,
                      loading: false,
                      error: message,
                      targetAvailable: !targetUnavailable,
                      hydrated: false,
                    }
                  : t,
              ),
            }));
          }
        },

        markTargetUnavailable: (
          target: ProjectTargetInput,
          worktreePath?: string,
        ) => {
          const targetRef = availabilityTarget(target, worktreePath);
          markProjectTargetUnavailable(targetRef);
          const scopeKey = editorTargetScopeKey(targetRef);
          set((s) => ({
            tabs: s.tabs.map((tab) =>
              editorTargetScopeKey(targetForTab(tab)) === scopeKey
                ? { ...tab, targetAvailable: false }
                : tab,
            ),
          }));
        },

        markTargetAvailable: (
          target: ProjectTargetInput,
          worktreePath?: string,
        ) => {
          const scopeKey = editorTargetScopeKey(
            availabilityTarget(target, worktreePath),
          );
          set((s) => ({
            tabs: s.tabs.map((tab) =>
              editorTargetScopeKey(targetForTab(tab)) === scopeKey
                ? { ...tab, targetAvailable: true, error: undefined }
                : tab,
            ),
          }));
        },
      };
    },
    {
      name: "dam-hopper:editor-state",
      version: EDITOR_PERSIST_VERSION,
      migrate: (persistedState) => migrateEditorState(persistedState),
      partialize: (state) => ({
        tabs: state.tabs.map((t) => ({
          key: t.key,
          project: t.project,
          target: t.target,
          targetKey: t.targetKey,
          targetAvailable: t.targetAvailable,
          path: t.path,
          name: t.name,
          mtime: t.mtime,
          size: t.size,
          tier: t.tier,
          mime: t.mime,
          fileStatus: t.fileStatus,
          additions: t.additions,
          deletions: t.deletions,
          commitHash: t.commitHash,
          gitRootId: t.gitRootId,
          diffPath: t.diffPath,
          hydrated: true,
          loading: false,
          dirty: false,
          saving: false,
          conflicted: false,
          stale: false,
        })),
        activeKeys: state.activeKeys,
      }),
    },
  ),
);
