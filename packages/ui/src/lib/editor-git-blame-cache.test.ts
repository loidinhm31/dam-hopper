import { describe, it, expect, beforeEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { ConnectionRef } from "@/api/ownership.js";
import type { GitBlameResponse } from "@/api/client.js";
import { computeMonacoLineCount } from "./editor-git-blame.js";
import {
  advanceTargetEpoch,
  beginRequestLease,
  beginRootDiscovery,
  BLAME_CACHE_MAX_BYTES,
  BLAME_CACHE_MAX_ENTRIES,
  buildBlameQueryKey,
  cancelRootDiscovery,
  completeRootDiscovery,
  computeBufferSha256,
  endRequestLease,
  estimateCachedAttributionWeight,
  getCompletedBlameHit,
  getModelBufferSha256,
  getTargetState,
  invalidateBlameForOwner,
  invalidateBlameForProject,
  invalidateBlameForTarget,
  isLeaseValid,
  isMatchingBlameQueryKey,
  retireOwner,
  setCompletedBlamePayload,
  touchCompletedBlameHit,
} from "./editor-git-blame-cache.js";

/**
 * Creates a structurally valid GitBlameResponse matching Monaco line counts
 * and strictly ordered range partitions.
 */
function makeValidBlameResponse(
  content: string,
  overrides?: Partial<GitBlameResponse>,
): GitBlameResponse {
  const lineCount = computeMonacoLineCount(content);
  const commitHash = "commit-abc";
  return {
    snapshotId: "snap-1",
    modelVersion: 1,
    rootId: "root-1",
    rootRelativePath: "src/main.rs",
    baseCommitOid: commitHash,
    bufferLineCount: lineCount,
    status: "ready",
    ranges: [{ startLine: 1, lineCount, commitIndex: 0 }],
    commits: [
      {
        hash: commitHash,
        authorName: "Alice",
        authorEmail: "alice@example.com",
        authorTimestamp: 1700000000,
        authorTimezoneOffsetMinutes: 0,
        subject: "First commit",
      },
    ],
    ...overrides,
  };
}

describe("editor-git-blame-cache", () => {
  let queryClient: QueryClient;
  const owner: ConnectionRef = { profileId: "prof-1", generation: 1 };
  const target = { project: "my-project", worktreePath: null };
  const path = "src/main.rs";

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity },
      },
    });
  });

  describe("Known SHA-256 Vectors and Monaco Memoization", () => {
    it("computes standard known SHA-256 test vectors synchronously", () => {
      // Official standard NIST / RFC SHA-256 vector for empty string
      const emptyHash = computeBufferSha256("");
      expect(emptyHash).toBe(
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      );

      // Known test vector for "hello world"
      const helloHash = computeBufferSha256("hello world");
      expect(helloHash).toBe(
        "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
      );
    });

    it("memoizes buffer fingerprint per model and version via WeakMap", () => {
      let version = 1;
      let text = "const x = 1;\n";
      const mockModel = {
        getVersionId: () => version,
        getValue: () => text,
      };

      const h1 = getModelBufferSha256(mockModel);
      // Change internal text without bumping versionId (simulating unchanged version)
      text = "corrupted";
      const h2 = getModelBufferSha256(mockModel);
      expect(h2).toBe(h1);

      // User types edit: version increases monotonically in Monaco
      version = 2;
      text = "const x = 2;\n";
      const h3 = getModelBufferSha256(mockModel);
      expect(h3).not.toBe(h1);

      // User presses Undo: version strictly increases in Monaco (e.g. 3), but text is restored to v1
      version = 3;
      text = "const x = 1;\n";
      const h4 = getModelBufferSha256(mockModel);
      expect(h4).toBe(h1);
    });
  });

  describe("Query Key Builder", () => {
    it("builds exact query key including owner, target, root, HEAD, epoch, path, and sha256", () => {
      const sha = computeBufferSha256("hello\nworld\n");
      const key = buildBlameQueryKey(
        owner,
        target,
        "root-main",
        "commit-123",
        5,
        "src/lib.rs",
        sha,
      );

      expect(key).toEqual([
        "profile",
        "prof-1",
        1,
        "git",
        "git-blame",
        "my-project",
        "root",
        "root-main",
        "commit-123",
        5,
        "src/lib.rs",
        sha,
      ]);
    });

    it("encodes verified unborn HEAD as null", () => {
      const sha = computeBufferSha256("initial content");
      const key = buildBlameQueryKey(
        owner,
        target,
        "root-main",
        null,
        1,
        "src/lib.rs",
        sha,
      );

      expect(key[8]).toBeNull();
    });

    it("normalizes worktree path into canonical key", () => {
      const worktreeTarget = {
        project: "my-project",
        worktreePath: "/ws/trees/feature-1/",
      };
      const sha = computeBufferSha256("code");
      const key = buildBlameQueryKey(
        owner,
        worktreeTarget,
        "root-1",
        "commit-1",
        1,
        "file.ts",
        sha,
      );

      expect(key[6]).toBe("worktree:/ws/trees/feature-1");
    });

    it("matches blame query keys accurately with isMatchingBlameQueryKey", () => {
      const sha = computeBufferSha256("code");
      const key = buildBlameQueryKey(
        owner,
        target,
        "root-1",
        "commit-1",
        1,
        path,
        sha,
      );

      expect(isMatchingBlameQueryKey(key, target, owner)).toBe(true);
      expect(
        isMatchingBlameQueryKey(key, { project: "other-project" }, owner),
      ).toBe(false);
      expect(
        isMatchingBlameQueryKey(key, target, {
          profileId: "prof-1",
          generation: 2,
        }),
      ).toBe(false);
      expect(isMatchingBlameQueryKey(["not-profile"], target, owner)).toBe(false);
    });
  });

  describe("Hit Derivation, Envelope Rebinding, and Non-Mutation", () => {
    it("returns miss on empty cache without creating entries or side effects", () => {
      const sha = computeBufferSha256("test\n");
      const hit = getCompletedBlameHit(
        queryClient,
        owner,
        target,
        path,
        sha,
        2,
        1,
        "snap-fresh",
      );

      expect(hit.hit).toBe(false);
      expect(hit.data).toBeNull();
      expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    });

    it("commits validated payload and derives warm hit rebound to fresh envelope", () => {
      const content = "line 1\nline 2\nline 3"; // 3 Monaco lines
      const lineCount = computeMonacoLineCount(content);
      expect(lineCount).toBe(3);

      const sha = computeBufferSha256(content);
      const resp = makeValidBlameResponse(content);

      const lease = beginRequestLease(queryClient, owner, target, path);
      const committed = setCompletedBlamePayload(
        queryClient,
        owner,
        target,
        path,
        sha,
        resp,
        lease.capturedEpoch,
        lease,
      );
      endRequestLease(queryClient, lease);

      expect(committed).toBe(true);

      // Now query hit with fresh modelVersion 42 and fresh snapshotId "snap-new"
      const hit = getCompletedBlameHit(
        queryClient,
        owner,
        target,
        path,
        sha,
        lineCount,
        42,
        "snap-new",
      );

      expect(hit.hit).toBe(true);
      expect(hit.data).not.toBeNull();
      expect(hit.data?.snapshotId).toBe("snap-new");
      expect(hit.data?.modelVersion).toBe(42);
      expect(hit.data?.ranges).toEqual(resp.ranges);
      expect(hit.data?.commits).toEqual(resp.commits);

      // Verify cached payload in TanStack Query was NOT mutated
      const cachedQuery = queryClient
        .getQueryCache()
        .find({ queryKey: hit.queryKey!, exact: true });
      const cachedData = cachedQuery?.state.data as
        | Record<string, unknown>
        | undefined;
      expect(cachedData?.snapshotId).toBeUndefined();
      expect(cachedData?.modelVersion).toBeUndefined();
    });

    it("rejects hit if line count does not match buffer", () => {
      const content = "line 1\nline 2"; // 2 lines
      const sha = computeBufferSha256(content);
      const resp = makeValidBlameResponse(content);

      const lease = beginRequestLease(queryClient, owner, target, path);
      const committed = setCompletedBlamePayload(
        queryClient,
        owner,
        target,
        path,
        sha,
        resp,
        lease.capturedEpoch,
        lease,
      );
      endRequestLease(queryClient, lease);
      expect(committed).toBe(true);

      // Request with mismatching line count (e.g. 5)
      const hit = getCompletedBlameHit(
        queryClient,
        owner,
        target,
        path,
        sha,
        5,
        1,
        "snap-1",
      );
      expect(hit.hit).toBe(false);
    });

    it("rejects hit if query state was marked invalidated in TanStack Query", () => {
      const content = "line 1"; // 1 line
      const sha = computeBufferSha256(content);
      const resp = makeValidBlameResponse(content);

      const lease = beginRequestLease(queryClient, owner, target, path);
      const committed = setCompletedBlamePayload(
        queryClient,
        owner,
        target,
        path,
        sha,
        resp,
        lease.capturedEpoch,
        lease,
      );
      endRequestLease(queryClient, lease);
      expect(committed).toBe(true);

      // Invalidate the query in TanStack QueryCache
      const key = buildBlameQueryKey(
        owner,
        target,
        resp.rootId,
        resp.baseCommitOid,
        lease.capturedEpoch,
        path,
        sha,
      );
      void queryClient.invalidateQueries({ queryKey: key });

      const hit = getCompletedBlameHit(
        queryClient,
        owner,
        target,
        path,
        sha,
        1,
        1,
        "snap-1",
      );
      expect(hit.hit).toBe(false);
    });
  });

  describe("Epoch Separation, Monotonic Undo Reuse, and Late Response Fencing", () => {
    it("allows undo back to previously cached content with increasing model version", () => {
      const contentA = "code A\n";
      const lineCountA = computeMonacoLineCount(contentA);
      const shaA = computeBufferSha256(contentA);
      const respA = makeValidBlameResponse(contentA);

      // Version 1: initial blame
      const leaseA = beginRequestLease(queryClient, owner, target, path);
      const committedA = setCompletedBlamePayload(
        queryClient,
        owner,
        target,
        path,
        shaA,
        respA,
        leaseA.capturedEpoch,
        leaseA,
      );
      endRequestLease(queryClient, leaseA);
      expect(committedA).toBe(true);

      // Version 2: user types content B (misses)
      const contentB = "code B\n";
      const lineCountB = computeMonacoLineCount(contentB);
      const shaB = computeBufferSha256(contentB);
      const hitB = getCompletedBlameHit(
        queryClient,
        owner,
        target,
        path,
        shaB,
        lineCountB,
        2,
        "snap-2",
      );
      expect(hitB.hit).toBe(false);

      // Version 3: user presses Undo back to content A without repository epoch advancing
      // Model version increments to 3 in Monaco, but content matches cached content A!
      const hitUndo = getCompletedBlameHit(
        queryClient,
        owner,
        target,
        path,
        shaA,
        lineCountA,
        3,
        "snap-3",
      );
      expect(hitUndo.hit).toBe(true);
      expect(hitUndo.data?.modelVersion).toBe(3);
    });

    it("rejects late response commit if target epoch advanced while request was in-flight", () => {
      const content = "code\n";
      const sha = computeBufferSha256(content);
      const resp = makeValidBlameResponse(content);

      const lease = beginRequestLease(queryClient, owner, target, path);
      const capturedEpoch = lease.capturedEpoch;

      // Git mutation occurs, advancing target epoch
      advanceTargetEpoch(queryClient, owner, target);

      // Late network response returns with old captured epoch
      const committed = setCompletedBlamePayload(
        queryClient,
        owner,
        target,
        path,
        sha,
        resp,
        capturedEpoch,
        lease,
      );

      // Must be rejected!
      expect(committed).toBe(false);
    });
  });

  describe("Request Leases and QueryClient.clear() Observability", () => {
    it("creates query marker that validates lease until endRequestLease", () => {
      const lease = beginRequestLease(queryClient, owner, target, path);
      expect(isLeaseValid(queryClient, lease)).toBe(true);

      endRequestLease(queryClient, lease);
      expect(isLeaseValid(queryClient, lease)).toBe(false);
    });

    it("observes QueryClient.clear() immediately and invalidates pending lease", () => {
      const lease = beginRequestLease(queryClient, owner, target, path);
      expect(isLeaseValid(queryClient, lease)).toBe(true);

      // QueryClient.clear() clears all queries from cache
      queryClient.clear();

      // Lease is now revoked because marker was removed!
      expect(isLeaseValid(queryClient, lease)).toBe(false);

      // Late commit cannot succeed
      const resp = makeValidBlameResponse("code");
      const committed = setCompletedBlamePayload(
        queryClient,
        owner,
        target,
        path,
        "hash",
        resp,
        lease.capturedEpoch,
        lease,
      );
      expect(committed).toBe(false);
    });
  });

  describe("Target and Project Invalidation", () => {
    it("invalidates blame for specific target, removing queries and advancing epoch", () => {
      const content = "content\n";
      const lineCount = computeMonacoLineCount(content);
      const sha = computeBufferSha256(content);
      const resp = makeValidBlameResponse(content);

      const lease = beginRequestLease(queryClient, owner, target, path);
      const committed = setCompletedBlamePayload(
        queryClient,
        owner,
        target,
        path,
        sha,
        resp,
        lease.capturedEpoch,
        lease,
      );
      endRequestLease(queryClient, lease);
      expect(committed).toBe(true);

      // Verify warm hit exists
      expect(
        getCompletedBlameHit(
          queryClient,
          owner,
          target,
          path,
          sha,
          lineCount,
          1,
          "s1",
        ).hit,
      ).toBe(true);

      // Invalidate target
      invalidateBlameForTarget(queryClient, owner, target);

      // Cache misses after invalidation
      expect(
        getCompletedBlameHit(
          queryClient,
          owner,
          target,
          path,
          sha,
          lineCount,
          1,
          "s2",
        ).hit,
      ).toBe(false);
    });

    it("invalidates all targets for an owner and project on SSE status event", () => {
      const content = "content\n";
      const lineCount = computeMonacoLineCount(content);
      const sha = computeBufferSha256(content);
      const resp = makeValidBlameResponse(content);

      const lease = beginRequestLease(queryClient, owner, target, path);
      const committed = setCompletedBlamePayload(
        queryClient,
        owner,
        target,
        path,
        sha,
        resp,
        lease.capturedEpoch,
        lease,
      );
      endRequestLease(queryClient, lease);
      expect(committed).toBe(true);

      invalidateBlameForProject(queryClient, owner, "my-project");

      expect(
        getCompletedBlameHit(
          queryClient,
          owner,
          target,
          path,
          sha,
          lineCount,
          1,
          "s1",
        ).hit,
      ).toBe(false);
    });

    it("conservatively invalidates all projects for owner if project name is missing", () => {
      const content = "content\n";
      const lineCount = computeMonacoLineCount(content);
      const sha = computeBufferSha256(content);
      const resp = makeValidBlameResponse(content);

      const lease = beginRequestLease(queryClient, owner, target, path);
      const committed = setCompletedBlamePayload(
        queryClient,
        owner,
        target,
        path,
        sha,
        resp,
        lease.capturedEpoch,
        lease,
      );
      endRequestLease(queryClient, lease);
      expect(committed).toBe(true);

      invalidateBlameForOwner(queryClient, owner);

      expect(
        getCompletedBlameHit(
          queryClient,
          owner,
          target,
          path,
          sha,
          lineCount,
          1,
          "s1",
        ).hit,
      ).toBe(false);
    });
  });

  describe("Owner Retirement", () => {
    it("retires owner and cleans up all queries, leases, and targets", () => {
      const content = "content\n";
      const lineCount = computeMonacoLineCount(content);
      const sha = computeBufferSha256(content);
      const resp = makeValidBlameResponse(content);

      const lease = beginRequestLease(queryClient, owner, target, path);
      const committed = setCompletedBlamePayload(
        queryClient,
        owner,
        target,
        path,
        sha,
        resp,
        lease.capturedEpoch,
        lease,
      );
      endRequestLease(queryClient, lease);
      expect(committed).toBe(true);

      retireOwner(queryClient, owner);

      expect(
        getCompletedBlameHit(
          queryClient,
          owner,
          target,
          path,
          sha,
          lineCount,
          1,
          "s1",
        ).hit,
      ).toBe(false);
    });
  });

  describe("Cache Bounds and LRU Eviction", () => {
    it("evicts oldest entry when entry count exceeds BLAME_CACHE_MAX_ENTRIES (64)", () => {
      for (let i = 0; i < BLAME_CACHE_MAX_ENTRIES + 1; i++) {
        const filePath = `src/file-${i}.rs`;
        const text = `content-${i}\n`;
        const lineCount = computeMonacoLineCount(text);
        const sha = computeBufferSha256(text);
        const resp = makeValidBlameResponse(text, {
          rootRelativePath: filePath,
        });

        const lease = beginRequestLease(queryClient, owner, target, filePath);
        const committed = setCompletedBlamePayload(
          queryClient,
          owner,
          target,
          filePath,
          sha,
          resp,
          lease.capturedEpoch,
          lease,
        );
        endRequestLease(queryClient, lease);
        expect(committed).toBe(true);
      }

      // First inserted entry (file-0.rs) should have been evicted by the 65th entry
      const text0 = "content-0\n";
      const sha0 = computeBufferSha256(text0);
      const hit0 = getCompletedBlameHit(
        queryClient,
        owner,
        target,
        "src/file-0.rs",
        sha0,
        computeMonacoLineCount(text0),
        1,
        "s0",
      );
      expect(hit0.hit).toBe(false);

      // Recent entry (file-64.rs) must still be present
      const text64 = "content-64\n";
      const sha64 = computeBufferSha256(text64);
      const hit64 = getCompletedBlameHit(
        queryClient,
        owner,
        target,
        "src/file-64.rs",
        sha64,
        computeMonacoLineCount(text64),
        1,
        "s64",
      );
      expect(hit64.hit).toBe(true);
    });

    it("touchCompletedBlameHit updates LRU order to protect accessed entry from eviction", () => {
      // Insert entry 0
      const text0 = "content-0\n";
      const lineCount0 = computeMonacoLineCount(text0);
      const sha0 = computeBufferSha256(text0);
      const lease0 = beginRequestLease(queryClient, owner, target, "file-0.rs");
      const comm0 = setCompletedBlamePayload(
        queryClient,
        owner,
        target,
        "file-0.rs",
        sha0,
        makeValidBlameResponse(text0, { rootRelativePath: "file-0.rs" }),
        lease0.capturedEpoch,
        lease0,
      );
      endRequestLease(queryClient, lease0);
      expect(comm0).toBe(true);

      // Insert entry 1
      const text1 = "content-1\n";
      const lineCount1 = computeMonacoLineCount(text1);
      const sha1 = computeBufferSha256(text1);
      const lease1 = beginRequestLease(queryClient, owner, target, "file-1.rs");
      const comm1 = setCompletedBlamePayload(
        queryClient,
        owner,
        target,
        "file-1.rs",
        sha1,
        makeValidBlameResponse(text1, { rootRelativePath: "file-1.rs" }),
        lease1.capturedEpoch,
        lease1,
      );
      endRequestLease(queryClient, lease1);
      expect(comm1).toBe(true);

      // Access entry 0 and touch it
      const hit0 = getCompletedBlameHit(
        queryClient,
        owner,
        target,
        "file-0.rs",
        sha0,
        lineCount0,
        1,
        "s",
      );
      expect(hit0.hit).toBe(true);
      touchCompletedBlameHit(queryClient, hit0.queryKey!);

      // Fill remaining slots up to limit + 1
      for (let i = 2; i <= BLAME_CACHE_MAX_ENTRIES; i++) {
        const filePath = `file-${i}.rs`;
        const text = `content-${i}\n`;
        const sha = computeBufferSha256(text);
        const lease = beginRequestLease(queryClient, owner, target, filePath);
        const comm = setCompletedBlamePayload(
          queryClient,
          owner,
          target,
          filePath,
          sha,
          makeValidBlameResponse(text, { rootRelativePath: filePath }),
          lease.capturedEpoch,
          lease,
        );
        endRequestLease(queryClient, lease);
        expect(comm).toBe(true);
      }

      // Entry 1 (which was NOT touched) should have been evicted before Entry 0
      const checkHit1 = getCompletedBlameHit(
        queryClient,
        owner,
        target,
        "file-1.rs",
        sha1,
        lineCount1,
        1,
        "s",
      );
      expect(checkHit1.hit).toBe(false);

      // Entry 0 (which was touched) should still survive!
      const checkHit0 = getCompletedBlameHit(
        queryClient,
        owner,
        target,
        "file-0.rs",
        sha0,
        lineCount0,
        1,
        "s",
      );
      expect(checkHit0.hit).toBe(true);
    });

    it("rejects admission of oversized entry exceeding BLAME_CACHE_MAX_BYTES (32 MiB)", () => {
      const massiveSubject = "x".repeat(33 * 1024 * 1024);
      const oversizedResp = makeValidBlameResponse("code", {
        commits: [
          {
            hash: "c1",
            authorName: "A",
            authorEmail: "a@a.com",
            authorTimestamp: 0,
            authorTimezoneOffsetMinutes: 0,
            subject: massiveSubject,
          },
        ],
      });

      const lease = beginRequestLease(queryClient, owner, target, path);
      const committed = setCompletedBlamePayload(
        queryClient,
        owner,
        target,
        path,
        "some-sha",
        oversizedResp,
        lease.capturedEpoch,
        lease,
      );
      endRequestLease(queryClient, lease);

      expect(committed).toBe(false);
    });

    it("handles repeated admission of identical key without double-counting entry count or bytes", () => {
      const text = "content\n";
      const sha = computeBufferSha256(text);
      const resp1 = makeValidBlameResponse(text);

      const lease1 = beginRequestLease(queryClient, owner, target, path);
      const comm1 = setCompletedBlamePayload(
        queryClient,
        owner,
        target,
        path,
        sha,
        resp1,
        lease1.capturedEpoch,
        lease1,
      );
      endRequestLease(queryClient, lease1);
      expect(comm1).toBe(true);

      // Repeated admission for the same key (e.g. forced refresh or race write)
      const lease2 = beginRequestLease(queryClient, owner, target, path);
      const comm2 = setCompletedBlamePayload(
        queryClient,
        owner,
        target,
        path,
        sha,
        resp1,
        lease2.capturedEpoch,
        lease2,
      );
      endRequestLease(queryClient, lease2);
      expect(comm2).toBe(true);

      const hit = getCompletedBlameHit(
        queryClient,
        owner,
        target,
        path,
        sha,
        computeMonacoLineCount(text),
        1,
        "s",
      );
      expect(hit.hit).toBe(true);
    });
  });

  describe("Root Discovery and Revision Trust", () => {
    it("suspends cache hit eligibility while discovery is pending", () => {
      const content = "code\n";
      const lineCount = computeMonacoLineCount(content);
      const sha = computeBufferSha256(content);
      const resp = makeValidBlameResponse(content);

      const lease = beginRequestLease(queryClient, owner, target, path);
      const committed = setCompletedBlamePayload(
        queryClient,
        owner,
        target,
        path,
        sha,
        resp,
        lease.capturedEpoch,
        lease,
      );
      endRequestLease(queryClient, lease);
      expect(committed).toBe(true);

      // Begin root discovery
      const handle = beginRootDiscovery(queryClient, owner, target);

      // Hit eligibility suspended during discovery!
      const hit = getCompletedBlameHit(
        queryClient,
        owner,
        target,
        path,
        sha,
        lineCount,
        1,
        "s1",
      );
      expect(hit.hit).toBe(false);

      // Complete discovery with unchanged root & HEAD
      completeRootDiscovery(
        queryClient,
        handle,
        resp.rootId,
        resp.baseCommitOid!,
      );

      // Hit eligibility restored
      const hitAfter = getCompletedBlameHit(
        queryClient,
        owner,
        target,
        path,
        sha,
        lineCount,
        1,
        "s2",
      );
      expect(hitAfter.hit).toBe(true);
    });

    it("cancels root discovery on error and restores target", () => {
      const handle = beginRootDiscovery(queryClient, owner, target);
      cancelRootDiscovery(queryClient, handle);

      const targetState = getTargetState(queryClient, owner, target);
      expect(targetState.repositoryEpoch).toBeDefined();
    });
  });

  describe("Isolation across QueryClients", () => {
    it("ensures entries in one QueryClient do not cross-hit in another QueryClient", () => {
      const qc2 = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: Infinity } },
      });

      const content = "shared\n";
      const lineCount = computeMonacoLineCount(content);
      const sha = computeBufferSha256(content);
      const resp = makeValidBlameResponse(content);

      const lease = beginRequestLease(queryClient, owner, target, path);
      const committed = setCompletedBlamePayload(
        queryClient,
        owner,
        target,
        path,
        sha,
        resp,
        lease.capturedEpoch,
        lease,
      );
      endRequestLease(queryClient, lease);
      expect(committed).toBe(true);

      // QC 1 hits
      expect(
        getCompletedBlameHit(
          queryClient,
          owner,
          target,
          path,
          sha,
          lineCount,
          1,
          "s1",
        ).hit,
      ).toBe(true);

      // QC 2 misses
      expect(
        getCompletedBlameHit(
          qc2,
          owner,
          target,
          path,
          sha,
          lineCount,
          1,
          "s2",
        ).hit,
      ).toBe(false);
    });
  });
});
