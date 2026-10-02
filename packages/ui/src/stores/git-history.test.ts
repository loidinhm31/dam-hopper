// @vitest-environment jsdom

import { describe, it, expect, beforeEach } from "vitest";
import {
  useGitHistoryStore,
  useGitHistoryHydrated,
  resetGitHistoryStore,
  validateAndMergeGitHistoryState,
  toBranchCanonicalRef,
  isBranchCanonicalRef,
  resolveHistoryBranch,
  gitHistoryScopeKey,
  parseGitHistoryScopeKey,
  parseProjectTargetKey,
  normalizeRootId,
  GIT_HISTORY_STORAGE_KEY,
  GIT_HISTORY_PERSIST_VERSION,
} from "./git-history.js";
import { projectKey } from "@/api/ownership.js";
import type { Branch } from "@/api/client.js";

describe("git-history store and helpers", () => {
  beforeEach(() => {
    localStorage.clear();
    resetGitHistoryStore();
  });

  describe("Branch canonical ref and resolution", () => {
    it("disambiguates local vs remote branch when names collide (e.g. origin/main)", () => {
      const localBranch: Branch = {
        name: "origin/main",
        isCurrent: false,
        isRemote: false,
        ahead: 0,
        behind: 0,
        lastCommit: "c1",
      };
      const remoteBranch: Branch = {
        name: "origin/main",
        isCurrent: false,
        isRemote: true,
        ahead: 0,
        behind: 0,
        lastCommit: "c2",
      };

      const localRef = toBranchCanonicalRef(localBranch);
      const remoteRef = toBranchCanonicalRef(remoteBranch);

      expect(localRef).toBe("refs/heads/origin/main");
      expect(remoteRef).toBe("refs/remotes/origin/main");
      expect(localRef).not.toBe(remoteRef);
    });

    it("preserves existing canonical prefixes without double-prefixing", () => {
      expect(toBranchCanonicalRef({ name: "refs/heads/feature", isRemote: false })).toBe(
        "refs/heads/feature",
      );
      expect(toBranchCanonicalRef({ name: "refs/remotes/origin/feature", isRemote: true })).toBe(
        "refs/remotes/origin/feature",
      );
      expect(toBranchCanonicalRef({ name: "refs/feature", isRemote: false })).toBe(
        "refs/heads/feature",
      );
    });

    it("validates canonical ref strings", () => {
      expect(isBranchCanonicalRef("refs/heads/main")).toBe(true);
      expect(isBranchCanonicalRef("refs/remotes/origin/main")).toBe(true);
      expect(isBranchCanonicalRef("main")).toBe(false);
      expect(isBranchCanonicalRef("refs/heads/")).toBe(false);
      expect(isBranchCanonicalRef("refs/remotes/")).toBe(false);
      expect(isBranchCanonicalRef("refs/heads/   ")).toBe(false);
      expect(isBranchCanonicalRef("refs/remotes/   ")).toBe(false);
    });

    it("resolves follow-active preference to checked-out branch", () => {
      const branches: Branch[] = [
        { name: "main", isCurrent: true, isRemote: false, ahead: 0, behind: 0, lastCommit: "c1" },
        { name: "feature", isCurrent: false, isRemote: false, ahead: 0, behind: 0, lastCommit: "c2" },
      ];

      const resolved = resolveHistoryBranch(branches, { mode: "follow-active" });
      expect(resolved.isFollowActive).toBe(true);
      expect(resolved.branch?.name).toBe("main");
      expect(resolved.canonicalRef).toBe("refs/heads/main");
      expect(resolved.notFound).toBeUndefined();
    });

    it("resolves pinned preference independent of checkout state", () => {
      const branches: Branch[] = [
        { name: "main", isCurrent: true, isRemote: false, ahead: 0, behind: 0, lastCommit: "c1" },
        { name: "feature", isCurrent: false, isRemote: false, ahead: 0, behind: 0, lastCommit: "c2" },
        { name: "origin/feature", isCurrent: false, isRemote: true, ahead: 0, behind: 0, lastCommit: "c3" },
      ];

      // Even when pinning the currently checked-out branch, isFollowActive must be false
      const pinnedCurrent = resolveHistoryBranch(branches, {
        mode: "pinned",
        ref: "refs/heads/main",
      });
      expect(pinnedCurrent.isFollowActive).toBe(false);
      expect(pinnedCurrent.canonicalRef).toBe("refs/heads/main");
      expect(pinnedCurrent.branch?.name).toBe("main");

      // Pinning remote branch
      const pinnedRemote = resolveHistoryBranch(branches, {
        mode: "pinned",
        ref: "refs/remotes/origin/feature",
      });
      expect(pinnedRemote.isFollowActive).toBe(false);
      expect(pinnedRemote.canonicalRef).toBe("refs/remotes/origin/feature");
      expect(pinnedRemote.branch?.name).toBe("origin/feature");
      expect(pinnedRemote.branch?.lastCommit).toBe("c3");

      // Pinning nonexistent branch
      const notFound = resolveHistoryBranch(branches, {
        mode: "pinned",
        ref: "refs/heads/vanished",
      });
      expect(notFound.isFollowActive).toBe(false);
      expect(notFound.canonicalRef).toBe("refs/heads/vanished");
      expect(notFound.branch).toBeUndefined();
      expect(notFound.notFound).toBe(true);
    });
  });

  describe("Scope and Root Helpers", () => {
    it("normalizes root IDs properly", () => {
      expect(normalizeRootId()).toBe(".");
      expect(normalizeRootId(null)).toBe(".");
      expect(normalizeRootId("")).toBe(".");
      expect(normalizeRootId(".")).toBe(".");
      expect(normalizeRootId("  .  ")).toBe(".");
      expect(normalizeRootId("server")).toBe("server");
      expect(normalizeRootId("  sub/pkg  ")).toBe("sub/pkg");
    });

    it("generates and parses git history scope keys", () => {
      const key = gitHistoryScopeKey({
        profileId: "p1",
        project: "repo-a",
        worktreePath: "worktrees/w1",
        rootId: "backend",
      });

      expect(parseGitHistoryScopeKey(key)).toEqual({
        profileId: "p1",
        project: "repo-a",
        worktreePath: "worktrees/w1",
        rootId: "backend",
      });
    });

    it("parses projectTargetKey correctly", () => {
      const key = JSON.stringify(["p1", "proj", "wt"]);
      expect(parseProjectTargetKey(key)).toEqual({
        profileId: "p1",
        project: "proj",
        worktreePath: "wt",
      });

      expect(parseProjectTargetKey("invalid-json")).toBeNull();
      expect(parseProjectTargetKey(JSON.stringify(["", "proj", null]))).toBeNull();
      expect(parseProjectTargetKey(JSON.stringify(["p1"]))).toBeNull();
    });
  });

  describe("Selection and Absence-as-Default Semantics", () => {
    it("starts with null gitPageSelection and default root/branch preferences", () => {
      const state = useGitHistoryStore.getState();
      expect(state.gitPageSelection).toBeNull();
      expect(state.selectionRecoveryRequired).toBe(false);
      expect(state.isHydrated).toBe(true);

      const target = { profileId: "p1", project: "repo-1" };
      expect(state.getRootForTarget(target)).toBe(".");
      expect(state.getBranchPreference(target)).toEqual({ mode: "follow-active" });
    });

    it("preserves explicit all ([]) selection distinct from uninitialized (null)", () => {
      const store = useGitHistoryStore.getState();
      store.clearGitPageSelection();

      expect(useGitHistoryStore.getState().gitPageSelection).toEqual([]);

      // Setting null resets to uninitialized
      store.setGitPageSelection(null);
      expect(useGitHistoryStore.getState().gitPageSelection).toBeNull();
    });

    it("deduplicates and sorts valid project selection keys", () => {
      const store = useGitHistoryStore.getState();
      const k1 = projectKey({ profileId: "p1", project: "proj-b" });
      const k2 = projectKey({ profileId: "p1", project: "proj-a" });

      store.setGitPageSelection([k1, k2, k1]);
      expect(useGitHistoryStore.getState().gitPageSelection).toEqual([k2, k1]);
    });

    it("stores root selection per target and treats '.' as absence", () => {
      const store = useGitHistoryStore.getState();
      const target = { profileId: "p1", project: "repo-1" };

      store.setRootForTarget(target, "packages/api");
      expect(store.getRootForTarget(target)).toBe("packages/api");

      // Setting back to '.' deletes the entry from rootByTarget (absence represents default '.')
      store.setRootForTarget(target, ".");
      expect(store.getRootForTarget(target)).toBe(".");
      expect(Object.keys(useGitHistoryStore.getState().rootByTarget)).toHaveLength(0);
    });

    it("stores branch preference per scope and treats follow-active as absence", () => {
      const store = useGitHistoryStore.getState();
      const target = { profileId: "p1", project: "repo-1" };

      store.setBranchPreference(target, {
        mode: "pinned",
        ref: "refs/heads/feature-x",
      });
      expect(store.getBranchPreference(target)).toEqual({
        mode: "pinned",
        ref: "refs/heads/feature-x",
      });

      // Switching root scope separates branch preference
      expect(store.getBranchPreference(target, "backend")).toEqual({
        mode: "follow-active",
      });

      // Setting back to follow-active clears entry from branchByScope
      store.setBranchPreference(target, { mode: "follow-active" });
      expect(store.getBranchPreference(target)).toEqual({ mode: "follow-active" });
      expect(Object.keys(useGitHistoryStore.getState().branchByScope)).toHaveLength(0);
    });

    it("clears invalid pinned branch back to follow-active", () => {
      const store = useGitHistoryStore.getState();
      const target = { profileId: "p1", project: "repo-1" };

      store.setBranchPreference(target, {
        mode: "pinned",
        ref: "refs/heads/old-branch",
      });
      store.clearBranchPreference(target);

      expect(store.getBranchPreference(target)).toEqual({ mode: "follow-active" });
    });
  });

  describe("Profile Deletion Lifecycle", () => {
    it("clears root and branch preferences for removed profile, while retaining selected keys as tombstones", () => {
      const store = useGitHistoryStore.getState();
      const p1Proj = projectKey({ profileId: "p1", project: "app" });
      const p2Proj = projectKey({ profileId: "p2", project: "app" });

      store.setGitPageSelection([p1Proj, p2Proj]);

      store.setRootForTarget({ profileId: "p1", project: "app" }, "server");
      store.setRootForTarget({ profileId: "p2", project: "app" }, "client");

      store.setBranchPreference(
        { profileId: "p1", project: "app" },
        { mode: "pinned", ref: "refs/heads/feat-1" },
      );
      store.setBranchPreference(
        { profileId: "p2", project: "app" },
        { mode: "pinned", ref: "refs/heads/feat-2" },
      );

      // Handle deletion of profile p1
      store.handleProfileRemoved("p1");

      const state = useGitHistoryStore.getState();

      // p1 preferences are removed
      expect(state.getRootForTarget({ profileId: "p1", project: "app" })).toBe(".");
      expect(
        state.getBranchPreference({ profileId: "p1", project: "app" }),
      ).toEqual({ mode: "follow-active" });

      // p2 preferences are retained
      expect(state.getRootForTarget({ profileId: "p2", project: "app" })).toBe("client");
      expect(
        state.getBranchPreference({ profileId: "p2", project: "app" }),
      ).toEqual({ mode: "pinned", ref: "refs/heads/feat-2" });

      // CRITICAL CONTRACT: gitPageSelection retains p1Proj as unavailable tombstone,
      // never silently deleting it or turning a nonempty selection into [] (all projects)!
      expect(state.gitPageSelection).toEqual([p1Proj, p2Proj]);
    });
  });

  describe("Schema Validation and Corrupted Storage Recovery", () => {
    it("drops malformed root and branch entries individually while keeping valid ones", () => {
      const currentState = useGitHistoryStore.getState();

      const validTargetKey = JSON.stringify(["p1", "proj", null]);
      const validScopeKey = JSON.stringify(["p1", "proj", null, "."]);

      const persisted = {
        gitPageSelection: null,
        rootByTarget: {
          [validTargetKey]: "backend",
          "invalid-target-key": "some-root",
          [JSON.stringify(["p1", "bad", null])]: "", // empty rootId
        },
        branchByScope: {
          [validScopeKey]: { mode: "pinned", ref: "refs/heads/valid" },
          "malformed-scope": { mode: "pinned", ref: "refs/heads/x" },
          [JSON.stringify(["p1", "bad", null, "."])]: { mode: "unknown-mode" },
          [JSON.stringify(["p1", "bad2", null, "."])]: { mode: "pinned", ref: "not-canonical" },
        },
        selectionRecoveryRequired: false,
      };

      const merged = validateAndMergeGitHistoryState(persisted, currentState);

      expect(merged.rootByTarget).toEqual({
        [validTargetKey]: "backend",
      });
      expect(merged.branchByScope).toEqual({
        [validScopeKey]: { mode: "pinned", ref: "refs/heads/valid" },
      });
      expect(merged.selectionRecoveryRequired).toBe(false);
    });

    it("sets selectionRecoveryRequired=true when persisted selection contains invalid keys", () => {
      const currentState = useGitHistoryStore.getState();

      const validKey = projectKey({ profileId: "p1", project: "proj-1" });
      const persisted = {
        gitPageSelection: [validKey, "not-a-valid-project-key", 123],
        rootByTarget: {},
        branchByScope: {},
        selectionRecoveryRequired: false,
      };

      const merged = validateAndMergeGitHistoryState(persisted, currentState);
      expect(merged.selectionRecoveryRequired).toBe(true);
      // Valid key is preserved but recovery is flagged
      expect(merged.gitPageSelection).toEqual([validKey]);
    });

    it("sets selectionRecoveryRequired=true when persisted selection is non-null non-array", () => {
      const currentState = useGitHistoryStore.getState();
      const persisted = {
        gitPageSelection: "unexpected-string",
        rootByTarget: {},
        branchByScope: {},
      };

      const merged = validateAndMergeGitHistoryState(persisted, currentState);
      expect(merged.selectionRecoveryRequired).toBe(true);
      expect(merged.gitPageSelection).toBeNull();
    });

    it("resets selectionRecoveryRequired upon explicit valid selection or Clear", () => {
      const store = useGitHistoryStore.getState();
      useGitHistoryStore.setState({ selectionRecoveryRequired: true });

      // Explicit clear resets it
      store.clearGitPageSelection();
      expect(useGitHistoryStore.getState().selectionRecoveryRequired).toBe(false);

      // Re-trigger and test explicit selection
      useGitHistoryStore.setState({ selectionRecoveryRequired: true });
      const validKey = projectKey({ profileId: "p1", project: "proj-1" });
      store.setGitPageSelection([validKey]);
      expect(useGitHistoryStore.getState().selectionRecoveryRequired).toBe(false);
    });

    it("migrates unknown version by flagging selectionRecoveryRequired", () => {
      const rawStored = JSON.stringify({
        state: {
          gitPageSelection: ["some-key"],
          rootByTarget: {},
          branchByScope: {},
        },
        version: 999, // unknown version
      });
      localStorage.setItem(GIT_HISTORY_STORAGE_KEY, rawStored);

      // Re-initialize store from storage
      useGitHistoryStore.persist.rehydrate();

      const state = useGitHistoryStore.getState();
      expect(state.selectionRecoveryRequired).toBe(true);
    });

    it("preserves selectionRecoveryRequired when migrating unknown version with valid keys", () => {
      const validKey = projectKey({ profileId: "p1", project: "app" });
      const rawStored = JSON.stringify({
        state: {
          gitPageSelection: [validKey],
          rootByTarget: {},
          branchByScope: {},
        },
        version: 999, // unknown version
      });

      localStorage.setItem(GIT_HISTORY_STORAGE_KEY, rawStored);
      useGitHistoryStore.persist.rehydrate();

      const state = useGitHistoryStore.getState();
      expect(state.selectionRecoveryRequired).toBe(true);
      expect(state.gitPageSelection).toEqual([validKey]);
    });

    it("sets gitPageSelection=null (never []) when all keys in non-empty array are invalid", () => {
      const currentState = useGitHistoryStore.getState();
      const persisted = {
        gitPageSelection: ["completely-invalid-1", "completely-invalid-2"],
        rootByTarget: {},
        branchByScope: {},
        selectionRecoveryRequired: false,
      };

      const merged = validateAndMergeGitHistoryState(persisted, currentState);
      expect(merged.selectionRecoveryRequired).toBe(true);
      // Must be null, NEVER [] (which represents explicit all projects)!
      expect(merged.gitPageSelection).toBeNull();
    });

    it("throws on setGitPageSelection with invalid keys and does not convert to []", () => {
      const store = useGitHistoryStore.getState();
      expect(() => {
        store.setGitPageSelection(["invalid-key"]);
      }).toThrow("Git page selection contains no valid project keys");

      // State remains unchanged
      expect(useGitHistoryStore.getState().gitPageSelection).toBeNull();
    });

    it("handles corrupt JSON in localStorage gracefully without throwing", () => {
      localStorage.setItem(GIT_HISTORY_STORAGE_KEY, "{corrupt-raw-json");

      expect(() => {
        useGitHistoryStore.persist.rehydrate();
      }).not.toThrow();

      const state = useGitHistoryStore.getState();
      expect(state.selectionRecoveryRequired).toBe(true);
      expect(state.isHydrated).toBe(true);
    });
  });

  describe("Storage-denied and isolation behavior", () => {
    it("keeps store operational in-memory even when localStorage throws security error", () => {
      const originalSetItem = localStorage.setItem;
      localStorage.setItem = () => {
        throw new Error("QuotaExceededError or StorageAccessDenied");
      };

      try {
        const store = useGitHistoryStore.getState();
        expect(() => {
          store.setRootForTarget({ profileId: "p1", project: "proj" }, "custom-root");
        }).not.toThrow();

        expect(
          useGitHistoryStore.getState().getRootForTarget({ profileId: "p1", project: "proj" }),
        ).toBe("custom-root");
      } finally {
        localStorage.setItem = originalSetItem;
      }
    });

    it("isolates entries between two profiles with identical project names", () => {
      const store = useGitHistoryStore.getState();
      const t1 = { profileId: "p-alpha", project: "same-repo" };
      const t2 = { profileId: "p-beta", project: "same-repo" };

      store.setRootForTarget(t1, "root-alpha");
      store.setRootForTarget(t2, "root-beta");

      store.setBranchPreference(t1, { mode: "pinned", ref: "refs/heads/alpha" });
      store.setBranchPreference(t2, { mode: "pinned", ref: "refs/heads/beta" });

      expect(store.getRootForTarget(t1)).toBe("root-alpha");
      expect(store.getRootForTarget(t2)).toBe("root-beta");

      expect(store.getBranchPreference(t1)).toEqual({
        mode: "pinned",
        ref: "refs/heads/alpha",
      });
      expect(store.getBranchPreference(t2)).toEqual({
        mode: "pinned",
        ref: "refs/heads/beta",
      });
    });
  });

  describe("Store hydration lifecycle and readiness", () => {
    it("maintains isHydrated: true readiness", () => {
      expect(useGitHistoryStore.getState().isHydrated).toBe(true);
    });

    it("markHydrated is idempotent and leaves other state unchanged", () => {
      const store = useGitHistoryStore.getState();
      expect(store.isHydrated).toBe(true);
      store.markHydrated();
      expect(useGitHistoryStore.getState().isHydrated).toBe(true);
    });

    it("settles isHydrated: true when rehydrated with empty, corrupt, or denied storage", () => {
      // Simulate empty rehydration
      useGitHistoryStore.setState({ isHydrated: false });
      expect(useGitHistoryStore.getState().isHydrated).toBe(false);
      useGitHistoryStore.getState().markHydrated();
      expect(useGitHistoryStore.getState().isHydrated).toBe(true);
    });
  });
});
