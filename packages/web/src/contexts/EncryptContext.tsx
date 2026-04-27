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
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { OpaqueSessionResult } from "@/lib/opaque-session.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EncryptProjectState {
  enabled: boolean;
  /** Cached passphrase for this project (cleared on disable or error). */
  passphrase: string | null;
}

interface EncryptContextValue {
  /** Returns whether encrypted mode is enabled for a given project. */
  isEncryptEnabled: (project: string) => boolean;
  /** Returns the cached passphrase for a project, or null if not set. */
  getPassphrase: (project: string) => string | null;
  /** Set a passphrase for a project (cache it without enabling encrypted mode). */
  setPassphrase: (project: string, passphrase: string) => void;
  /** Enable/disable encrypted mode for a project. Disabling clears the passphrase and OPAQUE session. */
  setEncryptEnabled: (project: string, enabled: boolean) => void;
  /** Clear cached passphrase (e.g. on auth error — forces re-prompt). */
  clearPassphrase: (project: string) => void;
  /** Get cached OPAQUE session for a project. */
  getSession: (project: string) => OpaqueSessionResult | null;
  /** Cache an OPAQUE session for a project. */
  setSession: (project: string, session: OpaqueSessionResult) => void;
  /** Evict cached OPAQUE session for a project (forces re-auth on next operation). */
  clearSession: (project: string) => void;
  /**
   * Request passphrase interactively.
   * Returns a Promise that resolves with the passphrase when the user submits,
   * or rejects when the user cancels.
   */
  promptPassphrase: (project: string) => Promise<string>;
  /** Whether a passphrase prompt is currently pending. */
  isPrompting: boolean;
  /** The project currently being prompted. */
  promptingProject: string | null;
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
  // Map of project → encrypt state
  const stateRef = useRef<Map<string, EncryptProjectState>>(new Map());
  const [, forceUpdate] = useState(0);

  // OPAQUE session cache — lives here so disabling Lock evicts the session atomically
  const sessionRef = useRef<Map<string, OpaqueSessionResult>>(new Map());

  // Prompt state
  const [isPrompting, setIsPrompting] = useState(false);
  const [promptingProject, setPromptingProject] = useState<string | null>(null);
  const resolveRef = useRef<((passphrase: string) => void) | null>(null);
  const rejectRef = useRef<(() => void) | null>(null);

  const getState = (project: string): EncryptProjectState => {
    if (!stateRef.current.has(project)) {
      stateRef.current.set(project, { enabled: false, passphrase: null });
    }
    return stateRef.current.get(project)!;
  };

  const isEncryptEnabled = useCallback((project: string) => {
    return getState(project).enabled;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getPassphrase = useCallback((project: string) => {
    return getState(project).passphrase;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setPassphrase = useCallback((project: string, passphrase: string) => {
    const s = getState(project);
    s.passphrase = passphrase;
    forceUpdate((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearPassphrase = useCallback((project: string) => {
    const s = getState(project);
    s.passphrase = null;
    forceUpdate((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setEncryptEnabled = useCallback((project: string, enabled: boolean) => {
    const s = getState(project);
    s.enabled = enabled;
    if (!enabled) {
      s.passphrase = null;
      sessionRef.current.delete(project); // evict OPAQUE session atomically with passphrase
    }
    forceUpdate((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getSession = useCallback((project: string): OpaqueSessionResult | null => {
    return sessionRef.current.get(project) ?? null;
  }, []);

  const setSession = useCallback((project: string, session: OpaqueSessionResult) => {
    sessionRef.current.set(project, session);
  }, []);

  const clearSession = useCallback((project: string) => {
    sessionRef.current.delete(project);
  }, []);

  const promptPassphrase = useCallback((project: string): Promise<string> => {
    // Evict prior in-flight prompt. Clear refs BEFORE calling priorReject so that
    // any catch-block handler calling rejectPrompt() sees null refs and is a no-op
    // rather than accidentally rejecting the new promise.
    const priorReject = rejectRef.current;
    resolveRef.current = null;
    rejectRef.current = null;
    if (priorReject) priorReject();
    return new Promise((resolve, reject) => {
      resolveRef.current = resolve;
      rejectRef.current = reject;
      setPromptingProject(project);
      setIsPrompting(true);
    });
  }, []);

  const resolvePrompt = useCallback((passphrase: string) => {
    resolveRef.current?.(passphrase);
    resolveRef.current = null;
    rejectRef.current = null;
    setIsPrompting(false);
    setPromptingProject(null);
  }, []);

  const rejectPrompt = useCallback(() => {
    rejectRef.current?.();
    resolveRef.current = null;
    rejectRef.current = null;
    setIsPrompting(false);
    setPromptingProject(null);
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
