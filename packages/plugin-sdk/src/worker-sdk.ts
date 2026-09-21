import { PluginError, PluginErrorCode } from './errors.js';
import type { CancelOutcome } from './runner-protocol.js';

export const WORKER_SDK_VERSION = '1.0.0';

export const RESOURCE_BUDGETS = {
  maxPayloadBytes: 16 * 1024 * 1024,
  maxControlBytes: 64 * 1024,
  maxPackageCompressedBytes: 32 * 1024 * 1024,
  maxPackageExpandedBytes: 64 * 1024 * 1024,
  maxPackageEntries: 2048,
  maxUiDocumentBytes: 5 * 1024 * 1024,
  maxOperationsPerContext: 4,
  maxOperationsPerWorker: 16,
  maxQueueCapacity: 32,
  maxContextsPerWorker: 16,
  contextIdleTtlMs: 15 * 60 * 1000,
  maxSnapshotsPerContext: 2,
  maxAggregateSnapshotBytes: 128 * 1024 * 1024,
  snapshotIdleTtlMs: 5 * 60 * 1000,
  maxActiveScansPerWorker: 1,
  maxScanIoBytes: 256 * 1024 * 1024,
  scanDeadlineMs: 30 * 1000,
  aggregateBufferedFramesBytes: 64 * 1024 * 1024,
  defaultPageSize: 100,
  maxPageSize: 500,
  maxPageResultBytes: 1024 * 1024,
  maxEvaluationFileReadBytes: 8 * 1024 * 1024,
  workerCgroupMemoryMaxBytes: 1024 * 1024 * 1024,
  workerCgroupTasksMax: 64,
  workerRssTargetBytes: 512 * 1024 * 1024,
  handshakeTimeoutMs: 5 * 1000,
  ordinaryRequestTimeoutMs: 10 * 1000,
  gracefulStopTimeoutMs: 5 * 1000,
  maxCrashFailures: 3,
  crashWindowMs: 60 * 1000,
  lanRefreshP95Ms: 10 * 1000,
  lanSummaryPageP95Ms: 500,
  lanDetailP95Ms: 1000,
  lanCancelAckMaxMs: 250,
  lanCooperativeSettlementMaxMs: 1000,
} as const;

export interface CancellationToken {
  readonly isCancelled: boolean;
  throwIfCancelled(): void;
  onCancelled(callback: () => void): void;
}

export class WorkerCancellationTracker {
  private activeOperations = new Map<string, {
    contextId: string;
    cancelled: boolean;
    listeners: Array<() => void>;
  }>();
  private settledOperations = new Set<string>();

  register(requestId: string, contextId: string): CancellationToken {
    const state: {
      contextId: string;
      cancelled: boolean;
      listeners: Array<() => void>;
    } = { contextId, cancelled: false, listeners: [] };
    this.activeOperations.set(requestId, state);

    return {
      get isCancelled(): boolean {
        return state.cancelled;
      },
      throwIfCancelled(): void {
        if (state.cancelled) {
          throw new PluginError(PluginErrorCode.CANCELLED, `Request ${requestId} was cancelled`);
        }
      },
      onCancelled(callback: () => void): void {
        if (state.cancelled) {
          callback();
        } else {
          state.listeners.push(callback);
        }
      },
    };
  }

  cancel(requestId: string, contextId: string): CancelOutcome {
    if (this.settledOperations.has(requestId)) {
      return 'alreadySettled';
    }
    const op = this.activeOperations.get(requestId);
    if (!op || op.contextId !== contextId) {
      return 'unknown';
    }
    if (op.cancelled) {
      return 'alreadySettled';
    }
    op.cancelled = true;
    for (const listener of op.listeners) {
      try {
        listener();
      } catch {
        // Suppress listener errors during cancellation delivery
      }
    }
    return 'accepted';
  }

  settle(requestId: string): void {
    this.activeOperations.delete(requestId);
    this.settledOperations.add(requestId);
    if (this.settledOperations.size > 1000) {
      const first = this.settledOperations.values().next().value;
      if (first !== undefined) {
        this.settledOperations.delete(first);
      }
    }
  }

  get activeCount(): number {
    return this.activeOperations.size;
  }
}
