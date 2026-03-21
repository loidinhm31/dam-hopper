import React, { useEffect, useState } from "react";
import { Box, Text, useApp } from "ink";
import Spinner from "ink-spinner";
import type { GitProgressEmitter, GitProgressEvent } from "@dev-hub/core";

export type ProjectProgressState = {
  name: string;
  phase: GitProgressEvent["phase"] | "pending";
  message: string;
  percent?: number;
};

interface Props {
  projects: string[];
  emitter: GitProgressEmitter;
  done: Promise<unknown>;
  label: string;
}

function PhaseIcon({ phase }: { phase: ProjectProgressState["phase"] }) {
  switch (phase) {
    case "completed": return <Text color="green">✓</Text>;
    case "failed": return <Text color="red">✗</Text>;
    case "started":
    case "progress": return <Text color="cyan"><Spinner type="dots" /></Text>;
    default: return <Text color="gray">·</Text>;
  }
}

export function ProgressList({ projects, emitter, done, label }: Props) {
  const { exit } = useApp();
  const [states, setStates] = useState<Map<string, ProjectProgressState>>(
    () => new Map(projects.map((name) => [name, { name, phase: "pending", message: "" }])),
  );
  const [summary, setSummary] = useState<string>("");

  useEffect(() => {
    const handler = (event: GitProgressEvent) => {
      setStates((prev) => {
        const next = new Map(prev);
        next.set(event.projectName, {
          name: event.projectName,
          phase: event.phase,
          message: event.message,
          percent: event.percent,
        });
        return next;
      });
    };
    emitter.on("progress", handler);
    return () => { emitter.off("progress", handler); };
  }, [emitter]);

  useEffect(() => {
    done.then((results) => {
      const arr = results as Array<{ success: boolean }>;
      const succeeded = arr.filter((r) => r.success).length;
      setSummary(`${label}: ${succeeded}/${projects.length} succeeded`);
      setTimeout(() => exit(), 100);
    });
  }, [done]);

  const list = Array.from(states.values());

  return (
    <Box flexDirection="column">
      {list.map((s) => (
        <Box key={s.name} gap={1}>
          <PhaseIcon phase={s.phase} />
          <Text>{s.name.padEnd(20)}</Text>
          <Text dimColor>{s.message}</Text>
          {s.percent !== undefined && s.phase === "progress" && (
            <Text dimColor> ({s.percent}%)</Text>
          )}
        </Box>
      ))}
      {summary && (
        <Box marginTop={1}>
          <Text bold>{summary}</Text>
        </Box>
      )}
    </Box>
  );
}
