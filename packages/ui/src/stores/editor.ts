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
import {
  captureConnection,
  getConnectionSnapshot,
  getTransport as getConnectionsTransport,
  isCurrentConnection,
} from "@/api/connections.js";
import {
  normalizeFsTarget,
  toServerFsTarget,
  fsTargetKey,
  isSameFsTarget,
  type ConnectionRef,
  type ProfileId,
  type ResourceBinding,
  type FsTargetRef,
  type ServerFsTarget,
} from "@/api/ownership.js";
import type { WsTransport } from "@/api/ws-transport.js";
import { fileTier, isPreviewOnlyFile } from "@/lib/file-tier.js";
import type { FileTier as FT } from "@/lib/file-tier.js";
import { isVideoFile } from "@/lib/video-file.js";
import type { FsArborNode, FileIdentity } from "@/api/fs-types.js";
import {
  isProjectTargetError,
  normalizeProjectTarget,
  projectTargetCacheKey,
  type ProjectTargetInput,
  type ProjectTargetRef,
} from "@/api/client.js";
import { markProjectTargetUnavailable } from "@/stores/project-target.js";
import { normalizeServerUrl } from "@/api/server-config.js";

export interface EndpointIdentity {
  profileId: string;
  serverUrl: string;
}
export type FileTier = FT | "diff";

const EDITOR_PERSIST_VERSION = 3;

export interface DocumentState {
  documentKey: string;
  fileIdentity?: FileIdentity;
  content: string;
  savedContent: string;
  dirty: boolean;
  mtime: number;
  size: number;
  tier: FileTier;
  mime?: string;
  binaryBase64?: string;
  saving: boolean;
  conflicted: boolean;
  stale?: boolean;
  viewState?: unknown;
  editRevision: number;
  endpointIdentity?: EndpointIdentity;
}

export function editorDocumentKey(
  profileId: string,
  identity: FileIdentity,
): string;
export function editorDocumentKey(
  profileId: string,
  workspaceId: string,
  workspaceEpoch: number,
  canonicalPath: string,
): string;
export function editorDocumentKey(
  profileId: string,
  arg1: FileIdentity | string,
  arg2?: number,
  arg3?: string,
): string {
  if (typeof arg1 === "object" && arg1 !== null) {
    return JSON.stringify([
      "file",
      profileId,
      arg1.workspaceId,
      arg1.workspaceEpoch,
      arg1.canonicalPath,
    ]);
  }
  return JSON.stringify(["file", profileId, arg1, arg2, arg3]);
}

export function parseEditorDocumentKey(key: string): {
  profileId: string;
  workspaceId: string;
  workspaceEpoch: number;
  canonicalPath: string;
} | null {
  try {
    const parsed = JSON.parse(key);
    if (
      Array.isArray(parsed) &&
      parsed.length === 5 &&
      parsed[0] === "file" &&
      typeof parsed[1] === "string" &&
      typeof parsed[2] === "string" &&
      typeof parsed[3] === "number" &&
      typeof parsed[4] === "string"
    ) {
      return {
        profileId: parsed[1],
        workspaceId: parsed[2],
        workspaceEpoch: parsed[3],
        canonicalPath: parsed[4],
      };
    }
    return null;
  } catch {
    return null;
  }
}
export function editorTargetScopeKey(
  target: FsTargetRef | ProjectTargetInput,
): string {
  const normalized = normalizeFsTarget(target);
  if (normalized.kind === "workspace") {
    const prefix = normalized.profileId
      ? `${normalized.profileId}::workspace`
      : "workspace";
    return `${prefix}::${fsTargetKey(normalized)}`;
  }
  const prefix = normalized.profileId
    ? `${normalized.profileId}::${normalized.project}`
    : normalized.project;
  const suffix = normalized.worktreePath == null ? "root" : normalized.worktreePath;
  return `${prefix}::${suffix}`;
}

/** Count unsaved editor tabs owned by one immutable project target. */
export function countDirtyTabsForTarget(
  tabs: ReadonlyArray<Pick<Tab, "project" | "target" | "dirty">>,
  target: FsTargetRef | ProjectTargetInput,
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
  if (normalized.profileId) {
    return JSON.stringify([
      kind,
      normalized.profileId,
      normalized.project,
      projectTargetCacheKey(normalized),
      path,
      ...extra,
    ]);
  }
  return JSON.stringify([
    kind,
    normalized.project,
    projectTargetCacheKey(normalized),
    path,
    ...extra,
  ]);
}

export function editorFileTabKey(
  target: FsTargetRef | ProjectTargetInput,
  path: string,
): string {
  const normalized = normalizeFsTarget(target);
  if (normalized.kind === "workspace") {
    return JSON.stringify([
      "file",
      normalized.profileId,
      "workspace",
      fsTargetKey(normalized),
      path,
    ]);
  }
  return compositeTabKey("file", normalized, path);
}

export function editorDiffTabKey(
  target: FsTargetRef | ProjectTargetInput,
  path: string,
  commitHash?: string,
  gitRootId?: string,
  diffPath?: string,
): string {
  const normalized = normalizeFsTarget(target);
  if (normalized.kind === "workspace") {
    throw new Error("Diff tabs require a project target, not a workspace target");
  }
  return compositeTabKey("diff", normalized, path, [
    commitHash ?? null,
    gitRootId ?? ".",
    diffPath ?? path,
  ]);
}

function targetForTab(tab: Pick<Tab, "target" | "project">): FsTargetRef {
  if (tab.target) return normalizeFsTarget(tab.target);
  return normalizeFsTarget(tab.project);
}

function targetUnavailableForError(
  target: FsTargetRef | ProjectTargetInput,
  ...values: Array<string | null | undefined>
): boolean {
  if (typeof target === "object" && "kind" in target && target.kind === "workspace") {
    return false;
  }
  const unavailable = isProjectTargetError(...values);
  if (unavailable) markProjectTargetUnavailable(target as ProjectTargetInput);
  return unavailable;
}

function errorCode(value: unknown): string | undefined {
  return value && typeof value === "object" && "code" in value
    ? String((value as { code?: unknown }).code ?? "")
    : undefined;
}

export function editorActiveKeyForTarget(
  activeKeys: Record<string, string | null>,
  target: FsTargetRef | ProjectTargetInput,
): string | null {
  const normalized = normalizeFsTarget(target);
  const scopeKey = editorTargetScopeKey(normalized);
  if (Object.prototype.hasOwnProperty.call(activeKeys, scopeKey)) {
    return activeKeys[scopeKey];
  }
  if (normalized.kind === "project" && normalized.worktreePath == null && !normalized.profileId) {
    const rootKey = `${normalized.project}::root`;
    if (Object.prototype.hasOwnProperty.call(activeKeys, rootKey)) {
      return activeKeys[rootKey];
    }
    if (Object.prototype.hasOwnProperty.call(activeKeys, normalized.project)) {
      return activeKeys[normalized.project];
    }
  }
  return null;
}

export interface Tab {
  /** Composite identity: project/workspace + target + content kind + path dimensions. */
  key: string;
  /** Legacy project field (preserved for compatibility; "" for workspace targets). */
  project: string;
  /** Immutable, normalized target captured when the tab was opened. */
  target: FsTargetRef;
  /** Stable root/worktree/workspace discriminator used by UI and cache boundaries. */
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
  /** Canonical file identity from server stat/read */
  fileIdentity?: FileIdentity;
  /** Canonical document identity key */
  documentKey?: string;
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
  /** Connection and endpoint binding metadata. */
  resourceBinding?: ResourceBinding;
  /** Session-only flag for Git blame line annotation gutter (excluded from persistence). */
  blameEnabled?: boolean;
  endpointIdentity?: EndpointIdentity;
  saveBlockedReason?: string;
}

interface EditorState {
  tabs: Tab[];
  documents: Record<string, DocumentState>;
  activeKeys: Record<string, string | null>;
  /** Ephemeral request generations invalidate responses after close/reopen. */
  requestGenerations: Record<string, number>;
  beginAsyncRequest: (key: string) => number;
  isCurrentAsyncRequest: (key: string, generation: number) => boolean;

  open: (target: FsTargetRef | ProjectTargetInput, node: FsArborNode) => Promise<void>;
  openDiff: (
    target: FsTargetRef | ProjectTargetInput,
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
  setActive: (target: FsTargetRef | ProjectTargetInput, key: string | null) => void;
  setContent: (key: string, content: string) => void;
  save: (key: string) => Promise<boolean>;
  forceOverwrite: (key: string) => Promise<void>;
  reloadTab: (key: string) => Promise<void>;
  discardAndReload: (key: string) => Promise<void>;
  clearConflict: (key: string) => void;
  clearStale: (key: string) => void;
  reconcileGitMutationFiles: (
    target: ProjectTargetInput,
    paths: string[],
  ) => Promise<void>;
  reconcileGitProjectFiles: (target: ProjectTargetInput) => Promise<void>;
  markSaved: (key: string, mtime: number) => void;
  saveViewState: (key: string, vs: unknown) => void;
  setBlameEnabled: (key: string, enabled: boolean) => void;
  getActiveTab: (target: ProjectTargetInput) => Tab | null;
  loadContent: (key: string) => Promise<void>;
  reconcileTabFreshness: (key: string) => Promise<void>;
  markTargetUnavailable: (
    target: ProjectTargetInput,
    worktreePath?: string,
  ) => void;
  markTargetAvailable: (
    target: ProjectTargetInput,
    worktreePath?: string,
  ) => void;
  reconcileProfileTabs: (profileId: string) => Promise<void>;
}

function availabilityTarget(
  target: ProjectTargetInput,
  worktreePath?: string,
): ProjectTargetRef {
  const normalized = normalizeProjectTarget(target);
  if (worktreePath === undefined) return normalized;
  return normalizeProjectTarget({
    ...normalized,
    worktreePath,
  });
}

export interface PersistedEditorSlice {
  tabs: MigratedEditorTab[];
  documents: Record<string, DocumentState>;
  activeKeys?: Record<string, string | null>;
}

export interface MigratedEditorTab {
  key: string;
  project: string;
  target: FsTargetRef;
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
  dirty: boolean;
  viewState: unknown | undefined;
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
  resourceBinding: ResourceBinding | undefined;
  blameEnabled: boolean;
  documentKey?: string;
  fileIdentity?: FileIdentity;
  endpointIdentity?: EndpointIdentity;
  saveBlockedReason?: string;
}

function resolveTabTransport(tab: Pick<Tab, "target">): {
  transport: WsTransport;
  connectionRef?: ConnectionRef;
  endpointIdentity?: EndpointIdentity;
} {
  const profileId = tab.target.profileId;
  if (profileId) {
    try {
      const conn = captureConnection(profileId);
      const snap = getConnectionSnapshot(profileId);
      if (snap && snap.serverUrl) {
        const t = getConnectionsTransport(conn) as WsTransport;
        return {
          transport: t,
          connectionRef: conn,
          endpointIdentity: {
            profileId,
            serverUrl: normalizeServerUrl(snap.serverUrl),
          },
        };
      }
    } catch {
      // Disconnected or offline
    }
  }
  return { transport: getTransport() as WsTransport };
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
): FsTargetRef {
  const rawTarget = asRecord(raw.target);
  if (rawTarget && rawTarget.kind === "workspace") {
    const profileId =
      typeof rawTarget.profileId === "string" ? rawTarget.profileId : "";
    return { kind: "workspace", profileId };
  }
  const profileId =
    typeof rawTarget?.profileId === "string"
      ? rawTarget.profileId
      : typeof raw.profileId === "string"
        ? raw.profileId
        : "";
  const worktreePath =
    typeof rawTarget?.worktreePath === "string"
      ? rawTarget.worktreePath
      : typeof raw.worktreePath === "string"
        ? raw.worktreePath
        : null;
  const projectVal =
    typeof rawTarget?.project === "string" ? rawTarget.project : project;
  return normalizeFsTarget({
    kind: "project",
    profileId,
    project: projectVal,
    worktreePath,
  });
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
  const viewState = asRecord(raw.viewState) ?? undefined;
  const key =
    tier === "diff"
      ? editorDiffTabKey(target, raw.path, commitHash, gitRootId, diffPath)
      : editorFileTabKey(target, raw.path);
  if (typeof raw.key === "string") keyMap.set(raw.key, key);
  keyMap.set(key, key);
  const rawResourceBinding = asRecord(raw.resourceBinding);
  const resourceBinding: ResourceBinding | undefined =
    rawResourceBinding && typeof rawResourceBinding.serverUrl === "string"
      ? {
          serverUrl: rawResourceBinding.serverUrl,
          configuredRoot:
            typeof rawResourceBinding.configuredRoot === "string"
              ? rawResourceBinding.configuredRoot
              : undefined,
        }
      : undefined;

  const rawFi = asRecord(raw.fileIdentity);
  const fileIdentity: FileIdentity | undefined =
    rawFi &&
    typeof rawFi.workspaceId === "string" &&
    typeof rawFi.workspaceEpoch === "number" &&
    typeof rawFi.canonicalPath === "string"
      ? {
          workspaceId: rawFi.workspaceId,
          workspaceEpoch: rawFi.workspaceEpoch,
          canonicalPath: rawFi.canonicalPath,
        }
      : undefined;

  const rawDocKey =
    typeof raw.documentKey === "string" ? raw.documentKey : undefined;
  const documentKey =
    rawDocKey ??
    (fileIdentity
      ? editorDocumentKey(target.profileId, fileIdentity)
      : undefined);

  const dirty = Boolean(raw.dirty && typeof raw.content === "string");
  const content = typeof raw.content === "string" ? raw.content : "";
  const savedContent =
    typeof raw.savedContent === "string" ? raw.savedContent : "";

  const rawEi = asRecord(raw.endpointIdentity);
  const endpointIdentity: EndpointIdentity | undefined =
    rawEi &&
    typeof rawEi.profileId === "string" &&
    typeof rawEi.serverUrl === "string"
      ? {
          profileId: rawEi.profileId,
          serverUrl: rawEi.serverUrl,
        }
      : undefined;

  return {
    key,
    project,
    target,
    targetKey: fsTargetKey(target),
    targetAvailable: raw.targetAvailable !== false,
    path: raw.path,
    name: typeof raw.name === "string" ? raw.name : raw.path,
    mtime: typeof raw.mtime === "number" ? raw.mtime : 0,
    size: typeof raw.size === "number" ? raw.size : 0,
    tier,
    mime: typeof raw.mime === "string" ? raw.mime : undefined,
    content,
    savedContent,
    dirty,
    viewState,
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
    resourceBinding,
    blameEnabled: false,
    documentKey,
    fileIdentity,
    endpointIdentity,
    saveBlockedReason: typeof raw.saveBlockedReason === "string" ? raw.saveBlockedReason : undefined,
  };
}

export function migrateEditorState(persisted: unknown): PersistedEditorSlice {
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
        dirty: normalized.dirty,
        viewState: normalized.viewState,
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
        resourceBinding: normalized.resourceBinding,
        blameEnabled: false,
        documentKey: normalized.documentKey,
        fileIdentity: normalized.fileIdentity,
        endpointIdentity: normalized.endpointIdentity,
        saveBlockedReason: normalized.saveBlockedReason,
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
  const rawDocs = asRecord(rawState.documents) ?? {};
  const documents: Record<string, DocumentState> = {};
  for (const [docKey, docVal] of Object.entries(rawDocs)) {
    const rawDoc = asRecord(docVal);
    if (rawDoc && typeof rawDoc.content === "string") {
      const rawFi = asRecord(rawDoc.fileIdentity);
      const fileIdentity: FileIdentity | undefined =
        rawFi &&
        typeof rawFi.workspaceId === "string" &&
        typeof rawFi.workspaceEpoch === "number" &&
        typeof rawFi.canonicalPath === "string"
          ? {
              workspaceId: rawFi.workspaceId,
              workspaceEpoch: rawFi.workspaceEpoch,
              canonicalPath: rawFi.canonicalPath,
            }
          : undefined;

      const rawDocEi = asRecord(rawDoc.endpointIdentity);
      const endpointIdentity: EndpointIdentity | undefined =
        rawDocEi &&
        typeof rawDocEi.profileId === "string" &&
        typeof rawDocEi.serverUrl === "string"
          ? {
              profileId: rawDocEi.profileId,
              serverUrl: rawDocEi.serverUrl,
            }
          : undefined;

      documents[docKey] = {
        documentKey: docKey,
        fileIdentity,
        content: rawDoc.content,
        savedContent:
          typeof rawDoc.savedContent === "string"
            ? rawDoc.savedContent
            : rawDoc.content,
        dirty: Boolean(rawDoc.dirty),
        mtime: typeof rawDoc.mtime === "number" ? rawDoc.mtime : 0,
        size: typeof rawDoc.size === "number" ? rawDoc.size : 0,
        tier: "normal",
        saving: false,
        conflicted: false,
        editRevision:
          typeof rawDoc.editRevision === "number" ? rawDoc.editRevision : 0,
        endpointIdentity,
      };
    }
  }
  return { tabs, activeKeys, documents };
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
        documents: {},
        activeKeys: {},
        requestGenerations: {},
        beginAsyncRequest: beginRequest,
        isCurrentAsyncRequest: isCurrentRequest,

        // ---------------------------------------------------------------------------
        // openDiff
        // ---------------------------------------------------------------------------
        openDiff: (
          target: FsTargetRef | ProjectTargetInput,
          path: string,
          fileStatus: string,
          additions: number,
          deletions: number,
          commitHash?: string,
          gitRootId?: string,
          diffPath?: string,
        ) => {
          const targetRef = normalizeFsTarget(target);
          if (targetRef.kind === "workspace") {
            throw new Error(
              "Diff tabs require a project target, not a workspace target",
            );
          }
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

          const profileId = targetRef.profileId;
          let resourceBinding: ResourceBinding | undefined;
          if (profileId) {
            const snapshot = getConnectionSnapshot(profileId);
            if (snapshot) {
              resourceBinding = { serverUrl: snapshot.serverUrl };
            }
          }

          const newTab: Tab = {
            key,
            project,
            target: targetRef,
            targetKey: fsTargetKey(targetRef),
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
            resourceBinding,
          };

          set((s) => ({
            tabs: [...s.tabs, newTab],
            activeKeys: { ...s.activeKeys, [scopeKey]: key },
          }));
        },

        open: async (
          target: FsTargetRef | ProjectTargetInput,
          node: FsArborNode,
        ) => {
          if (node.kind !== "file") return;

          const targetRef = normalizeFsTarget(target);
          const project =
            targetRef.kind === "project" ? targetRef.project : "";
          const scopeKey = editorTargetScopeKey(targetRef);
          const key = editorFileTabKey(targetRef, node.id);
          const existing = get().tabs.find((t) => t.key === key);
          if (existing) {
            set((s) => ({
              activeKeys: { ...s.activeKeys, [scopeKey]: key },
            }));
            const isDifferent =
              typeof node.mtime === "number" &&
              typeof existing.mtime === "number" &&
              (node.mtime > existing.mtime ||
                (node.mtime === existing.mtime && node.size !== existing.size));

            if (isDifferent && !existing.loading) {
              if (!existing.dirty) {
                void get().reloadTab(existing.key);
              } else if (!existing.stale) {
                set((s) => ({
                  tabs: s.tabs.map((t) =>
                    t.key === key ? { ...t, stale: true } : t,
                  ),
                }));
              }
            } else if ((!node.mtime || node.mtime === 0) && !existing.loading) {
              void get().reconcileTabFreshness(existing.key);
            }
            return;
          }

          // Optimistic tier guess from FsArborNode (no isBinary from tree)
          const optimisticTier = fileTier(node.name, node.size, false);

          const profileId = targetRef.profileId;
          let resourceBinding: ResourceBinding | undefined;
          if (profileId) {
            const snapshot = getConnectionSnapshot(profileId);
            if (snapshot) {
              resourceBinding = { serverUrl: snapshot.serverUrl };
            }
          }

          const placeholder: Tab = {
            key,
            project,
            target: targetRef,
            targetKey: fsTargetKey(targetRef),
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
            resourceBinding,
          };

          set((s) => ({
            tabs: [...s.tabs, placeholder],
            activeKeys: { ...s.activeKeys, [scopeKey]: key },
          }));
          if (isPreviewOnlyFile(optimisticTier, node.name)) {
            return;
          }
          const isPreview = false;
          const isLarge = optimisticTier === "large";

          const requestGeneration = beginRequest(key);
          const { transport: t, connectionRef, endpointIdentity: capturedIdentity } = resolveTabTransport({
            target: targetRef,
          });
          try {
            const readOpts =
              isPreview || isLarge ? { offset: 0, len: 0 } : undefined;
            const result = await t.fsRead(targetRef, node.id, readOpts);
            if (!isCurrentRequest(key, requestGeneration)) return;
            if (connectionRef && !isCurrentConnection(connectionRef)) return;

            if (isPreview || isLarge) {
              const fileIdentity = result.ok ? result.fileIdentity : undefined;
              const documentKey = fileIdentity
                ? editorDocumentKey(profileId, fileIdentity)
                : undefined;
              set((s) => ({
                tabs: s.tabs.map((tab) =>
                  tab.key === key
                    ? {
                        ...tab,
                        loading: false,
                        fileIdentity,
                        documentKey,
                      }
                    : tab,
                ),
              }));
              return;
            }
            if (!result.ok && result.code === "TOO_LARGE") {
              const tl = result as {
                ok: false;
                code: "TOO_LARGE";
                binary: boolean;
                mime?: string;
                mtime: number;
                size: number;
                fileIdentity?: FileIdentity;
              };
              const fileIdentity = tl.fileIdentity;
              const documentKey = fileIdentity
                ? editorDocumentKey(profileId, fileIdentity)
                : undefined;
              set((s) => ({
                tabs: s.tabs.map((tab) =>
                  tab.key === key
                    ? {
                        ...tab,
                        loading: false,
                        tier: tl.binary ? "binary" : "large",
                        mime: tl.mime,
                        mtime: tl.mtime,
                        size: tl.size,
                        fileIdentity,
                        documentKey,
                      }
                    : tab,
                ),
              }));
              return;
            }

            if (!result.ok) {
              const targetUnavailable =
                targetRef.kind === "project"
                  ? targetUnavailableForError(
                      targetRef,
                      result.code,
                      "message" in result ? result.message : undefined,
                    )
                  : false;
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

            const fileIdentity = result.fileIdentity;
            const documentKey = fileIdentity
              ? editorDocumentKey(profileId, fileIdentity)
              : undefined;

            const existingDoc = documentKey
              ? get().documents[documentKey]
              : undefined;

            if (existingDoc) {
              set((s) => ({
                tabs: s.tabs.map((tab) =>
                  tab.key === key
                    ? {
                        ...tab,
                        loading: false,
                        tier: existingDoc.tier,
                        mime: existingDoc.mime ?? result.mime,
                        mtime: existingDoc.mtime,
                        size: existingDoc.size,
                        content: existingDoc.content,
                        savedContent: existingDoc.savedContent,
                        binaryBase64: existingDoc.binaryBase64,
                        dirty: existingDoc.dirty,
                        saving: existingDoc.saving,
                        conflicted: existingDoc.conflicted,
                        stale: existingDoc.stale,
                        viewState: existingDoc.viewState,
                        fileIdentity: existingDoc.fileIdentity ?? fileIdentity,
                        documentKey,
                        endpointIdentity: existingDoc.endpointIdentity,
                      }
                    : tab,
                ),
              }));
              return;
            }

            const newDoc: DocumentState | undefined =
              documentKey && fileIdentity
                ? {
                    documentKey,
                    fileIdentity,
                    content: decoded,
                    savedContent: decoded,
                    dirty: false,
                    mtime: result.mtime,
                    size: result.size,
                    tier,
                    mime: result.mime,
                    binaryBase64,
                    saving: false,
                    conflicted: false,
                    stale: false,
                    editRevision: 0,
                    endpointIdentity: capturedIdentity,
                  }
                : undefined;

            set((s) => ({
              documents: newDoc
                ? { ...s.documents, [documentKey!]: newDoc }
                : s.documents,
              tabs: s.tabs.map((tab) =>
                tab.key === key
                  ? {
                      ...tab,
                      loading: false,
                      tier,
                      mime: result.mime,
                      mtime: result.mtime,
                      size: result.size,
                      content: decoded,
                      savedContent: decoded,
                      binaryBase64,
                      fileIdentity,
                      documentKey,
                      endpointIdentity: capturedIdentity,
                    }
                  : tab,
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

        setActive: (target: FsTargetRef | ProjectTargetInput, key: string | null) =>
          set((s) => ({
            activeKeys: {
              ...s.activeKeys,
              [editorTargetScopeKey(target)]: key,
            },
          })),

        setContent: (key: string, content: string) => {
          set((s) => {
            const tab = s.tabs.find((t) => t.key === key);
            if (!tab) return s;

            const documentKey = tab.documentKey;
            if (documentKey && s.documents[documentKey]) {
              const doc = s.documents[documentKey];
              const dirty = content !== doc.savedContent;
              const updatedDoc: DocumentState = {
                ...doc,
                content,
                dirty,
                editRevision: doc.editRevision + 1,
              };
              const updatedDocuments = {
                ...s.documents,
                [documentKey]: updatedDoc,
              };
              const updatedTabs = s.tabs.map((t) =>
                t.documentKey === documentKey
                  ? { ...t, content, dirty }
                  : t,
              );
              return { documents: updatedDocuments, tabs: updatedTabs };
            }

            const dirty = content !== tab.savedContent;
            return {
              tabs: s.tabs.map((t) =>
                t.key === key ? { ...t, content, dirty } : t,
              ),
            };
          });
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

          const documentKey = tab.documentKey;
          const doc = documentKey ? get().documents[documentKey] : undefined;
          const docIdentity = doc ? doc.endpointIdentity : tab.endpointIdentity;

          const profileId = tab.target.profileId;
          if (profileId || docIdentity) {
            const checkProfileId = profileId || docIdentity?.profileId || "";
            const liveSnapshot = checkProfileId ? getConnectionSnapshot(checkProfileId) : null;
            const isEndpointValid = Boolean(
              docIdentity &&
              checkProfileId &&
              docIdentity.profileId === checkProfileId &&
              liveSnapshot &&
              liveSnapshot.status === "connected" &&
              docIdentity.serverUrl === normalizeServerUrl(liveSnapshot.serverUrl)
            );

            if (!isEndpointValid) {
              const origin = docIdentity?.serverUrl || "<old or unknown endpoint>";
              const reason = `This file was loaded from ${origin}; reload to discard your changes or copy them first.`;
              set((s) => ({
                tabs: s.tabs.map((t) =>
                  (documentKey && t.documentKey === documentKey) || t.key === key
                    ? { ...t, saving: false, saveBlockedReason: reason }
                    : t,
                ),
              }));
              return false;
            }
          }

          const contentToSave = doc ? doc.content : tab.content;
          const mtimeToExpect = doc ? doc.mtime : tab.mtime;
          const requestGeneration = beginRequest(key);
          const { transport: tabTransport, connectionRef } =
            resolveTabTransport(tab);

          set((s) => ({
            documents:
              documentKey && s.documents[documentKey]
                ? {
                    ...s.documents,
                    [documentKey]: { ...s.documents[documentKey], saving: true },
                  }
                : s.documents,
            tabs: s.tabs.map((t) =>
              (documentKey && t.documentKey === documentKey) || t.key === key
                ? { ...t, saving: true }
                : t,
            ),
          }));

          try {
            const writeTarget: FsTargetRef =
              tab.target.kind === "workspace" && tab.fileIdentity?.workspaceEpoch !== undefined
                ? { ...tab.target, workspaceEpoch: tab.fileIdentity.workspaceEpoch }
                : tab.target;
            const result = await tabTransport.fsWriteFile(
              writeTarget,
              tab.path,
              contentToSave,
              mtimeToExpect,
            );
            if (!isCurrentRequest(key, requestGeneration)) return false;
            if (connectionRef && !isCurrentConnection(connectionRef))
              return false;

            if (result.ok) {
              const newMtime = result.newMtime;
              const fileIdentity = result.fileIdentity ?? tab.fileIdentity;
              const newDocKey = fileIdentity
                ? editorDocumentKey(tab.target.profileId, fileIdentity)
                : documentKey;

              set((s) => {
                let docs = s.documents;
                if (newDocKey) {
                  const prevDoc = docs[documentKey ?? ""] ?? docs[newDocKey];
                  const updatedDoc: DocumentState = {
                    ...(prevDoc ?? {
                      documentKey: newDocKey,
                      fileIdentity: fileIdentity!,
                      content: contentToSave,
                      size: tab.size,
                      tier: tab.tier,
                      editRevision: 0,
                    }),
                    savedContent: contentToSave,
                    dirty: prevDoc ? prevDoc.content !== contentToSave : false,
                    stale: false,
                    conflicted: false,
                    saving: false,
                    mtime: newMtime,
                    fileIdentity: fileIdentity ?? prevDoc?.fileIdentity,
                  };
                  docs = { ...docs, [newDocKey]: updatedDoc };
                }
                const updatedTabs = s.tabs.map((t) => {
                  if (
                    (documentKey && t.documentKey === documentKey) ||
                    t.key === key
                  ) {
                    return {
                      ...t,
                      saving: false,
                      dirty: t.content !== contentToSave,
                      stale: false,
                      conflicted: false,
                      savedContent: contentToSave,
                      mtime: newMtime,
                      fileIdentity: fileIdentity ?? t.fileIdentity,
                      documentKey: newDocKey ?? t.documentKey,
                      saveBlockedReason: undefined,
                    };
                  }
                  return t;
                });
                return { documents: docs, tabs: updatedTabs };
              });
              return true;
            } else if (!result.ok && result.conflict) {
              set((s) => ({
                documents:
                  documentKey && s.documents[documentKey]
                    ? {
                        ...s.documents,
                        [documentKey]: {
                          ...s.documents[documentKey],
                          saving: false,
                          conflicted: true,
                        },
                      }
                    : s.documents,
                tabs: s.tabs.map((t) =>
                  (documentKey && t.documentKey === documentKey) || t.key === key
                    ? { ...t, saving: false, conflicted: true }
                    : t,
                ),
              }));
            } else {
              const errMsg =
                !result.ok && !result.conflict ? result.error : "unknown error";
              const targetUnavailable =
                tab.target.kind === "project"
                  ? targetUnavailableForError(tab.target, errMsg)
                  : false;
              set((s) => ({
                documents:
                  documentKey && s.documents[documentKey]
                    ? {
                        ...s.documents,
                        [documentKey]: {
                          ...s.documents[documentKey],
                          saving: false,
                        },
                      }
                    : s.documents,
                tabs: s.tabs.map((t) => {
                  if (t.key === key) {
                    return {
                      ...t,
                      saving: false,
                      targetAvailable: !targetUnavailable,
                      error: `Save failed: ${errMsg}`,
                    };
                  }
                  if (documentKey && t.documentKey === documentKey) {
                    return { ...t, saving: false };
                  }
                  return t;
                }),
              }));
            }
          } catch (e) {
            const message = e instanceof Error ? e.message : "Save error";
            if (!isCurrentRequest(key, requestGeneration)) return false;
            if (connectionRef && !isCurrentConnection(connectionRef))
              return false;
            const targetUnavailable =
              tab.target.kind === "project"
                ? targetUnavailableForError(tab.target, errorCode(e), message)
                : false;
            set((s) => ({
              documents:
                documentKey && s.documents[documentKey]
                  ? {
                      ...s.documents,
                      [documentKey]: {
                        ...s.documents[documentKey],
                        saving: false,
                      },
                    }
                  : s.documents,
              tabs: s.tabs.map((t) => {
                if (t.key === key) {
                  return {
                    ...t,
                    saving: false,
                    error: message,
                    targetAvailable: !targetUnavailable,
                  };
                }
                if (documentKey && t.documentKey === documentKey) {
                  return { ...t, saving: false };
                }
                return t;
              }),
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
          const savedContent = tab.content;
          const { transport: tabTransport, connectionRef } =
            resolveTabTransport(tab);

          set((s) => ({
            tabs: s.tabs.map((t) =>
              t.key === key ? { ...t, saving: true, conflicted: false } : t,
            ),
          }));

          try {
            // Fetch current server mtime (0-byte range read just to get mtime).
            const stat = await tabTransport.fsRead(tab.target, tab.path, {
              offset: 0,
              len: 0,
            });
            if (!isCurrentRequest(key, requestGeneration)) return;

            const currentDoc = tab.documentKey ? get().documents[tab.documentKey] : undefined;
            const currentDocIdentity = currentDoc ? currentDoc.endpointIdentity : tab.endpointIdentity;
            const profileId = tab.target.profileId;
            const checkProfileId = profileId || currentDocIdentity?.profileId || "";
            if (checkProfileId || currentDocIdentity) {
              const liveSnap = checkProfileId ? getConnectionSnapshot(checkProfileId) : null;
              const isCurrentEndpointValid = Boolean(
                currentDocIdentity &&
                checkProfileId &&
                currentDocIdentity.profileId === checkProfileId &&
                liveSnap &&
                liveSnap.status === "connected" &&
                currentDocIdentity.serverUrl === normalizeServerUrl(liveSnap.serverUrl)
              );

              if (!isCurrentEndpointValid) {
                const origin = currentDocIdentity?.serverUrl || "<old or unknown endpoint>";
                const reason = `This file was loaded from ${origin}; reload to discard your changes or copy them first.`;
                set((s) => ({
                  tabs: s.tabs.map((t) =>
                    (tab.documentKey && t.documentKey === tab.documentKey) || t.key === key
                      ? { ...t, saving: false, saveBlockedReason: reason }
                      : t,
                  ),
                }));
                return;
              }
            }

            if (connectionRef && !isCurrentConnection(connectionRef)) return;

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
            const result = await tabTransport.fsWriteFile(
              tab.target,
              tab.path,
              savedContent,
              currentMtime,
            );
            if (!isCurrentRequest(key, requestGeneration)) return;
            if (connectionRef && !isCurrentConnection(connectionRef)) return;
            if (result.ok) {
              set((s) => ({
                tabs: s.tabs.map((t) =>
                  t.key === key
                    ? {
                        ...t,
                        saving: false,
                        dirty: t.content !== savedContent,
                        stale: false,
                        savedContent,
                        mtime: result.newMtime,
                        saveBlockedReason: undefined,
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
            if (connectionRef && !isCurrentConnection(connectionRef)) return;
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
          const { transport: tabTransport, connectionRef, endpointIdentity: capturedIdentity } =
            resolveTabTransport(tab);
          set((s) => ({
            tabs: s.tabs.map((t) =>
              t.key === key ? { ...t, loading: true, conflicted: false } : t,
            ),
          }));

          try {
            const result = await tabTransport.fsRead(tab.target, tab.path);
            if (!isCurrentRequest(key, requestGeneration)) return;
            if (connectionRef && !isCurrentConnection(connectionRef)) return;
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
            const documentKey = tab.documentKey;
            set((s) => {
              const currentTab = s.tabs.find((t) => t.key === key);
              if (currentTab?.dirty) {
                return {
                  tabs: s.tabs.map((t) =>
                    t.key === key
                      ? {
                          ...t,
                          loading: false,
                          stale: decoded !== t.savedContent,
                        }
                      : t,
                  ),
                };
              }
              const nextDocs =
                documentKey && s.documents[documentKey]
                  ? {
                      ...s.documents,
                      [documentKey]: {
                        ...s.documents[documentKey],
                        content: decoded,
                        savedContent: decoded,
                        mtime: result.mtime,
                        size: typeof result.size === "number" ? result.size : s.documents[documentKey].size,
                        dirty: false,
                        stale: false,
                        endpointIdentity: capturedIdentity,
                      },
                    }
                  : s.documents;
              const nextTabs = s.tabs.map((t) => {
                if (t.key !== key && (!documentKey || t.documentKey !== documentKey)) return t;
                return {
                  ...t,
                  loading: false,
                  content: decoded,
                  savedContent: decoded,
                  mtime: result.mtime,
                  size: typeof result.size === "number" ? result.size : t.size,
                  dirty: false,
                  stale: false,
                  binaryBase64: result.binary ? result.content : undefined,
                  endpointIdentity: capturedIdentity,
                  saveBlockedReason: undefined,
                };
              });
              return { documents: nextDocs, tabs: nextTabs };
            });
          } catch (e) {
            const message = e instanceof Error ? e.message : "Reload failed";
            if (!isCurrentRequest(key, requestGeneration)) return;
            if (connectionRef && !isCurrentConnection(connectionRef)) return;
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
                      error: t.content ? undefined : message,
                    }
                  : t,
              ),
            }));
          }
        },

        // ---------------------------------------------------------------------------
        // discardAndReload — explicit user action: discard edits, reload from server, rebind endpoint
        // ---------------------------------------------------------------------------
        discardAndReload: async (key: string) => {
          const tab = get().tabs.find((t) => t.key === key);
          if (!tab || !tab.targetAvailable) return;

          const requestGeneration = beginRequest(key);
          const { transport: tabTransport, connectionRef, endpointIdentity: capturedIdentity } =
            resolveTabTransport(tab);

          set((s) => ({
            tabs: s.tabs.map((t) =>
              t.key === key ? { ...t, loading: true, conflicted: false } : t,
            ),
          }));

          try {
            const result = await tabTransport.fsRead(tab.target, tab.path);
            if (!isCurrentRequest(key, requestGeneration)) return;
            if (connectionRef && !isCurrentConnection(connectionRef)) return;
            if (!result.ok) {
              set((s) => ({
                tabs: s.tabs.map((t) =>
                  t.key === key ? { ...t, loading: false } : t,
                ),
              }));
              return;
            }

            const decoded = result.binary ? "" : b64ToUtf8(result.content);
            const documentKey = tab.documentKey;

            set((s) => ({
              documents:
                documentKey && s.documents[documentKey]
                  ? {
                      ...s.documents,
                      [documentKey]: {
                        ...s.documents[documentKey],
                        content: decoded,
                        savedContent: decoded,
                        dirty: false,
                        conflicted: false,
                        stale: false,
                        mtime: result.mtime,
                        size: typeof result.size === "number" ? result.size : s.documents[documentKey].size,
                        endpointIdentity: capturedIdentity,
                      },
                    }
                  : s.documents,
              tabs: s.tabs.map((t) => {
                if (t.key !== key && (!documentKey || t.documentKey !== documentKey)) return t;
                return {
                  ...t,
                  loading: false,
                  content: decoded,
                  savedContent: decoded,
                  mtime: result.mtime,
                  size: typeof result.size === "number" ? result.size : t.size,
                  dirty: false,
                  stale: false,
                  conflicted: false,
                  saveBlockedReason: undefined,
                  endpointIdentity: capturedIdentity,
                  binaryBase64: result.binary ? result.content : undefined,
                };
              }),
            }));
          } catch {
            if (!isCurrentRequest(key, requestGeneration)) return;
            if (connectionRef && !isCurrentConnection(connectionRef)) return;
            set((s) => ({
              tabs: s.tabs.map((t) =>
                t.key === key ? { ...t, loading: false } : t,
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

        setBlameEnabled: (key: string, enabled: boolean) => {
          set((s) => ({
            tabs: s.tabs.map((t) =>
              t.key === key ? { ...t, blameEnabled: enabled } : t,
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
          const { transport: tabTransport, connectionRef, endpointIdentity: capturedIdentity } =
            resolveTabTransport(tab);
          set((s) => ({
            tabs: s.tabs.map((t) =>
              t.key === key ? { ...t, loading: true } : t,
            ),
          }));

          try {
            const result = await tabTransport.fsRead(tab.target, tab.path);
            if (!isCurrentRequest(key, requestGeneration)) return;
            if (connectionRef && !isCurrentConnection(connectionRef)) return;

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

            const documentKey = tab.documentKey;
            set((s) => {
              const currentTab = s.tabs.find((t) => t.key === key);
              if (currentTab?.dirty) {
                return {
                  tabs: s.tabs.map((t) =>
                    t.key === key
                      ? {
                          ...t,
                          loading: false,
                          hydrated: false,
                          stale: decoded !== t.savedContent,
                        }
                      : t,
                  ),
                };
              }
              const nextDocs =
                documentKey && s.documents[documentKey]
                  ? {
                      ...s.documents,
                      [documentKey]: {
                        ...s.documents[documentKey],
                        content: decoded,
                        savedContent: decoded,
                        mtime: result.mtime,
                        size: result.size,
                        dirty: false,
                        stale: false,
                        endpointIdentity: capturedIdentity,
                      },
                    }
                  : s.documents;
              const nextTabs = s.tabs.map((t) => {
                if (t.key !== key && (!documentKey || t.documentKey !== documentKey)) return t;
                return {
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
                  dirty: false,
                  stale: false,
                  endpointIdentity: capturedIdentity,
                  saveBlockedReason: undefined,
                };
              });
              return { documents: nextDocs, tabs: nextTabs };
            });
          } catch (e) {
            const message = e instanceof Error ? e.message : "Unknown error";
            if (!isCurrentRequest(key, requestGeneration)) return;
            if (connectionRef && !isCurrentConnection(connectionRef)) return;
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
                      hydrated: false,
                    }
                  : t,
              ),
            }));
          }
        },
        reconcileTabFreshness: async (key: string) => {
          const tab = get().tabs.find((t) => t.key === key);
          if (
            !tab ||
            !tab.targetAvailable ||
            tab.loading ||
            tab.tier === "diff" ||
            isPreviewOnlyFile(tab.tier, tab.name)
          ) {
            return;
          }

          const requestGeneration = beginRequest(key);
          const { transport: tabTransport, connectionRef } =
            resolveTabTransport(tab);

          try {
            const stat = await tabTransport.fsRead(tab.target, tab.path, {
              offset: 0,
              len: 0,
            });
            if (!isCurrentRequest(key, requestGeneration)) return;
            if (connectionRef && !isCurrentConnection(connectionRef)) return;
            if (!stat.ok) return;

            const current = get().tabs.find((t) => t.key === key);
            if (
              !current ||
              current.loading ||
              typeof stat.mtime !== "number" ||
              typeof current.mtime !== "number" ||
              (stat.mtime <= current.mtime && stat.size === current.size)
            ) {
              return;
            }

            if (!current.dirty) {
              await get().reloadTab(key);
            } else if (!current.stale) {
              set((s) => ({
                tabs: s.tabs.map((t) =>
                  t.key === key ? { ...t, stale: true } : t,
                ),
              }));
            }
          } catch {
            // Non-blocking freshness probe; keep current buffer on network failure
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

        reconcileProfileTabs: async (profileId: string) => {
          const snapshot = getConnectionSnapshot(profileId);
          if (!snapshot || snapshot.status !== "connected") return;
          const tabs = get().tabs.filter(
            (t) =>
              t.target.profileId === profileId &&
              !t.dirty &&
              t.targetAvailable,
          );
          for (const tab of tabs) {
            if (
              tab.resourceBinding?.serverUrl &&
              tab.resourceBinding.serverUrl !== snapshot.serverUrl
            ) {
              set((s) => ({
                tabs: s.tabs.map((t) =>
                  t.key === tab.key ? { ...t, targetAvailable: false } : t,
                ),
              }));
              continue;
            }
            void get().reconcileTabFreshness(tab.key);
          }
        },
      };
    },
    {
      name: "dam-hopper:editor-state",
      version: EDITOR_PERSIST_VERSION,
      migrate: (persistedState): PersistedEditorSlice =>
        migrateEditorState(persistedState),
      partialize: (state): PersistedEditorSlice => ({
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
          content: t.dirty ? t.content : "",
          savedContent: t.dirty ? t.savedContent : "",
          dirty: t.dirty,
          documentKey: t.documentKey,
          fileIdentity: t.fileIdentity,
          viewState: t.viewState,
          fileStatus: t.fileStatus,
          additions: t.additions,
          deletions: t.deletions,
          commitHash: t.commitHash,
          gitRootId: t.gitRootId,
          diffPath: t.diffPath,
          resourceBinding: t.resourceBinding,
          hydrated: true,
          loading: false,
          saving: false,
          conflicted: false,
          stale: false,
          blameEnabled: false,
          endpointIdentity: t.endpointIdentity,
          saveBlockedReason: t.saveBlockedReason,
        })),
        documents: Object.fromEntries(
          Object.entries(state.documents).filter(([, doc]) => doc.dirty),
        ),
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.tabs) {
          for (const tab of state.tabs) {
            tab.blameEnabled = false;
          }
        }
      },
    },
  ),
);
