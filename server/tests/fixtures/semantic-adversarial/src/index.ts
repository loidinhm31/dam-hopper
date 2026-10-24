export interface HostileWorkspaceContract {
  computeSafeValue(seed: number): number;
}

export class VerifiedSafeEngine implements HostileWorkspaceContract {
  computeSafeValue(seed: number): number {
    return seed + 42;
  }
}

export function runSafeNavigation(input: number): number {
  const engine: HostileWorkspaceContract = new VerifiedSafeEngine();
  return engine.computeSafeValue(input);
}
