/**
 * Host-resource stream coordinator (Phase 03).
 *
 * Owns one cancellable SSE stream per captured ConnectionRef and QueryClient.
 * Enforces pre-data status pairing, source modes, retry budget and jitter,
 * inactivity and data deadlines, and auth/rest latches.
 */

import {
  getConnectionSnapshot,
  getTransport,
  isCurrentConnection,
  subscribeConnections,
} from "./connections.js";
import {
  computeProjectionFreshness,
  createFreshnessTracker,
  decodeHostResourceEvent,
  type DataFrame,
  type FreshnessTracker,
  type ProjectionFreshness,
  type StatusFrame,
} from "./host-resource-sse-codec.js";
import {
  HostResourceSseParser,
  type ParsedPiece,
} from "./host-resource-sse-parser.js";
import * as TanStackReactQuery from "@tanstack/react-query";
import type { QueryClient as TanStackQueryClient } from "@tanstack/react-query";

function batchQueryUpdates(fn: () => void): void {
  const nm = (
    TanStackReactQuery as unknown as {
      notifyManager?: { batch?: (cb: () => void) => void };
    }
  ).notifyManager;
  if (typeof nm?.batch === "function") {
    nm.batch(fn);
  } else {
    fn();
  }
}
import { connectionKey, type ConnectionRef } from "./ownership.js";
import { profileQueryKey } from "./query-client.js";
import { WsTransport } from "./ws-transport.js";

export interface QueryClientLike {
  cancelQueries(filters: { queryKey: readonly unknown[]; exact?: boolean }): Promise<void>;
  setQueryData<T>(queryKey: readonly unknown[], updater: T | ((prev: T | undefined) => T)): void;
  invalidateQueries(filters: { queryKey: readonly unknown[]; exact?: boolean }): Promise<void>;
}

function asQueryClientLike(qc: unknown): QueryClientLike | null {
  if (
    typeof qc === "object" &&
    qc !== null &&
    "cancelQueries" in qc &&
    "setQueryData" in qc &&
    typeof (qc as Record<string, unknown>).cancelQueries === "function" &&
    typeof (qc as Record<string, unknown>).setQueryData === "function"
  ) {
    return qc as unknown as QueryClientLike;
  }
  return null;
}

export type QueryClient = TanStackQueryClient;
export type SourceMode =
  | "STOPPED"
  | "STARTING"
  | "LIVE"
  | "RETRY_WAIT"
  | "REST_ONLY"
  | "AUTH_BLOCKED"
  | "PAUSED";

type TimerId = ReturnType<typeof setTimeout>;

export type ConsumerKind = "fleet" | "detailSnapshot" | "detailMetrics";

export interface HostResourceSourceState {
  mode: SourceMode;
  sourceGeneration: number;
  switching: boolean;
  freshness: ProjectionFreshness;
}

const INITIAL_DATA_DEADLINE_MS = 10_000;
const BYTE_IDLE_TIMEOUT_MS = 45_000;
const MAX_RETRY_COUNT = 5; // 6 attempts total (1 initial + 5 retries)
const STABLE_REVISION_WINDOW_MS = 60_000;
const RETRY_BASE_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000];
const MAX_RETRY_DELAY_MS = 30_000;
const MAX_RETRY_AFTER_MS = 60_000;

// Registry of known QueryClients and their refcounts
const registeredQueryClients = new Map<QueryClient, number>();

export function registerConnectionRegistryQueryClient(
  qc: QueryClient,
): () => void {
  const current = registeredQueryClients.get(qc) ?? 0;
  registeredQueryClients.set(qc, current + 1);

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    const count = registeredQueryClients.get(qc);
    if (count !== undefined) {
      if (count <= 1) {
        registeredQueryClients.delete(qc);
        cleanupCoordinatorsForQueryClient(qc);
      } else {
        registeredQueryClients.set(qc, count - 1);
      }
    }
  };
}

export function getRegisteredQueryClients(): readonly QueryClient[] {
  return Array.from(registeredQueryClients.keys());
}
export function isQueryClientRegistered(qc: QueryClient): boolean {
  return (registeredQueryClients.get(qc) ?? 0) > 0;
}

export function __resetRegisteredQueryClientsForTests(): void {
  for (const qc of Array.from(registeredQueryClients.keys())) {
    cleanupCoordinatorsForQueryClient(qc);
  }
  registeredQueryClients.clear();
  coordinatorsByQc.clear();
}

// Map from QueryClient -> (connectionKey -> HostResourceStreamCoordinator)
const coordinatorsByQc = new Map<
  QueryClient,
  Map<string, HostResourceStreamCoordinator>
>();

export class HostResourceStreamCoordinator {
  public mode: SourceMode = "STOPPED";
  public sourceGeneration = 1;
  public switching = false;

  private authBlockedLatch = false;
  private restOnlyLatch = false;

  private interestCounts: Record<ConsumerKind, number> = {
    fleet: 0,
    detailSnapshot: 0,
    detailMetrics: 0,
  };

  private listeners = new Set<() => void>();

  private streamAttemptFence = 0;
  private retryCount = 0;

  public get attemptNumber(): number {
    return this.streamAttemptFence;
  }

  public set attemptNumber(v: number) {
    this.streamAttemptFence = v;
  }
  private retryTimer: TimerId | null = null;
  private dataDeadlineTimer: TimerId | null = null;
  private byteIdleTimer: TimerId | null = null;
  private stableWindowTimer: TimerId | null = null;
  private ttlExpiryTimer: TimerId | null = null;
  private currentAbortController: AbortController | null = null;
  private currentCloseHandle: (() => void) | null = null;

  private cleanupDomListeners: (() => void) | null = null;
  private cleanupConnectionListener: (() => void) | null = null;
  // Paired pre-data status state for the active attempt
  private lastStatusForAttempt: StatusFrame | null = null;
  private statusAdjacent = false;

  // Freshness and revision tracking
  private freshnessTracker: FreshnessTracker | null = null;
  private lastCommittedRevisionBigInt: bigint | null = null;
  private lastCommittedServerEpoch: string | null = null;
  private revisionsCommittedInStableWindow = 0;

  private disposed = false;
  private switchToken = 0;

  constructor(
    public readonly owner: ConnectionRef,
    public readonly queryClient: QueryClient,
  ) {
    this.setupVisibilityListeners();
    // Restoration can precede WS recovery; do not depend on a consumer remount.
    this.cleanupConnectionListener = subscribeConnections(() =>
      this.evaluateLifecycle(),
    );
  }
  private cachedSnapshot: HostResourceSourceState | null = null;

  private notify(): void {
    if (this.disposed) return;
    this.cachedSnapshot = null;
    for (const listener of this.listeners) {
      listener();
    }
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public getSnapshot(): HostResourceSourceState {
    if (!this.cachedSnapshot) {
      this.cachedSnapshot = {
        mode: this.mode,
        sourceGeneration: this.sourceGeneration,
        switching: this.switching,
        freshness: computeProjectionFreshness(this.freshnessTracker),
      };
    }
    return this.cachedSnapshot;
  }

  public isAuthBlockedLatched(): boolean {
    return this.authBlockedLatch;
  }

  public isRestOnlyLatched(): boolean {
    return this.restOnlyLatch;
  }

  public hasInterest(): boolean {
    return (
      this.interestCounts.fleet > 0 ||
      this.interestCounts.detailSnapshot > 0 ||
      this.interestCounts.detailMetrics > 0
    );
  }

  public registerInterest(kind: ConsumerKind): () => void {
    this.interestCounts[kind] += 1;
    this.evaluateLifecycle();

    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      this.interestCounts[kind] = Math.max(0, this.interestCounts[kind] - 1);
      this.evaluateLifecycle();
    };
  }

  private isDocumentVisible(): boolean {
    if (typeof document === "undefined") return true;
    return document.visibilityState === "visible";
  }

  private isCurrentOwner(): boolean {
    // A matching generation may still be connecting after page restoration.
    return (
      getConnectionSnapshot(this.owner.profileId)?.owner.generation ===
      this.owner.generation
    );
  }

  private setupVisibilityListeners(): void {
    if (typeof document === "undefined") return;

    const onVisibilityChange = () => {
      if (this.disposed) return;
      if (!this.isCurrentOwner()) {
        this.dispose();
        return;
      }

      if (document.visibilityState === "hidden") {
        if (
          this.mode === "STARTING" ||
          this.mode === "LIVE" ||
          this.mode === "RETRY_WAIT"
        ) {
          this.stopActiveStream(false);
          this.mode = "PAUSED";
          this.notify();
        }
      } else if (document.visibilityState === "visible") {
        if (this.mode === "PAUSED" && this.hasInterest()) {
          this.evaluateLifecycle();
        }
      }
    };

    const onPageHide = (event: PageTransitionEvent) => {
      if (this.disposed) return;
      if (!this.isCurrentOwner()) {
        this.dispose();
        return;
      }

      if (event.persisted) {
        if (
          this.mode === "STARTING" ||
          this.mode === "LIVE" ||
          this.mode === "RETRY_WAIT"
        ) {
          this.stopActiveStream(false);
          this.mode = "PAUSED";
          this.notify();
        }
        return;
      }

      this.dispose();
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (this.disposed || !event.persisted) return;
      if (!this.isCurrentOwner()) {
        this.dispose();
        return;
      }
      this.evaluateLifecycle();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    if (typeof window !== "undefined") {
      window.addEventListener("pagehide", onPageHide);
      window.addEventListener("pageshow", onPageShow);
    }

    this.cleanupDomListeners = () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (typeof window !== "undefined") {
        window.removeEventListener("pagehide", onPageHide);
        window.removeEventListener("pageshow", onPageShow);
      }
    };
  }

  public evaluateLifecycle(): void {
    if (this.disposed) return;
    if (!this.isCurrentOwner()) {
      this.dispose();
      return;
    }

    if (!isQueryClientRegistered(this.queryClient)) {
      this.stopActiveStream(false);
      this.mode = "STOPPED";
      this.notify();
      return;
    }

    const conn = getConnectionSnapshot(this.owner.profileId);
    if (!conn || conn.status !== "connected") {
      this.stopActiveStream(false);
      this.mode = "STOPPED";
      this.notify();
      return;
    }

    if (!this.hasInterest()) {
      this.stopActiveStream(false);
      this.mode = "STOPPED";
      this.notify();
      return;
    }

    if (!this.isDocumentVisible()) {
      this.stopActiveStream(false);
      this.mode = "PAUSED";
      this.notify();
      return;
    }

    // Check latches
    if (this.authBlockedLatch) {
      this.stopActiveStream(false);
      this.mode = "AUTH_BLOCKED";
      this.notify();
      return;
    }

    if (this.restOnlyLatch) {
      this.stopActiveStream(false);
      this.mode = "REST_ONLY";
      this.notify();
      return;
    }

    // Start stream if stopped or paused
    if (this.mode === "STOPPED" || this.mode === "PAUSED") {
      this.startAttempt();
    }
  }

  private clearAllTimers(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.dataDeadlineTimer) {
      clearTimeout(this.dataDeadlineTimer);
      this.dataDeadlineTimer = null;
    }
    if (this.byteIdleTimer) {
      clearTimeout(this.byteIdleTimer);
      this.byteIdleTimer = null;
    }
    if (this.stableWindowTimer) {
      clearTimeout(this.stableWindowTimer);
      this.stableWindowTimer = null;
    }
    if (this.ttlExpiryTimer) {
      clearTimeout(this.ttlExpiryTimer);
      this.ttlExpiryTimer = null;
    }
  }

  private stopActiveStream(clearRetryTimer = true): void {
    // Fence frame commits that may be suspended in cancelQueries().
    this.switchToken += 1;
    this.switching = false;

    if (clearRetryTimer && this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.dataDeadlineTimer) {
      clearTimeout(this.dataDeadlineTimer);
      this.dataDeadlineTimer = null;
    }
    if (this.byteIdleTimer) {
      clearTimeout(this.byteIdleTimer);
      this.byteIdleTimer = null;
    }
    if (this.stableWindowTimer) {
      clearTimeout(this.stableWindowTimer);
      this.stableWindowTimer = null;
    }
    if (this.ttlExpiryTimer) {
      clearTimeout(this.ttlExpiryTimer);
      this.ttlExpiryTimer = null;
    }
    this.revisionsCommittedInStableWindow = 0;
    this.freshnessTracker = null;
    if (this.currentCloseHandle) {
      try {
        this.currentCloseHandle();
      } catch {
        // ignore
      }
      this.currentCloseHandle = null;
    }
    if (this.currentAbortController) {
      try {
        this.currentAbortController.abort(new Error("Stream stopped"));
      } catch {
        // ignore
      }
      this.currentAbortController = null;
    }

    this.lastStatusForAttempt = null;
    this.statusAdjacent = false;
  }

  private startAttempt(): void {
    if (this.disposed || !isCurrentConnection(this.owner)) return;

    this.stopActiveStream(true);
    this.mode = "STARTING";
    this.notify();

    const controller = new AbortController();
    this.currentAbortController = controller;
    const capturedAttempt = ++this.streamAttemptFence;

    // Arm 10 s initial data deadline
    this.dataDeadlineTimer = setTimeout(() => {
      if (this.disposed || capturedAttempt !== this.streamAttemptFence) return;
      this.handleStreamFailure(
        capturedAttempt,
        new Error("10 s initial data deadline expired"),
      );
    }, INITIAL_DATA_DEADLINE_MS);

    // Arm 45 s byte-inactivity deadline
    this.armByteIdleDeadline(capturedAttempt);

    void this.executeAttempt(controller.signal, capturedAttempt);
  }

  private armTtlExpiryDeadline(status: StatusFrame): void {
    if (this.ttlExpiryTimer !== null) {
      clearTimeout(this.ttlExpiryTimer);
      this.ttlExpiryTimer = null;
    }
    const snapAge = status.snapshotAgeMs ?? 0;
    const metricsAge = status.metricsAgeMs ?? 0;
    const maxAge = Math.max(snapAge, metricsAge);
    const remainingMs = status.freshnessTtlMs - maxAge;

    if (remainingMs > 0 && Number.isFinite(remainingMs)) {
      this.ttlExpiryTimer = setTimeout(() => {
        this.ttlExpiryTimer = null;
        if (this.disposed) return;
        this.notify();
      }, remainingMs);
    }
  }

  private armByteIdleDeadline(capturedAttempt: number): void {
    if (this.byteIdleTimer !== null) {
      clearTimeout(this.byteIdleTimer);
      this.byteIdleTimer = null;
    }
    this.byteIdleTimer = setTimeout(() => {
      if (this.disposed || capturedAttempt !== this.streamAttemptFence) return;
      this.handleStreamFailure(
        capturedAttempt,
        new Error("45 s byte idle timeout expired"),
      );
    }, BYTE_IDLE_TIMEOUT_MS);
  }

  private async executeAttempt(
    signal: AbortSignal,
    capturedAttempt: number,
  ): Promise<void> {
    let transport: unknown;
    try {
      transport = getTransport(this.owner);
    } catch (err) {
      this.handleStreamFailure(capturedAttempt, err);
      return;
    }
    const hasCapability =
      transport instanceof WsTransport ||
      (typeof transport === "object" &&
        transport !== null &&
        "openHostResourceEvents" in transport &&
        typeof (transport as Record<string, unknown>).openHostResourceEvents ===
          "function");

    if (!hasCapability) {
      this.restOnlyLatch = true;
      this.stopActiveStream(true);
      this.mode = "REST_ONLY";
      this.notify();
      return;
    }

    const streamingSupported =
      typeof (transport as Record<string, unknown>)
        .supportsHostResourceStreaming === "function"
        ? (
            transport as { supportsHostResourceStreaming: () => boolean }
          ).supportsHostResourceStreaming()
        : true;

    if (!streamingSupported) {
      this.restOnlyLatch = true;
      this.stopActiveStream(true);
      this.mode = "REST_ONLY";
      this.notify();
      return;
    }

    let openResult;
    try {
      openResult = await (
        transport as {
          openHostResourceEvents: (s: AbortSignal) => Promise<any>;
        }
      ).openHostResourceEvents(signal);
    } catch (err) {
      if (
        signal.aborted ||
        this.disposed ||
        capturedAttempt !== this.streamAttemptFence
      ) {
        return;
      }
      this.handleStreamFailure(capturedAttempt, err);
      return;
    }
    if (
      signal.aborted ||
      this.disposed ||
      capturedAttempt !== this.streamAttemptFence
    ) {
      openResult.close();
      return;
    }

    if (openResult.kind === "unsupported") {
      openResult.close();
      this.restOnlyLatch = true;
      this.stopActiveStream(true);
      this.mode = this.authBlockedLatch ? "AUTH_BLOCKED" : "REST_ONLY";
      this.notify();
      return;
    }

    if (openResult.kind === "finite") {
      openResult.close();
      this.handleFiniteResponse(
        capturedAttempt,
        openResult.status,
        openResult.code,
        openResult.retryAfter,
      );
      return;
    }

    // Stream successfully opened (status 200)
    this.currentCloseHandle = openResult.close;
    const parser = new HostResourceSseParser();
    const reader = openResult.reader;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        if (
          signal.aborted ||
          this.disposed ||
          capturedAttempt !== this.streamAttemptFence
        ) {
          break;
        }

        // Body bytes received -> rearm 45 s byte idle timeout
        this.armByteIdleDeadline(capturedAttempt);

        const pieces = parser.push(value);
        for (const piece of pieces) {
          this.handleParsedPiece(
            capturedAttempt,
            piece,
            transport as unknown as WsTransport,
          );
        }
      }

      // Stream closed normally (EOF)
      parser.finish();
      if (
        !signal.aborted &&
        !this.disposed &&
        capturedAttempt === this.streamAttemptFence
      ) {
        this.handleStreamFailure(
          capturedAttempt,
          new Error("Unexpected stream EOF"),
        );
      }
    } catch (err) {
      parser.finish();
      if (
        !signal.aborted &&
        !this.disposed &&
        capturedAttempt === this.streamAttemptFence
      ) {
        this.handleStreamFailure(capturedAttempt, err);
      }
    }
  }

  private handleParsedPiece(
    capturedAttempt: number,
    piece: ParsedPiece,
    transport: WsTransport,
  ): void {
    if (this.disposed || capturedAttempt !== this.streamAttemptFence) return;

    if (piece.kind === "comment") {
      // Comments count as transport bytes (already rearmed idle timer),
      // but clear pre-data status adjacency
      this.statusAdjacent = false;
      return;
    }

    if (piece.kind === "error") {
      // Protocol/Oversize/UTF8 error -> clear adjacency and fail attempt
      this.statusAdjacent = false;
      this.handleStreamFailure(
        capturedAttempt,
        new Error(`Parser error: ${piece.error.code} - ${piece.error.message}`),
      );
      return;
    }

    // Named event
    const decoded = decodeHostResourceEvent(piece);
    if (decoded.kind === "error") {
      // Malformed frame or stream error control
      this.statusAdjacent = false;
      if (piece.event === "host-resources-error") {
        transport.reportHostResourceErrorControl(decoded.code);
        if (decoded.code === "AUTH_UNAVAILABLE") {
          this.authBlockedLatch = true;
          this.sourceGeneration += 1;
          this.stopActiveStream(true);
          const qcLike = asQueryClientLike(this.queryClient);
          if (qcLike) {
            const snapshotKey = profileQueryKey(
              this.owner,
              "system",
              "resource-snapshot",
            );
            const metricsKey = profileQueryKey(this.owner, "system", "metrics");
            void Promise.all([
              qcLike.cancelQueries({ queryKey: snapshotKey, exact: true }),
              qcLike.cancelQueries({ queryKey: metricsKey, exact: true }),
            ]);
          }
          this.mode = "AUTH_BLOCKED";
          this.notify();
          return;
        }
      }

      this.handleStreamFailure(
        capturedAttempt,
        new Error(`Decoded frame error: ${decoded.code} - ${decoded.message}`),
      );
      return;
    }

    if (decoded.kind === "status") {
      this.lastStatusForAttempt = decoded;
      this.statusAdjacent = true;
      if (
        this.mode !== "LIVE" ||
        (this.lastCommittedServerEpoch === decoded.serverEpoch &&
          this.lastCommittedRevisionBigInt !== null &&
          decoded.revisionBigInt === this.lastCommittedRevisionBigInt)
      ) {
        this.freshnessTracker = createFreshnessTracker(decoded);
        this.armTtlExpiryDeadline(decoded);
        this.notify();
      }
      return;
    }

    if (decoded.kind === "data") {
      // Must have adjacent status with matching epoch and revision
      if (
        !this.statusAdjacent ||
        !this.lastStatusForAttempt ||
        this.lastStatusForAttempt.serverEpoch !== decoded.serverEpoch ||
        this.lastStatusForAttempt.revision !== decoded.revision
      ) {
        this.statusAdjacent = false;
        // Non-adjacent or non-matching status -> reject data frame
        return;
      }

      // Adjacency consumed
      this.statusAdjacent = false;

      // Validate revision progression
      if (this.lastCommittedServerEpoch === decoded.serverEpoch) {
        if (this.mode === "LIVE") {
          // Within same attempt already LIVE: require strictly advancing revision
          if (
            this.lastCommittedRevisionBigInt !== null &&
            decoded.revisionBigInt <= this.lastCommittedRevisionBigInt
          ) {
            // Deduplicate or regression -> ignore
            return;
          }
        } else {
          // First frame of this attempt: accept equal or higher revision as new baseline
          if (
            this.lastCommittedRevisionBigInt !== null &&
            decoded.revisionBigInt < this.lastCommittedRevisionBigInt
          ) {
            // Revision regression -> reject
            return;
          }
        }
      }

      // First valid data frame disarms the 10 s data deadline!
      if (this.dataDeadlineTimer) {
        clearTimeout(this.dataDeadlineTimer);
        this.dataDeadlineTimer = null;
      }

      // Valid frame accepted!
      const matchedStatus = this.lastStatusForAttempt;
      void this.applyValidFrame(capturedAttempt, decoded, matchedStatus);
    }
  }

  private async applyValidFrame(
    capturedAttempt: number,
    decoded: DataFrame,
    matchedStatus: StatusFrame,
  ): Promise<void> {
    if (this.disposed || capturedAttempt !== this.streamAttemptFence) return;

    await this.switchToHostResourceFrame(
      this.sourceGeneration,
      decoded,
      matchedStatus,
      capturedAttempt,
    );
  }

  public async switchToHostResourceFrame(
    expectedSourceGeneration: number,
    decoded: DataFrame,
    matchedStatus: StatusFrame,
    attemptNumber?: number,
  ): Promise<boolean> {
    if (this.disposed || !isCurrentConnection(this.owner)) return false;
    const currentAttempt = attemptNumber ?? this.streamAttemptFence;
    if (currentAttempt !== this.streamAttemptFence) return false;

    // Validate fence
    if (this.sourceGeneration !== expectedSourceGeneration) {
      return false;
    }

    const currentSwitchToken = ++this.switchToken;
    this.switching = true;
    this.sourceGeneration += 1;
    this.notify();

    try {
      // Re-verify after synchronous fence bump
      if (
        this.disposed ||
        !isCurrentConnection(this.owner) ||
        !isQueryClientRegistered(this.queryClient) ||
        currentAttempt !== this.streamAttemptFence ||
        this.switchToken !== currentSwitchToken
      ) {
        if (this.switchToken === currentSwitchToken) {
          this.switching = false;
          this.notify();
        }
        return false;
      }

      // Cancel exact in-flight owner queries before paired writes
      const snapshotKey = profileQueryKey(
        this.owner,
        "system",
        "resource-snapshot",
      );
      const metricsKey = profileQueryKey(this.owner, "system", "metrics");
      const qcLike = asQueryClientLike(this.queryClient);

      if (qcLike) {
        await Promise.all([
          qcLike.cancelQueries({ queryKey: snapshotKey, exact: true }),
          qcLike.cancelQueries({ queryKey: metricsKey, exact: true }),
        ]);
      }

      // Re-verify after cancellation await
      if (
        this.disposed ||
        !isCurrentConnection(this.owner) ||
        !isQueryClientRegistered(this.queryClient) ||
        currentAttempt !== this.streamAttemptFence ||
        this.switchToken !== currentSwitchToken
      ) {
        if (this.switchToken === currentSwitchToken) {
          this.switching = false;
          this.notify();
        }
        return false;
      }

      // Paired cache writes via batchQueryUpdates
      if (qcLike) {
        batchQueryUpdates(() => {
          qcLike.setQueryData(snapshotKey, decoded.snapshot);
          qcLike.setQueryData(metricsKey, decoded.metrics);
        });
      }

      this.lastCommittedServerEpoch = decoded.serverEpoch;
      this.lastCommittedRevisionBigInt = decoded.revisionBigInt;
      this.freshnessTracker = createFreshnessTracker(matchedStatus);
      this.armTtlExpiryDeadline(matchedStatus);

      this.mode = "LIVE";
      this.switching = false;
      this.notify();

      this.recordAdvancingRevision();
      return true;
    } catch {
      if (this.switchToken === currentSwitchToken) {
        this.switching = false;
        this.notify();
      }
      return false;
    }
  }

  private recordAdvancingRevision(): void {
    this.revisionsCommittedInStableWindow += 1;
    if (!this.stableWindowTimer) {
      this.stableWindowTimer = setTimeout(() => {
        if (this.disposed) return;
        if (this.mode === "LIVE" && this.revisionsCommittedInStableWindow > 0) {
          // Reset retry count after 60 s stable with advancing revisions
          this.retryCount = 0;
        }
        this.revisionsCommittedInStableWindow = 0;
        this.stableWindowTimer = null;
      }, STABLE_REVISION_WINDOW_MS);
    }
  }

  private handleFiniteResponse(
    capturedAttempt: number,
    status: number,
    code: string | null,
    retryAfter: string | null,
  ): void {
    if (this.disposed || capturedAttempt !== this.streamAttemptFence) return;

    if (status === 404 || status === 405) {
      this.restOnlyLatch = true;
      this.stopActiveStream(true);
      this.mode = this.authBlockedLatch ? "AUTH_BLOCKED" : "REST_ONLY";
      this.notify();
      return;
    }

    if (status === 503 && code === "FRAME_TOO_LARGE") {
      this.restOnlyLatch = true;
      this.stopActiveStream(true);
      this.mode = this.authBlockedLatch ? "AUTH_BLOCKED" : "REST_ONLY";
      this.notify();
      return;
    }

    if (status === 503 && code === "AUTH_UNAVAILABLE") {
      this.authBlockedLatch = true;
      this.stopActiveStream(true);
      this.mode = "AUTH_BLOCKED";
      this.notify();
      return;
    }

    if (status === 401 || status === 403) {
      // Recognized codes already triggered onDrop inside ws-transport.
      // Stop stream immediately; do not retry.
      if (
        code === "MFA_REQUIRED" ||
        code === "AUTH_REQUIRED" ||
        code === "SESSION_EXPIRED" ||
        code === "SESSION_REVOKED"
      ) {
        this.stopActiveStream(true);
        this.mode = "STOPPED";
        this.notify();
        return;
      }

      // Unknown 401/403 is terminal REST_ONLY without clearing tokens or onDrop.
      this.restOnlyLatch = true;
      this.stopActiveStream(true);
      this.mode = this.authBlockedLatch ? "AUTH_BLOCKED" : "REST_ONLY";
      this.notify();
      return;
    }

    // 429 or other 5xx / transient error -> consume retry budget
    let delayMs: number | null = null;
    if (status === 429 && retryAfter) {
      const parsedSeconds = Number.parseFloat(retryAfter);
      if (!Number.isNaN(parsedSeconds) && parsedSeconds > 0) {
        delayMs = Math.min(
          MAX_RETRY_AFTER_MS,
          Math.floor(parsedSeconds * 1000),
        );
      }
    }

    this.scheduleRetry(capturedAttempt, delayMs);
  }

  private handleStreamFailure(capturedAttempt: number, _err?: unknown): void {
    void _err;
    if (this.disposed || capturedAttempt !== this.streamAttemptFence) return;
    const wasLive = this.mode === "LIVE";
    if (wasLive) {
      this.sourceGeneration += 1;
    }
    this.scheduleRetry(capturedAttempt);

    if (wasLive && canUseResourceRest(this.owner, this.queryClient)) {
      const qcLike = asQueryClientLike(this.queryClient);
      if (qcLike) {
        const snapshotKey = profileQueryKey(
          this.owner,
          "system",
          "resource-snapshot",
        );
        const metricsKey = profileQueryKey(this.owner, "system", "metrics");
        void qcLike.invalidateQueries({ queryKey: snapshotKey, exact: true });
        if (this.interestCounts.detailMetrics > 0) {
          void qcLike.invalidateQueries({ queryKey: metricsKey, exact: true });
        }
      }
    }
  }

  private scheduleRetry(
    capturedAttempt: number,
    explicitDelayMs?: number | null,
  ): void {
    if (this.disposed) return;
    this.stopActiveStream(false);

    this.retryCount += 1;
    if (this.retryCount > MAX_RETRY_COUNT) {
      // Retries exhausted
      this.mode = this.authBlockedLatch ? "AUTH_BLOCKED" : "REST_ONLY";
      this.notify();
      return;
    }

    this.mode = "RETRY_WAIT";
    this.notify();

    let delayMs: number;
    if (explicitDelayMs !== undefined && explicitDelayMs !== null) {
      delayMs = explicitDelayMs;
    } else {
      const retryIndex = Math.min(
        this.retryCount - 1,
        RETRY_BASE_DELAYS_MS.length - 1,
      );
      const baseDelay = RETRY_BASE_DELAYS_MS[Math.max(0, retryIndex)];
      const jitter = Math.floor(Math.random() * 500);
      delayMs = Math.min(MAX_RETRY_DELAY_MS, baseDelay + jitter);
    }

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (
        this.disposed ||
        !isCurrentConnection(this.owner) ||
        !this.hasInterest() ||
        !this.isDocumentVisible()
      ) {
        return;
      }
      this.startAttempt();
    }, delayMs);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearAllTimers();
    this.stopActiveStream(true);
    this.cleanupDomListeners?.();
    this.cleanupDomListeners = null;
    this.cleanupConnectionListener?.();
    this.cleanupConnectionListener = null;
    this.mode = "STOPPED";
    this.listeners.clear();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Module-level Registry and Public Coordinator APIs
// ─────────────────────────────────────────────────────────────────────────────

function getOrCreateCoordinator(
  owner: ConnectionRef,
  qc: QueryClient,
): HostResourceStreamCoordinator {
  let byConn = coordinatorsByQc.get(qc);
  if (!byConn) {
    byConn = new Map();
    coordinatorsByQc.set(qc, byConn);
  }
  const key = connectionKey(owner);
  let coord = byConn.get(key);
  if (!coord) {
    coord = new HostResourceStreamCoordinator(owner, qc);
    byConn.set(key, coord);
  }
  return coord;
}

export function cleanupCoordinatorsForQueryClient(qc: QueryClient): void {
  const byConn = coordinatorsByQc.get(qc);
  if (byConn) {
    for (const coord of byConn.values()) {
      coord.dispose();
    }
    coordinatorsByQc.delete(qc);
  }
}

export function cleanupCoordinatorsForOwner(owner: ConnectionRef): void {
  const key = connectionKey(owner);
  for (const byConn of coordinatorsByQc.values()) {
    const coord = byConn.get(key);
    if (coord) {
      coord.dispose();
      byConn.delete(key);
    }
  }
}

export function registerHostResourceInterest(
  owner: ConnectionRef,
  qc: QueryClient,
  kind: ConsumerKind,
): () => void {
  const coord = getOrCreateCoordinator(owner, qc);
  return coord.registerInterest(kind);
}

const STOPPED_SOURCE_STATE: HostResourceSourceState = Object.freeze({
  mode: "STOPPED",
  sourceGeneration: 0,
  switching: false,
  freshness: computeProjectionFreshness(null),
});

export function getHostResourceSource(
  owner: ConnectionRef,
  qc: QueryClient,
): HostResourceSourceState {
  const byConn = coordinatorsByQc.get(qc);
  const coord = byConn?.get(connectionKey(owner));
  if (!coord) {
    return STOPPED_SOURCE_STATE;
  }
  return coord.getSnapshot();
}

export function subscribeHostResourceSource(
  owner: ConnectionRef,
  qc: QueryClient,
  listener: () => void,
): () => void {
  const coord = getOrCreateCoordinator(owner, qc);
  return coord.subscribe(listener);
}

export function captureResourceSource(
  owner: ConnectionRef,
  qc: QueryClient,
): number {
  return getHostResourceSource(owner, qc).sourceGeneration;
}

export function isResourceSourceCurrent(
  owner: ConnectionRef,
  qc: QueryClient,
  sourceGeneration: number,
): boolean {
  return captureResourceSource(owner, qc) === sourceGeneration;
}

export function canUseResourceRest(
  owner: ConnectionRef,
  qc: QueryClient,
): boolean {
  if (!isCurrentConnection(owner)) return false;
  if (!isQueryClientRegistered(qc)) return false;

  const conn = getConnectionSnapshot(owner.profileId);
  if (!conn || conn.status !== "connected") return false;

  if (typeof document !== "undefined" && document.visibilityState !== "visible") {
    return false;
  }

  const byConn = coordinatorsByQc.get(qc);
  const coord = byConn?.get(connectionKey(owner));
  if (!coord || !coord.hasInterest()) return false;

  if (coord.switching) return false;
  if (coord.isAuthBlockedLatched()) return false;

  return (
    coord.mode === "STARTING" ||
    coord.mode === "RETRY_WAIT" ||
    coord.mode === "REST_ONLY"
  );
}

export async function switchToHostResourceFrame(
  owner: ConnectionRef,
  qc: QueryClient,
  sourceGeneration: number,
  decodedFrame: DataFrame,
  matchedStatus: StatusFrame,
): Promise<boolean> {
  const byConn = coordinatorsByQc.get(qc);
  const coord = byConn?.get(connectionKey(owner));
  if (!coord) return false;
  return coord.switchToHostResourceFrame(sourceGeneration, decodedFrame, matchedStatus);
}
