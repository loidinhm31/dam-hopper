// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAggregatedTerminalSessions } from "./use-aggregated-terminal-sessions.js";

const mockProfiles = [
  { id: "profile-1", name: "Server A", url: "http://localhost:4801", autoConnect: true },
  { id: "profile-2", name: "Server B", url: "http://localhost:4802", autoConnect: true },
];

vi.mock("@/api/server-config.js", () => ({
  getProfiles: vi.fn(() => mockProfiles),
  subscribeToProfileChanges: vi.fn(() => () => {}),
  getProfileChangeVersion: vi.fn(() => 1),
}));

const mockConnections = {
  "profile-1": {
    owner: { profileId: "profile-1", generation: 1 },
    status: "connected",
  },
  "profile-2": {
    owner: { profileId: "profile-2", generation: 1 },
    status: "connected",
  },
};

vi.mock("@/api/connections.js", () => ({
  subscribeConnections: vi.fn(() => () => {}),
  getConnectionSnapshot: vi.fn((profileId: string) => mockConnections[profileId as keyof typeof mockConnections] ?? null),
  getTransport: vi.fn((owner: { profileId: string }) => ({
    invoke: vi.fn().mockImplementation(async (channel: string) => {
      if (channel === "terminal:listDetailed") {
        if (owner.profileId === "profile-1") {
          return [
            { id: "terminal:dam-hopper:_:1", project: "dam-hopper", command: "bash", alive: true, startedAt: 100 },
          ];
        }
        if (owner.profileId === "profile-2") {
          return [
            { id: "terminal:nonclaw:_:2", project: "nonclaw", command: "bash", alive: true, startedAt: 200 },
          ];
        }
      }
      return [];
    }),
  })),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueries: vi.fn().mockImplementation(({ queries }: { queries: Array<{ queryFn: () => Promise<unknown> }> }) => {
    return [
      {
        isLoading: false,
        isSuccess: true,
        data: [
          { id: "terminal:dam-hopper:_:1", project: "dam-hopper", command: "bash", alive: true, startedAt: 100, profileId: "profile-1" },
        ],
      },
      {
        isLoading: false,
        isSuccess: true,
        data: [
          { id: "terminal:nonclaw:_:2", project: "nonclaw", command: "bash", alive: true, startedAt: 200, profileId: "profile-2" },
        ],
      },
    ];
  }),
}));

describe("useAggregatedTerminalSessions", () => {
  let root: Root;
  let container: HTMLDivElement;
  let captured: ReturnType<typeof useAggregatedTerminalSessions> | null = null;

  function TestHarness() {
    captured = useAggregatedTerminalSessions();
    return null;
  }

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    captured = null;
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("aggregates terminal sessions across all profiles and tags profileId", () => {
    act(() => {
      root.render(createElement(TestHarness));
    });

    expect(captured).not.toBeNull();
    expect(captured?.sessions).toHaveLength(2);
    expect(captured?.sessions[0].id).toBe("terminal:dam-hopper:_:1");
    expect(captured?.sessions[0].profileId).toBe("profile-1");
    expect(captured?.sessions[1].id).toBe("terminal:nonclaw:_:2");
    expect(captured?.sessions[1].profileId).toBe("profile-2");
    expect(captured?.isSuccess).toBe(true);
    expect(captured?.isLoading).toBe(false);
  });
});
