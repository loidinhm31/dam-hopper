import { describe, expect, it, vi } from "vitest";

const worktrees = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: unknown) => options,
  useMutation: vi.fn(),
  useQueryClient: vi.fn(),
}));

vi.mock("./client.js", () => ({
  api: { git: { worktrees } },
  isGitUnavailableError: vi.fn(),
  normalizeProjectTarget: (target: unknown) => target,
  normalizeProjectTargetPath: (path: string) => path,
  projectTargetCacheKey: vi.fn(),
}));

vi.mock("./transport.js", () => ({ getTransport: vi.fn() }));
vi.mock("@/stores/editor.js", () => ({
  useEditorStore: { getState: vi.fn() },
}));

import { useWorktrees } from "./queries.js";

describe("useWorktrees discovery policy", () => {
  it("disables all fetching when disabled", () => {
    const query = useWorktrees("demo-project", {
      enabled: false,
    }) as unknown as Record<string, unknown>;

    expect(query.enabled).toBe(false);
    expect(query.refetchInterval).toBe(false);
    expect(query.refetchOnWindowFocus).toBe(false);
    expect(query.refetchOnReconnect).toBe(false);
  });

  it("strictly disables interval polling and enables event/reconnect/focus refresh when enabled", () => {
    const query = useWorktrees("demo-project", {
      enabled: true,
    }) as unknown as Record<string, unknown>;

    expect(query.enabled).toBe(true);
    expect(query.refetchInterval).toBe(false);
    expect(query.refetchOnWindowFocus).toBe("always");
    expect(query.refetchOnReconnect).toBe("always");
  });
});
