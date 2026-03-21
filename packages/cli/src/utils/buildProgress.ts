import {
  createProgressEmitter,
  type BuildProgressEvent,
  type GitProgressEmitter,
} from "@dev-hub/core";
import type EventEmitter from "eventemitter3";
import { formatDuration } from "./format.js";

/**
 * Creates a GitProgressEmitter and wires it to the given BuildService emitter.
 * Label function maps (projectName, serviceName) → display key for ProgressList.
 */
export function bridgeBuildToGitEmitter(
  buildEmitter: EventEmitter<{ progress: [BuildProgressEvent] }>,
  makeLabel: (projectName: string, serviceName: string | undefined) => string,
): GitProgressEmitter {
  const gitEmitter = createProgressEmitter();

  buildEmitter.on("progress", (event) => {
    const label = makeLabel(event.projectName, event.serviceName);
    if (event.phase === "started") {
      gitEmitter.emit("progress", {
        projectName: label,
        operation: "build",
        phase: "started",
        message: "Building...",
      });
    } else if (event.phase === "completed") {
      const dur = event.result ? formatDuration(event.result.durationMs) : "";
      gitEmitter.emit("progress", {
        projectName: label,
        operation: "build",
        phase: "completed",
        message: `Done (${dur})`,
      });
    } else if (event.phase === "failed") {
      gitEmitter.emit("progress", {
        projectName: label,
        operation: "build",
        phase: "failed",
        message: event.result?.error ?? "failed",
      });
    }
  });

  return gitEmitter;
}

export function serviceLabel(
  projectName: string,
  serviceName: string | undefined,
): string {
  return serviceName && serviceName !== "default"
    ? `${projectName} > ${serviceName}`
    : projectName;
}
