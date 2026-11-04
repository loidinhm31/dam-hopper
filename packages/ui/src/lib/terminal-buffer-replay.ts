import {
  type TerminalStreamReplayGate,
  beginTerminalReplayWrite,
  finishTerminalReplayWrite,
  notifyTerminalReplayDrain,
} from "./terminal-stream-replay-gate.js";
import { recordClientDiagnostic } from "@/lib/diagnostics-client.js";
import {
  proveNumericEvidenceJoin,
  type TerminalTarget,
} from "@/api/terminal-session-contract.js";

export interface TerminalBufferReplay {
  data: string;
  offset: number;
  reset: boolean;
  truncated: boolean;
  incarnation: number;
}

export interface TerminalReplayTarget {
  reset(): void;
  write(data: string, callback?: () => void): void;
}
export function isTerminalBufferReplayEligible(
  replay: Pick<TerminalBufferReplay, "incarnation">,
  target?: TerminalTarget | null,
): boolean {
  if (!target) return true;
  return proveNumericEvidenceJoin(replay.incarnation, target.incarnation);
}

export function applyTerminalBufferReplay(
  term: TerminalReplayTarget,
  replay: TerminalBufferReplay,
  onComplete?: () => void,
  gate?: TerminalStreamReplayGate,
  instanceToken?: string,
  target?: TerminalTarget | null,
): number {
  if (target && !isTerminalBufferReplayEligible(replay, target)) {
    recordClientDiagnostic(
      "transport",
      "terminal-buffer-replay",
      "buffer_replay_refused_mismatch",
      {
        expectedIncarnation: target.incarnation,
        receivedIncarnation: replay.incarnation,
        instanceToken,
      },
    );
    return -1;
  }
  if (gate) {
    beginTerminalReplayWrite(gate);
  }

  const finish = () => {
    if (gate) {
      finishTerminalReplayWrite(gate);
    }
    try {
      onComplete?.();
    } finally {
      if (gate) {
        notifyTerminalReplayDrain(gate);
      }
    }
  };

  if (replay.reset) {
    recordClientDiagnostic(
      "transport",
      "terminal-buffer-replay",
      "buffer_reset",
      {
        offset: replay.offset,
        truncated: replay.truncated,
        instanceToken,
        sessionId: target?.terminalId,
      },
    );
    term.write("", () => {
      term.reset();
      term.write(replay.data, finish);
    });
  } else {
    term.write(replay.data, finish);
  }
  return replay.offset;
}
