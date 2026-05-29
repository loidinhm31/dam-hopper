import { describe, expect, it } from "vitest";
import { groupActiveTerminalRuntime } from "./terminal-runtime-groups.js";
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

function tab(sessionId: string, label: string): TabEntry {
  return { sessionId, label, session: undefined };
}

function port(
  portNumber: number,
  overrides: Partial<PortEntry> = {},
): PortEntry {
  return {
    port: portNumber,
    project: overrides.project ?? "web",
    state: overrides.state ?? "listening",
    sessionId: overrides.sessionId ?? null,
    tunnel: overrides.tunnel ?? null,
  };
}

describe("groupActiveTerminalRuntime", () => {
  it("groups active terminals by project", () => {
    const groups = groupActiveTerminalRuntime({
      terminals: [
        terminal("terminal:web:_:1", "web"),
        terminal("run:api", "api", "pnpm dev"),
      ],
      tabs: [tab("terminal:web:_:1", "web:bash"), tab("run:api", "api:run")],
      ports: [],
    });

    expect(groups.map((group) => group.name)).toEqual(["web", "api"]);
    expect(groups[0]?.terminals[0]?.label).toBe("web:bash");
    expect(groups[1]?.terminals[0]?.command).toBe("pnpm dev");
  });

  it("places projectless free terminals in a free terminal group", () => {
    const groups = groupActiveTerminalRuntime({
      terminals: [terminal("free:abc", "", "")],
      tabs: [tab("free:abc", "Terminal 1")],
      ports: [],
    });

    expect(groups).toMatchObject([
      {
        id: "__free__",
        name: "Free Terminals",
        isFreeGroup: true,
        terminals: [{ sessionId: "free:abc", label: "Terminal 1" }],
      },
    ]);
  });

  it("groups project ports even without an active terminal", () => {
    const groups = groupActiveTerminalRuntime({
      terminals: [],
      tabs: [],
      ports: [port(5173, { project: "web" })],
    });

    expect(groups).toMatchObject([
      { name: "web", ports: [{ port: 5173, state: "listening" }] },
    ]);
  });

  it("uses sessionId association before the port project label", () => {
    const groups = groupActiveTerminalRuntime({
      terminals: [terminal("terminal:api:_:1", "api")],
      tabs: [],
      ports: [
        port(4800, {
          project: "stale-label",
          sessionId: "terminal:api:_:1",
        }),
      ],
    });

    expect(groups).toMatchObject([
      {
        name: "api",
        terminals: [{ sessionId: "terminal:api:_:1" }],
        ports: [{ port: 4800, project: "api" }],
      },
    ]);
  });

  it("excludes lost ports", () => {
    const groups = groupActiveTerminalRuntime({
      terminals: [terminal("terminal:web:_:1", "web")],
      tabs: [],
      ports: [
        port(3000, { project: "web", state: "lost" }),
        port(3001, { project: "web", state: "provisional" }),
      ],
    });

    expect(groups[0]?.ports.map((entry) => entry.port)).toEqual([3001]);
  });
});
