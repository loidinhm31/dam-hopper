import { afterEach, describe, expect, it, vi } from "vitest";
import { TerminalAttachRecoveryController } from "./terminal-attach-recovery-controller.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function makeController(
  overrides: {
    sendAttach?: () => boolean;
    checkAlive?: () => Promise<boolean>;
    create?: () => Promise<void>;
  } = {},
) {
  const sendAttach = vi.fn(overrides.sendAttach ?? (() => true));
  const checkAlive = vi.fn(
    overrides.checkAlive ?? (() => Promise.resolve(true)),
  );
  const create = vi.fn(overrides.create ?? (() => Promise.resolve()));
  const onTimeout = vi.fn();
  const onCreateFailed = vi.fn();
  const onAttachUnavailable = vi.fn();
  const controller = new TerminalAttachRecoveryController({
    sendAttach,
    checkAlive,
    create,
    onTimeout,
    onCreateFailed,
    onAttachUnavailable,
    timeoutMs: 10,
    initialRetryDelayMs: 100,
    maxRetryDelayMs: 400,
  });
  return {
    controller,
    sendAttach,
    checkAlive,
    create,
    onTimeout,
    onCreateFailed,
    onAttachUnavailable,
  };
}

describe("TerminalAttachRecoveryController", () => {
  afterEach(() => vi.useRealTimers());

  it("runs one attach/probe flight and backs off repeated alive retries", async () => {
    vi.useFakeTimers();
    const { controller, sendAttach, checkAlive, onTimeout } = makeController();

    controller.start();
    controller.start();
    controller.onConnectionStatus("connected");
    expect(sendAttach).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10);
    expect(checkAlive).toHaveBeenCalledTimes(1);
    expect(onTimeout).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(99);
    expect(sendAttach).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sendAttach).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(199);
    expect(sendAttach).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(sendAttach).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(10 + 400);
    expect(sendAttach).toHaveBeenCalledTimes(4);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("does not attach before startup discovery explicitly starts recovery", () => {
    const { controller, sendAttach } = makeController();

    controller.onConnectionStatus("connected");
    expect(sendAttach).not.toHaveBeenCalled();

    controller.start();
    expect(sendAttach).toHaveBeenCalledTimes(1);
  });

  it("cancels pending recovery immediately when a buffer arrives", async () => {
    vi.useFakeTimers();
    const { controller, sendAttach, checkAlive } = makeController();

    controller.start();
    controller.onBuffer();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(sendAttach).toHaveBeenCalledTimes(1);
    expect(checkAlive).not.toHaveBeenCalled();
  });

  it("reattaches once with the received offset after reconnecting", () => {
    const { controller, sendAttach } = makeController();

    controller.start();
    controller.onBuffer();
    controller.onConnectionStatus("disconnected");
    controller.onConnectionStatus("connected", 42);
    controller.onConnectionStatus("connected", 42);

    expect(sendAttach).toHaveBeenCalledTimes(2);
    expect(sendAttach).toHaveBeenLastCalledWith(42, 0);
  });

  it("creates a confirmed-dead session once before attaching it", async () => {
    vi.useFakeTimers();
    const creation = deferred<void>();
    const { controller, sendAttach, create } = makeController({
      checkAlive: () => Promise.resolve(false),
      create: () => creation.promise,
    });

    controller.start();
    await vi.advanceTimersByTimeAsync(10);
    expect(create).toHaveBeenCalledTimes(1);

    controller.start();
    controller.onConnectionStatus("connected");
    expect(create).toHaveBeenCalledTimes(1);

    creation.resolve();
    await Promise.resolve();
    expect(sendAttach).toHaveBeenCalledTimes(2);
  });

  it("does not recreate a session after creation succeeds but replay stays missing", async () => {
    vi.useFakeTimers();
    const { controller, create } = makeController({
      checkAlive: () => Promise.resolve(false),
    });

    controller.start();
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(10);

    expect(create).toHaveBeenCalledTimes(1);
  });

  it("reports a failed creation once while continuing capped recovery", async () => {
    vi.useFakeTimers();
    const { controller, create, onCreateFailed } = makeController({
      checkAlive: () => Promise.resolve(false),
      create: () => Promise.reject(new Error("spawn failed")),
    });

    controller.start();
    await vi.advanceTimersByTimeAsync(10 + 100 + 10 + 200 + 10);

    expect(create).toHaveBeenCalledTimes(3);
    expect(onCreateFailed).toHaveBeenCalledTimes(1);
  });

  it("ignores a late liveness result after disconnect or disposal", async () => {
    vi.useFakeTimers();
    const liveness = deferred<boolean>();
    const { controller, sendAttach, checkAlive } = makeController({
      checkAlive: () => liveness.promise,
    });

    controller.start();
    await vi.advanceTimersByTimeAsync(10);
    expect(checkAlive).toHaveBeenCalledTimes(1);
    controller.onConnectionStatus("disconnected");
    liveness.resolve(true);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sendAttach).toHaveBeenCalledTimes(1);

    controller.dispose();
    controller.onConnectionStatus("connected");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sendAttach).toHaveBeenCalledTimes(1);
  });

  it("defers without spinning when transport cannot send an attach", () => {
    const { controller, sendAttach, onAttachUnavailable } = makeController({
      sendAttach: () => false,
    });

    controller.start();
    controller.start();

    expect(sendAttach).toHaveBeenCalledTimes(1);
    expect(onAttachUnavailable).toHaveBeenCalledTimes(1);
  });
});
