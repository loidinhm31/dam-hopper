import { useCallback, useRef, useState } from "react";
import type { ComponentProps } from "react";
import { PassphraseDialog } from "@/components/organisms/PassphraseDialog.js";
import { useSshAddKey, useSshListKeys } from "@/api/queries.js";
import type { GitOpResult, SshLoadKeyResult } from "@/api/client.js";

type GitRetryResult = GitOpResult | GitOpResult[];
type GitOperationLabel = "fetch" | "pull" | "push";

interface ExecuteWithRetryOptions {
  operation: GitOperationLabel;
}

export function normalizeGitRetryResults(result: GitRetryResult): GitOpResult[] {
  return Array.isArray(result) ? result : [result];
}

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

export function matchesSshAuthError(error: unknown): boolean {
  const msg = errorToString(error).toLowerCase();
  // "could not read from remote" is intentionally excluded because it also
  // appears for non-auth failures (e.g. missing submodule path, network issues).
  return (
    msg.includes("permission denied") ||
    msg.includes("authentication failed") ||
    msg.includes("publickey") ||
    msg.includes("no suitable credentials") ||
    msg.includes("agent admitted failure to sign") ||
    msg.includes("sign_and_send_pubkey") ||
    msg.includes("could not open a connection to your authentication agent")
  );
}

function isAuthError(results: GitOpResult[]): boolean {
  return results.some((r) => !r.success && matchesSshAuthError(r.error));
}

export function shouldPromptForSshPassphrase(
  results: GitOpResult[],
): boolean {
  return isAuthError(results);
}

interface SshRetryState {
  open: boolean;
  loading: boolean;
  error: string | undefined;
  status: string | undefined;
}

interface UseGitWithSshRetryResult {
  /** Pass these props to PassphraseDialog near the top of your JSX tree */
  passphraseDialogProps: ComponentProps<typeof PassphraseDialog>;
  statusMessage?: string;
  /**
   * Wraps a git operation. If it returns auth-error results,
   * opens the passphrase dialog, loads key, then retries once.
   */
  executeWithRetry: (
    options: ExecuteWithRetryOptions,
    fn: () => Promise<GitRetryResult>,
  ) => Promise<GitOpResult[]>;
}

export function getSshLoadKeyStatus(result: SshLoadKeyResult): string | undefined {
  if (result.error) return result.error;
  if (result.saved) {
    return "SSH key loaded. Saved passphrase is available for later use on this device.";
  }
  return "SSH key loaded for this server session only.";
}

function formatOperationName(operation: GitOperationLabel): string {
  return operation[0].toUpperCase() + operation.slice(1);
}

export function getRetryFailureStatus(
  operation: GitOperationLabel,
  results: GitOpResult[],
): string | undefined {
  if (!isAuthError(results)) return undefined;
  return `${formatOperationName(operation)} still failed after loading the selected SSH key. Verify the key, passphrase, and remote access.`;
}

export function getGitOperationSuccessStatus(
  operation: GitOperationLabel,
  results: GitOpResult[],
): string | undefined {
  if (results.length === 0 || results.some((result) => !result.success)) {
    return undefined;
  }

  if (results.length === 1) {
    return `${formatOperationName(operation)} succeeded.`;
  }

  return `${formatOperationName(operation)} succeeded for ${results.length} targets.`;
}

export function getGitOperationFailureStatus(
  operation: GitOperationLabel,
  results: GitOpResult[],
): string | undefined {
  const failures = results.filter((result) => !result.success);
  if (failures.length === 0) return undefined;

  const authRetryStatus = getRetryFailureStatus(operation, results);
  if (authRetryStatus) return authRetryStatus;

  const firstError = failures[0]?.error?.trim();
  if (failures.length === 1) {
    return firstError
      ? `${formatOperationName(operation)} failed: ${firstError}`
      : `${formatOperationName(operation)} failed.`;
  }

  return firstError
    ? `${formatOperationName(operation)} failed for ${failures.length} targets. First error: ${firstError}`
    : `${formatOperationName(operation)} failed for ${failures.length} targets.`;
}

export function getGitOperationStatus(
  operation: GitOperationLabel,
  results: GitOpResult[],
): string | undefined {
  return (
    getGitOperationFailureStatus(operation, results) ??
    getGitOperationSuccessStatus(operation, results)
  );
}

export async function retryGitOperationAfterSshLoad(
  operation: GitOperationLabel,
  retryFn: () => Promise<GitRetryResult>,
): Promise<{ results: GitOpResult[]; status: string | undefined }> {
  const results = normalizeGitRetryResults(await retryFn());
  return {
    results,
    status: getGitOperationStatus(operation, results),
  };
}

export function useGitWithSshRetry(): UseGitWithSshRetryResult {
  const [state, setState] = useState<SshRetryState>({
    open: false,
    loading: false,
    error: undefined,
    status: undefined,
  });

  // Stores the pending retry callback while dialog is open
  const pendingRetryRef = useRef<(() => Promise<GitRetryResult>) | null>(null);
  const resolveRef = useRef<((results: GitOpResult[]) => void) | null>(null);
  const rejectRef = useRef<((err: unknown) => void) | null>(null);

  const sshAddKey = useSshAddKey();
  const { data: availableKeys = [] } = useSshListKeys();
  const operationRef = useRef<GitOperationLabel>("push");

  const executeWithRetry = useCallback(
    async (
      options: ExecuteWithRetryOptions,
      fn: () => Promise<GitRetryResult>,
    ): Promise<GitOpResult[]> => {
      operationRef.current = options.operation;
      setState((current) => ({ ...current, status: undefined }));
      const results = normalizeGitRetryResults(await fn());

      if (!shouldPromptForSshPassphrase(results)) {
        setState((current) => ({
          ...current,
          status: getGitOperationStatus(options.operation, results),
        }));
        return results;
      }

      // Auth error detected — open dialog and wait for user action
      return new Promise<GitOpResult[]>((resolve, reject) => {
        pendingRetryRef.current = fn;
        resolveRef.current = resolve;
        rejectRef.current = reject;
        setState({
          open: true,
          loading: false,
          error: undefined,
          status: undefined,
        });
      });
    },
    [],
  );

  const handleSubmit = useCallback(
    async (passphrase: string, keyPath: string | undefined, saveForLater: boolean) => {
      setState((s) => ({ ...s, loading: true, error: undefined }));

      let result;
      try {
        result = await sshAddKey.mutateAsync({ passphrase, keyPath, saveForLater });
      } catch (error) {
        setState((s) => ({
          ...s,
          loading: false,
          error: errorToString(error) || "Failed to load SSH key",
        }));
        return;
      }

      if (!result.success) {
        setState((s) => ({
          ...s,
          loading: false,
          error: result.error ?? "Failed to load SSH key",
        }));
        return;
      }

      const status = getSshLoadKeyStatus(result);
      setState({
        open: false,
        loading: false,
        error: undefined,
        status,
      });

      const retryFn = pendingRetryRef.current;
      const resolve = resolveRef.current;
      const reject = rejectRef.current;

      pendingRetryRef.current = null;
      resolveRef.current = null;
      rejectRef.current = null;

      if (retryFn && resolve) {
        try {
          const retry = await retryGitOperationAfterSshLoad(
            operationRef.current,
            retryFn,
          );
          // If the retry still fails with an auth error the passphrase was wrong —
          // reset the session cache so the dialog can appear again next time.
          if (retry.status) {
            setState((current) => ({ ...current, status: retry.status }));
          }
          resolve(retry.results);
        } catch (err) {
          setState((current) => ({
            ...current,
            status:
              errorToString(err) ||
              `${formatOperationName(operationRef.current)} retry failed after loading the selected SSH key.`,
          }));
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
    setState((current) => ({
      ...current,
      open: false,
      loading: false,
      error: undefined,
      status: undefined,
    }));
    // Reject with a user-cancelled marker so callers can handle gracefully
    reject?.(new Error("SSH_CANCELLED"));
  }, []);

  const passphraseDialogProps = {
    open: state.open,
    onSubmit: handleSubmit,
    onCancel: handleCancel,
    loading: state.loading,
    error: state.error,
    availableKeys,
  };

  return {
    passphraseDialogProps,
    statusMessage: state.status,
    executeWithRetry,
  };
}
