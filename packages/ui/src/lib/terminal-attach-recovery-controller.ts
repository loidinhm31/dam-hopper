export type TerminalConnectionStatus =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

type Timer = ReturnType<typeof setTimeout>;

export interface TerminalAttachRecoveryControllerOptions {
  sendAttach: (fromOffset?: number, retryAttempt?: number) => boolean;
  checkAlive: () => Promise<boolean>;
  create: () => Promise<void>;
  onTimeout: () => void;
  onCreateFailed: (error: unknown) => void;
  onAttachUnavailable: () => void;
  /** Return true while the first replay belongs to an unavailable target. */
  shouldRetryAfterReplay?: () => boolean;
  timeoutMs?: number;
  initialRetryDelayMs?: number;
  maxRetryDelayMs?: number;
}

/**
 * Owns one terminal panel's attach/recovery work. It deliberately has no
 * transport or React dependency so timer and promise races are testable.
 */
export class TerminalAttachRecoveryController {
  private readonly timeoutMs: number;
  private readonly initialRetryDelayMs: number;
  private readonly maxRetryDelayMs: number;
  private connected = true;
  private awaitingBuffer = false;
  private bufferReceived = false;
  private attached = false;
  private attachDeferred = false;
  private started = false;
  private disposed = false;
  private recoveryReported = false;
  private createFailureReported = false;
  private createdThisRecovery = false;
  private retryAttempt = 0;
  private generation = 0;
  private attachTimeout: Timer | null = null;
  private retryTimer: Timer | null = null;
  private probeInFlight = false;
  private createInFlight = false;

  constructor(
    private readonly options: TerminalAttachRecoveryControllerOptions,
  ) {
    this.timeoutMs = options.timeoutMs ?? 3_000;
    this.initialRetryDelayMs = options.initialRetryDelayMs ?? 1_000;
    this.maxRetryDelayMs = options.maxRetryDelayMs ?? 30_000;
  }

  start(fromOffset?: number): void {
    this.started = true;
    this.requestAttach(fromOffset);
  }

  onBuffer(): void {
    if (this.disposed) return;
    if (
      this.options.shouldRetryAfterReplay?.() === true &&
      !this.createdThisRecovery
    ) {
      this.attached = false;
      this.awaitingBuffer = false;
      this.bufferReceived = true;
      this.retryAttempt = 0;
      this.recoveryReported = false;
      this.createFailureReported = false;
      this.invalidatePendingWork();
      return;
    }
    this.attached = true;
    this.awaitingBuffer = false;
    this.bufferReceived = false;
    this.retryAttempt = 0;
    this.recoveryReported = false;
    this.createFailureReported = false;
    this.createdThisRecovery = false;
    this.invalidatePendingWork();
  }

  /** Start same-ID recovery only after the current replay has been rendered. */
  onReplayComplete(): void {
    if (this.disposed || !this.bufferReceived) return;
    this.bufferReceived = false;
    this.create(this.generation);
  }

  onConnectionStatus(
    status: TerminalConnectionStatus,
    fromOffset?: number,
  ): void {
    if (this.disposed) return;
    if (status === "connected") {
      this.connected = true;
      this.attachDeferred = false;
      if (!this.started) return;
      this.requestAttach(fromOffset);
      return;
    }

    this.connected = false;
    this.attached = false;
    this.awaitingBuffer = false;
    this.bufferReceived = false;
    this.retryAttempt = 0;
    this.recoveryReported = false;
    this.createFailureReported = false;
    this.createdThisRecovery = false;
    this.invalidatePendingWork();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.invalidatePendingWork();
  }

  private requestAttach(fromOffset?: number): void {
    if (
      this.disposed ||
      !this.started ||
      !this.connected ||
      this.attached ||
      this.attachDeferred ||
      this.awaitingBuffer ||
      this.probeInFlight ||
      this.createInFlight
    ) {
      return;
    }

    this.clearRetryTimer();
    this.awaitingBuffer = true;
    if (!this.options.sendAttach(fromOffset, this.retryAttempt)) {
      this.awaitingBuffer = false;
      this.attachDeferred = true;
      this.options.onAttachUnavailable();
      return;
    }

    const generation = this.generation;
    this.attachTimeout = setTimeout(() => {
      if (
        this.disposed ||
        generation !== this.generation ||
        !this.awaitingBuffer
      ) {
        return;
      }
      this.attachTimeout = null;
      this.awaitingBuffer = false;
      this.probe(generation, fromOffset);
    }, this.timeoutMs);
  }

  private probe(generation: number, fromOffset?: number): void {
    if (this.disposed || generation !== this.generation || this.probeInFlight)
      return;

    this.probeInFlight = true;
    if (!this.recoveryReported) {
      this.recoveryReported = true;
      this.options.onTimeout();
    }

    void this.options
      .checkAlive()
      .then((alive) => {
        if (this.disposed || generation !== this.generation) return;
        this.probeInFlight = false;
        if (alive) {
          this.scheduleRetry(fromOffset);
          return;
        }
        this.create(generation);
      })
      .catch(() => {
        if (this.disposed || generation !== this.generation) return;
        this.probeInFlight = false;
        this.scheduleRetry(fromOffset);
      });
  }

  private create(generation: number): void {
    if (this.disposed || generation !== this.generation) return;
    if (this.createInFlight || this.createdThisRecovery) {
      this.scheduleRetry();
      return;
    }

    this.createInFlight = true;
    void this.options
      .create()
      .then(() => {
        this.createInFlight = false;
        if (this.disposed) return;
        if (generation !== this.generation) {
          this.requestAttach();
          return;
        }
        this.createdThisRecovery = true;
        this.retryAttempt = 0;
        this.requestAttach();
      })
      .catch((error: unknown) => {
        this.createInFlight = false;
        if (this.disposed) return;
        if (generation !== this.generation) {
          this.requestAttach();
          return;
        }
        if (!this.createFailureReported) {
          this.createFailureReported = true;
          this.options.onCreateFailed(error);
        }
        this.scheduleRetry();
      });
  }

  private scheduleRetry(fromOffset?: number): void {
    if (
      this.disposed ||
      !this.connected ||
      this.attached ||
      this.retryTimer ||
      this.createInFlight
    ) {
      return;
    }

    const delay = Math.min(
      this.initialRetryDelayMs * 2 ** this.retryAttempt,
      this.maxRetryDelayMs,
    );
    this.retryAttempt += 1;
    const generation = this.generation;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.disposed || generation !== this.generation) return;
      this.requestAttach(fromOffset);
    }, delay);
  }

  private invalidatePendingWork(): void {
    this.generation += 1;
    this.probeInFlight = false;
    this.clearAttachTimeout();
    this.clearRetryTimer();
  }

  private clearAttachTimeout(): void {
    if (!this.attachTimeout) return;
    clearTimeout(this.attachTimeout);
    this.attachTimeout = null;
  }

  private clearRetryTimer(): void {
    if (!this.retryTimer) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }
}
