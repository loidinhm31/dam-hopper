import { useEffect, useRef, useState, type RefObject } from "react";
import {
  ApiRequestError,
  normalizeProjectTarget,
  type CommitMessageResponse,
  type GitLogEntry,
  type ProjectTargetInput,
  type ProjectTargetRef,
} from "@/api/client.js";
import {
  getBoundApiClient,
  resolveTargetOwner,
  useGitSquash,
} from "@/api/queries.js";
import { useConnectionSnapshot } from "@/api/connections.js";
import type { GitHistoryViewResult } from "@/hooks/use-git-history-view.js";
import {
  useLeasedGitPush,
  type UseLeasedGitPushResult,
} from "@/hooks/use-leased-git-push.js";
import {
  combineCommitMessages,
  normalizeCommitMessage,
} from "@/lib/git-squash-selection.js";

export type GitSquashContext = Pick<
  GitHistoryViewResult,
  | "squashScopeKey"
  | "squashSelection"
  | "squashAvailable"
  | "activeBranchRef"
  | "clearSquashSelection"
  | "clearSelectedCommit"
  | "refresh"
>;
type Phase =
  | "closed"
  | "loading"
  | "read-error"
  | "ready"
  | "pending"
  | "blocked"
  | "uncertain";
interface SquashState {
  phase: Phase;
  entries: GitLogEntry[];
  draft: string;
  snapshot?: CommitMessageResponse;
  error?: string;
  signatureConsentRequired: boolean;
  allowSignatureRemoval: boolean;
}
export interface GitSquashReceipt {
  branch: string;
  sourceOid: string;
  count: number;
  targetOid?: string;
  capturedTarget: ProjectTargetRef;
  root?: string;
  ownerGeneration?: number;
}
export interface GitSquashActions extends SquashState {
  open: boolean;
  begin: () => void;
  close: () => void;
  submit: () => Promise<void>;
  retryMessages: () => void;
  inspectHistory: () => void;
  setDraft: (draft: string) => void;
  setConsent: (consent: boolean) => void;
  receipt: GitSquashReceipt | null;
  success: string | null;
  publication: UseLeasedGitPushResult;
  revokePublication: () => void;
  toolbarRef: RefObject<HTMLDivElement | null>;
  restoreFocus: () => void;
  restorePublicationFocus: (launcher: HTMLElement | null | undefined) => void;
  scopeLabel: string;
  project: string;
  rootLabel: string;
}
const closedState = (): SquashState => ({
  phase: "closed",
  entries: [],
  draft: "",
  signatureConsentRequired: false,
  allowSignatureRemoval: false,
});

export function useGitSquashActions(
  target: ProjectTargetInput,
  root: string | undefined,
  context: GitSquashContext,
): GitSquashActions {
  const targetRef = normalizeProjectTarget(target);
  const connection = useConnectionSnapshot(targetRef.profileId ?? "");
  const owner = resolveTargetOwner(targetRef.profileId);
  const scope = JSON.stringify([
    context.squashScopeKey,
    targetRef.profileId,
    targetRef.project,
    targetRef.worktreePath,
    root,
    connection?.owner.generation ?? owner?.generation,
  ]);
  const [state, setState] = useState<SquashState>(closedState);
  const [receipt, setReceipt] = useState<GitSquashReceipt | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const tokenRef = useRef(0);
  const scopeRef = useRef(scope);
  const dialogScopeRef = useRef<string | null>(null);
  const allowFocusRestoreRef = useRef(false);
  const receiptRef = useRef(receipt);
  receiptRef.current = receipt;
  const stateRef = useRef(state);
  stateRef.current = state;
  const toolbarRef = useRef<HTMLDivElement>(null);
  const launcherRef = useRef<HTMLElement | null>(null);
  const mutation = useGitSquash(targetRef, root);
  const publication = useLeasedGitPush(
    receipt?.capturedTarget ?? targetRef,
    receipt ? receipt.root : root,
    { expectedSource: receipt ?? undefined, scopeFence: scope },
  );
  // Once submitted, page reconciliation cannot cancel the outcome receipt.
  // A successful/uncertain rewrite may remove rows during mutation invalidation.
  const missingSelection =
    state.phase !== "closed" &&
    state.phase !== "pending" &&
    state.phase !== "uncertain" &&
    state.entries.some(
      (entry) => !context.squashSelection.orderedHashes.includes(entry.hash),
    );
  if (scopeRef.current !== scope || missingSelection) {
    scopeRef.current = scope;
    allowFocusRestoreRef.current = false;
    receiptRef.current = null;
    tokenRef.current += 1;
    stateRef.current = closedState();
    setState(stateRef.current);
    setReceipt(null);
    setSuccess(null);
  }
  useEffect(
    () => () => {
      tokenRef.current += 1;
      allowFocusRestoreRef.current = false;
      receiptRef.current = null;
    },
    [],
  );

  function isCurrent(token: number, capturedScope: string) {
    return (
      token === tokenRef.current &&
      capturedScope === scopeRef.current &&
      resolveTargetOwner(targetRef.profileId)?.generation === owner?.generation
    );
  }
  function revokePublication() {
    receiptRef.current = null;
    setReceipt(null);
    setSuccess(null);
    publication.close();
  }
  function restoreFocus() {
    if (
      !allowFocusRestoreRef.current ||
      dialogScopeRef.current !== scopeRef.current
    )
      return;
    allowFocusRestoreRef.current = false;
    const launcher = launcherRef.current;
    if (launcher?.isConnected && !launcher.hasAttribute("disabled") && !receipt)
      launcher.focus();
    else toolbarRef.current?.focus();
  }
  function restorePublicationFocus(launcher: HTMLElement | null | undefined) {
    if (!receiptRef.current || scope !== scopeRef.current) return;
    if (launcher?.isConnected && !launcher.hasAttribute("disabled"))
      launcher.focus();
    else toolbarRef.current?.focus();
  }
  function close() {
    if (stateRef.current.phase === "pending") return;
    tokenRef.current += 1;
    stateRef.current = closedState();
    setState(stateRef.current);
  }
  async function load(entries: GitLogEntry[]) {
    const token = ++tokenRef.current;
    const capturedScope = scope;
    const capturedTarget = { ...targetRef };
    const capturedRoot = root;
    const branch = context.activeBranchRef;
    dialogScopeRef.current = capturedScope;
    allowFocusRestoreRef.current = true;
    const capturedEntries = entries.map((entry) => ({
      ...entry,
      parents: [...entry.parents],
    }));
    stateRef.current = {
      ...closedState(),
      phase: "loading",
      entries: capturedEntries,
    };
    setState(stateRef.current);
    try {
      const client = getBoundApiClient(owner);
      const messages = await Promise.all(
        capturedEntries.map((entry) =>
          client.git.commitMessage(capturedTarget, entry.hash, capturedRoot),
        ),
      );
      if (!isCurrent(token, capturedScope)) return;
      const snapshot = messages[0];
      if (
        !snapshot ||
        snapshot.branch !== branch ||
        messages.some(
          (value) =>
            value.branch !== snapshot.branch ||
            value.headOid !== snapshot.headOid,
        )
      ) {
        setState((previous) => ({
          ...previous,
          phase: "blocked",
          error:
            "History changed while loading messages. Refresh and select again.",
        }));
        return;
      }
      setState((previous) => ({
        ...previous,
        phase: "ready",
        snapshot,
        draft: combineCommitMessages(messages.map((value) => value.message)),
      }));
    } catch (error) {
      if (!isCurrent(token, capturedScope)) return;
      setState((previous) => ({
        ...previous,
        phase: "read-error",
        error:
          error instanceof Error
            ? error.message
            : "Could not load full messages. Retry the entire batch or cancel.",
      }));
    }
  }
  function open() {
    if (
      !context.squashAvailable ||
      !context.squashSelection.valid ||
      stateRef.current.phase !== "closed" ||
      publication.state !== "closed"
    )
      return;
    launcherRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    revokePublication();
    void load(context.squashSelection.entries);
  }
  async function submit() {
    const current = stateRef.current;
    if (
      current.phase !== "ready" ||
      !current.snapshot ||
      !current.draft.trim() ||
      (current.signatureConsentRequired && !current.allowSignatureRemoval)
    )
      return;
    const token = tokenRef.current;
    const capturedScope = scope;
    stateRef.current = { ...current, phase: "pending", error: undefined };
    setState(stateRef.current);
    try {
      const result = await mutation.mutateAsync({
        hashes: current.entries.map((entry) => entry.hash),
        message: normalizeCommitMessage(current.draft),
        expectedBranch: current.snapshot.branch,
        expectedHeadOid: current.snapshot.headOid,
        ...(current.allowSignatureRemoval
          ? { allowSignatureRemoval: true }
          : {}),
      });
      if (!isCurrent(token, capturedScope)) return;
      if (result.ok) {
        tokenRef.current += 1;
        setState(closedState());
        context.clearSelectedCommit();
        context.clearSquashSelection();
        setSuccess(
          `Squashed ${current.entries.length} commits locally. Remote unchanged.`,
        );
        if (result.newHeadOid)
          setReceipt({
            branch: current.snapshot.branch,
            sourceOid: result.newHeadOid,
            count: current.entries.length,
            targetOid: result.newTargetOid ?? result.hash,
            capturedTarget: { ...targetRef },
            root,
            ownerGeneration: owner?.generation,
          });
      } else {
        const consent = result.blockedReason === "signature-consent-required";
        setState((previous) => ({
          ...previous,
          phase:
            result.blockedReason === "publication-uncertain"
              ? "uncertain"
              : "ready",
          signatureConsentRequired:
            consent || previous.signatureConsentRequired,
          error: [
            result.message || "Squash was blocked.",
            result.recommendation,
            result.recovery?.canAbort || result.recovery?.canContinue
              ? "Resolve the active operation before continuing."
              : undefined,
          ]
            .filter(Boolean)
            .join(" "),
        }));
      }
    } catch (error) {
      if (!isCurrent(token, capturedScope)) return;
      // A typed HTTP rejection proves no successful response; an ambiguous transport failure may follow CAS.
      const known =
        error instanceof ApiRequestError &&
        error.status >= 400 &&
        error.status < 500;
      const stale =
        error instanceof ApiRequestError &&
        (error.status === 409 || error.code?.includes("STALE"));
      setState((previous) => ({
        ...previous,
        phase: known ? (stale ? "blocked" : "ready") : "uncertain",
        error: `${error instanceof Error ? error.message : "Squash outcome unknown."}${known ? "" : " The rewrite may have happened. Inspect and refresh history; do not retry blindly."}`,
      }));
    }
  }
  return {
    ...state,
    open: state.phase !== "closed",
    begin: open,
    close,
    submit,
    retryMessages: () => {
      if (state.phase === "read-error") void load(state.entries);
    },
    inspectHistory: () => {
      void context.refresh();
    },
    setDraft: (draft: string) => {
      if (state.phase === "ready" || state.phase === "blocked")
        setState((previous) => ({ ...previous, draft }));
    },
    setConsent: (allowSignatureRemoval: boolean) => {
      if (state.phase === "ready")
        setState((previous) => ({ ...previous, allowSignatureRemoval }));
    },
    receipt,
    success,
    publication,
    revokePublication,
    toolbarRef,
    restoreFocus,
    restorePublicationFocus,
    scopeLabel: [
      targetRef.profileId,
      targetRef.project,
      targetRef.worktreePath,
      `Root: ${root ?? "."}`,
      context.activeBranchRef,
    ]
      .filter(Boolean)
      .join(" · "),
    project: targetRef.project,
    rootLabel: root && root !== "." ? root : "Project root",
  };
}
