// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  TerminalCloseProvider,
  useTerminalClose,
  type TerminalCloseContextValue,
} from "./terminal-close-context.js";
import { terminalActionCoordinator } from "@/lib/terminal-session-action-coordinator.js";
import { useWindowStore } from "./window-store.js";
import { createDefaultOsSession, openWindow } from "./window-ops.js";
import type { TerminalTarget } from "@/api/terminal-session-contract.js";
import type { GuardedTerminationClient } from "@/lib/terminal-session-actions.js";

vi.mock("@/hooks/use-aggregated-terminal-sessions.js", () => ({
  useAggregatedTerminalSessions: () => ({
    sessions: [],
    observations: [],
    isSuccess: true,
    isLoading: false,
  }),
}));

vi.mock("@/api/connections.js", () => ({
  getConnectionSnapshot: (profileId: string) => ({
    status: "connected",
    serverUrl: "http://localhost:3000",
    owner: { profileId, generation: 1 },
  }),
  isCurrentConnection: () => true,
  subscribeConnections: () => () => {},
}));

describe("TerminalCloseProvider held-response prompt isolation", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  const targetA: TerminalTarget = {
    profileId: "prof-1",
    generation: 1,
    serverEpoch: "epoch-1",
    terminalId: "term-a",
    incarnation: "101",
  };

  const targetB: TerminalTarget = {
    profileId: "prof-1",
    generation: 1,
    serverEpoch: "epoch-1",
    terminalId: "term-b",
    incarnation: "202",
  };

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    terminalActionCoordinator.resetForTests();

    let session = createDefaultOsSession("desk-1");
    session = openWindow(session, {
      id: "win-a",
      appId: "terminals",
      title: "Terminal A",
      ctx: { profileId: "prof-1" },
      runtimeIdentity: { kind: "terminal", target: targetA },
    });
    session = openWindow(session, {
      id: "win-b",
      appId: "terminals",
      title: "Terminal B",
      ctx: { profileId: "prof-1" },
      runtimeIdentity: { kind: "terminal", target: targetB },
    });
    useWindowStore.getState().setSession(session);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("prevents held response A from mutating or dismissing active prompt B", async () => {
    const { promise: promiseA, resolve: resolveA } =
      Promise.withResolvers<unknown>();
    const terminateMock = vi.fn().mockImplementation((target: TerminalTarget) => {
      if (target.terminalId === "term-a") {
        return promiseA;
      }
      return Promise.resolve({
        version: 1,
        serverEpoch: "epoch-1",
        terminalId: target.terminalId,
        incarnation: target.incarnation,
        outcome: "terminationRequested",
      });
    });
    const mockClient: GuardedTerminationClient = {
      terminal: {
        terminateSessionGuarded: terminateMock,
      },
    };

    let closeContext!: TerminalCloseContextValue;
    function Consumer() {
      closeContext = useTerminalClose();
      return createElement("div", null, "Consumer");
    }

    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(
            TerminalCloseProvider,
            { client: mockClient },
            createElement(Consumer),
          ),
        ),
      );
    });

    const onCloseViewA = vi.fn();
    const onCloseViewB = vi.fn();

    // 1. Open prompt A
    await act(async () => {
      closeContext.requestTerminalClose(
        {
          windowId: "win-a",
          target: targetA,
          availability: "live",
        },
        onCloseViewA,
      );
    });

    expect(closeContext.isPromptOpen).toBe(true);
    expect(closeContext.currentRequest?.windowId).toBe("win-a");

    // 2. Dispatch End session for A: dispatch starts and holds on promiseA
    await act(async () => {
      void closeContext.endSession?.();
    });
    expect(terminateMock).toHaveBeenCalledTimes(1);
    expect(terminateMock).toHaveBeenCalledWith(
      expect.objectContaining({ terminalId: "term-a" }),
      "live",
    );

    // 3. User cancels prompt A, opens prompt B
    act(() => {
      closeContext.requestTerminalClose(
        {
          windowId: "win-b",
          target: targetB,
          availability: "live",
        },
        onCloseViewB,
      );
    });

    expect(closeContext.isPromptOpen).toBe(true);
    expect(closeContext.currentRequest?.windowId).toBe("win-b");
    expect(closeContext.currentRequest?.target?.terminalId).toBe("term-b");

    // 4. Held response A resolves (202 terminationRequested)
    await act(async () => {
      resolveA({
        version: 1,
        serverEpoch: "epoch-1",
        terminalId: "term-a",
        incarnation: "101",
        outcome: "terminationRequested",
      });
    });

    // Prompt B MUST remain open, for win-b, targetB, untouched by response A
    expect(closeContext.isPromptOpen).toBe(true);
    expect(closeContext.currentRequest?.windowId).toBe("win-b");
    expect(closeContext.currentRequest?.target?.terminalId).toBe("term-b");
    expect(onCloseViewA).not.toHaveBeenCalled();
    expect(onCloseViewB).not.toHaveBeenCalled();
  });

  it("supports restartPending origin 200 outcome and response loss reconciliation", async () => {
    const { promise: promiseA, reject: rejectA } =
      Promise.withResolvers<unknown>();
    const terminateMock = vi.fn().mockImplementation((target: TerminalTarget, origin: string) => {
      if (target.terminalId === "term-a") {
        return promiseA;
      }
      return Promise.resolve({
        version: 1,
        serverEpoch: "epoch-1",
        terminalId: target.terminalId,
        incarnation: target.incarnation,
        outcome: origin === "restartPending" ? "restartCancelled" : "terminationRequested",
      });
    });
    const mockClient: GuardedTerminationClient = {
      terminal: {
        terminateSessionGuarded: terminateMock,
      },
    };

    let closeContext!: TerminalCloseContextValue;
    function Consumer() {
      closeContext = useTerminalClose();
      return createElement("div", null, "Consumer");
    }

    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(
            TerminalCloseProvider,
            { client: mockClient },
            createElement(Consumer),
          ),
        ),
      );
    });

    const onCloseViewA = vi.fn();

    // 1. Open prompt for term-a with restartPending origin
    await act(async () => {
      closeContext.requestTerminalClose(
        {
          windowId: "win-a",
          target: targetA,
          availability: "restartPending",
        },
        onCloseViewA,
      );
    });

    // 2. Dispatch cancel restart
    await act(async () => {
      void closeContext.endSession?.();
    });
    expect(terminateMock).toHaveBeenCalledWith(
      expect.objectContaining({ terminalId: "term-a" }),
      "restartPending",
    );

    // 3. Response is lost (network drop / timeout)
    await act(async () => {
      rejectA(new Error("Network drop: connection reset by peer"));
    });

    // Action is retained as outcomeUnknown
    expect(closeContext.activeTerminationState?.status).toBe("outcomeUnknown");
  });
});
