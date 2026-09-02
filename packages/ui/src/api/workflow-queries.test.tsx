// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, api } from "./client.js";
import { profileScopedQueryKeyHash } from "./query-client.js";
import {
  reconfigureTransport,
  type Transport,
} from "./transport.js";
import {
  classifyWorkflowOverviewError,
  generateWorkflowRequestId,
  isWorkflowOverviewUnavailable,
  useAbandonWorkflowSession,
  useCreateWorkflowItem,
  useCreateWorkflowNote,
  useCreateWorkflowSession,
  useDeleteWorkflowItem,
  useDeleteWorkflowNote,
  useEndWorkflowSession,
  useLinkWorkflowResource,
  usePatchWorkflowItem,
  usePurgeWorkflowHistory,
  useUnlinkWorkflowResource,
  useWorkflowEvents,
  useWorkflowOverview,
  workflowQueryKeys,
} from "./workflow-queries.js";
import type { WorkflowOverviewAvailability } from "./workflow-queries.js";
import type {
  EventsDto,
  ItemDto,
  LinkDto,
  MutationDto,
  NoteDto,
  OverviewDto,
  SessionDto,
  TombstoneDto,
} from "./workflow-types.js";

type OverviewQuerySnapshot = {
  availability: WorkflowOverviewAvailability;
  isUnavailable: boolean;
  data: OverviewDto | undefined;
  isLoading: boolean;
  error: Error | null;
};

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let root: Root | null = null;
let queryClient: QueryClient;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

const mockOverview: OverviewDto = {
  workspace: { id: "ws-1", name: "Test WS" },
  serverTime: "2026-09-02T12:00:00.000Z",
  projects: [],
  plans: [],
  standaloneTasks: [],
  runningSessions: [],
  recentEvents: [],
  truncated: false,
};

const mockEvents: EventsDto = {
  events: [],
  nextCursor: null,
};

function createMockMutationDto<T>(resource: T): MutationDto<T> {
  return {
    resource,
    replayed: false,
    eventId: "e1",
  };
}

describe("workflow-queries", () => {
  describe("query keys and profile isolation", () => {
    it("generates structured query keys", () => {
      expect(workflowQueryKeys.all).toEqual(["workflow"]);
      expect(workflowQueryKeys.overviewRoot).toEqual(["workflow", "overview"]);
      expect(workflowQueryKeys.overview(0)).toEqual([
        "workflow",
        "overview",
        0,
      ]);
      expect(workflowQueryKeys.overview(2)).toEqual([
        "workflow",
        "overview",
        2,
      ]);
      expect(workflowQueryKeys.eventsRoot).toEqual(["workflow", "events"]);
      expect(workflowQueryKeys.events("cur1", 10)).toEqual([
        "workflow",
        "events",
        { cursor: "cur1", limit: 10 },
      ]);
      expect(workflowQueryKeys.events()).toEqual([
        "workflow",
        "events",
        { cursor: null, limit: null },
      ]);
    });
    it("isolates query cache across profiles using profileScopedQueryKeyHash", () => {
      localStorage.setItem("damhopper_active_profile_id", "profile-alpha");
      const hashAlpha = profileScopedQueryKeyHash(
        workflowQueryKeys.overview(0),
      );

      localStorage.setItem("damhopper_active_profile_id", "profile-beta");
      const hashBeta = profileScopedQueryKeyHash(workflowQueryKeys.overview(0));

      expect(hashAlpha).not.toEqual(hashBeta);
      expect(hashAlpha).toContain("profile-alpha");
      expect(hashBeta).toContain("profile-beta");
    });
  });

  describe("request ID generation", () => {
    it("generates valid UUID v4 format request IDs", () => {
      const id1 = generateWorkflowRequestId();
      const id2 = generateWorkflowRequestId();
      expect(typeof id1).toBe("string");
      expect(id1.length).toBe(36);
      expect(id1).not.toEqual(id2);
      expect(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          id1,
        ),
      ).toBe(true);
    });
  });
  describe("useWorkflowOverview hook", () => {
    it("fetches overview successfully", async () => {
      const overviewSpy = vi
        .spyOn(api.workflow, "overview")
        .mockResolvedValue(mockOverview);

      let hookData: OverviewDto | undefined;
      function TestHarness() {
        const query = useWorkflowOverview();
        hookData = query.data;
        return (
          <div data-testid="status">
            {query.isSuccess ? "ready" : "loading"}
          </div>
        );
      }

      const container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);

      await act(async () => {
        root?.render(
          <QueryClientProvider client={queryClient}>
            <TestHarness />
          </QueryClientProvider>,
        );
      });

      expect(overviewSpy).toHaveBeenCalledTimes(1);
      await vi.waitFor(() => {
        expect(hookData).toEqual(mockOverview);
      });
    });


    it("classifies only an overview ApiRequestError 404 as unavailable", () => {
      expect(
        classifyWorkflowOverviewError(new ApiRequestError("missing", 404)),
      ).toBe("unavailable");
      expect(
        isWorkflowOverviewUnavailable(new ApiRequestError("missing", 404)),
      ).toBe(true);
      expect(
        classifyWorkflowOverviewError(new ApiRequestError("unauthorized", 401)),
      ).toBe("error");
      expect(
        classifyWorkflowOverviewError(new ApiRequestError("server error", 500)),
      ).toBe("error");
      expect(classifyWorkflowOverviewError(new Error("missing"))).toBe("error");
      expect(classifyWorkflowOverviewError({ status: 404 })).toBe("error");
    });

    it("exposes a stable unavailable state for an overview 404", async () => {
      vi.spyOn(api.workflow, "overview").mockRejectedValue(
        new ApiRequestError("workflow route unavailable", 404),
      );

      let latestQuery: OverviewQuerySnapshot | undefined;
      function TestHarness() {
        latestQuery = useWorkflowOverview();
        return <div>{latestQuery.availability}</div>;
      }

      const container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);

      await act(async () => {
        root?.render(
          <QueryClientProvider client={queryClient}>
            <TestHarness />
          </QueryClientProvider>,
        );
      });

      await vi.waitFor(() => {
        expect(latestQuery?.availability).toBe("unavailable");
      });
      expect(latestQuery?.isUnavailable).toBe(true);
      expect(latestQuery?.error).toBeInstanceOf(ApiRequestError);
    });

    it.each([401, 500])(
      "keeps overview status %s as a retryable error",
      async (status) => {
        const error = new ApiRequestError(`HTTP ${status}`, status);
        vi.spyOn(api.workflow, "overview").mockRejectedValue(error);

        let latestQuery: OverviewQuerySnapshot | undefined;
        function TestHarness() {
          latestQuery = useWorkflowOverview();
          return <div>{latestQuery.availability}</div>;
        }

        const container = document.createElement("div");
        document.body.append(container);
        root = createRoot(container);

        await act(async () => {
          root?.render(
            <QueryClientProvider client={queryClient}>
              <TestHarness />
            </QueryClientProvider>,
          );
        });

        await vi.waitFor(() => {
          expect(latestQuery?.availability).toBe("error");
        });
        expect(latestQuery?.isUnavailable).toBe(false);
        expect(latestQuery?.error).toBe(error);
      },
    );

    it("does not flash the prior overview after transport generation changes", async () => {
      let resolveNext: ((overview: OverviewDto) => void) | undefined;
      vi.spyOn(api.workflow, "overview")
        .mockResolvedValueOnce(mockOverview)
        .mockImplementationOnce(
          () =>
            new Promise<OverviewDto>((resolve) => {
              resolveNext = resolve;
            }),
        );

      let latestQuery: OverviewQuerySnapshot | undefined;
      function TestHarness() {
        latestQuery = useWorkflowOverview();
        return <div>{latestQuery.data?.workspace.name ?? "loading"}</div>;
      }

      const container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);

      await act(async () => {
        root?.render(
          <QueryClientProvider client={queryClient}>
            <TestHarness />
          </QueryClientProvider>,
        );
      });
      await vi.waitFor(() => expect(latestQuery?.data).toEqual(mockOverview));

      await act(async () => {
        reconfigureTransport({} as Transport);
      });

      await vi.waitFor(() => {
        expect(latestQuery?.isLoading).toBe(true);
      });
      expect(latestQuery?.data).toBeUndefined();

      await act(async () => {
        resolveNext?.(mockOverview);
      });
    });
  });
  describe("useWorkflowEvents hook", () => {
    it("fetches events with parameters", async () => {
      const eventsSpy = vi
        .spyOn(api.workflow, "events")
        .mockResolvedValue(mockEvents);

      let hookData: EventsDto | undefined;
      function TestHarness() {
        const query = useWorkflowEvents({ cursor: "test-cur", limit: 50 });
        hookData = query.data;
        return (
          <div data-testid="status">
            {query.isSuccess ? "ready" : "loading"}
          </div>
        );
      }

      const container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);

      await act(async () => {
        root?.render(
          <QueryClientProvider client={queryClient}>
            <TestHarness />
          </QueryClientProvider>,
        );
      });

      expect(eventsSpy).toHaveBeenCalledWith({
        cursor: "test-cur",
        limit: 50,
      });
      await vi.waitFor(() => {
        expect(hookData).toEqual(mockEvents);
      });
    });
  });
  describe("mutation hooks invalidation", () => {
    it("invalidates workflow queries upon mutation success", async () => {
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

      const mockItem: ItemDto = {
        id: "i1",
        target: { project: "demo" },
        kind: "task",
        title: "My Task",
        status: "backlog",
        sortOrder: 0,
        source: "manual",
        createdAt: "2026-09-02T10:00:00.000Z",
        updatedAt: "2026-09-02T10:00:00.000Z",
      };

      vi.spyOn(api.workflow, "createItem").mockResolvedValue(
        createMockMutationDto(mockItem),
      );

      let triggerMutate: (() => Promise<unknown>) | null = null;
      function TestHarness() {
        const mutation = useCreateWorkflowItem();
        triggerMutate = () =>
          mutation.mutateAsync({
            requestId: "r1",
            target: { project: "demo" },
            kind: "task",
            title: "My Task",
          });
        return <div>test</div>;
      }

      const container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);

      await act(async () => {
        root?.render(
          <QueryClientProvider client={queryClient}>
            <TestHarness />
          </QueryClientProvider>,
        );
      });

      await act(async () => {
        await triggerMutate?.();
      });

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: workflowQueryKeys.all,
      });
    });

    it("does not invalidate on mutation failure and preserves error", async () => {
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
      const error = new Error("Validation failed");

      vi.spyOn(api.workflow, "createItem").mockRejectedValue(error);

      let triggerMutate: (() => Promise<unknown>) | null = null;
      function TestHarness() {
        const mutation = useCreateWorkflowItem();
        triggerMutate = () =>
          mutation.mutateAsync({
            requestId: "r1",
            target: { project: "demo" },
            kind: "task",
            title: "My Task",
          });
        return <div>test</div>;
      }

      const container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);

      await act(async () => {
        root?.render(
          <QueryClientProvider client={queryClient}>
            <TestHarness />
          </QueryClientProvider>,
        );
      });

      let caught: unknown = null;
      await act(async () => {
        try {
          await triggerMutate?.();
        } catch (err) {
          caught = err;
        }
      });

      expect(caught).toBe(error);
      expect(invalidateSpy).not.toHaveBeenCalled();
    });

    it("verifies all mutation hooks trigger api.workflow methods and invalidation", async () => {
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

      const mockItem: ItemDto = {
        id: "i1",
        target: { project: "demo" },
        kind: "task",
        title: "Task",
        status: "backlog",
        sortOrder: 0,
        source: "manual",
        createdAt: "2026-09-02T10:00:00.000Z",
        updatedAt: "2026-09-02T10:00:00.000Z",
      };
      const mockTombstone: TombstoneDto = {
        resourceType: "item",
        id: "i1",
        deletedAt: "2026-09-02T10:00:00.000Z",
      };
      const mockSession: SessionDto = {
        id: "s1",
        target: { project: "demo" },
        status: "running",
        startedAt: "2026-09-02T10:00:00.000Z",
        source: "manual",
        createdAt: "2026-09-02T10:00:00.000Z",
        updatedAt: "2026-09-02T10:00:00.000Z",
      };
      const mockLink: LinkDto = {
        id: "l1",
        sessionId: "s1",
        resourceType: "terminal",
        externalId: "t1",
        observedState: "attached",
        firstSeenAt: "2026-09-02T10:00:00.000Z",
        lastSeenAt: "2026-09-02T10:00:00.000Z",
        linkSource: "manual",
        createdAt: "2026-09-02T10:00:00.000Z",
        updatedAt: "2026-09-02T10:00:00.000Z",
      };
      const mockNote: NoteDto = {
        id: "n1",
        body: "Test note",
        source: "manual",
        createdAt: "2026-09-02T10:00:00.000Z",
        updatedAt: "2026-09-02T10:00:00.000Z",
      };

      const patchItemSpy = vi
        .spyOn(api.workflow, "patchItem")
        .mockResolvedValue(createMockMutationDto(mockItem));
      const deleteItemSpy = vi
        .spyOn(api.workflow, "deleteItem")
        .mockResolvedValue(createMockMutationDto(mockTombstone));
      const createSessionSpy = vi
        .spyOn(api.workflow, "createSession")
        .mockResolvedValue(createMockMutationDto(mockSession));
      const endSessionSpy = vi
        .spyOn(api.workflow, "endSession")
        .mockResolvedValue(createMockMutationDto(mockSession));
      const abandonSessionSpy = vi
        .spyOn(api.workflow, "abandonSession")
        .mockResolvedValue(createMockMutationDto(mockSession));
      const linkSpy = vi
        .spyOn(api.workflow, "linkResource")
        .mockResolvedValue(createMockMutationDto(mockLink));
      const unlinkSpy = vi
        .spyOn(api.workflow, "unlinkResource")
        .mockResolvedValue(createMockMutationDto(mockTombstone));
      const createNoteSpy = vi
        .spyOn(api.workflow, "createNote")
        .mockResolvedValue(createMockMutationDto(mockNote));
      const deleteNoteSpy = vi
        .spyOn(api.workflow, "deleteNote")
        .mockResolvedValue(createMockMutationDto(mockTombstone));
      const purgeSpy = vi
        .spyOn(api.workflow, "purgeHistory")
        .mockResolvedValue({ eventsDeleted: 10, notesDeleted: 5 });

      const runners: Record<string, () => Promise<unknown>> = {};
      function TestHarness() {
        const patchItem = usePatchWorkflowItem();
        const deleteItem = useDeleteWorkflowItem();
        const createSession = useCreateWorkflowSession();
        const endSession = useEndWorkflowSession();
        const abandonSession = useAbandonWorkflowSession();
        const linkResource = useLinkWorkflowResource();
        const unlinkResource = useUnlinkWorkflowResource();
        const createNote = useCreateWorkflowNote();
        const deleteNote = useDeleteWorkflowNote();
        const purgeHistory = usePurgeWorkflowHistory();

        runners.patchItem = () =>
          patchItem.mutateAsync({
            id: "i1",
            requestId: "r1",
            updatedAt: "now",
            title: "t",
          });
        runners.deleteItem = () =>
          deleteItem.mutateAsync({
            id: "i1",
            requestId: "r1",
            updatedAt: "now",
          });
        runners.createSession = () =>
          createSession.mutateAsync({
            requestId: "r1",
            target: { project: "p" },
            startedAt: "now",
          });
        runners.endSession = () =>
          endSession.mutateAsync({
            id: "s1",
            requestId: "r1",
            endedAt: "now",
          });
        runners.abandonSession = () =>
          abandonSession.mutateAsync({ id: "s1", requestId: "r1" });
        runners.linkResource = () =>
          linkResource.mutateAsync({
            sessionId: "s1",
            requestId: "r1",
            resourceType: "terminal",
            externalId: "t1",
          });
        runners.unlinkResource = () =>
          unlinkResource.mutateAsync({
            sessionId: "s1",
            requestId: "r1",
            updatedAt: "now",
            resourceType: "terminal",
            externalId: "t1",
          });
        runners.createNote = () =>
          createNote.mutateAsync({ requestId: "r1", body: "b" });
        runners.deleteNote = () =>
          deleteNote.mutateAsync({
            id: "n1",
            requestId: "r1",
            updatedAt: "now",
          });
        runners.purgeHistory = () =>
          purgeHistory.mutateAsync({ requestId: "r1", before: "now" });

        return <div>all</div>;
      }

      const container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);

      await act(async () => {
        root?.render(
          <QueryClientProvider client={queryClient}>
            <TestHarness />
          </QueryClientProvider>,
        );
      });

      await act(async () => {
        for (const runner of Object.values(runners)) {
          await runner();
        }
      });

      expect(patchItemSpy).toHaveBeenCalled();
      expect(deleteItemSpy).toHaveBeenCalled();
      expect(createSessionSpy).toHaveBeenCalled();
      expect(endSessionSpy).toHaveBeenCalled();
      expect(abandonSessionSpy).toHaveBeenCalled();
      expect(linkSpy).toHaveBeenCalled();
      expect(unlinkSpy).toHaveBeenCalled();
      expect(createNoteSpy).toHaveBeenCalled();
      expect(deleteNoteSpy).toHaveBeenCalled();
      expect(purgeSpy).toHaveBeenCalled();
      expect(invalidateSpy).toHaveBeenCalledTimes(10);
    });
  });
});
