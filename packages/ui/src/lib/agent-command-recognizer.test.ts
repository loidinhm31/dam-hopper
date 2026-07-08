import { describe, expect, it } from "vitest";
import type { AgentCommandPattern } from "@/api/client.js";
import {
  extractExecutableToken,
  recognizeAgentCommand,
} from "./agent-command-recognizer.js";

const patterns: AgentCommandPattern[] = [
  {
    id: "codex",
    label: "Codex",
    kind: "literal",
    pattern: "codex",
    agent: "codex",
    enabled: true,
  },
  {
    id: "codexnsb",
    label: "Codex NSB",
    kind: "regex",
    pattern: "^CODEXNSB$",
    agent: "codex",
    enabled: true,
  },
];

describe("extractExecutableToken", () => {
  it("skips env and leading assignments", () => {
    expect(extractExecutableToken("env NODE_ENV=test FOO=bar codex --ask")).toBe(
      "codex",
    );
  });

  it("handles quoted executable tokens without matching substrings", () => {
    expect(extractExecutableToken("'CODEXNSB' --flag")).toBe("CODEXNSB");
    expect(extractExecutableToken("prefix-codex --flag")).toBe("prefix-codex");
  });
});

describe("recognizeAgentCommand", () => {
  it("matches literal patterns against the executable token only", () => {
    expect(recognizeAgentCommand("codex --danger", patterns)).toMatchObject({
      agent: "codex",
      label: "Codex",
      patternId: "codex",
      executable: "codex",
    });
    expect(recognizeAgentCommand("npm run codex", patterns)).toBeNull();
  });

  it("matches user alias regex patterns case-sensitively", () => {
    expect(recognizeAgentCommand("CODEXNSB", patterns)).toMatchObject({
      label: "Codex NSB",
      executable: "CODEXNSB",
    });
    expect(recognizeAgentCommand("codexnsb", patterns)).toBeNull();
  });

  it("ignores disabled and invalid regex patterns", () => {
    expect(
      recognizeAgentCommand("codex", [
        { ...patterns[0]!, enabled: false },
        {
          id: "bad",
          label: "Bad",
          kind: "regex",
          pattern: "[",
          agent: "unknown",
          enabled: true,
        },
      ]),
    ).toBeNull();
  });
});
