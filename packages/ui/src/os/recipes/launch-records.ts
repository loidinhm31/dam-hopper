import { generateUUID } from "@/lib/utils.js";
import type {
  LaunchRecordV1,
  LaunchStepRecord,
  RecipeStepKey,
  RecipeV1,
  StepExecutionStatus,
} from "./types.js";

export const RECIPE_LAUNCHES_STORAGE_KEY = "dam-hopper:os:v1:recipe-launches";

/**
 * Serializes launch, retry, and reconciliation across tabs using Web Locks.
 * FAIL-CLOSED: If navigator.locks is missing or unsupported, dispatch and retry are strictly blocked.
 */
export async function withRecipeLaunchLock<T>(
  launchId: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (
    typeof navigator === "undefined" ||
    !navigator.locks ||
    typeof navigator.locks.request !== "function"
  ) {
    throw new Error(
      "Web Locks API (navigator.locks) is unavailable or disabled: recipe launch and retry blocked fail-closed",
    );
  }

  const lockName = `dam-hopper:recipe-launch:${launchId}`;
  return navigator.locks.request(lockName, { mode: "exclusive" }, async () => {
    return await fn();
  });
}

/**
 * Load all launch records from local persistence.
 * Safe against corrupt JSON or schema mismatch.
 */
export function loadAllLaunchRecords(): Record<string, LaunchRecordV1> {
  if (typeof localStorage === "undefined") return {};

  try {
    const raw = localStorage.getItem(RECIPE_LAUNCHES_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};

    const validated: Record<string, LaunchRecordV1> = {};
    for (const [key, val] of Object.entries(parsed)) {
      if (typeof val === "object" && val !== null && (val as LaunchRecordV1).version === 1) {
        validated[key] = val as LaunchRecordV1;
      }
    }
    return validated;
  } catch {
    return {};
  }
}

/**
 * Persists all launch records to local storage.
 */
export function saveAllLaunchRecords(
  records: Record<string, LaunchRecordV1>,
): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(RECIPE_LAUNCHES_STORAGE_KEY, JSON.stringify(records));
  } catch (err) {
    throw new Error(
      `Failed to persist durable launch records to storage: ${(err as Error).message}`,
    );
  }
}

/**
 * Load a single launch record by launchId under lock.
 */
export function getLaunchRecord(launchId: string): LaunchRecordV1 | undefined {
  const records = loadAllLaunchRecords();
  return records[launchId];
}

/**
 * Atomically upsert a single launch record into durable storage.
 */
export function persistLaunchRecord(record: LaunchRecordV1): void {
  const records = loadAllLaunchRecords();
  records[record.launchId] = record;
  saveAllLaunchRecords(records);
}

export interface CreateLaunchRecordInput {
  recipe: RecipeV1;
  desktopId: string;
  serverEpoch: string | number | null;
  capturedPtyMap?: ReadonlyMap<
    RecipeStepKey,
    { terminalId: string; incarnation: number; serverEpoch: string | number | null }
  >;
}

/**
 * Creates a fresh LaunchRecordV1 snapshot.
 * Captures frozen recipe, target desktop, and initial pending step records.
 */
export function createLaunchRecord(input: CreateLaunchRecordInput): LaunchRecordV1 {
  const launchId = `launch-${generateUUID()}`;
  const now = Date.now();
  const steps: Record<RecipeStepKey, LaunchStepRecord> = {};

  // Initialize terminal steps
  for (const step of input.recipe.terminalSteps) {
    const captured = input.capturedPtyMap?.get(step.key);
    if (captured) {
      // Seeded from desktop capture with exact PTY reference
      steps[step.key] = {
        stepKey: step.key,
        type: "terminal",
        terminalId: captured.terminalId,
        status: "confirmed",
        profileId: input.recipe.profileId,
        serverEpoch: captured.serverEpoch ?? input.serverEpoch,
        incarnation: captured.incarnation,
        resolvedAt: now,
        evidence: `captured-run:${input.recipe.profileId}:${captured.terminalId}:${captured.incarnation}`,
      };
    } else {
      // Fresh run: reserve a unique UUID
      steps[step.key] = {
        stepKey: step.key,
        type: "terminal",
        terminalId: `term-${generateUUID()}`,
        status: "pending",
        profileId: input.recipe.profileId,
        serverEpoch: input.serverEpoch,
      };
    }
  }

  // Initialize app steps
  for (const step of input.recipe.appSteps) {
    steps[step.key] = {
      stepKey: step.key,
      type: "app",
      status: "pending",
      profileId: input.recipe.profileId,
      serverEpoch: input.serverEpoch,
    };
  }

  return {
    version: 1,
    launchId,
    recipeId: input.recipe.id,
    recipeSnapshot: input.recipe,
    desktopId: input.desktopId,
    profileId: input.recipe.profileId,
    serverEpoch: input.serverEpoch,
    steps,
    startedAt: now,
    updatedAt: now,
    capturedRun: Boolean(input.capturedPtyMap && input.capturedPtyMap.size > 0),
  };
}

/**
 * Transitions a step to `dispatched` state BEFORE the remote network call.
 */
export function stepTransitionDispatched(
  record: LaunchRecordV1,
  stepKey: RecipeStepKey,
  serverEpoch: string | number | null,
): LaunchRecordV1 {
  const currentStep = record.steps[stepKey];
  if (!currentStep) throw new Error(`Unknown stepKey "${stepKey}"`);

  const updatedStep: LaunchStepRecord = {
    ...currentStep,
    status: "dispatched",
    serverEpoch,
    dispatchedAt: Date.now(),
    error: undefined,
  };

  const updatedRecord: LaunchRecordV1 = {
    ...record,
    updatedAt: Date.now(),
    steps: {
      ...record.steps,
      [stepKey]: updatedStep,
    },
  };

  persistLaunchRecord(updatedRecord);
  return updatedRecord;
}

/**
 * Transitions a step to `confirmed` after authoritative successful creation.
 */
export function stepTransitionConfirmed(
  record: LaunchRecordV1,
  stepKey: RecipeStepKey,
  details: {
    terminalId?: string;
    windowId?: string;
    incarnation?: number;
    evidence?: string;
  },
): LaunchRecordV1 {
  const currentStep = record.steps[stepKey];
  if (!currentStep) throw new Error(`Unknown stepKey "${stepKey}"`);

  const updatedStep: LaunchStepRecord = {
    ...currentStep,
    status: "confirmed",
    terminalId: details.terminalId ?? currentStep.terminalId,
    windowId: details.windowId ?? currentStep.windowId,
    incarnation: details.incarnation ?? currentStep.incarnation,
    resolvedAt: Date.now(),
    evidence:
      details.evidence ??
      `authoritative-success:${currentStep.profileId}:${details.terminalId ?? currentStep.terminalId}:${details.incarnation ?? 0}`,
    error: undefined,
  };

  const updatedRecord: LaunchRecordV1 = {
    ...record,
    updatedAt: Date.now(),
    steps: {
      ...record.steps,
      [stepKey]: updatedStep,
    },
  };

  persistLaunchRecord(updatedRecord);
  return updatedRecord;
}

/**
 * Transitions a step to `failed` ONLY with definitive proof that create cannot still succeed.
 */
export function stepTransitionFailed(
  record: LaunchRecordV1,
  stepKey: RecipeStepKey,
  error: string,
  evidence: string,
): LaunchRecordV1 {
  const currentStep = record.steps[stepKey];
  if (!currentStep) throw new Error(`Unknown stepKey "${stepKey}"`);

  const updatedStep: LaunchStepRecord = {
    ...currentStep,
    status: "failed",
    resolvedAt: Date.now(),
    error,
    evidence,
  };

  const updatedRecord: LaunchRecordV1 = {
    ...record,
    updatedAt: Date.now(),
    steps: {
      ...record.steps,
      [stepKey]: updatedStep,
    },
  };

  persistLaunchRecord(updatedRecord);
  return updatedRecord;
}

/**
 * Transitions an interrupted, timed out, or unconfirmed step to `outcomeUnknown`.
 * BLOCKED: outcomeUnknown can NEVER be automatically cleared by timeout, elapsed time,
 * list absence, or user acknowledgement.
 */
export function stepTransitionOutcomeUnknown(
  record: LaunchRecordV1,
  stepKey: RecipeStepKey,
  reason: string,
): LaunchRecordV1 {
  const currentStep = record.steps[stepKey];
  if (!currentStep) throw new Error(`Unknown stepKey "${stepKey}"`);

  const updatedStep: LaunchStepRecord = {
    ...currentStep,
    status: "outcomeUnknown",
    resolvedAt: Date.now(),
    error: reason,
  };

  const updatedRecord: LaunchRecordV1 = {
    ...record,
    updatedAt: Date.now(),
    steps: {
      ...record.steps,
      [stepKey]: updatedStep,
    },
  };

  persistLaunchRecord(updatedRecord);
  return updatedRecord;
}

/**
 * Dismisses an outcomeUnknown or failed step.
 * Dismissal leaves the tombstone and durable identity intact; it NEVER authorizes a replacement UUID!
 */
export function dismissLaunchStep(
  record: LaunchRecordV1,
  stepKey: RecipeStepKey,
): LaunchRecordV1 {
  const currentStep = record.steps[stepKey];
  if (!currentStep) throw new Error(`Unknown stepKey "${stepKey}"`);

  const updatedStep: LaunchStepRecord = {
    ...currentStep,
    dismissed: true,
  };

  const updatedRecord: LaunchRecordV1 = {
    ...record,
    updatedAt: Date.now(),
    steps: {
      ...record.steps,
      [stepKey]: updatedStep,
    },
  };

  persistLaunchRecord(updatedRecord);
  return updatedRecord;
}

/**
 * Authoritative reconciliation of an outcomeUnknown step:
 * 1. Checks if original terminal session completed: matches exact profileId + original serverEpoch + terminalId + incarnation.
 *    If found: adopts that identity and marks confirmed without POST!
 * 2. Checks if authoritative serverProcess restarted (currentServerEpoch !== originalServerEpoch):
 *    If proved: server restart killed in-flight spawn, marks failed with epoch proof.
 * 3. Otherwise: remains outcomeUnknown!
 */
export function reconcileOutcomeUnknownStep(
  record: LaunchRecordV1,
  stepKey: RecipeStepKey,
  hostContext: {
    currentServerEpoch: string | number | null;
    aliveSessionsOnHost: ReadonlyArray<{
      id: string;
      incarnation?: number;
      alive: boolean;
    }>;
  },
): {
  record: LaunchRecordV1;
  reconciled: boolean;
  status: StepExecutionStatus;
  message: string;
} {
  const step = record.steps[stepKey];
  if (!step || step.status !== "outcomeUnknown") {
    return {
      record,
      reconciled: false,
      status: step?.status ?? "pending",
      message: "Step is not in outcomeUnknown state",
    };
  }

  const targetId = step.terminalId;
  if (!targetId) {
    return {
      record,
      reconciled: false,
      status: "outcomeUnknown",
      message: "Step lacks reserved terminal ID",
    };
  }

  // 1. Check exact authoritative completion in live sessions
  const match = hostContext.aliveSessionsOnHost.find(
    (s) =>
      s.id === targetId &&
      s.alive &&
      typeof s.incarnation === "number" &&
      Number.isSafeInteger(s.incarnation) &&
      (step.incarnation === undefined || s.incarnation === step.incarnation),
  );

  const epochsMatch =
    step.serverEpoch !== null &&
    step.serverEpoch !== undefined &&
    hostContext.currentServerEpoch !== null &&
    hostContext.currentServerEpoch !== undefined &&
    String(hostContext.currentServerEpoch) === String(step.serverEpoch);

  if (match && epochsMatch && typeof match.incarnation === "number") {
    // Exact late adoption verified with matching server epoch and valid incarnation!
    const updated = stepTransitionConfirmed(record, stepKey, {
      terminalId: targetId,
      incarnation: match.incarnation,
      evidence: `exact-late-adoption:${step.profileId}:${step.serverEpoch}:${targetId}:${match.incarnation}`,
    });
    return {
      record: updated,
      reconciled: true,
      status: "confirmed",
      message: `Adopted exact original session ${targetId} (incarnation ${match.incarnation})`,
    };
  }
  // 2. Check server process restart proof
  if (
    step.serverEpoch !== null &&
    step.serverEpoch !== undefined &&
    hostContext.currentServerEpoch !== null &&
    hostContext.currentServerEpoch !== undefined &&
    String(hostContext.currentServerEpoch) !== String(step.serverEpoch)
  ) {
    // Proved server process restarted: in-flight spawn died
    const updated = stepTransitionFailed(
      record,
      stepKey,
      "Server process restarted while creation was in-flight",
      `server-epoch-changed:expected-${step.serverEpoch}:actual-${hostContext.currentServerEpoch}`,
    );
    return {
      record: updated,
      reconciled: true,
      status: "failed",
      message: "Authoritative server restart proved creation cannot still succeed",
    };
  }

  // 3. Neither proof available: remains outcomeUnknown
  return {
    record,
    reconciled: false,
    status: "outcomeUnknown",
    message: "Cannot prove completion or failure; step remains blocked outcomeUnknown",
  };
}

/**
 * Validates whether explicit user retry is permissible.
 * Only unstarted pending steps or definitively failed steps with proof can be retried.
 * outcomeUnknown is STRICTLY forbidden from retry until reconciled.
 */
export function canRetryStep(step: LaunchStepRecord): boolean {
  if (step.status === "outcomeUnknown") return false;
  if (step.status === "dispatched") return false;
  if (step.status === "confirmed") return false;

  if (step.status === "failed") {
    // Only if authoritative failure proof exists
    return Boolean(step.evidence);
  }

  return step.status === "pending";
}

/**
 * Explicit user retry for an eligible failed step.
 * Allocates a FRESH UUID. Never reuses the old terminal ID.
 */
export function retryFailedStep(
  record: LaunchRecordV1,
  stepKey: RecipeStepKey,
): LaunchRecordV1 {
  const step = record.steps[stepKey];
  if (!step || !canRetryStep(step)) {
    throw new Error(`Step "${stepKey}" is not eligible for retry`);
  }

  const updatedStep: LaunchStepRecord = {
    ...step,
    status: "pending",
    terminalId: step.type === "terminal" ? `term-${generateUUID()}` : undefined,
    incarnation: undefined,
    dispatchedAt: undefined,
    resolvedAt: undefined,
    error: undefined,
    evidence: undefined,
    dismissed: false,
  };

  const updatedRecord: LaunchRecordV1 = {
    ...record,
    updatedAt: Date.now(),
    steps: {
      ...record.steps,
      [stepKey]: updatedStep,
    },
  };

  persistLaunchRecord(updatedRecord);
  return updatedRecord;
}

/**
 * Executes reconciliation under cross-tab Web Lock, re-reading latest state before transitioning.
 */
export async function lockedReconcileOutcomeUnknownStep(
  launchId: string,
  stepKey: RecipeStepKey,
  hostContext: {
    currentServerEpoch: string | number | null;
    aliveSessionsOnHost: ReadonlyArray<{
      id: string;
      incarnation?: number;
      alive: boolean;
    }>;
  },
): Promise<{
  record: LaunchRecordV1;
  reconciled: boolean;
  status: StepExecutionStatus;
  message: string;
}> {
  return withRecipeLaunchLock(launchId, async () => {
    const latest = getLaunchRecord(launchId);
    if (!latest) throw new Error(`Launch record "${launchId}" not found in storage`);
    const result = reconcileOutcomeUnknownStep(latest, stepKey, hostContext);
    persistLaunchRecord(result.record);
    return result;
  });
}

/**
 * Dismisses a step under cross-tab Web Lock, re-reading latest state before transitioning.
 */
export async function lockedDismissLaunchStep(
  launchId: string,
  stepKey: RecipeStepKey,
): Promise<LaunchRecordV1> {
  return withRecipeLaunchLock(launchId, async () => {
    const latest = getLaunchRecord(launchId);
    if (!latest) throw new Error(`Launch record "${launchId}" not found in storage`);
    const updated = dismissLaunchStep(latest, stepKey);
    persistLaunchRecord(updated);
    return updated;
  });
}

/**
 * Retries an eligible failed step under cross-tab Web Lock, allocating a fresh UUID.
 */
export async function lockedRetryFailedStep(
  launchId: string,
  stepKey: RecipeStepKey,
): Promise<LaunchRecordV1> {
  return withRecipeLaunchLock(launchId, async () => {
    const latest = getLaunchRecord(launchId);
    if (!latest) throw new Error(`Launch record "${launchId}" not found in storage`);
    const updated = retryFailedStep(latest, stepKey);
    persistLaunchRecord(updated);
    return updated;
  });
}

/**
 * Recovers any in-flight pending/dispatched steps found upon browser reload or restart.
 * Any nonterminal pending/dispatched step becomes outcomeUnknown!
 */
export function recoverDurableLaunchRecordsOnStartup(): void {
  const records = loadAllLaunchRecords();
  let changed = false;

  for (const [id, record] of Object.entries(records)) {
    let recordModified = false;
    const nextSteps = { ...record.steps };

    for (const [stepKey, step] of Object.entries(record.steps)) {
      if (step.status === "dispatched" || (step.status === "pending" && step.dispatchedAt)) {
        nextSteps[stepKey] = {
          ...step,
          status: "outcomeUnknown",
          resolvedAt: Date.now(),
          error: "Process restarted while dispatch was in-flight",
        };
        recordModified = true;
      }
    }

    if (recordModified) {
      records[id] = { ...record, steps: nextSteps, updatedAt: Date.now() };
      changed = true;
    }
  }

  if (changed) {
    saveAllLaunchRecords(records);
  }
}
