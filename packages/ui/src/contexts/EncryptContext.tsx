/**
 * EncryptContext — per-session encrypted write mode state.
 *
 * Encrypted mode enables AES-256-GCM encrypted file uploads and text saves
 * via OPAQUE PAKE + Web Crypto API. Per project: each project can have
 * encrypted mode enabled/disabled independently. The passphrase and derived
 * AES key are held in ephemeral React state — they never touch localStorage
 * or sessionStorage.
 *
 * Usage:
 *   <EncryptProvider>
 *     <App />
 *   </EncryptProvider>
 *
 *   const { isEncryptEnabled, getPassphrase, setEncryptEnabled } = useEncryptMode();
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { OpaqueSessionResult } from "@/lib/opaque-session.js";
import type { ConnectionRef, ProjectTargetInput } from "@/api/client.js";
import { normalizeProjectTarget } from "@/api/client.js";
import { generateUUID } from "@/lib/utils.js";
import {
  isCurrentConnection,
  subscribeConnections,
} from "@/api/connections.js";

// ---------------------------------------------------------------------------
// Types & Helpers
// ---------------------------------------------------------------------------
function createDeferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export function toEncryptKey(
  targetOrProject: ProjectTargetInput | string,
  owner?: ConnectionRef,
): string {
  if (typeof targetOrProject === "string") {
    if (targetOrProject.includes(":")) return targetOrProject;
    if (owner)
      return `${owner.profileId}@${owner.generation}:${targetOrProject}`;
    return `ambient:${targetOrProject}`;
  }
  const norm = normalizeProjectTarget(targetOrProject);
  const profileId = owner?.profileId ?? norm.profileId ?? "ambient";
  const gen = owner?.generation ?? 1;
  return `${profileId}@${gen}:${norm.project}`;
}

export function extractProjectFromKey(key: string): string {
  const idx = key.indexOf(":");
  return idx >= 0 ? key.slice(idx + 1) : key;
}

export function extractOwnerFromKey(
  key: string,
): { profileId: string; generation: number } | null {
  const idx = key.indexOf(":");
  if (idx <= 0) return null;
  const prefix = key.slice(0, idx);
  const atIdx = prefix.indexOf("@");
  if (atIdx <= 0) return null;
  const profileId = prefix.slice(0, atIdx);
  const generation = parseInt(prefix.slice(atIdx + 1), 10);
  if (isNaN(generation)) return null;
  return { profileId, generation };
}

function zeroSessionKey(session: OpaqueSessionResult | undefined | null): void {
  if (!session) return;
  if (session.aesKey && session.aesKey.buffer) {
    try {
      new Uint8Array(session.aesKey.buffer).fill(0);
    } catch {
      // Best effort buffer zeroing
    }
  }
}

interface EncryptProjectState {
  enabled: boolean;
  passphrase: string | null;
}

export interface PromptRequest {
  id: string;
  key: string;
  project: string;
  profileId?: string;
  profileName?: string;
  resolve: (passphrase: string) => void;
  reject: (err: Error) => void;
}

export interface EncryptContextValue {
  /** Returns whether encrypted mode is enabled for a given project/owner. */
  isEncryptEnabled: (project: string, owner?: ConnectionRef) => boolean;
  /** Returns the cached passphrase for a project/owner, or null if not set. */
  getPassphrase: (project: string, owner?: ConnectionRef) => string | null;
  /** Set a passphrase for a project/owner (cache it without enabling encrypted mode). */
  setPassphrase: (
    project: string,
    passphrase: string,
    owner?: ConnectionRef,
  ) => void;
  /** Enable/disable encrypted mode. Disabling clears the passphrase, zeroes keys and evicts session. */
  setEncryptEnabled: (
    project: string,
    enabled: boolean,
    owner?: ConnectionRef,
  ) => void;
  /** Clear cached passphrase (e.g. on auth error — forces re-prompt). */
  clearPassphrase: (project: string, owner?: ConnectionRef) => void;
  /** Get cached OPAQUE session for a project/owner. */
  getSession: (
    project: string,
    owner?: ConnectionRef,
  ) => OpaqueSessionResult | null;
  /** Cache an OPAQUE session for a project/owner. */
  setSession: (
    project: string,
    session: OpaqueSessionResult,
    owner?: ConnectionRef,
  ) => void;
  /** Evict and zero cached OPAQUE session for a project/owner. */
  clearSession: (project: string, owner?: ConnectionRef) => void;
  /**
   * Request passphrase interactively. Queues prompts with explicit profile/project labels
   * and deduplicates exact same owned request.
   */
  promptPassphrase: (
    project: string,
    owner?: ConnectionRef,
    profileName?: string,
  ) => Promise<string>;
  /** Whether a passphrase prompt is currently pending. */
  isPrompting: boolean;
  /** The project currently being prompted. */
  promptingProject: string | null;
  /** The profile ID currently being prompted. */
  promptingProfileId: string | null;
  /** The profile display name currently being prompted. */
  promptingProfileName: string | null;
  /** The full owner-project key currently being prompted. */
  promptingKey: string | null;
  /** Resolve the pending prompt with a passphrase. */
  resolvePrompt: (passphrase: string) => void;
  /** Reject the pending prompt (user cancelled). */
  rejectPrompt: () => void;
}

// ---------------------------------------------------------------------------
// Context + Provider
// ---------------------------------------------------------------------------

const EncryptContext = createContext<EncryptContextValue | null>(null);

export function EncryptProvider({ children }: { children: ReactNode }) {
  // Map of owner-qualified key → encrypt state
  const stateRef = useRef<Map<string, EncryptProjectState>>(new Map());
  const [, forceUpdate] = useState(0);

  // OPAQUE session cache — lives here so disabling Lock evicts and zeroes the session atomically
  const sessionRef = useRef<Map<string, OpaqueSessionResult>>(new Map());

  // Prompt queue state
  const queueRef = useRef<PromptRequest[]>([]);
  const [isPrompting, setIsPrompting] = useState(false);
  const [promptingProject, setPromptingProject] = useState<string | null>(null);
  const [promptingProfileId, setPromptingProfileId] = useState<string | null>(
    null,
  );
  const [promptingProfileName, setPromptingProfileName] = useState<
    string | null
  >(null);
  const [promptingKey, setPromptingKey] = useState<string | null>(null);

  const getState = (key: string): EncryptProjectState => {
    if (!stateRef.current.has(key)) {
      stateRef.current.set(key, { enabled: false, passphrase: null });
    }
    return stateRef.current.get(key)!;
  };

  const isEncryptEnabled = useCallback(
    (project: string, owner?: ConnectionRef) => {
      const key = toEncryptKey(project, owner);
      return getState(key).enabled;
    },
    [],
  );

  const getPassphrase = useCallback(
    (project: string, owner?: ConnectionRef) => {
      const key = toEncryptKey(project, owner);
      return getState(key).passphrase;
    },
    [],
  );

  const setPassphrase = useCallback(
    (project: string, passphrase: string, owner?: ConnectionRef) => {
      const key = toEncryptKey(project, owner);
      const s = getState(key);
      s.passphrase = passphrase;
      forceUpdate((n) => n + 1);
    },
    [],
  );

  const clearPassphrase = useCallback(
    (project: string, owner?: ConnectionRef) => {
      const key = toEncryptKey(project, owner);
      const s = getState(key);
      s.passphrase = null;
      forceUpdate((n) => n + 1);
    },
    [],
  );

  const setEncryptEnabled = useCallback(
    (project: string, enabled: boolean, owner?: ConnectionRef) => {
      const key = toEncryptKey(project, owner);
      const s = getState(key);
      s.enabled = enabled;
      if (!enabled) {
        s.passphrase = null;
        const existingSession = sessionRef.current.get(key);
        zeroSessionKey(existingSession);
        sessionRef.current.delete(key);
        // Cancel any pending prompts for this key
        const canceled = queueRef.current.filter((r) => r.key === key);
        if (canceled.length > 0) {
          for (const req of canceled) {
            req.reject(new Error("Encrypted mode disabled"));
          }
          queueRef.current = queueRef.current.filter((r) => r.key !== key);
          if (queueRef.current.length === 0) {
            setIsPrompting(false);
            setPromptingProject(null);
            setPromptingProfileId(null);
            setPromptingProfileName(null);
            setPromptingKey(null);
          } else {
            const next = queueRef.current[0];
            setPromptingProject(next.project);
            setPromptingProfileId(next.profileId ?? null);
            setPromptingProfileName(next.profileName ?? null);
            setPromptingKey(next.key);
          }
        }
      }
      forceUpdate((n) => n + 1);
    },
    [],
  );

  const getSession = useCallback(
    (project: string, owner?: ConnectionRef): OpaqueSessionResult | null => {
      const key = toEncryptKey(project, owner);
      return sessionRef.current.get(key) ?? null;
    },
    [],
  );

  const setSession = useCallback(
    (project: string, session: OpaqueSessionResult, owner?: ConnectionRef) => {
      const key = toEncryptKey(project, owner);
      sessionRef.current.set(key, session);
    },
    [],
  );

  const clearSession = useCallback((project: string, owner?: ConnectionRef) => {
    const key = toEncryptKey(project, owner);
    const existing = sessionRef.current.get(key);
    zeroSessionKey(existing);
    sessionRef.current.delete(key);
  }, []);

  const activatePrompt = (request: PromptRequest) => {
    setPromptingProject(request.project);
    setPromptingProfileId(request.profileId ?? null);
    setPromptingProfileName(request.profileName ?? null);
    setPromptingKey(request.key);
    setIsPrompting(true);
  };

  const advanceQueue = () => {
    if (queueRef.current.length === 0) {
      setIsPrompting(false);
      setPromptingProject(null);
      setPromptingProfileId(null);
      setPromptingProfileName(null);
      setPromptingKey(null);
    } else {
      activatePrompt(queueRef.current[0]);
    }
  };

  const promptPassphrase = useCallback(
    (
      targetOrProject: ProjectTargetInput | string,
      owner?: ConnectionRef,
      profileName?: string,
    ): Promise<string> => {
      const key = toEncryptKey(targetOrProject, owner);
      const project =
        typeof targetOrProject === "string"
          ? extractProjectFromKey(targetOrProject)
          : normalizeProjectTarget(targetOrProject).project;
      const profileId =
        owner?.profileId ??
        (typeof targetOrProject === "object"
          ? normalizeProjectTarget(targetOrProject).profileId
          : undefined);

      // In-flight prompt deduplication: if exact same key is already queued, return joined promise
      const existing = queueRef.current.find((r) => r.key === key);
      if (existing) {
        const { promise, resolve, reject } = createDeferred<string>();
        const originalResolve = existing.resolve;
        const originalReject = existing.reject;
        existing.resolve = (pass) => {
          originalResolve(pass);
          resolve(pass);
        };
        existing.reject = (err) => {
          originalReject(err);
          reject(err);
        };
        return promise;
      }

      const { promise, resolve, reject } = createDeferred<string>();
      const request: PromptRequest = {
        id: generateUUID(),
        key,
        project,
        profileId,
        profileName,
        resolve,
        reject,
      };
      const wasEmpty = queueRef.current.length === 0;
      queueRef.current.push(request);
      if (wasEmpty) {
        activatePrompt(request);
      }
      return promise;
    },
    [],
  );

  const resolvePrompt = useCallback((passphrase: string) => {
    if (queueRef.current.length === 0) return;
    const current = queueRef.current.shift()!;
    try {
      current.resolve(passphrase);
    } finally {
      advanceQueue();
    }
  }, []);

  const rejectPrompt = useCallback(() => {
    if (queueRef.current.length === 0) return;
    const current = queueRef.current.shift()!;
    try {
      current.reject(new Error("Passphrase prompt cancelled"));
    } finally {
      advanceQueue();
    }
  }, []);

  // Connection lifecycle tracking: on connection drop or retirement, invalidate that owner's cache
  useEffect(() => {
    return subscribeConnections(() => {
      for (const [key, session] of Array.from(sessionRef.current.entries())) {
        const owner = extractOwnerFromKey(key);
        if (owner && !isCurrentConnection(owner)) {
          zeroSessionKey(session);
          sessionRef.current.delete(key);
        }
      }
      for (const [key, state] of Array.from(stateRef.current.entries())) {
        const owner = extractOwnerFromKey(key);
        if (owner && !isCurrentConnection(owner)) {
          state.passphrase = null;
        }
      }
      const stalePrompts = queueRef.current.filter((req) => {
        const owner = extractOwnerFromKey(req.key);
        return owner && !isCurrentConnection(owner);
      });
      if (stalePrompts.length > 0) {
        for (const req of stalePrompts) {
          req.reject(new Error("Connection retired or disconnected"));
        }
        queueRef.current = queueRef.current.filter(
          (req) => !stalePrompts.includes(req),
        );
        advanceQueue();
      }
    });
  }, []);

  return (
    <EncryptContext.Provider
      value={{
        isEncryptEnabled,
        getPassphrase,
        setPassphrase,
        setEncryptEnabled,
        clearPassphrase,
        getSession,
        setSession,
        clearSession,
        promptPassphrase,
        isPrompting,
        promptingProject,
        promptingProfileId,
        promptingProfileName,
        promptingKey,
        resolvePrompt,
        rejectPrompt,
      }}
    >
      {children}
    </EncryptContext.Provider>
  );
}

export function useEncryptMode() {
  const ctx = useContext(EncryptContext);
  if (!ctx) {
    throw new Error("useEncryptMode must be used within an EncryptProvider");
  }
  return ctx;
}
