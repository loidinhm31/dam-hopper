import { describe, expect, it, vi } from "vitest";
import { selectTerminal, syncTerminalProject } from "./terminal-selection.js";

function createCallbacks(events: string[]) {
  return {
    setActiveProject: vi.fn((project: string) => {
      events.push(`set:${project}`);
    }),
    openTerminalTab: vi.fn(
      (sessionId: string, project: string, command: string) => {
        events.push(`open:${sessionId}:${project}:${command}`);
      },
    ),
  };
}

describe("selectTerminal", () => {
  it("syncs the project when selecting an already-open project terminal", () => {
    const events: string[] = [];
    const callbacks = createCallbacks(events);

    syncTerminalProject({
      sessionId: "terminal:demo-project:dev",
      metadata: { project: "demo-project", command: "pnpm dev" },
      terminalAutoSwitchProjectEnabled: true,
      setActiveProject: callbacks.setActiveProject,
    });

    expect(events).toEqual(["set:demo-project"]);
  });

  it("sets the project before opening an enabled project terminal", () => {
    const events: string[] = [];
    const callbacks = createCallbacks(events);

    selectTerminal({
      sessionId: "terminal:demo-project:dev",
      metadata: { project: "demo-project", command: "pnpm dev" },
      terminalAutoSwitchProjectEnabled: true,
      ...callbacks,
    });

    expect(events).toEqual([
      "set:demo-project",
      "open:terminal:demo-project:dev:demo-project:pnpm dev",
    ]);
  });

  it("opens without setting the project when the preference is disabled", () => {
    const events: string[] = [];
    const callbacks = createCallbacks(events);

    selectTerminal({
      sessionId: "terminal:demo-project:dev",
      metadata: { project: "demo-project", command: "pnpm dev" },
      terminalAutoSwitchProjectEnabled: false,
      ...callbacks,
    });

    expect(events).toEqual([
      "open:terminal:demo-project:dev:demo-project:pnpm dev",
    ]);
  });

  it.each([
    { name: "with project metadata", project: "demo-project" },
    { name: "without project metadata", project: "" },
  ])(
    "opens a free terminal $name without setting the project",
    ({ project }) => {
      const events: string[] = [];
      const callbacks = createCallbacks(events);

      selectTerminal({
        sessionId: "free:session-1",
        metadata: { project, command: "bash" },
        terminalAutoSwitchProjectEnabled: true,
        ...callbacks,
      });

      expect(events).toEqual([`open:free:session-1:${project}:bash`]);
    },
  );

  it("opens a terminal with blank project metadata without setting the project", () => {
    const events: string[] = [];
    const callbacks = createCallbacks(events);

    selectTerminal({
      sessionId: "terminal:demo-project:dev",
      metadata: { project: "  ", command: "pnpm dev" },
      terminalAutoSwitchProjectEnabled: true,
      ...callbacks,
    });

    expect(events).toEqual(["open:terminal:demo-project:dev:  :pnpm dev"]);
  });

  it("does not switch an unknown session type", () => {
    const events: string[] = [];
    const callbacks = createCallbacks(events);

    syncTerminalProject({
      sessionId: "unknown:demo-project:session",
      metadata: { project: "demo-project", command: "pnpm dev" },
      terminalAutoSwitchProjectEnabled: true,
      setActiveProject: callbacks.setActiveProject,
    });

    expect(events).toEqual([]);
  });

  it("does not switch an unrecognized session prefix", () => {
    const events: string[] = [];
    const callbacks = createCallbacks(events);

    syncTerminalProject({
      sessionId: "legacy:demo-project:session",
      metadata: { project: "demo-project", command: "pnpm dev" },
      terminalAutoSwitchProjectEnabled: true,
      setActiveProject: callbacks.setActiveProject,
    });

    expect(events).toEqual([]);
  });

  it("opens with empty fallback metadata when the session is unresolved", () => {
    const events: string[] = [];
    const callbacks = createCallbacks(events);

    selectTerminal({
      sessionId: "terminal:unknown:dev",
      metadata: null,
      terminalAutoSwitchProjectEnabled: true,
      ...callbacks,
    });

    expect(events).toEqual(["open:terminal:unknown:dev::"]);
  });

  it("still delegates an already active project to the setter", () => {
    const events: string[] = [];
    const callbacks = createCallbacks(events);

    selectTerminal({
      sessionId: "terminal:demo-project:dev",
      metadata: { project: "demo-project", command: "pnpm dev" },
      terminalAutoSwitchProjectEnabled: true,
      ...callbacks,
    });

    expect(callbacks.setActiveProject).toHaveBeenCalledWith("demo-project");
    expect(events[0]).toBe("set:demo-project");
  });

  it("forwards session cwd and target metadata when selecting a terminal", () => {
    const callbacks = createCallbacks([]);

    selectTerminal({
      sessionId: "terminal:demo-project:dev",
      metadata: {
        project: "demo-project",
        command: "pnpm dev",
        cwd: "/worktrees/demo-feature/src",
        worktreePath: "/worktrees/demo-feature",
      },
      terminalAutoSwitchProjectEnabled: false,
      ...callbacks,
    });

    expect(callbacks.openTerminalTab).toHaveBeenCalledWith(
      "terminal:demo-project:dev",
      "demo-project",
      "pnpm dev",
      "/worktrees/demo-feature/src",
      "/worktrees/demo-feature",
    );
  });
});
