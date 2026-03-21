import React, { useEffect, useState } from "react";
import { Box, Text, useApp } from "ink";
import Spinner from "ink-spinner";
import type { BuildProgressEvent } from "@dev-hub/core";
import type EventEmitter from "eventemitter3";
import { formatDuration } from "../utils/format.js";

const MAX_LINES = 30;

interface Props {
  projectName: string;
  command: string;
  emitter: EventEmitter<{ progress: [BuildProgressEvent] }>;
  done: Promise<unknown>;
}

export function BuildOutput({ projectName, command, emitter, done }: Props) {
  const { exit } = useApp();
  const [lines, setLines] = useState<Array<{ text: string; stream: "stdout" | "stderr" }>>([]);
  const [phase, setPhase] = useState<BuildProgressEvent["phase"]>("started");
  const [elapsed, setElapsed] = useState(0);
  const [startTime] = useState(Date.now());

  useEffect(() => {
    if (phase === "completed" || phase === "failed") return;
    const timer = setInterval(() => setElapsed(Date.now() - startTime), 200);
    return () => clearInterval(timer);
  }, [startTime, phase]);

  useEffect(() => {
    const handler = (event: BuildProgressEvent) => {
      if (event.projectName !== projectName) return;
      setPhase(event.phase);
      if (event.phase === "output" && event.line !== undefined) {
        setLines((prev) => {
          const next = [...prev, { text: event.line!, stream: event.stream ?? "stdout" }];
          return next.slice(-MAX_LINES);
        });
      }
    };
    emitter.on("progress", handler);
    return () => { emitter.off("progress", handler); };
  }, [emitter, projectName]);

  useEffect(() => {
    done.then(() => setTimeout(() => exit(), 100));
  }, [done]);

  const statusIcon =
    phase === "completed" ? <Text color="green">✓</Text> :
    phase === "failed" ? <Text color="red">✗</Text> :
    <Text color="cyan"><Spinner type="dots" /></Text>;

  return (
    <Box flexDirection="column">
      <Box gap={1}>
        {statusIcon}
        <Text bold>{projectName}</Text>
        <Text dimColor>{command}</Text>
        <Text dimColor>[{formatDuration(elapsed)}]</Text>
      </Box>
      <Box flexDirection="column" marginLeft={2}>
        {lines.map((l, i) => (
          <Text key={i} color={l.stream === "stderr" ? "yellow" : undefined}>
            {l.text}
          </Text>
        ))}
      </Box>
      {(phase === "completed" || phase === "failed") && (
        <Box marginTop={1}>
          <Text color={phase === "completed" ? "green" : "red"} bold>
            {phase === "completed" ? "Build succeeded" : "Build failed"} in {formatDuration(elapsed)}
          </Text>
        </Box>
      )}
    </Box>
  );
}
