import React from "react";
import { Box, Text } from "ink";
import type { ProcessLogEntry } from "@dev-hub/core";

interface Props {
  logs: ProcessLogEntry[];
  projectName: string;
}

export function LogViewer({ logs, projectName }: Props) {
  if (logs.length === 0) {
    return <Text dimColor>No logs for {projectName}.</Text>;
  }

  return (
    <Box flexDirection="column">
      <Text bold dimColor>── {projectName} logs ──</Text>
      {logs.map((entry, i) => {
        const ts = entry.timestamp.toISOString().slice(11, 23);
        return (
          <Box key={i} gap={1}>
            <Text dimColor>{ts}</Text>
            <Text color={entry.stream === "stderr" ? "yellow" : undefined}>{entry.line}</Text>
          </Box>
        );
      })}
    </Box>
  );
}
