import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
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
import { useConnectionSnapshot } from "@/api/connections.js";

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
  options?: {
    expectedSource?: { branch: string; sourceOid: string };
    scopeFence?: string;
  },
): UseLeasedGitPushResult {
  const normalized = normalizeProjectTarget(target);
  const owner = resolveTargetOwner(normalized.profileId);
  const connection = useConnectionSnapshot(normalized.profileId ?? "");
  const expectedSource = options?.expectedSource;
  const scopeKey = JSON.stringify([
    projectTargetCacheKey(normalized),
    root ?? ".",
    connection?.owner.generation ?? owner?.generation,
    expectedSource?.branch,
    expectedSource?.sourceOid,
    options?.scopeFence,
  ]);

  const [state, setState] = useState<LeasedPushState>("closed");
  const [preview, setPreview] = useState<PublishPreview | null>(null);
  const [result, setResult] = useState<PublishResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renderScope, setRenderScope] = useState(scopeKey);
  const frozenSnapshotRef = useRef<PublishSnapshot | null>(null);

  const activeScopeRef = useRef(scopeKey);
  const activeGenerationRef = useRef(0);

  const prepareMutation = useGitPrepareLeasedPush(normalized, root);
  const publishMutation = useGitPublishLeasedPush(normalized, root);

  const {
    passphraseDialogProps,
    statusMessage: sshStatus,
    executeLeasedWithRetry,
    cancel: cancelSshRetry,
  } = useGitWithSshRetry();

  // Reset presentation during render without mutating refs from an uncommitted render.
  if (renderScope !== scopeKey) {
    setRenderScope(scopeKey);
    setState("closed");
    setPreview(null);
    setResult(null);
    setError(null);
  }
  // Commit the operation fence before the new surface can receive events.
  useLayoutEffect(() => {
    if (activeScopeRef.current !== scopeKey) {
      activeScopeRef.current = scopeKey;
      activeGenerationRef.current += 1;
      frozenSnapshotRef.current = null;
      cancelSshRetry();
    }
  }, [cancelSshRetry, scopeKey]);
  useEffect(
    () => () => {
      activeGenerationRef.current += 1;
      frozenSnapshotRef.current = null;
      cancelSshRetry();
    },
    [cancelSshRetry],
  );

  const close = useCallback(() => {
    activeGenerationRef.current += 1;
    frozenSnapshotRef.current = null;
    cancelSshRetry();
    setState("closed");
    setPreview(null);
    setResult(null);
    setError(null);
  }, [cancelSshRetry]);

  const prepare = useCallback(async () => {
    if (
      activeScopeRef.current !== scopeKey ||
      state === "preparing" ||
      state === "publishing"
    )
      return;
    const generation = ++activeGenerationRef.current;
    const currentScope = scopeKey;

    setState("preparing");
    setPreview(null);
    setResult(null);
    setError(null);
    frozenSnapshotRef.current = null;

    try {
      const isCurrent = () =>
        generation === activeGenerationRef.current &&
        currentScope === activeScopeRef.current;
      const res = await executeLeasedWithRetry(
        owner,
        () => {
          if (!isCurrent()) throw new Error("SSH_CANCELLED");
          return prepareMutation.mutateAsync();
        },
        isCurrent,
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
        if (
          expectedSource &&
          (res.snapshot.branch !== expectedSource.branch ||
            res.snapshot.sourceOid !== expectedSource.sourceOid)
        ) {
          setState("blocked");
          setError(
            "Local history changed after squash. Inspect current history before publishing.",
          );
          return;
        }
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
  }, [
    executeLeasedWithRetry,
    owner,
    prepareMutation,
    scopeKey,
    state,
    expectedSource,
  ]);

  const publish = useCallback(async () => {
    const snapshot = frozenSnapshotRef.current;
    if (
      !snapshot ||
      activeScopeRef.current !== scopeKey ||
      state !== "confirming"
    )
      return;
    // Consume once before awaiting, including repeated clicks before React rerenders.
    frozenSnapshotRef.current = null;

    const generation = ++activeGenerationRef.current;
    const currentScope = scopeKey;

    setState("publishing");
    setError(null);

    try {
      const isCurrent = () =>
        generation === activeGenerationRef.current &&
        currentScope === activeScopeRef.current;
      const res = await executeLeasedWithRetry(
        owner,
        () => {
          if (!isCurrent()) throw new Error("SSH_CANCELLED");
          return publishMutation.mutateAsync(snapshot);
        },
        isCurrent,
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
        frozenSnapshotRef.current = snapshot;
        setState("confirming");
      } else {
        setState("unknown");
        setError(msg || "Failed to publish leased push");
      }
    }
  }, [executeLeasedWithRetry, owner, publishMutation, scopeKey, state]);

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
