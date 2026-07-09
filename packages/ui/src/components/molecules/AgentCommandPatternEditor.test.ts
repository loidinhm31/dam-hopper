import { describe, expect, it } from "vitest";
import {
  createCustomTerminalAgentCommandPattern,
  normalizeAgentCommandPatterns,
  validateTerminalAgentCommandPatternCount,
  validateTerminalAgentCommandPattern,
} from "@/lib/terminal-agent-notification-settings.js";

describe("AgentCommandPatternEditor helpers", () => {
  it("creates enabled literal codex drafts", () => {
    expect(createCustomTerminalAgentCommandPattern()).toMatchObject({
      label: "Custom agent",
      kind: "literal",
      pattern: "",
      agent: "codex",
      enabled: true,
    });
  });

  it("validates blank labels and length bounds", () => {
    expect(
      validateTerminalAgentCommandPattern({
        id: "custom",
        label: "",
        kind: "literal",
        pattern: "codex",
        agent: "codex",
        enabled: true,
      }),
    ).toBe("Label is required.");

    expect(
      validateTerminalAgentCommandPattern({
        id: "custom",
        label: "x".repeat(65),
        kind: "literal",
        pattern: "codex",
        agent: "codex",
        enabled: true,
      }),
    ).toBe("Label must be 64 characters or fewer.");

    expect(
      validateTerminalAgentCommandPattern({
        id: "custom",
        label: "Codex NSB",
        kind: "literal",
        pattern: "x".repeat(129),
        agent: "codex",
        enabled: true,
      }),
    ).toBe("Pattern must be 128 characters or fewer.");
  });

  it("enforces the same lightweight pattern-count limit as the server", () => {
    expect(
      validateTerminalAgentCommandPatternCount(
        Array.from({ length: 33 }, (_, index) => ({
          id: `pattern-${index}`,
          label: `Pattern ${index}`,
          kind: "literal" as const,
          pattern: `agent-${index}`,
          agent: "codex" as const,
          enabled: true,
        })),
      ),
    ).toBe("No more than 32 command patterns are allowed.");
  });

  it("normalizes blank or duplicate ids into unique valid ids", () => {
    const normalized = normalizeAgentCommandPatterns([
      {
        id: "",
        label: "Codex",
        kind: "literal",
        pattern: "codex",
        agent: "codex",
        enabled: true,
      },
      {
        id: "codex",
        label: "Codex Alias",
        kind: "literal",
        pattern: "codexnsb",
        agent: "codex",
        enabled: true,
      },
      {
        id: "codex",
        label: "Codex Alias Two",
        kind: "literal",
        pattern: "codexnsb2",
        agent: "codex",
        enabled: true,
      },
    ]);

    expect(normalized.map((pattern) => pattern.id)).toEqual([
      "codex",
      "codex-alias",
      "codex-alias-two",
    ]);
  });
});
