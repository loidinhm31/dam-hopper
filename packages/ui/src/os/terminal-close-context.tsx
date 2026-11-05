import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  type ReactNode,
  type ReactElement,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  TerminalCloseRequest,
  TerminationOrigin,
  TerminationState,
} from "@/api/terminal-session-contract.js";
import {
  requestGuardedTermination,
  type GuardedTerminationClient,
} from "@/lib/terminal-session-actions.js";
import {
  terminalActionCoordinator,
  useAllTerminalActions,
} from "@/lib/terminal-session-action-coordinator.js";
import {
  getConnectionSnapshot,
  isCurrentConnection,
  getApi,
} from "@/api/connections.js";
import { useAggregatedTerminalSessions } from "@/hooks/use-aggregated-terminal-sessions.js";
import { TerminalCloseDialog } from "./TerminalCloseDialog.js";
import { useWindowStore } from "./window-store.js";
import {
  terminalTargetKey,
  resolveWindowTerminalObservation,
  type TerminalTarget,
} from "@/api/terminal-session-contract.js";
export interface TerminalCloseContextValue {
  readonly requestTerminalClose: (
    request: TerminalCloseRequest,
    onCloseView: (windowId: string) => void,
    options?: { immediate?: boolean; prompt?: boolean },
  ) => void;
  readonly isPromptOpen: boolean;
  readonly currentRequest: TerminalCloseRequest | null;
  readonly activeTerminationState: TerminationState | null;
  readonly endSession?: () => Promise<void>;
  readonly terminateSessionImmediately?: (
    target: TerminalTarget,
    windowId: string,
    onCloseView: (windowId: string) => void,
  ) => Promise<void>;
}

const TerminalCloseContext = createContext<TerminalCloseContextValue | null>(null);

export function useTerminalClose(): TerminalCloseContextValue {
  const ctx = useContext(TerminalCloseContext);
  if (!ctx) {
    throw new Error("useTerminalClose must be used within a TerminalCloseProvider");
  }
  return ctx;
}

export interface TerminalCloseProviderProps {
  readonly children: ReactNode;
  readonly client?: GuardedTerminationClient;
}

export function TerminalCloseProvider({
  children,
  client: overrideClient,
}: TerminalCloseProviderProps): ReactElement {
  const queryClient = useQueryClient();
  const [currentRequest, setCurrentRequest] = useState<TerminalCloseRequest | null>(null);
  const [isPromptOpen, setIsPromptOpen] = useState(false);
  const [activeTerminationState, setActiveTerminationState] =
    useState<TerminationState | null>(null);
  const promptTokenRef = useRef(0);
  const currentRequestRef = useRef<TerminalCloseRequest | null>(null);
  const currentOnCloseViewRef = useRef<((windowId: string) => void) | null>(null);
  interface DispatchedActionRecord {
    readonly target: TerminalTarget;
    readonly windowId: string;
    readonly onCloseView: (windowId: string) => void;
    state: TerminationState;
  }

  const dispatchedActionsRef = useRef<Map<string, DispatchedActionRecord>>(new Map());
  const inFlightTargetsRef = useRef<Set<string>>(new Set());

  const targetKey = terminalTargetKey;

  const { observations } = useAggregatedTerminalSessions();
  const actions = useAllTerminalActions();

  useEffect(() => {
    terminalActionCoordinator.reconcileWithObservations(observations);
  }, [observations]);

  useEffect(() => {
    for (const [tKey, record] of dispatchedActionsRef.current.entries()) {
      const nextState = actions.get(tKey);
      if (!nextState) continue;

      if (nextState !== record.state) {
        record.state = nextState;
        const isPromptActive =
          currentRequestRef.current !== null &&
          currentRequestRef.current.windowId === record.windowId &&
          currentRequestRef.current.target !== null &&
          targetKey(currentRequestRef.current.target) === tKey;
        if (isPromptActive) {
          setActiveTerminationState(nextState);
        }
        // Authoritative exit or cancellation closes the bound window
        if (nextState.status === "ended" || nextState.status === "restartCancelled") {
          const win = useWindowStore.getState().session.windows[record.windowId];
          const curTarget =
            win?.runtimeIdentity?.kind === "terminal"
              ? win.runtimeIdentity.target
              : (win?.appState?.target as TerminalTarget | undefined) ??
                (win ? resolveWindowTerminalObservation(win, observations).target : null);
          if (
            win &&
            curTarget &&
            curTarget.profileId === record.target.profileId &&
            curTarget.generation === record.target.generation &&
            curTarget.terminalId === record.target.terminalId &&
            curTarget.incarnation === record.target.incarnation &&
            curTarget.serverEpoch === record.target.serverEpoch
          ) {
            record.onCloseView(record.windowId);
          }
          if (isPromptActive) {
            promptTokenRef.current++;
            currentRequestRef.current = null;
            setIsPromptOpen(false);
            setCurrentRequest(null);
          }
        }
      }
    }
  }, [actions, currentRequest]);

  const terminateSessionImmediately = useCallback(
    async (
      target: TerminalTarget,
      windowId: string,
      onCloseView: (windowId: string) => void,
    ) => {
      onCloseView(windowId);

      const tKey = targetKey(target);
      const origin: TerminationOrigin = "live";

      const reservation = terminalActionCoordinator.reserveDispatch(target, origin);
      if (!reservation.allowed) {
        return;
      }

      const initialDispatchState: TerminationState = Object.freeze({
        status: "dispatching",
        target,
        origin,
        reason: "user_end_confirmed",
      });
      const record: DispatchedActionRecord = {
        target,
        windowId,
        onCloseView,
        state: initialDispatchState,
      };
      dispatchedActionsRef.current.set(tKey, record);

      const checkCurrent = () =>
        isCurrentConnection({
          profileId: target.profileId,
          generation: target.generation,
        });

      let terminationClient: GuardedTerminationClient;
      if (overrideClient) {
        terminationClient = overrideClient;
      } else {
        const snap = getConnectionSnapshot(target.profileId);
        if (!snap || snap.status !== "connected") {
          const failedState = Object.freeze<TerminationState>({
            status: "failed",
            target,
            origin,
            error: {
              category: "abort",
              message: `Target profile ${target.profileId} is disconnected`,
            },
          });
          terminalActionCoordinator.recordOutcome(target, failedState, reservation.attemptToken);
          record.state = failedState;
          return;
        }
        terminationClient = getApi(snap.owner);
      }

      try {
        const resultState = await requestGuardedTermination(
          target,
          origin,
          terminationClient,
          checkCurrent,
        );
        terminalActionCoordinator.recordOutcome(target, resultState, reservation.attemptToken);
        record.state = resultState;
        queryClient.invalidateQueries({
          predicate: (query) =>
            Array.isArray(query.queryKey) &&
            query.queryKey.some(
              (part) =>
                part === "terminal-sessions" || part === "terminal-inventory",
            ),
        });
      } catch {
        // Fallback error safely handled
      } finally {
        inFlightTargetsRef.current.delete(tKey);
      }
    },
    [overrideClient, queryClient],
  );

  const requestTerminalClose = useCallback(
    (
      request: TerminalCloseRequest,
      onCloseView: (windowId: string) => void,
      options?: { immediate?: boolean; prompt?: boolean },
    ) => {
      const frozenRequest: TerminalCloseRequest = Object.freeze({ ...request });
      currentOnCloseViewRef.current = onCloseView;

      if (!options?.prompt) {
        // Kill immediately, never ask dialog
        if (frozenRequest.target) {
          void terminateSessionImmediately(
            frozenRequest.target,
            frozenRequest.windowId,
            onCloseView,
          );
        } else {
          const win = useWindowStore.getState().session.windows[frozenRequest.windowId];
          const sessionId =
            (win?.appState?.sessionId as string | undefined) ??
            (win?.appState?.terminalId as string | undefined);
          const profileId = win?.ctx?.profileId ?? "default";
          if (sessionId) {
            try {
              const snap = getConnectionSnapshot(profileId);
              if (snap && snap.status === "connected") {
                const api = getApi(snap.owner);
                void api.terminal.remove(sessionId).catch(() => {
                  void api.terminal.kill(sessionId).catch(() => {});
                });
              }
            } catch {}
          }
          onCloseView(frozenRequest.windowId);
        }
        return;
      }

      // Explicit prompt requested (e.g. testing prompt isolation)
      const existingRecord = frozenRequest.target
        ? dispatchedActionsRef.current.get(targetKey(frozenRequest.target))
        : null;

      promptTokenRef.current++;
      currentRequestRef.current = frozenRequest;
      setCurrentRequest(frozenRequest);
      setActiveTerminationState(existingRecord?.state ?? null);
      setIsPromptOpen(true);
    },
    [terminateSessionImmediately],
  );

  const handleCancel = useCallback(() => {
    promptTokenRef.current++;
    currentRequestRef.current = null;
    setIsPromptOpen(false);
    setCurrentRequest(null);
    setActiveTerminationState(null);
  }, []);

  const handleCloseView = useCallback(() => {
    promptTokenRef.current++;
    currentRequestRef.current = null;
    if (currentRequest && currentOnCloseViewRef.current) {
      currentOnCloseViewRef.current(currentRequest.windowId);
    }
    setIsPromptOpen(false);
    setCurrentRequest(null);
    setActiveTerminationState(null);
  }, [currentRequest]);

  const handleEndSession = useCallback(async () => {
    if (!currentRequest || !currentRequest.target) {
      return;
    }
    const tokenAtDispatch = promptTokenRef.current;
    const { target, availability, windowId } = currentRequest;
    const tKey = targetKey(target);
    const origin: TerminationOrigin =
      availability === "restartPending" ? "restartPending" : "live";

    const reservation = terminalActionCoordinator.reserveDispatch(target, origin);
    if (!reservation.allowed) {
      return;
    }

    const initialDispatchState: TerminationState = Object.freeze({
      status: "dispatching",
      target,
      origin,
      reason: "user_end_confirmed",
    });
    const boundOnCloseView = currentOnCloseViewRef.current ?? (() => {});
    const record: DispatchedActionRecord = {
      target,
      windowId,
      onCloseView: boundOnCloseView,
      state: initialDispatchState,
    };
    dispatchedActionsRef.current.set(tKey, record);
    setActiveTerminationState(initialDispatchState);

    // Recheck currency before dispatch
    const checkCurrent = () =>
      isCurrentConnection({
        profileId: target.profileId,
        generation: target.generation,
      });

    if (!checkCurrent()) {
      const failedState = Object.freeze<TerminationState>({
        status: "failed",
        target,
        origin,
        error: {
          category: "abort",
          message: "Target profile is disconnected or generation changed before dispatch",
        },
      });
      terminalActionCoordinator.recordOutcome(target, failedState, reservation.attemptToken);
      record.state = failedState;
      if (currentRequest?.target && targetKey(currentRequest.target) === tKey) {
        setActiveTerminationState(failedState);
      }
      return;
    }

    // Resolve API client
    let terminationClient: GuardedTerminationClient;
    if (overrideClient) {
      terminationClient = overrideClient;
    } else {
      const snap = getConnectionSnapshot(target.profileId);
      if (!snap || snap.status !== "connected") {
        const failedState = Object.freeze<TerminationState>({
          status: "failed",
          target,
          origin,
          error: {
            category: "abort",
            message: `Target profile ${target.profileId} is disconnected`,
          },
        });
        terminalActionCoordinator.recordOutcome(target, failedState, reservation.attemptToken);
        record.state = failedState;
        const isPromptActive =
          promptTokenRef.current === tokenAtDispatch &&
          currentRequestRef.current !== null &&
          currentRequestRef.current.windowId === record.windowId &&
          currentRequestRef.current.target !== null &&
          targetKey(currentRequestRef.current.target) === tKey;
        if (isPromptActive) {
          setActiveTerminationState(failedState);
        }
        return;
      }
      terminationClient = getApi(snap.owner);
    }

    try {
      const resultState = await requestGuardedTermination(
        target,
        origin,
        terminationClient,
        checkCurrent,
      );
      terminalActionCoordinator.recordOutcome(target, resultState, reservation.attemptToken);
      if (
        record.state.status !== "ended" &&
        record.state.status !== "restartCancelled"
      ) {
        record.state = resultState;
      }
      const isPromptActive =
        promptTokenRef.current === tokenAtDispatch &&
        currentRequestRef.current !== null &&
        currentRequestRef.current.windowId === record.windowId &&
        currentRequestRef.current.target !== null &&
        targetKey(currentRequestRef.current.target) === tKey;
      if (isPromptActive) {
        setActiveTerminationState(resultState);
      }
      // Pending 200 restartCancelled completes immediately and closes view
      if (origin === "restartPending" && resultState.status === "restartCancelled") {
        const win = useWindowStore.getState().session.windows[record.windowId];
        const curTarget =
          win?.runtimeIdentity?.kind === "terminal"
            ? win.runtimeIdentity.target
            : (win?.appState?.target as TerminalTarget | undefined);
        const matchesExactTarget = Boolean(
          win &&
            curTarget &&
            curTarget.profileId === target.profileId &&
            curTarget.generation === target.generation &&
            curTarget.terminalId === target.terminalId &&
            curTarget.incarnation === target.incarnation &&
            curTarget.serverEpoch === target.serverEpoch,
        );
        if (matchesExactTarget) {
          record.onCloseView(record.windowId);
        }
        if (isPromptActive) {
          promptTokenRef.current++;
          currentRequestRef.current = null;
          setIsPromptOpen(false);
          setCurrentRequest(null);
        }
      }

      if (
        resultState.status === "terminationRequested" ||
        resultState.status === "ended"
      ) {
        queryClient.invalidateQueries({
          predicate: (query) =>
            Array.isArray(query.queryKey) && query.queryKey.includes("terminal-sessions"),
        });

        // 1500ms safety timeout: close view and dismiss prompt if observation push event is delayed
        window.setTimeout(() => {
          if (dispatchedActionsRef.current.has(tKey)) {
            const win = useWindowStore.getState().session.windows[record.windowId];
            if (win) {
              record.onCloseView(record.windowId);
            }
            if (currentRequestRef.current?.windowId === record.windowId) {
              promptTokenRef.current++;
              currentRequestRef.current = null;
              setIsPromptOpen(false);
              setCurrentRequest(null);
              setActiveTerminationState(null);
            }
          }
        }, 1500);
      }
    } finally {
      inFlightTargetsRef.current.delete(tKey);
    }
  }, [currentRequest, overrideClient]);

  const contextValue: TerminalCloseContextValue = {
    requestTerminalClose,
    isPromptOpen,
    currentRequest,
    activeTerminationState,
    endSession: handleEndSession,
    terminateSessionImmediately,
  };
  return (
    <TerminalCloseContext.Provider value={contextValue}>
      {children}
      <TerminalCloseDialog
        open={isPromptOpen}
        request={currentRequest}
        terminationState={activeTerminationState}
        onCloseView={handleCloseView}
        onEndSession={handleEndSession}
        onCancel={handleCancel}
      />
    </TerminalCloseContext.Provider>
  );
}
