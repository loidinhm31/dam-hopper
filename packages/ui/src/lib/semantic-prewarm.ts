import {
  PREWARM_DWELL_MS,
  type PrewarmEligibility,
  type PrewarmIntent,
} from "@dam-hopper/shared";

export interface PrewarmTransport {
  prewarm(intent: PrewarmIntent): boolean;
}

/** Pure active-tab dwell gate. It never scans, reads files, or starts a process. */
export class SemanticPrewarmController {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private key: string | null = null;
  private readonly emittedKeys = new Set<string>();

  constructor(private readonly transport: PrewarmTransport) {}

  schedule(intent: PrewarmIntent, eligibility: PrewarmEligibility): void {
    this.cancel();
    if (!eligibility.supported || !eligibility.hydrated || !eligibility.active)
      return;
    const key = prewarmKey(intent);
    this.key = key;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.key !== key || this.emittedKeys.has(key)) return;
      if (this.transport.prewarm(intent)) this.emittedKeys.add(key);
    }, PREWARM_DWELL_MS);
  }

  navigate(intent: PrewarmIntent): void {
    this.cancel();
    const key = prewarmKey(intent);
    if (this.emittedKeys.has(key)) return;
    if (this.transport.prewarm(intent)) this.emittedKeys.add(key);
  }

  cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.key = null;
  }

  reset(): void {
    this.cancel();
    this.emittedKeys.clear();
  }
}

export function prewarmKey(intent: PrewarmIntent): string {
  return JSON.stringify([
    intent.profileId,
    intent.workspaceId,
    intent.workspaceGeneration,
    intent.projectId,
    intent.language,
    intent.tabGeneration,
  ]);
}
