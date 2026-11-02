import { describe, expect, it } from "vitest";
import { parseOsDeepLink } from "./deep-links.js";
import { createProjectDesktopTemplate } from "./desktop-templates.js";
import type { ServerProfile } from "@/api/server-config.js";

const TEST_PROFILES: ServerProfile[] = [
  {
    id: "prof-1",
    name: "Local Profile",
    url: "http://127.0.0.1:4801",
    authType: "token",
    lastUsed: 1234,
  },
  {
    id: "prof-2",
    name: "Remote Profile",
    url: "https://remote.damhopper.dev",
    authType: "none",
    lastUsed: 5678,
  },
];

describe("deep-links parser", () => {
  it("returns empty when no open or action parameter is present", () => {
    expect(parseOsDeepLink("", TEST_PROFILES)).toEqual({ status: "empty" });
    expect(parseOsDeepLink("?foo=bar", TEST_PROFILES)).toEqual({
      status: "empty",
    });
  });

  it("fails closed when profile parameter is missing", () => {
    const res = parseOsDeepLink("?open=git&project=dam-hopper", TEST_PROFILES);
    expect(res.status).toBe("invalid");
    expect(res.reason).toContain("Missing required profile parameter");
  });

  it("fails closed when profile is not in known profiles list", () => {
    const res = parseOsDeepLink(
      "?open=git&profile=unknown-prof&project=dam-hopper",
      TEST_PROFILES,
    );
    expect(res.status).toBe("invalid");
    expect(res.reason).toContain('Unknown server profile "unknown-prof"');
  });

  it("fails closed when project-scoped app lacks project parameter", () => {
    const res = parseOsDeepLink("?open=git&profile=prof-1", TEST_PROFILES);
    expect(res.status).toBe("invalid");
    expect(res.reason).toContain('Application "git" requires a project parameter');
  });

  it("parses valid project-scoped deep link (git)", () => {
    const res = parseOsDeepLink(
      "?open=git&profile=prof-1&project=dam-hopper&worktree=feat-os",
      TEST_PROFILES,
    );
    expect(res.status).toBe("valid");
    expect(res.appId).toBe("git");
    expect(res.ctx?.profileId).toBe("prof-1");
    expect(res.ctx?.projectId).toBe("dam-hopper");
    expect(res.ctx?.worktreeId).toBe("feat-os");
    expect(res.intent?.action).toBe("git:status");
  });

  it("parses valid git deep link with commit hash", () => {
    const res = parseOsDeepLink(
      "?open=git&profile=prof-1&project=dam-hopper&hash=abc1234",
      TEST_PROFILES,
    );
    expect(res.status).toBe("valid");
    expect(res.intent?.action).toBe("git:reveal-commit");
    expect(res.intent?.payload).toMatchObject({
      commitHash: "abc1234",
    });
  });

  it("parses valid editor deep link with file and line", () => {
    const res = parseOsDeepLink(
      "?open=editor&profile=prof-1&project=dam-hopper&file=src/main.rs&line=42",
      TEST_PROFILES,
    );
    expect(res.status).toBe("valid");
    expect(res.appId).toBe("editor");
    expect(res.intent?.action).toBe("file:open");
    expect(res.intent?.payload).toMatchObject({
      filePath: "src/main.rs",
      line: 42,
    });
  });

  it("parses profile-scoped app without requiring project (terminals, ports)", () => {
    const termRes = parseOsDeepLink("?open=terminals&profile=prof-1", TEST_PROFILES);
    expect(termRes.status).toBe("valid");
    expect(termRes.appId).toBe("terminals");

    const portsRes = parseOsDeepLink("?open=ports-tunnels&profile=prof-2", TEST_PROFILES);
    expect(portsRes.status).toBe("valid");
    expect(portsRes.appId).toBe("ports-tunnels");
  });

  it("validates session-changes requires full owner tuple", () => {
    const incomplete = parseOsDeepLink(
      "?open=session-changes&profile=prof-1&terminal=t1",
      TEST_PROFILES,
    );
    expect(incomplete.status).toBe("invalid");
    expect(incomplete.reason).toContain("requires terminal, incarnation, and ompSession");

    const complete = parseOsDeepLink(
      "?open=session-changes&profile=prof-1&terminal=t1&incarnation=inc1&ompSession=omp1&root=.",
      TEST_PROFILES,
    );
    expect(complete.status).toBe("valid");
    expect(complete.appId).toBe("session-changes");
    expect(complete.intent?.action).toBe("session-changes:open");
    expect(complete.intent?.payload).toMatchObject({
      terminalId: "t1",
      terminalIncarnation: "inc1",
      ompSessionId: "omp1",
    });
  });
  it("rejects malformed line numbers in file/editor deep links", () => {
    const invalidNonInt = parseOsDeepLink(
      "?open=editor&profile=prof-1&project=dam-hopper&file=test.ts&line=foo",
      TEST_PROFILES,
    );
    expect(invalidNonInt.status).toBe("invalid");
    expect(invalidNonInt.reason).toContain('Malformed line parameter "foo"');

    const invalidNeg = parseOsDeepLink(
      "?open=editor&profile=prof-1&project=dam-hopper&file=test.ts&line=-10",
      TEST_PROFILES,
    );
    expect(invalidNeg.status).toBe("invalid");
    expect(invalidNeg.reason).toContain('Malformed line parameter "-10"');

    const valid = parseOsDeepLink(
      "?open=editor&profile=prof-1&project=dam-hopper&file=test.ts&line=42",
      TEST_PROFILES,
    );
    expect(valid.status).toBe("valid");
    expect(valid.intent?.payload).toMatchObject({
      line: 42,
    });
  });

  it("validates session-changes generation parameter", () => {
    const invalidGen = parseOsDeepLink(
      "?open=session-changes&profile=prof-1&terminal=t1&incarnation=inc1&ompSession=omp1&generation=bad",
      TEST_PROFILES,
    );
    expect(invalidGen.status).toBe("invalid");
    expect(invalidGen.reason).toContain('Malformed generation parameter "bad"');

    const validGen = parseOsDeepLink(
      "?open=session-changes&profile=prof-1&terminal=t1&incarnation=inc1&ompSession=omp1&generation=3",
      TEST_PROFILES,
    );
    expect(validGen.status).toBe("valid");
    expect(validGen.intent?.payload).toMatchObject({
      generation: 3,
    });
  });

  it("parses action-only links with explicit trigger without running ambient commands", () => {
    const res = parseOsDeepLink("?action=new-terminal&profile=prof-1&project=test-proj", TEST_PROFILES);
    expect(res.status).toBe("valid");
    expect(res.action).toBe("new-terminal");
    expect(res.ctx?.profileId).toBe("prof-1");
    expect(res.ctx?.projectId).toBe("test-proj");
  });
});

describe("desktop-templates", () => {
  it("creates approved 60/40 project desktop layout with 5 tiled windows", () => {
    const ctx = { profileId: "prof-1", projectId: "dam-hopper" };
    const { desktop, windows } = createProjectDesktopTemplate(
      "Project DamHopper",
      ctx,
      "test-desktop-1",
    );

    expect(desktop.id).toBe("test-desktop-1");
    expect(desktop.name).toBe("Project DamHopper");
    expect(desktop.defaultCtx).toEqual(ctx);
    expect(windows).toHaveLength(5);

    const appIds = windows.map((w) => w.appId);
    expect(appIds).toContain("terminals");
    expect(appIds).toContain("files");
    expect(appIds).toContain("search");
    expect(appIds).toContain("git");
    expect(appIds).toContain("changes");

    // Verify 60/40 horizontal binary split
    expect(desktop.tree?.type).toBe("split");
    if (desktop.tree?.type === "split") {
      expect(desktop.tree.direction).toBe("horizontal");
      expect(desktop.tree.sizes).toEqual([60, 40]);

      // Left pane is terminals
      const leftChild = desktop.tree.children[0];
      expect(leftChild.type).toBe("pane");
      if (leftChild.type === "pane") {
        const termWin = windows.find((w) => w.appId === "terminals");
        expect(leftChild.items).toEqual([termWin?.id]);
      }

      // Right pane is vertical 50/50 split
      const rightChild = desktop.tree.children[1];
      expect(rightChild.type).toBe("split");
      if (rightChild.type === "split") {
        expect(rightChild.direction).toBe("vertical");
        expect(rightChild.sizes).toEqual([50, 50]);

        // Top sub-pane: files & search
        const topPane = rightChild.children[0];
        expect(topPane.type).toBe("pane");

        // Bottom sub-pane: git & changes
        const bottomPane = rightChild.children[1];
        expect(bottomPane.type).toBe("pane");
      }
    }
  });
});
