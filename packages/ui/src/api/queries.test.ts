import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import {
  gitHistoryQueryPrefixes,
  gitLogQueryOptions,
  invalidateGitHistoryDetails,
  normalizeGitMessageQuery,
  resolveGitPushTarget,
  usageSessionPollInterval,
} from "./queries.js";
import {
  __setConnectionSnapshotForTests,
  resetConnections,
} from "./connections.js";
import { createApiClient, type GitLogEntry } from "./client.js";
import type { Transport } from "./transport.js";

describe("resolveGitPushTarget", () => {
  it("maps a plain project name to a normal push", () => {
    expect(resolveGitPushTarget("dam-hopper")).toEqual([
      "dam-hopper",
      undefined,
    ]);
  });

  it("preserves root-aware push arguments", () => {
    expect(
      resolveGitPushTarget({
        project: "dam-hopper",
        root: "modules/child",
      }),
    ).toEqual(["dam-hopper", "modules/child"]);
  });
});

describe("usageSessionPollInterval", () => {
  it("polls visible documents and stops when hidden or server-rendered", () => {
    expect(usageSessionPollInterval()).toBe(false);
    vi.stubGlobal("document", { visibilityState: "visible" });
    expect(usageSessionPollInterval()).toBe(15_000);
    vi.stubGlobal("document", { visibilityState: "hidden" });
    expect(usageSessionPollInterval()).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe("normalizeGitMessageQuery", () => {
  it("returns undefined for null, undefined, empty, or whitespace-only input", () => {
    expect(normalizeGitMessageQuery(undefined)).toBeUndefined();
    expect(normalizeGitMessageQuery(null)).toBeUndefined();
    expect(normalizeGitMessageQuery("")).toBeUndefined();
    expect(normalizeGitMessageQuery("   ")).toBeUndefined();
    expect(normalizeGitMessageQuery("\t \n ")).toBeUndefined();
  });

  it("trims outer whitespace while preserving inner whitespace and punctuation", () => {
    expect(normalizeGitMessageQuery("  fix(auth): bug #123  ")).toBe(
      "fix(auth): bug #123",
    );
    expect(normalizeGitMessageQuery("feature + test?")).toBe("feature + test?");
  });
});

describe("gitLogQueryOptions and scope gating", () => {
  it("builds correct query key suffix and delegates to bound api", () => {
    const options = gitLogQueryOptions(
      { project: "my-project" },
      200,
      0,
      "refs/heads/main",
      "src",
      " fix ",
    );
    expect(options.queryKey).toEqual([
      "git-log",
      "my-project",
      "root",
      "src",
      200,
      0,
      "refs/heads/main",
      "fix",
    ]);
    expect(options.enabled).toBe(true);
  });

  it("normalizes empty term to null in query key", () => {
    const options = gitLogQueryOptions({ project: "my-project" });
    expect(options.queryKey).toEqual([
      "git-log",
      "my-project",
      "root",
      ".",
      undefined,
      undefined,
      null,
      null,
    ]);
  });

  it("disables query when target project is empty string while preserving profile owner", () => {
    const target = { profileId: "server-1", project: "" };
    const options = gitLogQueryOptions(target);
    expect(options.enabled).toBe(false);
  });
});

describe("gitHistoryQueryPrefixes", () => {
  it("returns consistent query key prefixes for history controller", () => {
    const prefixes = gitHistoryQueryPrefixes({ project: "my-project" }, "sub");
    expect(prefixes.branches).toEqual(["branches", "my-project", "root", "sub"]);
    expect(prefixes.projectStatus).toEqual(["project-status", "my-project", "root"]);
    expect(prefixes.log).toEqual(["git-log", "my-project", "root", "sub"]);
    expect(prefixes.details("abc1234")).toEqual([
      ["git-commit-files", "my-project", "root", "sub", "abc1234"],
      ["git-commit-message", "my-project", "root", "sub", "abc1234"],
      ["git-commit-file-diff", "my-project", "root", "sub", "abc1234"],
    ]);
  });
});

describe("consumer-visible cache isolation and search query variants", () => {
  let qc: QueryClient;

  beforeEach(() => {
    resetConnections();
    qc = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
  });

  afterEach(() => {
    resetConnections();
    qc.clear();
  });

  it("isolates same-name project log caches across profiles, generations, and search terms", async () => {
    const owner1 = { profileId: "profile-alpha", generation: 1 };
    const owner2 = { profileId: "profile-beta", generation: 1 };

    const commitA: GitLogEntry = {
      hash: "aaaa111",
      author: "Alpha Dev",
      date: "2026-10-01",
      message: "feat: alpha search match",
      parents: [],
    };
    const commitB: GitLogEntry = {
      hash: "bbbb222",
      author: "Beta Dev",
      date: "2026-10-01",
      message: "feat: beta search match",
      parents: [],
    };

    const transport1: Transport = {
      invoke: vi.fn().mockImplementation(async (method, data) => {
        if (method === "git:log") {
          const d = data as { messageQuery?: string };
          if (d.messageQuery === "alpha") return [commitA];
          return [];
        }
        return null;
      }),
      onEvent: vi.fn(),
      offEvent: vi.fn(),
      destroy: vi.fn(),
    };
    const transport2: Transport = {
      invoke: vi.fn().mockImplementation(async (method, data) => {
        if (method === "git:log") {
          const d = data as { messageQuery?: string };
          if (d.messageQuery === "beta") return [commitB];
          return [];
        }
        return null;
      }),
      onEvent: vi.fn(),
      offEvent: vi.fn(),
      destroy: vi.fn(),
    };

    const api1 = createApiClient(owner1, transport1);
    const api2 = createApiClient(owner2, transport2);

    __setConnectionSnapshotForTests(owner1.profileId, {
      owner: owner1,
      status: "connected",
      api: api1,
    });
    __setConnectionSnapshotForTests(owner2.profileId, {
      owner: owner2,
      status: "connected",
      api: api2,
    });

    const targetAlpha = { profileId: "profile-alpha", project: "common-repo" };
    const targetBeta = { profileId: "profile-beta", project: "common-repo" };

    // 1. Fetch Alpha's search log
    const optionsAlphaSearch = gitLogQueryOptions(
      targetAlpha,
      200,
      0,
      "main",
      ".",
      "alpha",
    );
    const resultAlpha = await qc.fetchQuery(optionsAlphaSearch);
    expect(resultAlpha).toEqual([commitA]);

    // 2. Fetch Beta's search log for the exact same project name
    const optionsBetaSearch = gitLogQueryOptions(
      targetBeta,
      200,
      0,
      "main",
      ".",
      "beta",
    );
    const resultBeta = await qc.fetchQuery(optionsBetaSearch);
    expect(resultBeta).toEqual([commitB]);

    // 3. Verify cache data isolation: Target Alpha's cache cannot render Beta's commits
    expect(qc.getQueryData(optionsAlphaSearch.queryKey)).toEqual([commitA]);
    expect(qc.getQueryData(optionsBetaSearch.queryKey)).toEqual([commitB]);

    // 4. Verify search term isolation within same target: different query does not reuse cached results
    const optionsAlphaOther = gitLogQueryOptions(
      targetAlpha,
      200,
      0,
      "main",
      ".",
      "other-term",
    );
    expect(qc.getQueryData(optionsAlphaOther.queryKey)).toBeUndefined();

    // 5. Verify owner generation switch fences out prior cached results
    const owner1Gen2 = { profileId: "profile-alpha", generation: 2 };
    __setConnectionSnapshotForTests(owner1.profileId, {
      owner: owner1Gen2,
      status: "connected",
      api: createApiClient(owner1Gen2, transport1),
    });
    const optionsAlphaGen2 = gitLogQueryOptions(
      targetAlpha,
      200,
      0,
      "main",
      ".",
      "alpha",
    );
    expect(qc.getQueryData(optionsAlphaGen2.queryKey)).toBeUndefined();

    // 6. Verify mutation invalidation prefix targeting targetAlpha does not invalidate targetBeta
    // Restore targetAlpha generation 1 in cache and fetch both
    __setConnectionSnapshotForTests(owner1.profileId, {
      owner: owner1,
      status: "connected",
      api: api1,
    });
    await qc.fetchQuery(optionsAlphaSearch);
    await qc.fetchQuery(optionsBetaSearch);

    // Invalidate git-log prefix for targetAlpha
    const prefixesAlpha = gitHistoryQueryPrefixes(targetAlpha);
    await qc.invalidateQueries({ queryKey: prefixesAlpha.log });

    // Alpha query should be stale; Beta query should remain fresh
    const alphaQueryState = qc.getQueryCache().find({ queryKey: optionsAlphaSearch.queryKey });
    const betaQueryState = qc.getQueryCache().find({ queryKey: optionsBetaSearch.queryKey });
    expect(alphaQueryState?.isStale()).toBe(true);
    expect(betaQueryState?.isStale()).toBe(false);

    // 7. Test invalidateGitHistoryDetails batch invalidation
    const detailsKeys = prefixesAlpha.details("c12345");
    for (const key of detailsKeys) {
      qc.setQueryData(key, { ok: true });
    }
    await invalidateGitHistoryDetails(qc, targetAlpha, ".", "c12345");
    for (const key of detailsKeys) {
      expect(qc.getQueryCache().find({ queryKey: key })?.isStale()).toBe(true);
    }
  });
});
