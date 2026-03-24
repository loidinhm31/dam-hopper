import { useCallback, useRef, useState } from "react";
import type { ReactElement } from "react";
import { createElement } from "react";
import { PassphraseDialog } from "@/components/organisms/PassphraseDialog.js";
import { useSshAddKey, useSshListKeys } from "@/api/queries.js";
import type { GitOpResult } from "@/api/client.js";

/** Extract a string from whatever IPC serializes GitError to (string or Error-like object). */
function errorToString(error: unknown): string {
  if (!error) return "";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof (error as Record<string, unknown>).message === "string") {
    return (error as { message: string }).message;
  }
  return String(error);
}

function isAuthError(results: GitOpResult[]): boolean {
  return results.some((r) => {
    if (r.success) return false;
    const msg = errorToString(r.error).toLowerCase();
    return (
      msg.includes("permission denied") ||
      msg.includes("authentication failed") ||
      msg.includes("publickey") ||
      msg.includes("could not read from remote")
    );
  });
}

interface SshRetryState {
  open: boolean;
  loading: boolean;
  error: string | undefined;
}

interface UseGitWithSshRetryResult {
  /** Render this element near the top of your JSX tree */
  PassphraseDialogElement: ReactElement;
  /**
   * Wraps a git operation. If it returns auth-error results,
   * opens the passphrase dialog, loads key, then retries once.
   */
  executeWithRetry: (fn: () => Promise<GitOpResult[]>) => Promise<GitOpResult[]>;
}

export function useGitWithSshRetry(): UseGitWithSshRetryResult {
  const [state, setState] = useState<SshRetryState>({
    open: false,
    loading: false,
    error: undefined,
  });

  // Session-level cache: once ssh-add succeeds, skip dialog for subsequent ops
  const keysLoadedRef = useRef(false);

  // Stores the pending retry callback while dialog is open
  const pendingRetryRef = useRef<(() => Promise<GitOpResult[]>) | null>(null);
  const resolveRef = useRef<((results: GitOpResult[]) => void) | null>(null);
  const rejectRef = useRef<((err: unknown) => void) | null>(null);

  const sshAddKey = useSshAddKey();
  const { data: availableKeys = [] } = useSshListKeys();

  const executeWithRetry = useCallback(
    async (fn: () => Promise<GitOpResult[]>): Promise<GitOpResult[]> => {
      const results = await fn();

      // If keys are already loaded or no auth error, return immediately
      if (keysLoadedRef.current || !isAuthError(results)) {
        return results;
      }

      // Auth error detected — open dialog and wait for user action
      return new Promise<GitOpResult[]>((resolve, reject) => {
        pendingRetryRef.current = fn;
        resolveRef.current = resolve;
        rejectRef.current = reject;
        setState({ open: true, loading: false, error: undefined });
      });
    },
    [],
  );

  const handleSubmit = useCallback(
    async (passphrase: string, keyPath?: string) => {
      setState((s) => ({ ...s, loading: true, error: undefined }));

      const result = await sshAddKey.mutateAsync({ passphrase, keyPath });

      if (!result.success) {
        setState((s) => ({
          ...s,
          loading: false,
          error: result.error ?? "Failed to load SSH key",
        }));
        return;
      }

      // Key loaded — mark session cache and retry
      keysLoadedRef.current = true;
      setState({ open: false, loading: false, error: undefined });

      const retryFn = pendingRetryRef.current;
      const resolve = resolveRef.current;
      const reject = rejectRef.current;

      pendingRetryRef.current = null;
      resolveRef.current = null;
      rejectRef.current = null;

      if (retryFn && resolve) {
        try {
          const retryResults = await retryFn();
          resolve(retryResults);
        } catch (err) {
          reject?.(err);
        }
      }
    },
    [sshAddKey],
  );

  const handleCancel = useCallback(() => {
    const reject = rejectRef.current;
    pendingRetryRef.current = null;
    resolveRef.current = null;
    rejectRef.current = null;
    setState({ open: false, loading: false, error: undefined });
    // Reject with a user-cancelled marker so callers can handle gracefully
    reject?.(new Error("SSH_CANCELLED"));
  }, []);

  const PassphraseDialogElement = createElement(PassphraseDialog, {
    open: state.open,
    onSubmit: handleSubmit,
    onCancel: handleCancel,
    loading: state.loading,
    error: state.error,
    availableKeys,
  });

  return { PassphraseDialogElement, executeWithRetry };
}
