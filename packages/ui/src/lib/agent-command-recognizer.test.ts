import { describe, expect, it } from "vitest";
import type { AgentCommandPattern } from "@/api/client.js";
import {
  extractExecutableToken,
  recognizeAgentCommand,
} from "./agent-command-recognizer.js";

const codexAliasRegexPattern: AgentCommandPattern = {
  id: "codexnsb-regex",
  label: "Codex NSB Regex",
  kind: "regex",
  pattern: "^CODEXNSB$",
  agent: "codex",
  enabled: true,
};

const codexPattern: AgentCommandPattern = {
  id: "codex",
  label: "Codex",
  kind: "literal",
  pattern: "codex",
  agent: "codex",
  enabled: true,
};

const codexAliasLiteralPattern: AgentCommandPattern = {
  id: "codexnsb-literal",
  label: "Codex NSB",
  kind: "literal",
  pattern: "CODEXNSB",
  agent: "codex",
  enabled: true,
};

const patterns: AgentCommandPattern[] = [
  codexPattern,
  {
    id: "claude",
    label: "Claude",
    kind: "literal",
    pattern: "claude",
    agent: "claude",
    enabled: true,
  },
  {
    id: "claude-code",
    label: "Claude Code",
    kind: "literal",
    pattern: "claude-code",
    agent: "claude",
    enabled: true,
  },
  {
    id: "antigravity",
    label: "Antigravity",
    kind: "literal",
    pattern: "antigravity",
    agent: "antigravity",
    enabled: true,
  },
  codexAliasLiteralPattern,
  {
    ...codexAliasRegexPattern,
  },
];

describe("extractExecutableToken", () => {
  it("skips env and leading assignments", () => {
    expect(extractExecutableToken("env NODE_ENV=test FOO=bar codex --ask")).toBe(
      "codex",
    );
  });

  it("skips supported env options before resolving the executable", () => {
    expect(extractExecutableToken("env -u FOO codex --ask")).toBe("codex");
    expect(extractExecutableToken("env --unset=FOO codex --ask")).toBe("codex");
    expect(extractExecutableToken("env --chdir /tmp codex --ask")).toBe("codex");
    expect(extractExecutableToken("env --chdir=/tmp codex --ask")).toBe("codex");
  });

  it("extracts executables from env split-string options", () => {
    expect(extractExecutableToken('env -S "codex --ask"')).toBe("codex");
    expect(extractExecutableToken('env --split-string "FOO=1 codex --ask"')).toBe(
      "codex",
    );
  });

  it("handles env boundary cases without over-matching", () => {
    expect(extractExecutableToken("env -- codex --ask")).toBe("codex");
    expect(extractExecutableToken("env -S")).toBeNull();
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
    expect(recognizeAgentCommand("env FOO=1 codex --ask", patterns)).toMatchObject({
      patternId: "codex",
      executable: "codex",
    });
    expect(recognizeAgentCommand("npm run codex", patterns)).toBeNull();
    expect(recognizeAgentCommand("grep codex README.md", patterns)).toBeNull();
  });

  it("matches built-in agent executables", () => {
    expect(recognizeAgentCommand("claude", patterns)).toMatchObject({
      agent: "claude",
      patternId: "claude",
    });
    expect(recognizeAgentCommand("claude-code --resume", patterns)).toMatchObject({
      agent: "claude",
      patternId: "claude-code",
    });
    expect(recognizeAgentCommand("antigravity plan", patterns)).toMatchObject({
      agent: "antigravity",
      patternId: "antigravity",
    });
  });

  it("matches user aliases through literal and regex patterns case-sensitively", () => {
    expect(recognizeAgentCommand("CODEXNSB", patterns)).toMatchObject({
      label: "Codex NSB",
      patternId: "codexnsb-literal",
      executable: "CODEXNSB",
    });
    expect(
      recognizeAgentCommand("CODEXNSB", [codexAliasRegexPattern]),
    ).toMatchObject({
      label: "Codex NSB Regex",
      patternId: "codexnsb-regex",
      executable: "CODEXNSB",
    });
    expect(recognizeAgentCommand("codexnsb", patterns)).toBeNull();
  });

  it("prefers the first matching pattern when literal and regex both match", () => {
    expect(
      recognizeAgentCommand("CODEXNSB", [
        codexAliasLiteralPattern,
        codexAliasRegexPattern,
      ]),
    ).toMatchObject({
      patternId: "codexnsb-literal",
    });
  });

  it("ignores disabled and invalid regex patterns", () => {
    expect(
      recognizeAgentCommand("codex", [
        { ...codexPattern, enabled: false },
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
