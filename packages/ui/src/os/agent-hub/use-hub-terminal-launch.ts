import { useCallback, useEffect, useRef, useState } from "react";
import {
  getConnectionSnapshot,
  type ConnectionSnapshot,
} from "@/api/connections.js";
import {
  terminalTargetKey,
  type TerminalTarget,
} from "@/api/terminal-session-contract.js";
import { terminalKey } from "@/api/ownership.js";
import {
  useProjectTargetStore,
  projectScopeKey,
} from "@/stores/project-target.js";
import type { TraditionalTerminalProjectGroup } from "@/lib/traditional-terminal-projects.js";
import {
  buildTerminalLaunchIdentity,
  reserveAndExecuteTerminalLaunch,
  type TerminalLaunchOutcome,
} from "../terminal-launch-lifecycle.js";

export interface StuckAttemptInfo {
  readonly attemptId: string;
  readonly reason: string;
  readonly profileId: string;
}

export interface UseHubTerminalLaunchOptions {
  readonly hubWindowId: string;
  readonly desktopId: string;
  readonly groups: readonly TraditionalTerminalProjectGroup[];
  readonly runtimeIndex: ReadonlyMap<string, TerminalTarget>;
  onSelectTab(sessionId: string): void;
  getConnectionSnapshot?: (profileId: string) => ConnectionSnapshot | null;
  reserveAndExecuteTerminalLaunch?: typeof reserveAndExecuteTerminalLaunch;
  buildTerminalLaunchIdentity?: typeof buildTerminalLaunchIdentity;
}

export interface UseHubTerminalLaunchResult {
  readonly isLaunching: boolean;
  readonly launchNotice: string | null;
  readonly stuckAttempt: StuckAttemptInfo | null;
  launchTerminal(groupId?: string): Promise<void>;
  clearNotice(): void;
  clearStuckAttempt(): void;
}

interface PendingSelection {
  readonly capturedOwner: { readonly profileId: string; readonly generation: number };
  readonly terminalId: string;
  readonly target: TerminalTarget;
}

export function useHubTerminalLaunch(
  options: UseHubTerminalLaunchOptions,
): UseHubTerminalLaunchResult {
  const {
    desktopId,
    groups,
    runtimeIndex,
    onSelectTab,
    getConnectionSnapshot: getSnapshot = getConnectionSnapshot,
    reserveAndExecuteTerminalLaunch: reserveAndExecute = reserveAndExecuteTerminalLaunch,
    buildTerminalLaunchIdentity: buildIdentity = buildTerminalLaunchIdentity,
  } = options;

  const [isLaunching, setIsLaunching] = useState(false);
  const [launchNotice, setLaunchNotice] = useState<string | null>(null);
  const [stuckAttempt, setStuckAttempt] = useState<StuckAttemptInfo | null>(
    null,
  );
  const [pendingSelection, setPendingSelection] =
    useState<PendingSelection | null>(null);

  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const launchTerminal = useCallback(
    async (groupId?: string) => {
      const targetGroup = groupId
        ? groups.find((g) => g.id === groupId)
        : groups[0];

      if (!targetGroup || !targetGroup.profileId) {
        return;
      }

      const snap = getSnapshot(targetGroup.profileId);
      if (!snap || snap.status !== "connected") {
        setLaunchNotice(
          `Cannot launch terminal: Target profile "${targetGroup.profileName || targetGroup.profileId}" is disconnected.`,
        );
        return;
      }

      // Capture owner before reserve
      const capturedOwner = {
        profileId: snap.owner.profileId,
        generation: snap.owner.generation,
      };

      const projectKeyStr = targetGroup.projectRef
        ? projectScopeKey(targetGroup.projectRef)
        : (targetGroup.projectName ?? targetGroup.id);
      const activeTargets = useProjectTargetStore.getState().activeTargetByProject as Record<string, string | null>;
      const selectedWorktree = activeTargets[projectKeyStr] ?? null;

      const identity = buildIdentity({
        profileId: targetGroup.profileId,
        target: targetGroup.projectName
          ? {
              kind: "project",
              profileId: targetGroup.profileId,
              project: targetGroup.projectName,
              worktreePath: selectedWorktree ?? undefined,
            }
          : { kind: "workspace", profileId: targetGroup.profileId },
        fallbackProjectId: targetGroup.projectName ?? undefined,
        fallbackWorktreeId: selectedWorktree ?? undefined,
        cwd: null,
      });

      setIsLaunching(true);
      setLaunchNotice(null);

      try {
        const result = await reserveAndExecute({
          identity,
          generation: capturedOwner.generation,
          desktopId,
          request: {
            owner: capturedOwner,
            command: "",
            project: targetGroup.projectName ?? undefined,
            wireTarget: targetGroup.projectName
              ? (selectedWorktree
                  ? {
                      type: "project",
                      project: targetGroup.projectName,
                      worktreePath: selectedWorktree,
                    }
                  : { type: "project", project: targetGroup.projectName })
              : { type: "workspace" },
          },
        });

        // Hub closed while pending: settled normally, do not setState
        if (!isMountedRef.current) {
          return;
        }

        if (result.kind === "blocked") {
          setLaunchNotice(result.reason);
          if (result.existingAttemptId) {
            setStuckAttempt({
              attemptId: result.existingAttemptId,
              reason: result.reason,
              profileId: targetGroup.profileId,
            });
          }
          return;
        }

        if (result.kind === "failed") {
          setLaunchNotice(result.error);
          return;
        }

        if (result.kind === "created") {
          if (result.target) {
            setPendingSelection({
              capturedOwner,
              terminalId: result.terminalId,
              target: result.target,
            });
          } else {
            // Non-canonical outcome: fail closed, never auto-select
            setLaunchNotice(
              "Terminal started; select it from the project tabs",
            );
          }
        }
      } catch (err: unknown) {
        if (!isMountedRef.current) return;
        const msg = err instanceof Error ? err.message : String(err);
        setLaunchNotice(`Terminal launch failed: ${msg}`);
      } finally {
        if (isMountedRef.current) {
          setIsLaunching(false);
        }
      }
    },
    [desktopId, getSnapshot, groups, buildIdentity, reserveAndExecute],
  );

  // R8a Pending selection watcher
  useEffect(() => {
    if (!pendingSelection) return;

    const { capturedOwner, terminalId, target } = pendingSelection;
    const currentSnap = getSnapshot(capturedOwner.profileId);

    // Cancel marker on owner generation change or disconnect
    if (
      !currentSnap ||
      currentSnap.status !== "connected" ||
      currentSnap.owner.generation !== capturedOwner.generation
    ) {
      setPendingSelection(null);
      return;
    }

    const logicalKey = terminalKey({
      profileId: capturedOwner.profileId,
      id: terminalId,
    });
    const observedTarget = runtimeIndex.get(logicalKey);

    if (observedTarget) {
      if (terminalTargetKey(observedTarget) === terminalTargetKey(target)) {
        // Exact canonical match under unchanged generation
        onSelectTab(logicalKey);
        setPendingSelection(null);
      } else {
        // Replacement with same terminal ID observed! Cancel marker
        setPendingSelection(null);
      }
    }
  }, [getSnapshot, onSelectTab, pendingSelection, runtimeIndex]);

  const clearNotice = useCallback(() => {
    setLaunchNotice(null);
  }, []);

  const clearStuckAttempt = useCallback(() => {
    setStuckAttempt(null);
  }, []);

  return {
    isLaunching,
    launchNotice,
    stuckAttempt,
    launchTerminal,
    clearNotice,
    clearStuckAttempt,
  };
}
