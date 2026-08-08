import { describe, expect, it } from "vitest";
import { buildRuntimeTree, reorderRuntimeIds } from "./terminal-runtime-tree.js";
import type { PortEntry } from "@/hooks/use-ports.js";
import type { MountedSession } from "@/components/organisms/MultiTerminalDisplay.js";
import type { TabEntry } from "@/components/organisms/TerminalTabBar.js";

function terminal(
  sessionId: string,
  project: string,
  command = "bash",
): MountedSession {
  return { sessionId, project, command, cwd: `/repo/${project}` };
}

function tab(sessionId: string, label: string, startedAt: number): TabEntry {
  return { sessionId, label, session: { id: sessionId, command: label, cwd: ".", type: "terminal", alive: true, startedAt } };
}

function port(portNumber: number, overrides: Partial<PortEntry> = {}): PortEntry {
  return {
    port: portNumber,
    project: overrides.project ?? "web",
    state: overrides.state ?? "listening",
    sessionId: overrides.sessionId ?? null,
    tunnel: overrides.tunnel ?? null,
  };
}

describe("buildRuntimeTree", () => {
  it("propagates pin state to standalone and grouped Runtime leaves", () => {
    const groups = buildRuntimeTree({
      terminals: [
        terminal("terminal:web:_:1", "web"),
        terminal("terminal:web:_:2", "web", "node worker.js"),
      ],
      tabs: [
        { ...tab("terminal:web:_:1", "web:one", 10), isPinned: true },
        { ...tab("terminal:web:_:2", "web:two", 20), isPinned: false },
      ],
      ports: [port(3001, { sessionId: "terminal:web:_:1", project: "web" })],
    });

    expect(groups[0]?.items).toMatchObject([
      {
        kind: "service-group",
        sessions: [{ sessionId: "terminal:web:_:1", isPinned: true }],
      },
      { kind: "session", sessionId: "terminal:web:_:2", isPinned: false },
    ]);
  });
  it("groups port-backed terminals into one project service node", () => {
    const groups = buildRuntimeTree({
      terminals: [
        terminal("terminal:web:_:1", "web"),
        terminal("terminal:web:_:2", "web", "node alt.js"),
        terminal("free:shell", "web", "bash"),
      ],
      tabs: [
        tab("terminal:web:_:1", "web:one", 10),
        tab("terminal:web:_:2", "web:two", 20),
        tab("free:shell", "web:shell", 30),
      ],
      ports: [
        port(3001, { sessionId: "terminal:web:_:1", project: "web" }),
        port(3002, { sessionId: "terminal:web:_:2", project: "web" }),
      ],
    });

    expect(groups.map((group) => group.name)).toEqual(["web"]);
    expect(groups[0]?.items).toMatchObject([
      {
        kind: "service-group",
        sessions: [
          { sessionId: "terminal:web:_:1", ports: [{ port: 3001 }] },
          { sessionId: "terminal:web:_:2", ports: [{ port: 3002 }] },
        ],
      },
      {
        kind: "session",
        sessionId: "free:shell",
      },
    ]);
  });

  it("creates standalone items for orphan ports", () => {
    const groups = buildRuntimeTree({
      terminals: [],
      tabs: [],
      ports: [port(4800, { project: "api" }), port(5173, { project: "api" })],
    });

    expect(groups[0]?.items.map((item) => item.id)).toEqual([
      "port:api:4800",
      "port:api:5173",
    ]);
  });

  it("uses persisted runtime order before fallback order", () => {
    const groups = buildRuntimeTree({
      terminals: [
        terminal("terminal:web:_:1", "web"),
        terminal("terminal:api:_:1", "api"),
      ],
      tabs: [
        tab("terminal:web:_:1", "web:bash", 20),
        tab("terminal:api:_:1", "api:bash", 10),
      ],
      ports: [port(3001, { project: "web", sessionId: "terminal:web:_:1" })],
      projectOrder: ["api", "web"],
      runtimeGroupOrder: ["web", "api"],
      runtimeItemOrder: { web: ["services:web"] },
    });

    expect(groups.map((group) => group.id)).toEqual(["web", "api"]);
    expect(groups[0]?.items[0]?.id).toBe("services:web");
  });

  it("falls back to service group first, then sessions, then orphan ports", () => {
    const groups = buildRuntimeTree({
      terminals: [
        terminal("terminal:web:_:1", "web"),
        terminal("terminal:web:_:2", "web"),
        terminal("free:web-shell", "web"),
      ],
      tabs: [
        tab("terminal:web:_:1", "web:one", 30),
        tab("terminal:web:_:2", "web:two", 10),
        tab("free:web-shell", "web:shell", 20),
      ],
      ports: [
        port(5000, { project: "web", sessionId: "terminal:web:_:1" }),
        port(6000, { project: "web" }),
        port(3000, { project: "web" }),
      ],
    });

    expect(groups[0]?.items.map((item) => item.id)).toEqual([
      "services:web",
      "session:terminal:web:_:2",
      "session:free:web-shell",
      "port:web:3000",
      "port:web:6000",
    ]);
  });
});

describe("reorderRuntimeIds", () => {
  it("keeps order stable unless a valid drag target is present", () => {
    expect(reorderRuntimeIds(["a", "b", "c"], "b", "a")).toEqual([
      "b",
      "a",
      "c",
    ]);
    expect(reorderRuntimeIds(["a", "b"], "a", "a")).toBeNull();
  });
});
