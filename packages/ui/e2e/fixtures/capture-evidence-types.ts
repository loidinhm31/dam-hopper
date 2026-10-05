export interface PngDimensions {
  width: number;
  height: number;
}

export interface CaptureOptions {
  caseDir: string;
  checkpointName?: string;
  dockWidth?: number;
}

export interface StagedCheckpoint {
  checkpoint: string;
  fileName: string;
  stagedPath: string;
  destinationPath: string;
  caseDir: string;
  caseName: string;
  sha256: string;
  dimensions: PngDimensions;
  route: string;
  dockWidth?: number;
}

export interface EvidenceSession {
  runId: string;
  command: string;
  startedAt: string;
  startSourceFingerprint: string;
  gitHead: string;
  seedDigest: string;
  stagingDir: string;
  browserVersion?: string;
  checkpoints: StagedCheckpoint[];
}
