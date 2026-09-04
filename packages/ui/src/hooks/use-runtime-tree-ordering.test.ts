import { describe, expect, it } from "vitest";
import {
  moveRuntimeGroupOrder,
  moveRuntimeItemOrder,
} from "./use-runtime-tree-ordering.js";
import type { RuntimeTreeGroup } from "@/lib/terminal-runtime-tree.js";

const groups: RuntimeTreeGroup[] = [
  {
    id: "web",
    name: "web",
    isFreeGroup: false,
    items: [
      {
        kind: "session",
        id: "session:web",
        groupId: "web",
        sessionId: "web",
        label: "web",
        project: "web",
        command: "pnpm dev",
        startedAt: 1,
        ports: [],
      },
      {
        kind: "port",
        id: "port:web:5173",
        groupId: "web",
        port: 5173,
        ports: [
          {
            port: 5173,
            project: "web",
            state: "listening",
            sessionId: null,
            tunnelStatus: null,
          },
        ],
      },
    ],
  },
  {
    id: "api",
    name: "api",
    isFreeGroup: false,
    items: [],
  },
];

describe("moveRuntimeGroupOrder", () => {
  it("produces runtimeGroupOrder for a group drag", () => {
    expect(moveRuntimeGroupOrder(groups, "api", "web")).toEqual(["api", "web"]);
  });
});

describe("moveRuntimeItemOrder", () => {
  it("produces runtimeItemOrder for an item drag within a group", () => {
    expect(
      moveRuntimeItemOrder(groups, {}, "web", "port:web:5173", "session:web"),
    ).toEqual({
      web: ["port:web:5173", "session:web"],
    });
  });
});
