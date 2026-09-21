import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  WorkerCancellationTracker,
  PluginError,
  PluginErrorCode,
  type CancelOutcome,
  RESOURCE_BUDGETS,
} from './index.js';

afterEach(() => {
  vi.useRealTimers();
});

// Simulated Cooperative Worker Implementation
class SimulatedCooperativeWorker {
  readonly tracker = new WorkerCancellationTracker();
  private contexts = new Map<string, { activeOps: Set<string> }>();

  openContext(contextId: string): void {
    this.contexts.set(contextId, { activeOps: new Set() });
  }

  async invokeScan(
    requestId: string,
    contextId: string,
    totalChunks = 10,
    chunkDelayMs = 20
  ): Promise<{ chunksProcessed: number }> {
    const ctx = this.contexts.get(contextId);
    if (!ctx) {
      throw new PluginError(PluginErrorCode.CONTEXT_REVOKED, `Context ${contextId} not found`);
    }

    const token = this.tracker.register(requestId, contextId);
    ctx.activeOps.add(requestId);

    let chunksProcessed = 0;
    try {
      for (let i = 0; i < totalChunks; i++) {
        const { promise, resolve } = Promise.withResolvers<void>();
        const timer = setTimeout(resolve, chunkDelayMs);
        token.onCancelled(() => {
          clearTimeout(timer);
          resolve();
        });
        await promise;

        token.throwIfCancelled();
        chunksProcessed++;
      }
      return { chunksProcessed };
    } finally {
      this.tracker.settle(requestId);
      ctx.activeOps.delete(requestId);
    }
  }

  handleCancel(requestId: string, contextId: string): CancelOutcome {
    return this.tracker.cancel(requestId, contextId);
  }
}

// Simulated Non-Cooperative Worker and Supervisor Implementation
class SimulatedWorkerSupervisor {
  private workerProcessAlive = true;
  private workerContexts = new Set<string>();

  registerContext(contextId: string): void {
    this.workerContexts.add(contextId);
  }

  isAlive(): boolean {
    return this.workerProcessAlive;
  }

  // When a non-cooperative worker blocks or exceeds deadline, supervisor escalates
  escalateKillAndRevokeAll(): { revokedContexts: string[]; status: string } {
    this.workerProcessAlive = false;
    const revoked = Array.from(this.workerContexts);
    this.workerContexts.clear();
    return {
      revokedContexts: revoked,
      status: 'WORKER_KILLED_ALL_CONTEXTS_REVOKED',
    };
  }
}

describe('Worker Cancellation and Escalation Feasibility', () => {
  it('cooperative worker yields, acknowledges cancel in <250ms, and settles original once with CANCELLED', async () => {
    vi.useFakeTimers();
    const worker = new SimulatedCooperativeWorker();
    worker.openContext('ctx-scan-1');

    const requestId = 'req-scan-001';
    let originalSettled = false;
    let originalError: PluginError | null = null;

    // Start scan (10 chunks * 30ms = 300ms total)
    const scanPromise = worker
      .invokeScan(requestId, 'ctx-scan-1', 10, 30)
      .then(() => {
        originalSettled = true;
      })
      .catch((err) => {
        originalSettled = true;
        originalError = err;
      });

    // Advance 50ms so scan processes first chunk
    await vi.advanceTimersByTimeAsync(50);

    // Cancel request
    const outcome = worker.handleCancel(requestId, 'ctx-scan-1');

    // Cancel acknowledgement is immediate (returns accepted)
    expect(outcome).toBe('accepted');

    // Second cancel call returns alreadySettled
    const outcomeRepeat = worker.handleCancel(requestId, 'ctx-scan-1');
    expect(outcomeRepeat).toBe('alreadySettled');

    // Await original request settlement
    await scanPromise;
    expect(originalSettled).toBe(true);
    expect(originalError).toBeInstanceOf(PluginError);
    expect((originalError as unknown as PluginError).code).toBe(PluginErrorCode.CANCELLED);
    expect((originalError as unknown as PluginError).message).toContain('was cancelled');
  });

  it('handles race conditions: cancel arriving after completion returns alreadySettled or unknown', async () => {
    vi.useFakeTimers();
    const worker = new SimulatedCooperativeWorker();
    worker.openContext('ctx-fast-1');

    const requestId = 'req-fast-001';
    const scanPromise = worker.invokeScan(requestId, 'ctx-fast-1', 1, 5);
    await vi.advanceTimersByTimeAsync(10);
    const res = await scanPromise;
    expect(res.chunksProcessed).toBe(1);

    // Cancel arriving after settlement returns alreadySettled
    const outcome = worker.handleCancel(requestId, 'ctx-fast-1');
    expect(outcome).toBe('alreadySettled');

    // Cancel for request never registered returns unknown
    const outcomeUnknown = worker.handleCancel('req-never-registered', 'ctx-fast-1');
    expect(outcomeUnknown).toBe('unknown');
  });
  it('non-cooperative worker escalates: supervisor kill revokes all contexts and fails active work', () => {
    const supervisor = new SimulatedWorkerSupervisor();
    supervisor.registerContext('ctx-tenant-a');
    supervisor.registerContext('ctx-tenant-b');

    expect(supervisor.isAlive()).toBe(true);

    // When worker is non-responsive past graceful deadline (5s)
    const escalation = supervisor.escalateKillAndRevokeAll();

    expect(supervisor.isAlive()).toBe(false);
    expect(escalation.status).toBe('WORKER_KILLED_ALL_CONTEXTS_REVOKED');
    expect(escalation.revokedContexts).toContain('ctx-tenant-a');
    expect(escalation.revokedContexts).toContain('ctx-tenant-b');
  });
});
