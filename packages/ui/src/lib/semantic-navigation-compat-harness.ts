import {
  MAX_SEMANTIC_TARGETS,
  PREWARM_DWELL_MS,
  parseSemanticProtocolTargets,
  type PrewarmEligibility,
  type PrewarmIntent,
  type SemanticAvailabilityState,
  type SemanticNavigationTarget,
} from "@dam-hopper/shared";

export type VirtualNavigationResult =
  | { kind: "targets"; targets: SemanticNavigationTarget[]; capped: boolean }
  | { kind: "empty" }
  | { kind: "unavailable"; state: SemanticAvailabilityState };

export function virtualizeNavigationResult(
  state: SemanticAvailabilityState,
  targets: unknown,
): VirtualNavigationResult {
  if (state !== "ready") return { kind: "unavailable", state };
  if (targets === null) return { kind: "empty" };
  if (!Array.isArray(targets)) return { kind: "empty" };
  const cappedTargets = targets.slice(0, MAX_SEMANTIC_TARGETS);
  if (!cappedTargets.length) return { kind: "empty" };
  const parsed = parseSemanticProtocolTargets(cappedTargets);
  return {
    kind: "targets",
    targets: parsed,
    capped: targets.length > MAX_SEMANTIC_TARGETS,
  };
}

export function selectVirtualTarget(
  result: VirtualNavigationResult,
  index: number,
  open: (target: SemanticNavigationTarget) => void,
): void {
  if (result.kind !== "targets") return;
  const target = result.targets[index];
  if (target) open(target);
}

export class PrewarmIntentHarness {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private key: string | null = null;

  schedule(
    intent: PrewarmIntent,
    eligibility: PrewarmEligibility,
    emit: (intent: PrewarmIntent) => void,
  ): void {
    this.cancel();
    if (
      !eligibility.supported ||
      !eligibility.hydrated ||
      !eligibility.active
    ) {
      return;
    }
    const key = prewarmKey(intent);
    this.key = key;
    this.timer = setTimeout(() => {
      if (this.key === key) emit(intent);
      this.timer = null;
    }, PREWARM_DWELL_MS);
  }

  cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.key = null;
  }

  navigate(intent: PrewarmIntent, emit: (intent: PrewarmIntent) => void): void {
    this.cancel();
    emit(intent);
  }
}

function prewarmKey(intent: PrewarmIntent): string {
  return JSON.stringify([
    intent.profileId,
    intent.workspaceId,
    intent.projectId,
    intent.language,
    intent.tabGeneration,
  ]);
}
