import EventEmitter from "eventemitter3";
import type { GitProgressEvent } from "./types.js";

interface GitProgressEvents {
  progress: [event: GitProgressEvent];
}

export class GitProgressEmitter extends EventEmitter<GitProgressEvents> {}

export function createProgressEmitter(): GitProgressEmitter {
  return new GitProgressEmitter();
}

export function emitProgress(
  emitter: GitProgressEmitter | null | undefined,
  projectName: string,
  operation: string,
  phase: GitProgressEvent["phase"],
  message: string,
  percent?: number,
): void {
  emitter?.emit("progress", {
    projectName,
    operation,
    phase,
    message,
    percent,
  });
}
