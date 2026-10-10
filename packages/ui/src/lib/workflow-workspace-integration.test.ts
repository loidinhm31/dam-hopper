import { describe, expect, it } from "vitest";
import {
  deriveWorkflowTerminalCandidates,
  resolveWorkflowTerminalReveal,
  resolveWorkflowTargetSelection,
} from "./workflow-workspace-integration.js";

describe("workflow-workspace-integration", () => {
  describe("deriveWorkflowTerminalCandidates", () => {
    it("returns empty array for empty inputs", () => {
      expect(deriveWorkflowTerminalCandidates(null, null, null)).toEqual([]);
      expect(deriveWorkflowTerminalCandidates(new Map(), [], {})).toEqual([]);
    });

    it("derives candidates from mounted sessions and sessionMap", () => {
      const mounted = [
        { sessionId: "term-1", project: "proj-a", worktreePath: "/workspaces/proj-a/feature-1", alive: true, incarnation: 1 },
      ];
      const sessionMap = new Map([
        ["term-2", { sessionId: "term-2", target: { project: "proj-b" }, alive: false }],
      ]);

      const candidates = deriveWorkflowTerminalCandidates(sessionMap, mounted, null);
      expect(candidates).toHaveLength(2);
      expect(candidates.find((c) => c.sessionId === "term-1")).toEqual({
        sessionId: "term-1",
        project: "proj-a",
        worktreePath: "/workspaces/proj-a/feature-1",
        alive: true,
        incarnation: 1,
        targetUnavailable: false,
      });
      expect(candidates.find((c) => c.sessionId === "term-2")).toEqual({
        sessionId: "term-2",
        project: "proj-b",
        worktreePath: null,
        alive: false,
        incarnation: undefined,
        targetUnavailable: false,
      });
    });

    it("marks targetUnavailable when path is in unavailable list", () => {
      const mounted = [
        { sessionId: "term-1", project: "proj-a", worktreePath: "/workspaces/proj-a/./feature-1", alive: true },
      ];
      const unavailable = { "proj-a": ["/workspaces/proj-a/feature-1"] };
      const candidates = deriveWorkflowTerminalCandidates(null, mounted, unavailable);
      expect(candidates[0].targetUnavailable).toBe(true);
    });
  });

  describe("resolveWorkflowTerminalReveal", () => {
    it("rejects missing or empty session ID", () => {
      expect(resolveWorkflowTerminalReveal({ sessionId: "" })).toEqual({ canReveal: false, reason: "missing_session_id" });
      expect(resolveWorkflowTerminalReveal({ sessionId: "   " })).toEqual({ canReveal: false, reason: "missing_session_id" });
    });

    it("rejects profile mismatch", () => {
      const outcome = resolveWorkflowTerminalReveal({
        sessionId: "term-1",
        activeProfileId: "prof-1",
        currentProfileId: "prof-2",
      });
      expect(outcome).toEqual({ canReveal: false, reason: "profile_mismatch" });
    });

    it("rejects session not found in sessionMap or mountedSessions", () => {
      const outcome = resolveWorkflowTerminalReveal({
        sessionId: "term-unknown",
        sessionMap: new Map([["term-1", { alive: true }]]),
        mountedSessions: [{ sessionId: "term-2" }],
      });
      expect(outcome).toEqual({ canReveal: false, reason: "session_not_found" });
    });

    it("resolves desktop terminal reveal when session exists", () => {
      const outcome = resolveWorkflowTerminalReveal({
        sessionId: "term-1",
        sessionMap: new Map([["term-1", { alive: true }]]),
        isCompactWorkspace: false,
      });
      expect(outcome).toEqual({ canReveal: true, sessionId: "term-1", requestedCompactSurface: undefined });
    });

    it("resolves compact terminal reveal with requestedCompactSurface='terminal'", () => {
      const outcome = resolveWorkflowTerminalReveal({
        sessionId: "term-2",
        mountedSessions: [{ sessionId: "term-2" }],
        isCompactWorkspace: true,
      });
      expect(outcome).toEqual({ canReveal: true, sessionId: "term-2", requestedCompactSurface: "terminal" });
    });
  });

  describe("resolveWorkflowTargetSelection", () => {
    const projects = [{ name: "proj-a" }, { name: "proj-b" }];

    it("rejects missing target or project", () => {
      expect(resolveWorkflowTargetSelection({ target: null, projects })).toEqual({
        canSelect: false,
        reason: "missing_target",
        errorMessage: "No target project specified.",
      });
      expect(resolveWorkflowTargetSelection({ target: { project: "" }, projects })).toEqual({
        canSelect: false,
        reason: "missing_target",
        errorMessage: "No target project specified.",
      });
    });

    it("rejects unconfigured project", () => {
      const outcome = resolveWorkflowTargetSelection({ target: { project: "proj-unknown" }, projects });
      expect(outcome).toEqual({
        canSelect: false,
        reason: "project_not_configured",
        errorMessage: 'Project "proj-unknown" is not configured in this workspace.',
      });
    });

    it("selects valid project root target", () => {
      const outcome = resolveWorkflowTargetSelection({ target: { project: "proj-a" }, projects });
      expect(outcome).toEqual({ canSelect: true, project: "proj-a", profileId: undefined, worktreePath: null });
    });

    it("selects valid worktree target", () => {
      const outcome = resolveWorkflowTargetSelection({ target: { project: "proj-a", worktreePath: "/tmp/feat" }, projects });
      expect(outcome).toEqual({ canSelect: true, project: "proj-a", profileId: undefined, worktreePath: "/tmp/feat" });
    });
    it("rejects unavailable worktree target", () => {
      const outcome = resolveWorkflowTargetSelection({
        target: { project: "proj-a", worktreePath: "/tmp/feat" },
        projects,
        unavailableTargetsByProject: { "proj-a": ["/tmp/feat"] },
      });
      expect(outcome).toEqual({
        canSelect: false,
        project: "proj-a",
        worktreePath: "/tmp/feat",
        reason: "target_unavailable",
        errorMessage: 'Worktree "/tmp/feat" is currently unavailable.',
      });
    });

    it("selects target scoped to explicit profile and disambiguates same-named projects across profiles", () => {
      const multiProfileProjects = [
        { name: "demo", profileId: "server-a" },
        { name: "demo", profileId: "server-b" },
      ];
      const outcomeA = resolveWorkflowTargetSelection({
        target: { profileId: "server-a", project: "demo", worktreePath: "/wt-a" },
        projects: multiProfileProjects,
      });
      expect(outcomeA).toEqual({
        canSelect: true,
        project: "demo",
        profileId: "server-a",
        worktreePath: "/wt-a",
      });

      const outcomeB = resolveWorkflowTargetSelection({
        target: { profileId: "server-b", project: "demo", worktreePath: "/wt-b" },
        projects: multiProfileProjects,
      });
      expect(outcomeB).toEqual({
        canSelect: true,
        project: "demo",
        profileId: "server-b",
        worktreePath: "/wt-b",
      });

      const outcomeMissing = resolveWorkflowTargetSelection({
        target: { profileId: "server-c", project: "demo" },
        projects: multiProfileProjects,
      });
      expect(outcomeMissing.canSelect).toBe(false);
      expect(outcomeMissing.reason).toBe("project_not_configured");
    });
    it("rejects explicitly qualified target when requested profile does not configure the project even if another profile does", () => {
      const projects = [
        { name: "demo", profileId: "server-a" },
        { name: "other", profileId: "server-b" },
      ];
      const outcome = resolveWorkflowTargetSelection({
        target: { profileId: "server-b", project: "demo" },
        projects,
      });
      expect(outcome.canSelect).toBe(false);
      expect(outcome.reason).toBe("project_not_configured");
    });

  });
});
