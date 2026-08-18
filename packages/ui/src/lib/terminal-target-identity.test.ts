import { describe, expect, it } from "vitest";
import {
  targetScopedCommandSessionId,
  terminalProfileSessionId,
  terminalProfileSessionPrefix,
  terminalTargetDiscriminator,
} from "./terminal-target-identity.js";

describe("terminal target identity", () => {
  it("keeps root command IDs backward compatible", () => {
    expect(targetScopedCommandSessionId("build", "demo")).toBe("build:demo");
    expect(
      targetScopedCommandSessionId("custom", "demo", undefined, "check"),
    ).toBe("custom:demo:check");
  });

  it("uses a stable opaque discriminator for each worktree", () => {
    const first = terminalTargetDiscriminator("demo", "/worktrees/feature");
    expect(first).toMatch(/^wt-[a-z0-9]+$/);
    expect(first.length).toBeGreaterThan("wt-0000000".length);
    expect(first).toBe(
      terminalTargetDiscriminator("demo", "/worktrees/feature"),
    );
    expect(first).not.toBe(
      terminalTargetDiscriminator("demo", "/worktrees/other"),
    );
  });

  it("separates command and profile replacement keys by target", () => {
    const worktree = "/worktrees/feature";
    const commandId = targetScopedCommandSessionId("run", "demo", worktree);
    const profilePrefix = terminalProfileSessionPrefix(
      "demo",
      "api_server",
      worktree,
    );
    expect(commandId).not.toContain(worktree);
    expect(commandId).not.toBe("run:demo");
    expect(profilePrefix).toMatch(/^terminal:demo:api_server:wt-[a-z0-9]+:$/);
    expect(terminalProfileSessionId("demo", "api_server", worktree, 42)).toBe(
      `${profilePrefix}42`,
    );
  });

  it("does not collide between UNC and POSIX target namespaces", () => {
    expect(
      terminalTargetDiscriminator("demo", String.raw`\\server\share\feature`),
    ).not.toBe(terminalTargetDiscriminator("demo", "/server/share/feature"));
    expect(
      terminalTargetDiscriminator("demo", String.raw`C:\Worktrees\Feature`),
    ).toBe(terminalTargetDiscriminator("demo", "c:/worktrees/feature"));
  });
});
