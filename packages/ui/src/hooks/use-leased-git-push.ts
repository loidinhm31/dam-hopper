import { useCallback, useEffect, useRef, useState } from "react";
import type { ComponentProps } from "react";
import {
  normalizeProjectTarget,
  projectTargetCacheKey,
  type ProjectTargetInput,
  type PublishPreview,
  type PublishResult,
  type PublishSnapshot,
} from "@/api/client.js";
import {
  resolveTargetOwner,
  useGitPrepareLeasedPush,
  useGitPublishLeasedPush,
} from "@/api/queries.js";
import { useGitWithSshRetry } from "@/hooks/use-git-with-ssh-retry.js";
import type { PassphraseDialog } from "@/components/organisms/PassphraseDialog.js";

export type LeasedPushState =
  | "closed"
  | "preparing"
  | "confirming"
  | "publishing"
  | "published"
  | "already-current"
  | "blocked"
  | "stale"
  | "rejected"
  | "unknown";

export interface UseLeasedGitPushResult {
  state: LeasedPushState;
  preview: PublishPreview | null;
  result: PublishResult | null;
  error: string | null;
  prepare: () => Promise<void>;
  publish: () => Promise<void>;
  close: () => void;
  passphraseDialogProps: ComponentProps<typeof PassphraseDialog>;
  sshStatus: string | undefined;
}

export function useLeasedGitPush(
  target: ProjectTargetInput,
  root?: string,
): UseLeasedGitPushResult {
  const normalized = normalizeProjectTarget(target);
  const owner = resolveTargetOwner(normalized.profileId);
  const scopeKey = `${projectTargetCacheKey(normalized)}::${root ?? "."}`;

  const [state, setState] = useState<LeasedPushState>("closed");
  const [preview, setPreview] = useState<PublishPreview | null>(null);
  const [result, setResult] = useState<PublishResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const frozenSnapshotRef = useRef<PublishSnapshot | null>(null);

  const activeScopeRef = useRef(scopeKey);
  const activeGenerationRef = useRef(0);

  const prepareMutation = useGitPrepareLeasedPush(normalized, root);
  const publishMutation = useGitPublishLeasedPush(normalized, root);

  const {
    passphraseDialogProps,
    statusMessage: sshStatus,
    executeLeasedWithRetry,
  } = useGitWithSshRetry();

  // Reset state and invalidate in-flight operations when project/worktree/root changes
  useEffect(() => {
    if (activeScopeRef.current !== scopeKey) {
      activeScopeRef.current = scopeKey;
      activeGenerationRef.current += 1;
      frozenSnapshotRef.current = null;
      setState("closed");
      setPreview(null);
      setResult(null);
      setError(null);
    }
  }, [scopeKey]);

  const close = useCallback(() => {
    activeGenerationRef.current += 1;
    frozenSnapshotRef.current = null;
    setState("closed");
    setPreview(null);
    setResult(null);
    setError(null);
  }, []);

  const prepare = useCallback(async () => {
    const generation = ++activeGenerationRef.current;
    const currentScope = scopeKey;

    setState("preparing");
    setPreview(null);
    setResult(null);
    setError(null);
    frozenSnapshotRef.current = null;

    try {
      const res = await executeLeasedWithRetry(owner, () =>
        prepareMutation.mutateAsync(),
      );

      // Ignore completions if scope changed or closed
      if (
        generation !== activeGenerationRef.current ||
        currentScope !== activeScopeRef.current
      ) {
        return;
      }

      setPreview(res);

      if (res.status === "ready") {
        if (res.alreadyCurrent) {
          setState("already-current");
        } else {
          frozenSnapshotRef.current = res.snapshot;
          setState("confirming");
        }
      } else {
        setState("blocked");
      }
    } catch (err) {
      if (
        generation !== activeGenerationRef.current ||
        currentScope !== activeScopeRef.current
      ) {
        return;
      }

      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "SSH_CANCELLED" || msg === "SSH_CANCELLED_STALE_CONNECTION") {
        setState("closed");
      } else {
        setState("blocked");
        setError(msg || "Failed to prepare leased push");
      }
    }
  }, [executeLeasedWithRetry, owner, prepareMutation, scopeKey]);

  const publish = useCallback(async () => {
    const snapshot = frozenSnapshotRef.current;
    if (!snapshot) return;

    const generation = ++activeGenerationRef.current;
    const currentScope = scopeKey;

    setState("publishing");
    setError(null);

    try {
      const res = await executeLeasedWithRetry(owner, () =>
        publishMutation.mutateAsync(snapshot),
      );

      if (
        generation !== activeGenerationRef.current ||
        currentScope !== activeScopeRef.current
      ) {
        return;
      }

      setResult(res);

      switch (res.status) {
        case "published":
          setState("published");
          break;
        case "already-current":
          setState("already-current");
          break;
        case "stale-remote":
        case "stale-local":
        case "stale-config":
          frozenSnapshotRef.current = null;
          setState("stale");
          break;
        case "rejected":
          setState("rejected");
          break;
        case "unknown":
          setState("unknown");
          break;
        case "auth-required":
          setState("blocked");
          break;
      }
    } catch (err) {
      if (
        generation !== activeGenerationRef.current ||
        currentScope !== activeScopeRef.current
      ) {
        return;
      }

      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "SSH_CANCELLED" || msg === "SSH_CANCELLED_STALE_CONNECTION") {
        setState("confirming");
      } else {
        setState("unknown");
        setError(msg || "Failed to publish leased push");
      }
    }
  }, [executeLeasedWithRetry, owner, publishMutation, scopeKey]);

  return {
    state,
    preview,
    result,
    error,
    prepare,
    publish,
    close,
    passphraseDialogProps,
    sshStatus,
  };
}
