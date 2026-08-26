import { useEffect, useRef, useState } from "react";
import type { BrowserSelectionV1 } from "@dam-hopper/browser-bridge";
import { Button } from "@/components/atoms/Button.js";
import {
  browserTerminalTargetReason,
  isBrowserTerminalTargetReady,
  type BrowserTerminalTarget,
  type PreparedBrowserTerminalArtifact,
} from "@/lib/browser-terminal-handoff.js";
import { BrowserDebugTerminalHandoffDialog } from "./BrowserDebugTerminalHandoffDialog.js";
import { BrowserDebugTerminalTargetList } from "./BrowserDebugTerminalTargetList.js";

interface BrowserDebugTerminalHandoffProps {
  selection: BrowserSelectionV1 | null;
  mode?: "active" | "select";
  target: BrowserTerminalTarget | undefined;
  targets?: BrowserTerminalTarget[];
  onPrepare: (sessionId: string) => Promise<PreparedBrowserTerminalArtifact>;
  onDiscard: (artifactId: string) => Promise<void>;
  onInsert: (
    target: BrowserTerminalTarget,
    artifact: PreparedBrowserTerminalArtifact,
  ) => Promise<void>;
}

const PREPARE_ERROR =
  "Couldn’t create the browser bundle. Nothing was inserted; try again.";
const INSERT_ERROR = "This terminal closed before insertion. Create it again.";
const EXPIRED_ERROR = "This bundle is no longer available. Create it again.";

export function BrowserDebugTerminalHandoff({
  selection,
  mode = "active",
  target,
  targets = target ? [target] : [],
  onPrepare,
  onDiscard,
  onInsert,
}: BrowserDebugTerminalHandoffProps) {
  const [artifact, setArtifact] =
    useState<PreparedBrowserTerminalArtifact | null>(null);
  const [artifactTarget, setArtifactTarget] =
    useState<BrowserTerminalTarget | null>(null);
  const [pending, setPending] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [inserted, setInserted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const artifactRef = useRef<PreparedBrowserTerminalArtifact | null>(null);
  const insertedRef = useRef(false);
  const insertingRef = useRef(false);
  const preparationEpochRef = useRef(0);
  const mountedRef = useRef(true);
  const selectionRef = useRef(selection);
  const discardRef = useRef(onDiscard);

  useEffect(() => {
    artifactRef.current = artifact;
  }, [artifact]);

  useEffect(() => {
    discardRef.current = onDiscard;
  }, [onDiscard]);

  useEffect(() => {
    if (selectionRef.current === selection) return;
    selectionRef.current = selection;
    preparationEpochRef.current += 1;
    const pendingArtifact = artifactRef.current;
    if (pendingArtifact && !insertedRef.current) {
      void discardRef.current(pendingArtifact.artifact.artifactId);
    }
    artifactRef.current = null;
    setArtifact(null);
    setArtifactTarget(null);
    setInserted(false);
    setDialogOpen(false);
    setNotice(null);
    setPending(false);
  }, [selection]);

  useEffect(
    () => () => {
      mountedRef.current = false;
      preparationEpochRef.current += 1;
      const pendingArtifact = artifactRef.current;
      if (pendingArtifact && !insertedRef.current)
        void discardRef.current(pendingArtifact.artifact.artifactId);
    },
    [],
  );

  const selectedTarget = targets.find(
    (candidate) => candidate.sessionId === selectedId,
  );
  const preparationTarget = mode === "active" ? target : selectedTarget;
  const currentArtifactTarget = artifactTarget
    ? targets.find((candidate) => candidate.sessionId === artifactTarget.sessionId)
    : null;
  const canPrepare = Boolean(
    selection && isBrowserTerminalTargetReady(preparationTarget),
  );
  const visibleTarget = currentArtifactTarget ?? artifactTarget ?? preparationTarget;
  const visibleTargetReason = visibleTarget
    ? browserTerminalTargetReason(visibleTarget)
    : null;

  const discardArtifact = () => {
    if (artifact && !insertedRef.current) {
      void discardRef.current(artifact.artifact.artifactId);
    }
    setArtifact(null);
    artifactRef.current = null;
    setArtifactTarget(null);
  };

  const prepare = async () => {
    if (!preparationTarget || !canPrepare || pending) return;
    const targetAtPreparation = preparationTarget;
    const preparationEpoch = ++preparationEpochRef.current;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const nextArtifact = await onPrepare(targetAtPreparation.sessionId);
      if (
        !mountedRef.current ||
        preparationEpoch !== preparationEpochRef.current
      ) {
        void discardRef.current(nextArtifact.artifact.artifactId);
        return;
      }
      insertedRef.current = false;
      setInserted(false);
      artifactRef.current = nextArtifact;
      setArtifact(nextArtifact);
      setArtifactTarget(targetAtPreparation);
      setNotice("Reviewable artifact ready. No text has been inserted.");
    } catch {
      if (
        mountedRef.current &&
        preparationEpoch === preparationEpochRef.current
      ) {
        setError(PREPARE_ERROR);
      }
    } finally {
      if (
        mountedRef.current &&
        preparationEpoch === preparationEpochRef.current
      ) {
        setPending(false);
      }
    }
  };

  const selectTarget = (sessionId: string) => {
    if (sessionId === selectedId) return;
    preparationEpochRef.current += 1;
    discardArtifact();
    insertedRef.current = false;
    setInserted(false);
    setSelectedId(sessionId);
    setDialogOpen(false);
    setError(null);
    setNotice(null);
    setPending(false);
  };

  const insert = async () => {
    if (insertingRef.current || insertedRef.current) return;
    const targetToInsert = currentArtifactTarget ?? undefined;
    if (!artifact || !isBrowserTerminalTargetReady(targetToInsert) || pending) {
      setDialogOpen(false);
      setError(INSERT_ERROR);
      return;
    }
    if (artifact.artifact.expiresAt <= Date.now()) {
      discardArtifact();
      setDialogOpen(false);
      setError(EXPIRED_ERROR);
      return;
    }
    insertingRef.current = true;
    setPending(true);
    try {
      await onInsert(targetToInsert, artifact);
      insertedRef.current = true;
      setInserted(true);
      setDialogOpen(false);
      setNotice("Reference inserted; no command was run.");
    } catch {
      setError(INSERT_ERROR);
    } finally {
      insertingRef.current = false;
      setPending(false);
    }
  };

  return (
    <section
      aria-label="Send reference to terminal"
      className="max-h-40 shrink-0 overflow-y-auto border-t border-[var(--color-border)] px-3 py-3"
    >
      {mode === "select" && (
        <BrowserDebugTerminalTargetList
          disabled={!selection || pending}
          selectedId={selectedId}
          targets={targets}
          onSelect={selectTarget}
        />
      )}
      <p className="text-xs text-[var(--color-text-muted)]">
        {visibleTarget
          ? `${artifactTarget ? "Artifact terminal" : "Current terminal"}: ${visibleTarget.label}${visibleTargetReason ? ` · ${visibleTargetReason}` : ""}`
          : "Open a terminal before creating an artifact."}
      </p>
      {error && (
        <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {notice && (
        <p
          aria-live="polite"
          className="mt-2 text-xs text-[var(--color-text-muted)]"
        >
          {notice}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={!canPrepare || Boolean(artifact)}
          loading={pending && !dialogOpen}
          onClick={() => void prepare()}
        >
          Create reviewable artifact
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={
            !artifact ||
            !isBrowserTerminalTargetReady(currentArtifactTarget ?? undefined) ||
            inserted
          }
          onClick={() => setDialogOpen(true)}
        >
          Review & insert
        </Button>
      </div>
      {!selection && (
        <p className="mt-2 text-[11px] text-[var(--color-text-muted)]">
          Select an element before creating an artifact.
        </p>
      )}
      {artifact && (
        <BrowserDebugTerminalHandoffDialog
          open={dialogOpen}
          targetLabel={artifactTarget?.label ?? "current terminal"}
          reference={artifact.reference}
          pending={pending}
          onClose={() => setDialogOpen(false)}
          onConfirm={() => void insert()}
        />
      )}
    </section>
  );
}
