// --- Build ---

export interface BuildResult {
  projectName: string;
  serviceName?: string;
  command: string;
  success: boolean;
  exitCode: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  error?: string;
}

export interface BuildProgressEvent {
  projectName: string;
  serviceName?: string;
  phase: "started" | "output" | "completed" | "failed";
  stream?: "stdout" | "stderr";
  line?: string; // single line of output
  result?: BuildResult;
}

// --- Run ---

export interface RunningProcess {
  projectName: string;
  serviceName?: string;
  command: string;
  pid: number;
  startedAt: Date;
  status: "running" | "stopped" | "crashed";
  exitCode?: number;
  restartCount: number;
}

export interface ProcessLogEntry {
  timestamp: Date;
  stream: "stdout" | "stderr";
  line: string;
}

export interface RunProgressEvent {
  projectName: string;
  serviceName?: string;
  phase: "started" | "output" | "stopped" | "crashed" | "restarted";
  stream?: "stdout" | "stderr";
  line?: string;
  process?: RunningProcess;
}
