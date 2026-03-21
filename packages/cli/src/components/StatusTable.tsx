import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import type { GitStatus } from "@dev-hub/core";

interface Props {
  statuses: GitStatus[] | null;
}

function statusColor(s: GitStatus): string {
  if (s.modified > 0 || s.staged > 0 || s.untracked > 0) return "yellow";
  if (s.behind > 0) return "red";
  if (s.ahead > 0) return "cyan";
  return "green";
}

function statusLabel(s: GitStatus): string {
  if (!s.isClean) {
    const parts: string[] = [];
    if (s.staged > 0) parts.push(`${s.staged} staged`);
    if (s.modified > 0) parts.push(`${s.modified} modified`);
    if (s.untracked > 0) parts.push(`${s.untracked} untracked`);
    return parts.join(", ") || "dirty";
  }
  return "clean";
}

const COL_WIDTHS = { name: 20, branch: 20, status: 20, ahead: 6, behind: 6, stash: 5 };

function Header() {
  return (
    <Box>
      <Box width={COL_WIDTHS.name}><Text bold>Project</Text></Box>
      <Box width={COL_WIDTHS.branch}><Text bold>Branch</Text></Box>
      <Box width={COL_WIDTHS.status}><Text bold>Status</Text></Box>
      <Box width={COL_WIDTHS.ahead}><Text bold>↑</Text></Box>
      <Box width={COL_WIDTHS.behind}><Text bold>↓</Text></Box>
      <Box width={COL_WIDTHS.stash}><Text bold>Stash</Text></Box>
    </Box>
  );
}

function Row({ s }: { s: GitStatus }) {
  const col = statusColor(s);
  return (
    <Box>
      <Box width={COL_WIDTHS.name}>
        <Text>{s.projectName.slice(0, COL_WIDTHS.name - 1)}</Text>
      </Box>
      <Box width={COL_WIDTHS.branch}>
        <Text color="cyan">{s.branch.slice(0, COL_WIDTHS.branch - 1)}</Text>
      </Box>
      <Box width={COL_WIDTHS.status}>
        <Text color={col as never}>{statusLabel(s)}</Text>
      </Box>
      <Box width={COL_WIDTHS.ahead}>
        <Text color={s.ahead > 0 ? "cyan" : "gray"}>{s.ahead}</Text>
      </Box>
      <Box width={COL_WIDTHS.behind}>
        <Text color={s.behind > 0 ? "red" : "gray"}>{s.behind}</Text>
      </Box>
      <Box width={COL_WIDTHS.stash}>
        <Text>{s.hasStash ? "yes" : ""}</Text>
      </Box>
    </Box>
  );
}

export function StatusTable({ statuses }: Props) {
  if (statuses === null) {
    return (
      <Box>
        <Text color="cyan"><Spinner type="dots" /></Text>
        <Text> Loading status...</Text>
      </Box>
    );
  }

  if (statuses.length === 0) {
    return <Text color="yellow">No projects configured.</Text>;
  }

  return (
    <Box flexDirection="column">
      <Header />
      <Box>
        <Text dimColor>{"─".repeat(Object.values(COL_WIDTHS).reduce((a, b) => a + b, 0))}</Text>
      </Box>
      {statuses.map((s) => <Row key={s.projectName} s={s} />)}
    </Box>
  );
}

// Self-contained loader for use in the status command
export function StatusLoader({ loader }: { loader: () => Promise<GitStatus[]> }) {
  const [statuses, setStatuses] = useState<GitStatus[] | null>(null);

  useEffect(() => {
    loader().then(setStatuses);
  }, []);

  return <StatusTable statuses={statuses} />;
}
