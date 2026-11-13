// @vitest-environment jsdom
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionRef } from "@/api/ownership.js";
import {
  useHostBrowserSelection,
  type HostBrowserSelectionController,
} from "./selection-controller.js";
import { setDocumentVisibilityForTests } from "./visibility-demand.js";

const { isCurrentConnectionMock, requestBrowserHostJsonMock } = vi.hoisted(
  () => ({
    isCurrentConnectionMock: vi.fn((_owner: ConnectionRef) => true),
    requestBrowserHostJsonMock: vi.fn(),
  }),
);

vi.mock("@/api/connections.js", () => ({
  getApi: vi.fn(),
  isCurrentConnection: (owner: ConnectionRef) => isCurrentConnectionMock(owner),
}));

vi.mock("@/api/browser-host-client.js", () => ({
  BrowserHostClientError: class extends Error {},
  requestBrowserHostJson: (
    owner: ConnectionRef,
    path: string,
    init?: RequestInit,
  ) => requestBrowserHostJsonMock(owner, path, init),
}));

describe("useHostBrowserSelection single-flight polling & visibility gating", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let latestController: HostBrowserSelectionController | null = null;
  const owner: ConnectionRef = { profileId: "p-1", generation: 1 };

  function Harness(props: {
    sessionId: string | null;
    navRev: string;
    pollIntervalMs?: number;
  }) {
    latestController = useHostBrowserSelection({
      owner,
      sessionId: props.sessionId,
      navigationRevision: props.navRev,
      leaseToken: "lease-1",
      targets: [],
      pollIntervalMs: props.pollIntervalMs ?? 50,
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    setDocumentVisibilityForTests(true);
    isCurrentConnectionMock.mockReturnValue(true);
    requestBrowserHostJsonMock.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    setDocumentVisibilityForTests(null);
    if (root) {
      await act(async () => {
        root?.unmount();
      });
    }
    container?.remove();
    vi.useRealTimers();
  });

  it("enforces single-flight selection polling (no overlap during slow requests) and aborts/pauses when document is hidden", async () => {
    let pollCalls = 0;
    let activeInFlight = 0;
    let maxConcurrent = 0;
    const signals: AbortSignal[] = [];
    let pendingResolvers: Array<() => void> = [];

    requestBrowserHostJsonMock.mockImplementation(
      (_owner: ConnectionRef, path: string, init?: RequestInit) => {
        if (path.endsWith("/selection/start")) {
          return Promise.resolve({
            selectionActive: true,
            selectionRevision: "1",
            navigationRevision: "1",
          });
        }
        if (path.endsWith("/sess-1")) {
          pollCalls += 1;
          activeInFlight += 1;
          maxConcurrent = Math.max(maxConcurrent, activeInFlight);
          if (init?.signal) {
            signals.push(init.signal);
          }
          const { promise, resolve, reject } = Promise.withResolvers<unknown>();
          const finish = () => {
            activeInFlight -= 1;
            if (init?.signal?.aborted) {
              reject(new DOMException("Aborted", "AbortError"));
              return;
            }
            resolve({
              sessionId: "sess-1",
              url: "https://example.com",
              navigationRevision: "1",
              selection: {
                active: true,
                selectionRevision: "1",
                preview: null,
              },
            });
          };
          init?.signal?.addEventListener("abort", finish, { once: true });
          pendingResolvers.push(finish);
          return promise;
        }
        return Promise.resolve({});
      },
    );

    await act(async () => {
      root!.render(
        createElement(Harness, {
          sessionId: "sess-1",
          navRev: "1",
          pollIntervalMs: 50,
        }),
      );
    });

    await act(async () => {
      await latestController!.startSelection();
    });
    expect(latestController!.selectionActive).toBe(true);

    // Advance 50ms -> first poll starts
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(pollCalls).toBe(1);
    expect(activeInFlight).toBe(1);

    // Advance 300ms while first poll is still in flight -> MUST NOT start overlapping polls
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(pollCalls).toBe(1);
    expect(maxConcurrent).toBe(1);

    // Complete first poll -> next poll schedules 50ms after completion
    await act(async () => {
      const r = pendingResolvers.shift();
      r?.();
    });
    expect(activeInFlight).toBe(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(pollCalls).toBe(2);
    expect(activeInFlight).toBe(1);

    // Hide document while poll 2 is in flight -> immediately aborts poll 2 and pauses future polls
    await act(async () => {
      setDocumentVisibilityForTests(false);
    });
    expect(signals[1]?.aborted).toBe(true);
    expect(activeInFlight).toBe(0);

    // Advance 500ms while document is hidden -> zero new polls
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(pollCalls).toBe(2);

    // Restore document visibility -> polling resumes cleanly
    await act(async () => {
      setDocumentVisibilityForTests(true);
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(pollCalls).toBe(3);
  });
});
