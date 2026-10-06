import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  normalizePlansBrowsePath,
  normalizePlanPath,
  normalizePlanDocumentPath,
  planFoldersQueryKey,
  selectedPlanQueryKey,
  planDocumentQueryKey,
  planFoldersPrefix,
  selectedPlanPrefix,
  planDocumentPrefix,
  decodeBase64Utf8,
  fetchPlanFolders,
  fetchSelectedPlan,
  fetchPlanDocument,
  planFoldersQueryOptions,
  selectedPlanQueryOptions,
  planDocumentQueryOptions,
} from "./project-plans-queries.js";
import {
  isPlanFoldersResponse,
  isSelectedPlanResponse,
  decodePlanFoldersResponse,
  decodeSelectedPlanResponse,
  type PlanFoldersResponse,
  type SelectedPlanResponse,
} from "./project-plans-types.js";
import {
  __setConnectionSnapshotForTests,
  resetConnections,
} from "./connections.js";
import type { ConnectionRef } from "./ownership.js";
import type { ApiClient } from "./client.js";

const mockOwner: ConnectionRef = {
  profileId: "profile-1",
  generation: 2,
};

const mockTarget = {
  project: "test-project",
  worktreePath: "/repo/worktree-1",
};

const validFoldersResponse: PlanFoldersResponse = {
  target: {
    project: "test-project",
    worktreePath: "/repo/worktree-1",
    targetKey: '["test-project","/repo/worktree-1"]',
  },
  path: "plans",
  kind: "collection",
  folderState: "present",
  folders: [{ path: "plans/261006-plan-a", name: "261006-plan-a" }],
  listing: {
    complete: true,
    entriesVisited: 1,
    limitsReached: [],
  },
  watchPaths: [".", "plans"],
  diagnostics: [],
};

const validPlanResponse: SelectedPlanResponse = {
  target: {
    project: "test-project",
    worktreePath: null,
    targetKey: '["test-project",null]',
  },
  plan: {
    id: "plans/261006-plan-a",
    title: "Test Plan",
    description: "A test plan",
    metadata: {
      priority: "P2",
      effort: "40h",
      issue: null,
      branch: null,
      tags: ["frontend"],
    },
    documents: {
      plan: {
        path: "plans/261006-plan-a/plan.md",
        state: "readable",
        sizeBytes: 1024,
        modifiedAt: "2026-10-06T12:00:00Z",
      },
      progress: {
        path: "plans/261006-plan-a/progress.md",
        state: "readable",
        sizeBytes: 512,
        modifiedAt: "2026-10-06T12:05:00Z",
      },
    },
    reportedStatus: {
      value: "in-progress",
      authority: "progress",
      raw: "In Progress",
      evidence: [],
      captured: [],
    },
    phases: [
      {
        id: "phase-01",
        number: 1,
        title: "Setup",
        path: "phase-01.md",
        reportedStatus: {
          value: "completed",
          authority: "progress",
          raw: "Completed",
          evidence: [],
          captured: [],
        },
        evidenceLinks: [],
      },
    ],
    completion: {
      declared: 1,
      completed: 1,
      unknown: 0,
      conflicted: 0,
      fraction: 1,
    },
    dates: {
      created: null,
      plannedStart: null,
      plannedEnd: null,
      actualStart: null,
      actualEnd: null,
      published: null,
    },
    lastDocumentUpdate: "2026-10-06T12:05:00Z",
    diagnostics: [],
  },
  watchPaths: [".", "plans", "plans/261006-plan-a"],
  diagnostics: [],
};

describe("Path Normalization", () => {
  it("normalizes empty or null browse path to 'plans'", () => {
    expect(normalizePlansBrowsePath(null)).toBe("plans");
    expect(normalizePlansBrowsePath(undefined)).toBe("plans");
    expect(normalizePlansBrowsePath("")).toBe("plans");
    expect(normalizePlansBrowsePath("   ")).toBe("plans");
    expect(normalizePlansBrowsePath(".")).toBe("plans");
  });

  it("normalizes nested browse paths and plan paths cleanly", () => {
    expect(normalizePlansBrowsePath("plans/subgroup")).toBe("plans/subgroup");
    expect(normalizePlansBrowsePath("plans//subgroup/")).toBe("plans/subgroup");
    expect(normalizePlanPath("plans/my-plan/")).toBe("plans/my-plan");
    expect(normalizePlanDocumentPath("plans/my-plan/phase-01.md")).toBe(
      "plans/my-plan/phase-01.md",
    );
  });
});

describe("Query Key Builders", () => {
  it("builds owner-bound folder query keys", () => {
    const key = planFoldersQueryKey(mockOwner, mockTarget, "plans/sub");
    expect(key).toEqual([
      "profile",
      "profile-1",
      2,
      "plan-folders",
      "test-project",
      "/repo/worktree-1",
      "plans/sub",
    ]);
  });

  it("builds owner-bound selected plan query keys", () => {
    const key = selectedPlanQueryKey(mockOwner, "test-project", "plans/plan-a");
    expect(key).toEqual([
      "profile",
      "profile-1",
      2,
      "plan",
      "test-project",
      null,
      "plans/plan-a",
    ]);
  });

  it("builds owner-bound document query keys with strict mode", () => {
    const key = planDocumentQueryKey(
      mockOwner,
      mockTarget,
      "plans/plan-a/plan.md",
    );
    expect(key).toEqual([
      "profile",
      "profile-1",
      2,
      "plan-document",
      "test-project",
      "/repo/worktree-1",
      "plans/plan-a/plan.md",
      "plan-document",
    ]);
  });

  it("builds prefix query keys for scoped invalidations", () => {
    expect(planFoldersPrefix(mockOwner, mockTarget)).toEqual([
      "profile",
      "profile-1",
      2,
      "plan-folders",
      "test-project",
      "/repo/worktree-1",
    ]);
    expect(selectedPlanPrefix(mockOwner, mockTarget)).toEqual([
      "profile",
      "profile-1",
      2,
      "plan",
      "test-project",
      "/repo/worktree-1",
    ]);
    expect(planDocumentPrefix(mockOwner, mockTarget)).toEqual([
      "profile",
      "profile-1",
      2,
      "plan-document",
      "test-project",
      "/repo/worktree-1",
    ]);
  });
});

describe("Type Guards and Decoders", () => {
  it("validates and decodes PlanFoldersResponse correctly", () => {
    expect(isPlanFoldersResponse(validFoldersResponse)).toBe(true);
    expect(decodePlanFoldersResponse(validFoldersResponse)).toEqual(
      validFoldersResponse,
    );
    expect(isPlanFoldersResponse({ invalid: true })).toBe(false);
    expect(() => decodePlanFoldersResponse({ invalid: true })).toThrow(
      "Invalid PlanFoldersResponse shape from server",
    );
  });

  it("validates and decodes SelectedPlanResponse correctly", () => {
    expect(isSelectedPlanResponse(validPlanResponse)).toBe(true);
    expect(decodeSelectedPlanResponse(validPlanResponse)).toEqual(
      validPlanResponse,
    );
    expect(isSelectedPlanResponse(null)).toBe(false);
    expect(() => decodeSelectedPlanResponse(null)).toThrow(
      "Invalid SelectedPlanResponse shape from server",
    );
  });

  it("decodes UTF-8 base64 encoded document text", () => {
    const plain = "Hello, world! 🚀 Chào bạn";
    const encoded = btoa(unescape(encodeURIComponent(plain)));
    expect(decodeBase64Utf8(encoded)).toBe(plain);
  });
});

describe("Fetchers and Query Option Factories", () => {
  beforeEach(() => {
    __setConnectionSnapshotForTests(mockOwner.profileId, {
      owner: mockOwner,
      status: "connected",
      serverUrl: "http://127.0.0.1:4801",
    });
  });

  afterEach(() => {
    resetConnections();
  });

  it("rejects fetch when owner connection is stale or disconnected", async () => {
    resetConnections();
    const mockClient = {
      plans: {
        folders: vi.fn(),
      },
    } as unknown as ApiClient;

    await expect(
      fetchPlanFolders(mockOwner, mockTarget, "plans", undefined, mockClient),
    ).rejects.toThrow("Connection is stale or not connected");
  });

  it("fetches plan folders using bound client", async () => {
    const mockClient = {
      plans: {
        folders: vi.fn(async () => validFoldersResponse),
      },
    } as unknown as ApiClient;

    const res = await fetchPlanFolders(
      mockOwner,
      mockTarget,
      "plans",
      undefined,
      mockClient,
    );
    expect(res).toEqual(validFoldersResponse);
    expect(mockClient.plans.folders).toHaveBeenCalledWith(mockTarget, "plans");
  });

  it("fetches selected plan using bound client", async () => {
    const mockClient = {
      plans: {
        read: vi.fn(async () => validPlanResponse),
      },
    } as unknown as ApiClient;

    const res = await fetchSelectedPlan(
      mockOwner,
      mockTarget,
      "plans/261006-plan-a",
      undefined,
      mockClient,
    );
    expect(res).toEqual(validPlanResponse);
    expect(mockClient.plans.read).toHaveBeenCalledWith(
      mockTarget,
      "plans/261006-plan-a",
    );
  });

  it("fetches plan document with plan-document mode and decodes content", async () => {
    const docText = "# Project Plan Content";
    const base64 = btoa(unescape(encodeURIComponent(docText)));

    const mockClient = {
      fs: {
        read: vi.fn(async () => ({
          ok: true,
          content: base64,
          binary: false,
        })),
      },
    } as unknown as ApiClient;

    const content = await fetchPlanDocument(
      mockOwner,
      mockTarget,
      "plans/my-plan/plan.md",
      undefined,
      mockClient,
    );
    expect(content).toBe(docText);
    expect(mockClient.fs.read).toHaveBeenCalledWith(
      mockTarget,
      "plans/my-plan/plan.md",
      { mode: "plan-document" },
    );
  });

  it("throws ApiRequestError when document read fails", async () => {
    const mockClient = {
      fs: {
        read: vi.fn(async () => ({
          ok: false,
          code: "NOT_FOUND",
          message: "Document not found",
        })),
      },
    } as unknown as ApiClient;

    await expect(
      fetchPlanDocument(
        mockOwner,
        mockTarget,
        "plans/missing.md",
        undefined,
        mockClient,
      ),
    ).rejects.toThrow("Document not found");
  });

  it("produces query options that reflect enabled state", () => {
    const foldersOpt = planFoldersQueryOptions(mockOwner, mockTarget, "plans");
    expect(foldersOpt.enabled).toBe(true);

    const disabledFolders = planFoldersQueryOptions(null, null);
    expect(disabledFolders.enabled).toBe(false);

    const planOpt = selectedPlanQueryOptions(
      mockOwner,
      mockTarget,
      "plans/plan-a",
    );
    expect(planOpt.enabled).toBe(true);

    const docOpt = planDocumentQueryOptions(
      mockOwner,
      mockTarget,
      "plans/plan-a/plan.md",
    );
    expect(docOpt.enabled).toBe(true);
  });
});
