import {
  getConnectionSnapshot,
  getApi,
  isCurrentConnection,
  type ConnectionSnapshot,
} from "@/api/connections.js";
import { ApiRequestError } from "@/api/client.js";
import type { ConnectionRef, FsTargetRef, ServerFsTarget } from "@/api/ownership.js";
import {
  createTerminalTargetFromObservation,
  isCanonicalPositiveU64,
  isCanonicalUuid,
  type TerminalInventoryDetailedObservation,
  type TerminalInventoryDetailedRow,
  type TerminalTarget,
} from "@/api/terminal-session-contract.js";
import { terminalInventoryQueryOptions } from "@/api/queries.js";
import {
  getLaunchAttempt,
  reserveTerminalLaunch,
  settleTerminalLaunch,
  type LaunchAttemptRead,
  type LaunchAttemptState,
  type LaunchIdentityParams,
  type ReserveLaunchResult,
} from "./persistence.js";

export function buildTerminalLaunchIdentity(input: {
  profileId: string;
  target: FsTargetRef;
  fallbackProjectId?: string | null;
  fallbackWorktreeId?: string | null;
  cwd: string | null;
}): LaunchIdentityParams {
  const { profileId, target, fallbackProjectId, fallbackWorktreeId, cwd } = input;
  return {
    profileId,
    endpointBinding: "default-endpoint",
    action: "terminal.create",
    targetKind: target.kind,
    workspaceId: target.kind === "workspace" ? target.profileId : null,
    projectId:
      target.kind === "project"
        ? target.project
        : fallbackProjectId ?? null,
    worktreeId:
      target.kind === "project"
        ? target.worktreePath ?? null
        : fallbackWorktreeId ?? null,
    cwd,
  };
}

// In-flight registry (page-scoped, in-memory)
// Tracks reservations awaiting execution, and active execution counts per attemptId
const reservedAttempts = new Set<string>();
const executingAttemptCounts = new Map<string, number>();

export function isLaunchAttemptActive(attemptId: string): boolean {
  return reservedAttempts.has(attemptId) || (executingAttemptCounts.get(attemptId) ?? 0) > 0;
}

export function markLaunchAttemptReserved(attemptId: string): void {
  reservedAttempts.add(attemptId);
}

export function markLaunchAttemptExecuting(attemptId: string): void {
  reservedAttempts.delete(attemptId);
  executingAttemptCounts.set(attemptId, (executingAttemptCounts.get(attemptId) ?? 0) + 1);
}

export function markLaunchAttemptExecutionFinished(attemptId: string): void {
  const current = (executingAttemptCounts.get(attemptId) ?? 0) - 1;
  if (current <= 0) {
    executingAttemptCounts.delete(attemptId);
  } else {
    executingAttemptCounts.set(attemptId, current);
  }
}

export function markLaunchAttemptActive(attemptId: string): void {
  markLaunchAttemptExecuting(attemptId);
}

export function markLaunchAttemptInactive(attemptId: string): void {
  reservedAttempts.delete(attemptId);
  executingAttemptCounts.delete(attemptId);
}

export function resetActiveLaunchAttemptsForTests(): void {
  reservedAttempts.clear();
  executingAttemptCounts.clear();
}

export async function reserveTrackedTerminalLaunch(
  identity: LaunchIdentityParams,
  meta: {
    generation: number;
    desktopId: string;
    explicitRequestedTerminalId?: string;
  },
  deps?: {
    reserve?: typeof reserveTerminalLaunch;
  },
): Promise<ReserveLaunchResult> {
  const reserve = deps?.reserve ?? reserveTerminalLaunch;
  const result = await reserve(identity, meta);
  if (result.status === "reserved") {
    markLaunchAttemptReserved(result.attemptId);
  }
  return result;
}

export interface TerminalLaunchRequest {
  owner: { profileId: string; generation: number };
  attemptId?: string;
  terminalId: string;
  command: string;
  project?: string;
  cwd?: string;
  wireTarget?: ServerFsTarget;
}

export type TerminalLaunchOutcome =
  | {
      kind: "created";
      terminalId: string;
      target?: TerminalTarget;
      incarnation?: number;
      incarnationExact?: string;
      serverEpoch?: string;
    }
  | {
      kind: "failed";
      terminalId: string;
      error: string;
      settlement: "confirmed-not-created" | "uncertain" | "confirmed-success" | "none";
    };

export interface ExecuteLaunchDependencies {
  getSnapshot?: (profileId: string) => ConnectionSnapshot | null | undefined;
  getApi?: (owner: ConnectionRef) => {
    terminal: {
      create: (params: {
        id: string;
        command: string;
        project?: string;
        cwd?: string;
        target?: ServerFsTarget;
        cols: number;
        rows: number;
      }) => Promise<{
        id?: string;
        incarnation?: number;
        incarnationExact?: string;
        serverEpoch?: string;
      }>;
    };
  };
  settle?: typeof settleTerminalLaunch;
}

export async function executeTerminalLaunch(
  req: TerminalLaunchRequest,
  deps?: ExecuteLaunchDependencies,
): Promise<TerminalLaunchOutcome> {
  if (req.attemptId) {
    markLaunchAttemptExecuting(req.attemptId);
  }
  const settle = deps?.settle ?? settleTerminalLaunch;
  const getSnapshot = deps?.getSnapshot ?? getConnectionSnapshot;
  const apiFactory = deps?.getApi ?? getApi;

  let requestSent = false;
  try {
    const snap = getSnapshot(req.owner.profileId);
    if (!snap || snap.status !== "connected") {
      const errorMsg = `Profile ${req.owner.profileId} is not connected`;
      if (req.attemptId) {
        await settle(req.attemptId, {
          kind: "confirmed-not-created",
          reason: errorMsg,
        });
      }
      return {
        kind: "failed",
        terminalId: req.terminalId,
        error: errorMsg,
        settlement: req.attemptId ? "confirmed-not-created" : "none",
      };
    }

    if (snap.owner.generation !== req.owner.generation) {
      const errorMsg = "Connection generation changed before launch";
      if (req.attemptId) {
        await settle(req.attemptId, {
          kind: "confirmed-not-created",
          reason: errorMsg,
        });
      }
      return {
        kind: "failed",
        terminalId: req.terminalId,
        error: errorMsg,
        settlement: req.attemptId ? "confirmed-not-created" : "none",
      };
    }

    const client = apiFactory(snap.owner);
    requestSent = true;
    const sessionRes = await client.terminal.create({
      id: req.terminalId,
      command: req.command,
      project: req.project,
      cwd: req.cwd,
      target: req.wireTarget,
      cols: 80,
      rows: 24,
    });

    const serverEpoch =
      sessionRes.serverEpoch && isCanonicalUuid(sessionRes.serverEpoch)
        ? sessionRes.serverEpoch
        : undefined;

    const incExactValue =
      sessionRes &&
      typeof sessionRes === "object" &&
      "incarnationExact" in sessionRes &&
      typeof sessionRes.incarnationExact === "string"
        ? sessionRes.incarnationExact
        : undefined;

    const rawIncarnation =
      incExactValue && isCanonicalPositiveU64(incExactValue)
        ? incExactValue
        : typeof sessionRes.incarnation === "number" &&
          Number.isSafeInteger(sessionRes.incarnation) &&
          sessionRes.incarnation > 0
          ? String(sessionRes.incarnation)
          : undefined;

    const isIncarnationValid = Boolean(rawIncarnation);

    const createdTarget: TerminalTarget | undefined =
      serverEpoch && isIncarnationValid && rawIncarnation
        ? {
            profileId: req.owner.profileId,
            generation: req.owner.generation,
            terminalId: req.terminalId,
            incarnation: rawIncarnation,
            serverEpoch,
          }
        : undefined;

    const afterSnap = getSnapshot(req.owner.profileId);
    const isOwnerChanged =
      !afterSnap ||
      afterSnap.status !== "connected" ||
      afterSnap.owner.profileId !== snap.owner.profileId ||
      afterSnap.owner.generation !== req.owner.generation;

    let settlement: "confirmed-success" | "uncertain" | "none" = "none";
    if (req.attemptId) {
      if (createdTarget) {
        // Contract C3 Rule 3: A successful create settles as confirmed-success even if owner changed afterwards
        settlement = "confirmed-success";
        await settle(req.attemptId, {
          kind: "confirmed-success",
          target: createdTarget,
        });
      } else {
        settlement = "uncertain";
        await settle(req.attemptId, {
          kind: "uncertain",
          reason:
            "Server creation succeeded but serverEpoch or incarnationExact is missing or non-canonical",
        });
      }
    }

    if (isOwnerChanged) {
      return {
        kind: "failed",
        terminalId: req.terminalId,
        error: "Connection owner changed during launch",
        settlement: req.attemptId ? settlement : "none",
      };
    }

    return {
      kind: "created",
      terminalId: req.terminalId,
      target: createdTarget,
      incarnation: sessionRes.incarnation,
      incarnationExact: rawIncarnation ?? (sessionRes.incarnation !== undefined ? String(sessionRes.incarnation) : undefined),
      serverEpoch,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    let settlement: "confirmed-not-created" | "uncertain" | "none" = "none";
    if (req.attemptId) {
      const isDefiniteNotCreated =
        !requestSent ||
        (err instanceof ApiRequestError &&
          [400, 401, 403, 404, 413, 422].includes(err.status));
      const settlementKind = isDefiniteNotCreated
        ? "confirmed-not-created"
        : "uncertain";
      settlement = settlementKind;
      await settle(req.attemptId, {
        kind: settlementKind,
        reason: msg,
      });
    }
    return {
      kind: "failed",
      terminalId: req.terminalId,
      error: msg,
      settlement,
    };
  } finally {
    if (req.attemptId) {
      markLaunchAttemptExecutionFinished(req.attemptId);
    }
  }
}

export async function reserveAndExecuteTerminalLaunch(
  input: {
    identity: LaunchIdentityParams;
    generation: number;
    desktopId: string;
    request: Omit<TerminalLaunchRequest, "attemptId" | "terminalId">;
  },
  deps?: ExecuteLaunchDependencies & {
    reserve?: typeof reserveTerminalLaunch;
  },
): Promise<
  | TerminalLaunchOutcome
  | { kind: "blocked"; reason: string; existingAttemptId?: string }
> {
  const reserveResult = await reserveTrackedTerminalLaunch(
    input.identity,
    {
      generation: input.generation,
      desktopId: input.desktopId,
    },
    deps,
  );

  if (reserveResult.status === "blocked") {
    return {
      kind: "blocked",
      reason: reserveResult.reason,
      existingAttemptId: reserveResult.existingAttemptId,
    };
  }

  return executeTerminalLaunch(
    {
      ...input.request,
      attemptId: reserveResult.attemptId,
      terminalId: reserveResult.requestedTerminalId,
    },
    deps,
  );
}

export type StuckLaunchResolution =
  | { kind: "already-resolved" }
  | { kind: "in-flight" }
  | { kind: "unknown"; reason: string }
  | { kind: "present-unresolvable"; reason: string }
  | { kind: "definitely-absent" }
  | { kind: "found"; target: TerminalTarget }
  | { kind: "cleared" }
  | { kind: "unavailable"; reason: string }
  | { kind: "conflict"; state: LaunchAttemptState };

export interface ResolveStuckLaunchDependencies {
  getAttempt?: (attemptId: string) => LaunchAttemptRead;
  getSnapshot?: (profileId: string) => ConnectionSnapshot | null | undefined;
  isCurrent?: (owner: ConnectionRef) => boolean;
  observeInventory?: (
    owner: ConnectionRef,
  ) => Promise<TerminalInventoryDetailedObservation>;
  isActive?: (attemptId: string) => boolean;
  settle?: typeof settleTerminalLaunch;
}

export async function resolveStuckLaunch(
  input: { attemptId: string; confirmNotCreated: boolean },
  deps?: ResolveStuckLaunchDependencies,
): Promise<StuckLaunchResolution> {
  const getAttempt = deps?.getAttempt ?? getLaunchAttempt;
  const getSnapshot = deps?.getSnapshot ?? getConnectionSnapshot;
  const isCurrent = deps?.isCurrent ?? isCurrentConnection;
  const isActive = deps?.isActive ?? isLaunchAttemptActive;
  const settle = deps?.settle ?? settleTerminalLaunch;

  // Step 1: Read attempt record
  const attemptRead = getAttempt(input.attemptId);
  if (attemptRead.status === "unreadable") {
    return { kind: "unavailable", reason: attemptRead.reason };
  }
  if (attemptRead.status === "missing") {
    return { kind: "already-resolved" };
  }
  const record = attemptRead.record;
  if (
    record.state === "confirmed-success" ||
    record.state === "confirmed-not-created"
  ) {
    return { kind: "already-resolved" };
  }

  // Step 2: Check in-flight registry
  if (isActive(input.attemptId)) {
    return { kind: "in-flight" };
  }

  // Step 3: Fresh owner-qualified observation for THAT profile
  const snap = getSnapshot(record.profileId);
  if (!snap || snap.status !== "connected") {
    return {
      kind: "unknown",
      reason: `Profile ${record.profileId} is not connected`,
    };
  }
  const capturedOwner = snap.owner;

  let obs: TerminalInventoryDetailedObservation;
  try {
    if (deps?.observeInventory) {
      obs = await deps.observeInventory(capturedOwner);
    } else {
      obs = await terminalInventoryQueryOptions(capturedOwner).queryFn();
    }
  } catch (err) {
    return {
      kind: "unknown",
      reason: `Failed to observe inventory: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (
    !obs ||
    !obs.owner ||
    obs.owner.profileId !== capturedOwner.profileId ||
    obs.owner.generation !== capturedOwner.generation ||
    !isCurrent(capturedOwner)
  ) {
    return {
      kind: "unknown",
      reason: "Observation owner or connection state changed during observation",
    };
  }

  // Step 4: Classify requested id
  const row = obs.sessions.find(
    (s: TerminalInventoryDetailedRow) => s.id === record.requestedTerminalId,
  );
  if (row) {
    const target = createTerminalTargetFromObservation(obs, row);
    if (target && target.generation === capturedOwner.generation) {
      // Settle confirmed-success (no new PTY)
      const settleRes = await settle(input.attemptId, {
        kind: "confirmed-success",
        target,
      });
      if (settleRes.status !== "settled") {
        return { kind: "unavailable", reason: settleRes.reason };
      }
      // F9 durable verification
      const verifyRead = getAttempt(input.attemptId);
      if (verifyRead.status !== "ok") {
        return {
          kind: "unavailable",
          reason:
            verifyRead.status === "unreadable"
              ? verifyRead.reason
              : "Record missing after settlement",
        };
      }
      if (verifyRead.record.state !== "confirmed-success") {
        return { kind: "conflict", state: verifyRead.record.state };
      }
      const prov = verifyRead.record.provenance;
      if (
        !prov ||
        prov.terminalId !== target.terminalId ||
        prov.serverEpoch !== target.serverEpoch ||
        prov.incarnationExact !== String(target.incarnation)
      ) {
        return { kind: "conflict", state: verifyRead.record.state };
      }
      return { kind: "found", target };
    }
    return {
      kind: "present-unresolvable",
      reason:
        "Terminal row present in inventory but target is non-canonical, retired, or ineligible",
    };
  }

  // Row is absent in fresh observation
  if (!input.confirmNotCreated) {
    return { kind: "definitely-absent" };
  }

  // Explicit confirmation: re-check steps at confirmation time
  const confirmAttemptRead = getAttempt(input.attemptId);
  if (confirmAttemptRead.status === "unreadable") {
    return { kind: "unavailable", reason: confirmAttemptRead.reason };
  }
  if (confirmAttemptRead.status === "missing") {
    return { kind: "already-resolved" };
  }
  if (
    confirmAttemptRead.record.state === "confirmed-success" ||
    confirmAttemptRead.record.state === "confirmed-not-created"
  ) {
    return { kind: "already-resolved" };
  }

  if (isActive(input.attemptId)) {
    return { kind: "in-flight" };
  }

  const snap2 = getSnapshot(record.profileId);
  if (!snap2 || snap2.status !== "connected") {
    return {
      kind: "unknown",
      reason: `Profile ${record.profileId} is not connected at confirmation`,
    };
  }
  const capturedOwner2 = snap2.owner;

  let obs2: TerminalInventoryDetailedObservation;
  try {
    if (deps?.observeInventory) {
      obs2 = await deps.observeInventory(capturedOwner2);
    } else {
      obs2 = await terminalInventoryQueryOptions(capturedOwner2).queryFn();
    }
  } catch (err) {
    return {
      kind: "unknown",
      reason: `Failed to observe inventory at confirmation: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (
    !obs2 ||
    !obs2.owner ||
    obs2.owner.profileId !== capturedOwner2.profileId ||
    obs2.owner.generation !== capturedOwner2.generation ||
    !isCurrent(capturedOwner2)
  ) {
    return {
      kind: "unknown",
      reason: "Observation owner or connection state changed at confirmation",
    };
  }

  const row2 = obs2.sessions.find(
    (s: TerminalInventoryDetailedRow) => s.id === record.requestedTerminalId,
  );
  if (row2) {
    const target2 = createTerminalTargetFromObservation(obs2, row2);
    if (target2 && target2.generation === capturedOwner2.generation) {
      const settleRes = await settle(input.attemptId, {
        kind: "confirmed-success",
        target: target2,
      });
      if (settleRes.status !== "settled") {
        return { kind: "unavailable", reason: settleRes.reason };
      }
      const verifyRead = getAttempt(input.attemptId);
      if (verifyRead.status !== "ok") {
        return {
          kind: "unavailable",
          reason:
            verifyRead.status === "unreadable"
              ? verifyRead.reason
              : "Record missing after settlement",
        };
      }
      if (verifyRead.record.state !== "confirmed-success") {
        return { kind: "conflict", state: verifyRead.record.state };
      }
      const prov = verifyRead.record.provenance;
      if (
        !prov ||
        prov.terminalId !== target2.terminalId ||
        prov.serverEpoch !== target2.serverEpoch ||
        prov.incarnationExact !== String(target2.incarnation)
      ) {
        return { kind: "conflict", state: verifyRead.record.state };
      }
      return { kind: "found", target: target2 };
    }
    return {
      kind: "present-unresolvable",
      reason:
        "Terminal row present at confirmation but target is non-canonical, retired, or ineligible",
    };
  }

  // Re-verify in-flight status immediately before not-created settlement
  if (isActive(input.attemptId)) {
    return { kind: "in-flight" };
  }

  const settleRes = await settle(input.attemptId, {
    kind: "confirmed-not-created",
    reason: "Cleared by user",
  });
  if (settleRes.status !== "settled") {
    return { kind: "unavailable", reason: settleRes.reason };
  }

  // F9 durable verification
  const verifyRead = getAttempt(input.attemptId);
  if (verifyRead.status !== "ok") {
    return {
      kind: "unavailable",
      reason:
        verifyRead.status === "unreadable"
          ? verifyRead.reason
          : "Record missing after settlement",
    };
  }
  if (verifyRead.record.state !== "confirmed-not-created") {
    return { kind: "conflict", state: verifyRead.record.state };
  }
  if (verifyRead.record.failureReason !== "Cleared by user") {
    return { kind: "conflict", state: verifyRead.record.state };
  }

  return { kind: "cleared" };
}
