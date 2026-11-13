import { useCallback, useEffect, useRef, useState } from "react";
import type {
  BrowserDebugArtifactResponse,
  BrowserSelectionV1,
} from "@/api/client.js";
import {
  getApi,
  isCurrentConnection,
} from "@/api/connections.js";
import {
  BrowserHostClientError,
  requestBrowserHostJson,
} from "@/api/browser-host-client.js";
import {
  ConnectionOwnerError,
  type ConnectionRef,
} from "@/api/ownership.js";
import {
  prepareBrowserTerminalArtifact,
  type BrowserTerminalTarget,
  type PreparedBrowserTerminalArtifact,
} from "@/lib/browser-terminal-handoff.js";
import { latestTerminalSessionIncarnation } from "@/lib/terminal-incarnation-state.js";
import type { OsWindow } from "@/os/types.js";
import {
  isDocumentVisible,
  subscribeDocumentVisibility,
} from "./visibility-demand.js";
export interface InspectPoint {
  x: number;
  y: number;
}

export interface BrowserSelectionSummary {
  active: boolean;
  selectionRevision: number;
  navigationRevision: number;
  preview: BrowserSelectionV1 | null;
}

export interface HostSelectionStartResponse {
  selectionActive: boolean;
  navigationRevision: number;
  selectionRevision: number;
  preview?: BrowserSelectionV1 | null;
}

export interface HostSelectionCancelResponse {
  selectionActive: boolean;
  navigationRevision: number;
  selectionRevision: number;
}

export interface HostSelectionArtifactResponse extends BrowserDebugArtifactResponse {
  selectionRevision: number;
  navigationRevision: number;
  selection?: BrowserSelectionV1;
}

export interface HostTerminalCandidate {
  sessionId: string;
  profileId: string;
  generation: number;
  incarnation: string;
  label: string;
  ready: boolean;
  reason?: string;
}


export async function startHostBrowserSelection(
  owner: ConnectionRef,
  sessionId: string,
  req: {
    leaseToken: string;
    navigationRevision: number | string;
    inspectPoint?: InspectPoint;
  },
  signal?: AbortSignal,
): Promise<HostSelectionStartResponse> {
  return requestBrowserHostJson<HostSelectionStartResponse>(
    owner,
    `/api/browser/sessions/${encodeURIComponent(sessionId)}/selection/start`,
    {
      method: "POST",
      body: req,
      signal,
    },
  );
}

export async function cancelHostBrowserSelection(
  owner: ConnectionRef,
  sessionId: string,
  req: {
    leaseToken: string;
    navigationRevision: number | string;
  },
  signal?: AbortSignal,
): Promise<HostSelectionCancelResponse> {
  return requestBrowserHostJson<HostSelectionCancelResponse>(
    owner,
    `/api/browser/sessions/${encodeURIComponent(sessionId)}/selection/cancel`,
    {
      method: "POST",
      body: req,
      signal,
    },
  );
}

export async function getHostBrowserSelectionState(
  owner: ConnectionRef,
  sessionId: string,
  signal?: AbortSignal,
): Promise<{
  url?: string;
  navigationRevision: string;
  status: string;
  selection?: BrowserSelectionSummary;
}> {
  return requestBrowserHostJson<{
    url?: string;
    navigationRevision: string;
    status: string;
    selection?: BrowserSelectionSummary;
  }>(owner, `/api/browser/sessions/${encodeURIComponent(sessionId)}`, {
    signal,
  });
}

export async function createHostSelectionArtifacts(
  owner: ConnectionRef,
  sessionId: string,
  req: {
    selectionRevision: number;
    terminalId: string;
    terminalIncarnation: string | number;
    navigationRevision?: number | string;
    includePng?: boolean;
  },
  signal?: AbortSignal,
): Promise<HostSelectionArtifactResponse> {
  return requestBrowserHostJson<HostSelectionArtifactResponse>(
    owner,
    `/api/browser/sessions/${encodeURIComponent(sessionId)}/selection/artifacts`,
    {
      method: "POST",
      body: {
        selectionRevision: req.selectionRevision,
        terminalId: req.terminalId,
        terminalIncarnation: String(req.terminalIncarnation),
        navigationRevision: req.navigationRevision,
        includePng: req.includePng ?? true,
      },
      signal,
    },
  );
}

export async function handoffHostSelectionArtifact(
  owner: ConnectionRef,
  artifactId: string,
): Promise<{ inserted: boolean }> {
  if (!isCurrentConnection(owner)) {
    throw new ConnectionOwnerError(
      `Connection is stale or disconnected: ${owner.profileId}@${owner.generation}`,
      "stale",
    );
  }
  const res = await getApi(owner).browserDebug.handoff(artifactId);
  return typeof res === "string" ? (JSON.parse(res) as { inserted: boolean }) : res;
}

export async function deleteHostSelectionArtifact(
  owner: ConnectionRef,
  artifactId: string,
): Promise<void> {
  if (!isCurrentConnection(owner)) {
    throw new ConnectionOwnerError(
      `Connection is stale or disconnected: ${owner.profileId}@${owner.generation}`,
      "stale",
    );
  }
  await getApi(owner).browserDebug.deleteArtifact(artifactId);
}

export function toBrowserTerminalTarget(
  candidate: HostTerminalCandidate,
): BrowserTerminalTarget {
  const numInc = Number(candidate.incarnation);
  return {
    sessionId: candidate.sessionId,
    profileId: candidate.profileId,
    incarnation: Number.isSafeInteger(numInc) ? numInc : undefined,
    label: candidate.label,
    mounted: true,
    registered: true,
    alive: candidate.ready,
    current: true,
  };
}

function pickLatestIncarnation(
  candidates: Array<string | undefined>,
): string | undefined {
  let best: string | undefined;
  let bestNum: bigint | null = null;
  for (const cand of candidates) {
    if (!cand || !/^\d+$/.test(cand)) continue;
    try {
      const n = BigInt(cand);
      if (bestNum === null || n > bestNum) {
        bestNum = n;
        best = cand;
      }
    } catch {
      // ignore unparseable
    }
  }
  return best ?? candidates.find((c) => Boolean(c));
}

export function collectHostTerminalCandidates(
  owner: ConnectionRef,
  windows: Record<string, OsWindow> | undefined | null,
  liveSessions?: ReadonlyArray<{
    id: string;
    incarnation?: number;
    incarnationExact?: string;
    alive?: boolean;
    name?: string | null;
    title?: string | null;
  }>,
): HostTerminalCandidate[] {
  if (liveSessions != null && !Array.isArray(liveSessions)) {
    return [];
  }
  const seen = new Set<string>();
  const candidates: HostTerminalCandidate[] = [];
  const liveMap = new Map(
    (liveSessions ?? []).map((s) => [s.id, s] as const),
  );
  for (const win of Object.values(windows ?? {})) {
    if (win.appId !== "terminals") continue;
    if (win.ctx.profileId !== owner.profileId) continue;

    const runtimeTarget =
      win.runtimeIdentity?.kind === "terminal"
        ? (win.runtimeIdentity.target as {
            terminalId?: string;
            incarnation?: string;
            generation?: number;
            profileId?: string;
          })
        : undefined;

    if (
      runtimeTarget &&
      runtimeTarget.generation !== undefined &&
      runtimeTarget.generation !== owner.generation
    ) {
      continue;
    }

    const sessionId =
      runtimeTarget?.terminalId ??
      (win.appState?.sessionId as string | undefined) ??
      (win.appState?.terminalId as string | undefined);
    if (!sessionId || seen.has(sessionId)) continue;
    seen.add(sessionId);

    const liveRow = liveMap.get(sessionId);
    const rememberedInc = latestTerminalSessionIncarnation({
      profileId: owner.profileId,
      id: sessionId,
    });
    const rawInc = pickLatestIncarnation([
      liveRow?.incarnationExact ??
        (liveRow?.incarnation !== undefined
          ? String(liveRow.incarnation)
          : undefined),
      runtimeTarget?.incarnation,
      win.appState?.incarnationExact as string | undefined,
      win.appState?.incarnation !== undefined
        ? String(win.appState.incarnation)
        : undefined,
      rememberedInc !== undefined ? String(rememberedInc) : undefined,
    ]);

    const alive = liveRow ? liveRow.alive !== false : Boolean(rawInc);
    const ready = Boolean(rawInc && alive);

    candidates.push({
      sessionId,
      profileId: owner.profileId,
      generation: owner.generation,
      incarnation: rawInc ?? "",
      label: win.title || liveRow?.title || liveRow?.name || sessionId,
      ready,
      reason: !rawInc
        ? "Missing terminal incarnation"
        : !alive
          ? "Disconnected"
          : undefined,
    });
  }

  for (const s of liveSessions ?? []) {
    if (seen.has(s.id) || s.alive === false) continue;
    const rawInc =
      s.incarnationExact ??
      (s.incarnation !== undefined ? String(s.incarnation) : undefined);
    if (!rawInc) continue;
    seen.add(s.id);
    candidates.push({
      sessionId: s.id,
      profileId: owner.profileId,
      generation: owner.generation,
      incarnation: rawInc,
      label: s.title || s.name || s.id,
      ready: true,
      reason: undefined,
    });
  }

  return candidates;
}

export interface UseHostBrowserSelectionOptions {
  owner: ConnectionRef;
  sessionId: string | undefined;
  navigationRevision: number | string;
  leaseToken: string | undefined;
  onNavigationSync?: (update: { navigationRevision: string; url?: string }) => void;
  targets: HostTerminalCandidate[];
  pollIntervalMs?: number;
  enabled?: boolean;
}

export interface HostBrowserSelectionController {
  selectionActive: boolean;
  selectionRevision: number;
  preview: BrowserSelectionV1 | null;
  preparedArtifact: PreparedBrowserTerminalArtifact | null;
  capturedTarget: HostTerminalCandidate | null;
  inserted: boolean;
  pending: boolean;
  error: string | null;
  notice: string | null;
  startSelection: (inspectPoint?: InspectPoint) => Promise<void>;
  cancelSelection: () => Promise<void>;
  prepareArtifact: (
    target: HostTerminalCandidate,
    includePng?: boolean,
  ) => Promise<void>;
  handoffArtifact: () => Promise<void>;
  discardArtifact: () => Promise<void>;
  clearMessages: () => void;
}

export function useHostBrowserSelection({
  owner,
  sessionId,
  navigationRevision,
  leaseToken,
  onNavigationSync,
  targets,
  pollIntervalMs = 200,
  enabled = true,
}: UseHostBrowserSelectionOptions): HostBrowserSelectionController {
  const [selectionActive, setSelectionActive] = useState(false);
  const [selectionRevision, setSelectionRevision] = useState(0);
  const [preview, setPreview] = useState<BrowserSelectionV1 | null>(null);
  const [preparedArtifact, setPreparedArtifact] =
    useState<PreparedBrowserTerminalArtifact | null>(null);
  const [capturedTarget, setCapturedTarget] =
    useState<HostTerminalCandidate | null>(null);
  const [inserted, setInserted] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const epochRef = useRef(0);
  const skipResetForNavRef = useRef<{
    ownerProfileId: string;
    ownerGeneration: number;
    sessionId?: string;
    navRev: string;
  } | null>(null);
  const mountedRef = useRef(true);
  const latestContextRef = useRef({
    owner,
    sessionId,
    navigationRevision: String(navigationRevision),
    leaseToken,
    targets,
    selectionRevision,
    inserted,
    preparedArtifact,
    onNavigationSync,
  });

  latestContextRef.current = {
    owner,
    sessionId,
    navigationRevision: String(navigationRevision),
    leaseToken,
    targets,
    selectionRevision,
    inserted,
    preparedArtifact,
    onNavigationSync,
  };

  const discardUnclaimedArtifact = useCallback(
    async (
      artifactToDiscard: PreparedBrowserTerminalArtifact | null,
      wasInserted: boolean,
      artifactOwner: ConnectionRef,
    ) => {
      if (!artifactToDiscard || wasInserted) return;
      try {
        await deleteHostSelectionArtifact(
          artifactOwner,
          artifactToDiscard.artifact.artifactId,
        );
      } catch {
        // best-effort cleanup
      }
    },
    [],
  );

  const ownerProfileId = owner.profileId;
  const ownerGeneration = owner.generation;
  const navRevKey = String(navigationRevision);

  // Invalidate selection preview and pending handoff whenever navigationRevision, sessionId, or owner changes
  useEffect(() => {
    const skip = skipResetForNavRef.current;
    if (
      skip &&
      skip.ownerProfileId === ownerProfileId &&
      skip.ownerGeneration === ownerGeneration &&
      skip.sessionId === sessionId &&
      skip.navRev === navRevKey
    ) {
      skipResetForNavRef.current = null;
      return;
    }
    skipResetForNavRef.current = null;
    epochRef.current += 1;
    const prev = latestContextRef.current.preparedArtifact;
    const prevInserted = latestContextRef.current.inserted;
    if (prev && !prevInserted) {
      void discardUnclaimedArtifact(prev, false, {
        profileId: ownerProfileId,
        generation: ownerGeneration,
      });
    }
    setSelectionActive(false);
    setSelectionRevision(0);
    setPreview(null);
    setPreparedArtifact(null);
    setCapturedTarget(null);
    setInserted(false);
    setPending(false);
    setError(null);
    setNotice(null);
  }, [
    ownerProfileId,
    ownerGeneration,
    sessionId,
    navRevKey,
    discardUnclaimedArtifact,
  ]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      epochRef.current += 1;
    };
  }, []);

  // Poll session navigation/selection state while inspecting, previewing, or holding an artifact
  const shouldWatchNavigation = Boolean(
    enabled && sessionId && (selectionActive || preview || preparedArtifact),
  );
  useEffect(() => {
    if (!shouldWatchNavigation || !sessionId) return;
    const activeOwner: ConnectionRef = {
      profileId: ownerProfileId,
      generation: ownerGeneration,
    };
    let stopped = false;
    let inFlightAbort: AbortController | null = null;
    let timer: number | null = null;
    let pollGeneration = 0;

    const cancelCurrentPoll = () => {
      pollGeneration += 1;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (inFlightAbort) {
        inFlightAbort.abort();
        inFlightAbort = null;
      }
    };

    const scheduleNext = () => {
      if (
        stopped ||
        !mountedRef.current ||
        !isDocumentVisible() ||
        !isCurrentConnection(activeOwner)
      ) {
        return;
      }
      const scheduledGen = pollGeneration;
      timer = window.setTimeout(() => {
        timer = null;
        void runSingleFlightPoll(scheduledGen);
      }, pollIntervalMs);
    };

    const runSingleFlightPoll = async (expectedGen: number) => {
      if (
        stopped ||
        expectedGen !== pollGeneration ||
        inFlightAbort !== null ||
        !mountedRef.current ||
        !isDocumentVisible() ||
        !isCurrentConnection(activeOwner)
      ) {
        return;
      }
      const abortCtrl = new AbortController();
      inFlightAbort = abortCtrl;
      try {
        const res = await getHostBrowserSelectionState(
          activeOwner,
          sessionId,
          abortCtrl.signal,
        );
        if (
          stopped ||
          abortCtrl.signal.aborted ||
          expectedGen !== pollGeneration ||
          !mountedRef.current ||
          !isDocumentVisible() ||
          !isCurrentConnection(activeOwner)
        ) {
          return;
        }
        if (
          String(res.navigationRevision) !==
          String(latestContextRef.current.navigationRevision)
        ) {
          const prevArt = latestContextRef.current.preparedArtifact;
          const prevInserted = latestContextRef.current.inserted;
          if (prevArt && !prevInserted) {
            void discardUnclaimedArtifact(prevArt, false, activeOwner);
          }
          epochRef.current += 1;
          setSelectionActive(false);
          setSelectionRevision(res.selection?.selectionRevision ?? 0);
          setPreview(null);
          setPreparedArtifact(null);
          setCapturedTarget(null);
          setInserted(false);
          setNotice("Page navigated; selection cleared.");
          const nextNav = String(res.navigationRevision);
          skipResetForNavRef.current = {
            ownerProfileId: activeOwner.profileId,
            ownerGeneration: activeOwner.generation,
            sessionId,
            navRev: nextNav,
          };
          latestContextRef.current.onNavigationSync?.({
            navigationRevision: nextNav,
            url: res.url,
          });
          return;
        }
        if (selectionActive && res.selection?.preview) {
          setPreview(res.selection.preview);
          setSelectionRevision(res.selection.selectionRevision);
          setSelectionActive(false);
          setNotice("Element selected. Review before preparing terminal artifact.");
          return;
        }
      } catch {
        // transient or aborted poll error
      } finally {
        if (inFlightAbort === abortCtrl) {
          inFlightAbort = null;
        }
        if (
          !stopped &&
          !abortCtrl.signal.aborted &&
          expectedGen === pollGeneration &&
          mountedRef.current &&
          isDocumentVisible() &&
          isCurrentConnection(activeOwner)
        ) {
          scheduleNext();
        }
      }
    };

    const onDocVisibilityChange = () => {
      if (!isDocumentVisible()) {
        cancelCurrentPoll();
      } else if (timer === null && inFlightAbort === null) {
        scheduleNext();
      }
    };

    const unsubVis = subscribeDocumentVisibility(onDocVisibilityChange);
    if (isDocumentVisible()) {
      scheduleNext();
    }

    return () => {
      stopped = true;
      unsubVis();
      cancelCurrentPoll();
    };
  }, [
    shouldWatchNavigation,
    selectionActive,
    sessionId,
    ownerProfileId,
    ownerGeneration,
    pollIntervalMs,
    enabled,
    discardUnclaimedArtifact,
  ]);
  const startSelection = useCallback(
    async (inspectPoint?: InspectPoint) => {
      if (!sessionId || !leaseToken) {
        setError("Control lease required to select an element.");
        return;
      }
      if (!isCurrentConnection(owner)) {
        setError("Connection changed or disconnected.");
        return;
      }
      const captureEpoch = ++epochRef.current;
      const capturedNav = String(navigationRevision);

      if (preparedArtifact && !inserted) {
        void discardUnclaimedArtifact(preparedArtifact, false, owner);
      }

      setPending(true);
      setError(null);
      setNotice(null);
      setPreparedArtifact(null);
      setCapturedTarget(null);
      setInserted(false);

      try {
        let usedNavRev: number | string = navigationRevision;
        let res: HostSelectionStartResponse;
        try {
          res = await startHostBrowserSelection(owner, sessionId, {
            leaseToken,
            navigationRevision: usedNavRev,
            inspectPoint,
          });
        } catch (firstErr) {
          if (
            firstErr instanceof BrowserHostClientError &&
            (firstErr.status === 409 ||
              /stale navigationRevision/i.test(firstErr.message))
          ) {
            const synced = await getHostBrowserSelectionState(owner, sessionId);
            if (
              !mountedRef.current ||
              epochRef.current !== captureEpoch ||
              !isCurrentConnection(owner)
            ) {
              return;
            }
            usedNavRev = String(synced.navigationRevision);
            skipResetForNavRef.current = {
              ownerProfileId: owner.profileId,
              ownerGeneration: owner.generation,
              sessionId,
              navRev: usedNavRev,
            };
            latestContextRef.current.onNavigationSync?.({
              navigationRevision: usedNavRev,
              url: synced.url,
            });
            res = await startHostBrowserSelection(owner, sessionId, {
              leaseToken,
              navigationRevision: usedNavRev,
              inspectPoint,
            });
          } else {
            throw firstErr;
          }
        }
        if (
          !mountedRef.current ||
          epochRef.current !== captureEpoch ||
          (String(latestContextRef.current.navigationRevision) !== capturedNav &&
            String(latestContextRef.current.navigationRevision) !==
              String(usedNavRev)) ||
          !isCurrentConnection(owner)
        ) {
          return;
        }

        setSelectionRevision(res.selectionRevision);
        if (res.preview) {
          setPreview(res.preview);
          setSelectionActive(false);
          setNotice("Element selected. Review before preparing terminal artifact.");
        } else {
          setPreview(null);
          setSelectionActive(res.selectionActive);
          setNotice("Click an element inside the browser canvas to inspect it.");
        }
      } catch (err) {
        if (mountedRef.current && epochRef.current === captureEpoch) {
          setSelectionActive(false);
          setError(
            err instanceof Error ? err.message : "Failed to start selection.",
          );
        }
      } finally {
        if (mountedRef.current && epochRef.current === captureEpoch) {
          setPending(false);
        }
      }
    },
    [
      sessionId,
      leaseToken,
      owner,
      navigationRevision,
      preparedArtifact,
      inserted,
      discardUnclaimedArtifact,
    ],
  );

  const cancelSelection = useCallback(async () => {
    const captureEpoch = ++epochRef.current;
    if (preparedArtifact && !inserted) {
      void discardUnclaimedArtifact(preparedArtifact, false, owner);
    }
    setSelectionActive(false);
    setPreview(null);
    setPreparedArtifact(null);
    setCapturedTarget(null);
    setInserted(false);
    setError(null);
    setNotice(null);

    if (sessionId && leaseToken && isCurrentConnection(owner)) {
      try {
        await cancelHostBrowserSelection(owner, sessionId, {
          leaseToken,
          navigationRevision,
        });
      } catch {
        // best effort cancel
      }
    }
    if (mountedRef.current && epochRef.current === captureEpoch) {
      setPending(false);
    }
  }, [
    sessionId,
    leaseToken,
    owner,
    navigationRevision,
    preparedArtifact,
    inserted,
    discardUnclaimedArtifact,
  ]);

  const prepareArtifact = useCallback(
    async (target: HostTerminalCandidate, includePng = true) => {
      if (!sessionId || !preview || pending) return;
      if (!target.ready || !target.incarnation) {
        setError("Selected terminal is not ready.");
        return;
      }
      if (!isCurrentConnection(owner)) {
        setError("Connection changed or disconnected.");
        return;
      }

      const captureEpoch = ++epochRef.current;
      const capturedOwner: ConnectionRef = {
        profileId: owner.profileId,
        generation: owner.generation,
      };
      const capturedNav = String(navigationRevision);
      const capturedSelRev = selectionRevision;

      if (preparedArtifact && !inserted) {
        void discardUnclaimedArtifact(preparedArtifact, false, owner);
      }

      setPending(true);
      setError(null);
      setNotice(null);

      try {
        const artifact = await createHostSelectionArtifacts(owner, sessionId, {
          selectionRevision: capturedSelRev,
          terminalId: target.sessionId,
          terminalIncarnation: target.incarnation,
          navigationRevision: capturedNav,
          includePng,
        });

        // Recheck owner, generation, navigation revision, selection revision, and terminal incarnation
        const latest = latestContextRef.current;
        const stillLiveTarget = latest.targets.find(
          (t) =>
            t.sessionId === target.sessionId &&
            t.incarnation === target.incarnation &&
            t.ready,
        );
        const ownerValid =
          isCurrentConnection(capturedOwner) &&
          latest.owner.profileId === capturedOwner.profileId &&
          latest.owner.generation === capturedOwner.generation;

        if (
          !mountedRef.current ||
          epochRef.current !== captureEpoch ||
          !ownerValid ||
          latest.navigationRevision !== capturedNav ||
          !stillLiveTarget
        ) {
          void deleteHostSelectionArtifact(capturedOwner, artifact.artifactId).catch(() => {});
          if (mountedRef.current) {
            setError(
              "Session, navigation, or selected terminal changed during preparation. Artifact discarded.",
            );
          }
          return;
        }

        const prepared = prepareBrowserTerminalArtifact(artifact);
        setPreparedArtifact(prepared);
        setCapturedTarget(target);
        setInserted(false);
        setNotice("Reviewable artifact ready. No text has been inserted.");
      } catch (err) {
        if (mountedRef.current && epochRef.current === captureEpoch) {
          setError(
            err instanceof Error
              ? err.message
              : "Couldn't create the browser selection artifact.",
          );
        }
      } finally {
        if (mountedRef.current && epochRef.current === captureEpoch) {
          setPending(false);
        }
      }
    },
    [
      sessionId,
      preview,
      pending,
      owner,
      navigationRevision,
      selectionRevision,
      preparedArtifact,
      inserted,
      discardUnclaimedArtifact,
    ],
  );

  const handoffArtifact = useCallback(async () => {
    if (!preparedArtifact || !capturedTarget || inserted || pending) return;
    const latest = latestContextRef.current;

    if (
      !isCurrentConnection(owner) ||
      owner.profileId !== capturedTarget.profileId ||
      owner.generation !== capturedTarget.generation
    ) {
      setError("Connection changed before terminal insertion.");
      return;
    }

    // Verify exact terminal incarnation is still live; NEVER fall back to another terminal
    const matchingLive = latest.targets.find(
      (t) =>
        t.sessionId === capturedTarget.sessionId &&
        t.incarnation === capturedTarget.incarnation &&
        t.ready,
    );
    if (!matchingLive) {
      void discardUnclaimedArtifact(preparedArtifact, false, owner);
      setPreparedArtifact(null);
      setCapturedTarget(null);
      setError("Selected terminal was closed or replaced before insertion.");
      return;
    }

    if (preparedArtifact.artifact.expiresAt <= Date.now()) {
      void discardUnclaimedArtifact(preparedArtifact, false, owner);
      setPreparedArtifact(null);
      setCapturedTarget(null);
      setError("This artifact expired. Prepare a new one.");
      return;
    }

    const captureEpoch = epochRef.current;
    setPending(true);
    setError(null);

    try {
      const res = await handoffHostSelectionArtifact(
        owner,
        preparedArtifact.artifact.artifactId,
      );
      if (mountedRef.current && epochRef.current === captureEpoch) {
        if (res.inserted) {
          setInserted(true);
          setNotice("Reference inserted; no command was run.");
        }
      }
    } catch (err) {
      void discardUnclaimedArtifact(preparedArtifact, false, owner);
      if (mountedRef.current && epochRef.current === captureEpoch) {
        setPreparedArtifact(null);
        setCapturedTarget(null);
        setError(
          err instanceof Error
            ? err.message
            : "Terminal handoff rejected; no bytes written.",
        );
      }
    } finally {
      if (mountedRef.current && epochRef.current === captureEpoch) {
        setPending(false);
      }
    }
  }, [
    preparedArtifact,
    capturedTarget,
    inserted,
    pending,
    owner,
    discardUnclaimedArtifact,
  ]);

  const discardArtifact = useCallback(async () => {
    if (preparedArtifact && !inserted) {
      await discardUnclaimedArtifact(preparedArtifact, false, owner);
    }
    setPreparedArtifact(null);
    setCapturedTarget(null);
    setInserted(false);
    setNotice(null);
    setError(null);
  }, [preparedArtifact, inserted, owner, discardUnclaimedArtifact]);

  const clearMessages = useCallback(() => {
    setError(null);
    setNotice(null);
  }, []);

  return {
    selectionActive,
    selectionRevision,
    preview,
    preparedArtifact,
    capturedTarget,
    inserted,
    pending,
    error,
    notice,
    startSelection,
    cancelSelection,
    prepareArtifact,
    handoffArtifact,
    discardArtifact,
    clearMessages,
  };
}
