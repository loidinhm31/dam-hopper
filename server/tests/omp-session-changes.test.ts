import { describe, expect, it } from "bun:test";
import damHopperSessionChangesExtension, {
  chunkCapturePaths,
  createRootSessionRegistration,
  derivePrivateHttpUrl,
  isGlobPattern,
  makePendingKey,
  mapSettledOutcome,
  normalizeRelativePath,
  parseAstEditTargets,
  parseHashlineEdits,
  rebasePathToRoot,
  sanitizeSessionId,
  validateLoopbackWsUrl,
  MAX_CHILD_ENTRIES,
  SessionChangesProducer,
  SessionChangesProducerRegistry,
  type RootSessionRegistration,
  type OmpExtensionAPI,
  type OmpExtensionContext,
} from "../src/agent_status/assets/omp-session-changes";
import damHopperAgentStatusExtension from "../src/agent_status/assets/omp-agent-status";

// ============================================================================
// 1. URL and Parameter Validation
// ============================================================================

describe("Session Changes URL and Parameter Validation", () => {
  it("validates loopback WS URLs strictly and accepts IPv4, localhost, and IPv6", () => {
    expect(validateLoopbackWsUrl("ws://127.0.0.1:4801/v1/agent-status")).not.toBeNull();
    expect(validateLoopbackWsUrl("wss://localhost:4801/v1/agent-status")).not.toBeNull();
    expect(validateLoopbackWsUrl("ws://[::1]:4801/v1/agent-status")).not.toBeNull();

    // Rejects remote hosts and invalid schemes
    expect(validateLoopbackWsUrl("ws://192.168.1.50:4801/v1/agent-status")).toBeNull();
    expect(validateLoopbackWsUrl("ws://example.com:4801/v1/agent-status")).toBeNull();
    expect(validateLoopbackWsUrl("http://127.0.0.1:4801/v1/agent-status")).toBeNull();
    expect(validateLoopbackWsUrl("not a url")).toBeNull();
    expect(validateLoopbackWsUrl(undefined)).toBeNull();

    // Rejects credentials, query, and fragments
    expect(validateLoopbackWsUrl("ws://user:pass@127.0.0.1:4801/v1")).toBeNull();
    expect(validateLoopbackWsUrl("ws://127.0.0.1:4801/v1?token=leak")).toBeNull();
    expect(validateLoopbackWsUrl("ws://127.0.0.1:4801/v1#hash")).toBeNull();
  });

  it("derives private HTTP URL from loopback WS URL", () => {
    expect(derivePrivateHttpUrl("ws://127.0.0.1:4801/v1/agent-status")).toBe(
      "http://127.0.0.1:4801/private/session-changes/v1",
    );
    expect(derivePrivateHttpUrl("wss://localhost:4801/v1/agent-status")).toBe(
      "https://localhost:4801/private/session-changes/v1",
    );
  });

  it("sanitizes session ID to printable safe characters and enforces fallback", () => {
    expect(sanitizeSessionId("session-123")).toBe("session-123");
    expect(sanitizeSessionId("/var/log/session-abc")).toBe("session-abc");
    expect(sanitizeSessionId("C:\\data\\session-xyz")).toBe("session-xyz");
    expect(sanitizeSessionId("")).toBe("session-unknown");
    expect(sanitizeSessionId(null)).toBe("session-unknown");
  });

  it("maps settled outcomes accurately from assistant stop reasons", () => {
    expect(mapSettledOutcome("stop", false)).toBe("completed");
    expect(mapSettledOutcome("ended", false)).toBe("completed");
    expect(mapSettledOutcome("completed", false)).toBe("completed");
    expect(mapSettledOutcome("aborted", false)).toBe("interrupted");
    expect(mapSettledOutcome("interrupted", false)).toBe("interrupted");
    expect(mapSettledOutcome("error", false)).toBe("error");
    expect(mapSettledOutcome("ended", true)).toBe("error");
    expect(mapSettledOutcome("unknown_reason", false)).toBe("unknown");
  });
});

// ============================================================================
// 2. Path Rebasing & Tool Input Parsing
// ============================================================================

describe("Path Rebasing & Tool Input Parsing", () => {
  it("rebases child-cwd paths into registered root correctly", () => {
    const rootCwd = "/home/user/project";
    const childCwd = "/home/user/project/packages/sub";

    // Relative to child
    expect(rebasePathToRoot("index.ts", childCwd, rootCwd)).toBe("packages/sub/index.ts");
    expect(rebasePathToRoot("./src/file.ts", childCwd, rootCwd)).toBe(
      "packages/sub/src/file.ts",
    );

    // Absolute within root
    expect(
      rebasePathToRoot("/home/user/project/packages/sub/src/file.ts", childCwd, rootCwd),
    ).toBe("packages/sub/src/file.ts");

    // Rejects paths outside root
    expect(rebasePathToRoot("/other/repo/file.ts", childCwd, rootCwd)).toBeNull();
    expect(rebasePathToRoot("../../../outside.ts", childCwd, rootCwd)).toBeNull();

    // Rejects the root directory itself
    expect(rebasePathToRoot("/home/user/project", childCwd, rootCwd)).toBeNull();

    // Rejects directory targets (ending with slash)
    expect(rebasePathToRoot("packages/sub/", childCwd, rootCwd)).toBeNull();

    // Rejects internal URLs
    expect(rebasePathToRoot("memory://root/notes.md", childCwd, rootCwd)).toBeNull();
    expect(rebasePathToRoot("ssh://server/home/user/file.ts", childCwd, rootCwd)).toBeNull();

    // Rejects archive and database selectors
    expect(rebasePathToRoot("archive.zip:member.ts", childCwd, rootCwd)).toBeNull();
    expect(rebasePathToRoot("data.db:users", childCwd, rootCwd)).toBeNull();
    expect(rebasePathToRoot("app.asar:bundle.js", childCwd, rootCwd)).toBeNull();
  });

  it("supports Windows drive letters cleanly", () => {
    const rootCwd = "C:/Users/project";
    const childCwd = "C:/Users/project/src";

    expect(rebasePathToRoot("app.ts", childCwd, rootCwd)).toBe("src/app.ts");
    expect(rebasePathToRoot("C:/Users/project/src/app.ts", childCwd, rootCwd)).toBe("src/app.ts");
    expect(rebasePathToRoot("D:/other/project/file.ts", childCwd, rootCwd)).toBeNull();
  });

  it("parses Hashline edit patches with multiple headers, MV, and REM with root rebasing", () => {
    const rootCwd = "/home/user/project";
    const childCwd = "/home/user/project/pkg";

    const patch = `
[hello.ts#A1B2]
PUT 1*:
+function hello() {
+  console.log("hello");
+}
[utils/math.ts#C3D4]
MV utils/calculator.ts
[deprecated.ts#E5F6]
REM
[spaced name.ts#7890]
MV "new spaced name.ts"
[quote.ts#1122]
MV 'single quoted.ts'
`;

    const parsed = parseHashlineEdits(patch, childCwd, rootCwd);
    expect(parsed).toContain("pkg/hello.ts");
    expect(parsed).toContain("pkg/utils/math.ts");
    expect(parsed).toContain("pkg/utils/calculator.ts");
    expect(parsed).toContain("pkg/deprecated.ts");
    expect(parsed).toContain("pkg/spaced name.ts");
    expect(parsed).toContain("pkg/new spaced name.ts");
    expect(parsed).toContain("pkg/quote.ts");
    expect(parsed).toContain("pkg/single quoted.ts");
  });

  it("never misinterprets patch body content as block headers", () => {
    const patchWithCode = `
[code.py#A1B2]
PUT 1*:
+[fake_header#1234]
+print("not a real header")
`;

    const parsed = parseHashlineEdits(patchWithCode, "/root", "/root");
    expect(parsed).toEqual(["code.py"]);
  });

  it("chunks capture paths to respect UTF-8 byte bounds", () => {
    const basePayload = {
      version: 1,
      serverEpoch: "epoch-1",
      terminalIncarnation: "1",
      ompSessionId: "session-1",
      rootId: ".",
      baselineId: "base-1",
      captureId: "capture-1",
      mode: "preEdit" as const,
    };

    const manyPaths: string[] = [];
    for (let i = 0; i < 150; i++) {
      manyPaths.push(`src/deeply/nested/directory/structure/module_${i}/service_${i}.ts`);
    }

    const chunks = chunkCapturePaths(basePayload, manyPaths, 2048);
    expect(chunks.length).toBeGreaterThan(1);

    const flattened = chunks.flat();
    expect(flattened.length).toBe(150);

    const encoder = new TextEncoder();
    for (const chunk of chunks) {
      const bytes = encoder.encode(JSON.stringify({ ...basePayload, paths: chunk })).length;
      expect(bytes).toBeLessThanOrEqual(2048 + 100);
    }
  });

  it("identifies glob patterns correctly", () => {
    expect(isGlobPattern("src/**/*.ts")).toBe(true);
    expect(isGlobPattern("src/*.js")).toBe(true);
    expect(isGlobPattern("src/file?.ts")).toBe(true);
    expect(isGlobPattern("src/[a-z].ts")).toBe(true);
    expect(isGlobPattern("src/{a,b}.ts")).toBe(true);
    expect(isGlobPattern("src/index.ts")).toBe(false);
  });

  it("parses ast_edit targets including concrete paths and excluding globs or directories", () => {
    const input = {
      paths: [
        "src/model.ts",
        "src/**/*.ts", // glob -> excluded
        "src/utils/", // directory -> excluded
        "archive.zip:sub", // selector -> excluded
        "src/controller.ts",
      ],
    };

    const targets = parseAstEditTargets(input, "/root", "/root");
    expect(targets).toEqual(["src/model.ts", "src/controller.ts"]);
  });
});

// ============================================================================
// 3. Lineage and In-Process Registry
// ============================================================================

describe("Session Changes Registry & Lineage Resolution", () => {
  it("resolves root session directly for main agent", () => {
    const registry = new SessionChangesProducerRegistry();
    const mockRoot: RootSessionRegistration = {
      serverEpoch: "epoch-1",
      terminalIncarnation: "1",
      ompSessionId: "root-session-1",
      rootId: ".",
      baselineId: "base-1",
      disabled: false,
      knownPaths: new Set(),
      unprovenPaths: new Set(),
      pendingUnprovenFlush: new Set(),
    };

    registry.registerRoot("main-1", mockRoot);

    const resolved = registry.resolveRoot({ kind: "main", id: "main-1" });
    expect(resolved).toBeDefined();
    expect(resolved?.ompSessionId).toBe("root-session-1");
  });

  it("resolves multi-level subagent lineage to root session", () => {
    const registry = new SessionChangesProducerRegistry();
    const mockRoot: RootSessionRegistration = {
      serverEpoch: "epoch-1",
      terminalIncarnation: "1",
      ompSessionId: "root-session-1",
      rootId: ".",
      baselineId: "base-1",
      disabled: false,
      knownPaths: new Set(),
      unprovenPaths: new Set(),
      pendingUnprovenFlush: new Set(),
    };

    registry.registerRoot("main-agent", mockRoot);
    registry.recordChildAgent("sub-task-1", "main-agent");
    registry.recordChildAgent("nested-task-2", "sub-task-1");

    const resolvedSub = registry.resolveRoot({
      kind: "sub",
      id: "sub-task-1",
      parentId: "main-agent",
    });
    expect(resolvedSub?.ompSessionId).toBe("root-session-1");

    const resolvedNested = registry.resolveRoot({
      kind: "sub",
      id: "nested-task-2",
      parentId: "sub-task-1",
    });
    expect(resolvedNested?.ompSessionId).toBe("root-session-1");
  });

  it("enforces MAX_RETAINED_ROOTS cap by evicting oldest", () => {
    const registry = new SessionChangesProducerRegistry();
    for (let i = 0; i < 35; i++) {
      registry.registerRoot(`agent-${i}`, {
        serverEpoch: "epoch-1",
        terminalIncarnation: "1",
        ompSessionId: `session-${i}`,
        rootId: ".",
        baselineId: `base-${i}`,
        disabled: false,
        knownPaths: new Set(),
        unprovenPaths: new Set(),
        pendingUnprovenFlush: new Set(),
      });
    }

    expect(registry.roots.size).toBe(32);
    expect(registry.roots.has("session-0")).toBe(false);
    expect(registry.roots.has("session-1")).toBe(false);
    expect(registry.roots.has("session-2")).toBe(false);
    expect(registry.roots.has("session-34")).toBe(true);
  });
});

// ============================================================================
// 4. Real Loopback HTTP Server Smoke Tests (Bun.serve)
// ============================================================================

describe("Session Changes Real Loopback HTTP Smoke Suite", () => {
  it("completes full register -> capture -> settled lifecycle over real HTTP loopback", async () => {
    const recordedRequests: Array<{ path: string; body: Record<string, unknown> }> = [];

    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        const url = new URL(req.url);
        const body = await req.json();
        recordedRequests.push({ path: url.pathname, body });

        if (url.pathname === "/private/session-changes/v1/register") {
          return Response.json({
            serverEpoch: "epoch-live",
            terminalIncarnation: "1",
            ompSessionId: body.ompSessionId,
            rootId: ".",
            baselineId: "base-live-1",
            canonicalRoot: "/workspace",
          });
        }
        if (url.pathname === "/private/session-changes/v1/capture") {
          return Response.json({
            version: 1,
            captureId: body.captureId,
            results: body.paths.map((p: string) => ({
              path: p,
              status: "captured",
              presence: "present",
            })),
          });
        }
        if (url.pathname === "/private/session-changes/v1/settled") {
          return Response.json({ accepted: true });
        }
        return new Response("Not found", { status: 404 });
      },
    });

    try {
      const httpUrl = `http://127.0.0.1:${server.port}/private/session-changes/v1`;
      const registry = new SessionChangesProducerRegistry();
      const producer = new SessionChangesProducer({
        httpUrl,
        token: "real-test-token",
        registry,
      });

      // 1. Register
      const root = await producer.registerSession("session-real", "main", "/workspace");
      expect(root).not.toBeNull();
      expect(root?.baselineId).toBe("base-live-1");

      // 2. Tool call triggers capture
      const ctx: OmpExtensionContext = {
        agent: { kind: "main", id: "main" },
        cwd: "/workspace",
      };
      await producer.handleToolCall("write", { path: "src/server.ts" }, ctx, "call-real-1");

      expect(root?.knownPaths.has("src/server.ts")).toBe(true);

      // 3. Settled turn
      await producer.handleAgentEnd(
        {
          willContinue: false,
          messages: [{ role: "assistant", stopReason: "stop" }],
        },
        ctx,
      );

      expect(recordedRequests.length).toBe(3);
      expect(recordedRequests[0].path).toBe("/private/session-changes/v1/register");
      expect(recordedRequests[1].path).toBe("/private/session-changes/v1/capture");
      expect(recordedRequests[1].body.mode).toBe("preEdit");
      expect(recordedRequests[2].path).toBe("/private/session-changes/v1/settled");
      expect(recordedRequests[2].body.outcome).toBe("completed");
    } finally {
      server.stop(true);
    }
  });

  it("enforces strict deadline abort and fails open without throwing", async () => {
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/private/session-changes/v1/capture") {
          // Delay by 200 ms
          const gate = Promise.withResolvers<void>();
          setTimeout(gate.resolve, 200);
          await gate.promise;
          return Response.json({ version: 1, captureId: "late", results: [] });
        }
        return new Response("{}", { status: 200 });
      },
    });

    try {
      const httpUrl = `http://127.0.0.1:${server.port}/private/session-changes/v1`;
      const registry = new SessionChangesProducerRegistry();
      const producer = new SessionChangesProducer({
        httpUrl,
        token: "test-token",
        captureTimeoutMs: 50, // Strict 50ms deadline
        registry,
      });

      const root: RootSessionRegistration = {
        serverEpoch: "epoch-1",
        terminalIncarnation: "1",
        ompSessionId: "session-deadline",
        rootId: ".",
        baselineId: "base-1",
        disabled: false,
        rootCwd: "/workspace",
        knownPaths: new Set(),
        unprovenPaths: new Set(),
        pendingUnprovenFlush: new Set(),
      };
      registry.registerRoot("main", root);

      // Must complete without error (fail-open)
      const startTime = performance.now();
      await producer.handleToolCall(
        "write",
        { path: "src/delayed.ts" },
        { agent: { kind: "main", id: "main" }, cwd: "/workspace" },
      );
      const elapsed = performance.now() - startTime;

      // Aborted around 50ms, well before the 200ms server delay
      expect(elapsed).toBeLessThan(180);
      expect(root.unprovenPaths.has("src/delayed.ts")).toBe(true);
    } finally {
      server.stop(true);
    }
  });

  it("fences session switches: delayed registration for old session is discarded", async () => {
    let unblockOldRegister: (() => void) | null = null;

    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        const body = (await req.json()) as Record<string, unknown>;
        if (body.ompSessionId === "session-A") {
          const gate = Promise.withResolvers<void>();
          unblockOldRegister = gate.resolve;
          await gate.promise;
        }
        return Response.json({
          serverEpoch: "epoch-1",
          terminalIncarnation: "1",
          ompSessionId: body.ompSessionId,
          rootId: ".",
          baselineId: `base-${body.ompSessionId}`,
          canonicalRoot: "/workspace",
        });
      },
    });

    try {
      const httpUrl = `http://127.0.0.1:${server.port}/private/session-changes/v1`;
      const registry = new SessionChangesProducerRegistry();
      const producer = new SessionChangesProducer({
        httpUrl,
        token: "test-token",
        registry,
      });

      // 1. Session A starts registering
      const promiseA = producer.registerSession("session-A", "main", "/workspace");

      // 2. User switches to Session B before A finishes via handleSessionSwitch
      const promiseB = producer.handleSessionSwitch("session-B", "main", "/workspace");
      const rootB = await promiseB;
      expect(rootB?.ompSessionId).toBe("session-B");

      // 3. Late response for A arrives
      unblockOldRegister?.();
      const rootA = await promiseA;

      // A is discarded due to generation mismatch
      expect(rootA).toBeNull();
      expect(registry.roots.has("session-A")).toBe(false);
      expect(registry.roots.has("session-B")).toBe(true);
    } finally {
      server.stop(true);
    }
  });

  it("enforces hard 500-path cap across known and unproven paths", async () => {
    const registry = new SessionChangesProducerRegistry();
    const producer = new SessionChangesProducer({
      httpUrl: "http://127.0.0.1:4801/private/session-changes/v1",
      token: "test-token",
      registry,
    });

    const root: RootSessionRegistration = {
      serverEpoch: "epoch-1",
      terminalIncarnation: "1",
      ompSessionId: "session-cap",
      rootId: ".",
      baselineId: "base-cap",
      disabled: false,
      rootCwd: "/workspace",
      knownPaths: new Set(),
      unprovenPaths: new Set(),
      pendingUnprovenFlush: new Set(),
    };
    registry.registerRoot("main", root);

    // Pre-fill 500 paths
    for (let i = 0; i < 500; i++) {
      root.knownPaths.add(`file_${i}.ts`);
    }

    // 501st path should be rejected/dropped immediately
    await producer.handleToolCall(
      "write",
      { path: "file_501.ts" },
      { agent: { kind: "main", id: "main" }, cwd: "/workspace" },
    );

    expect(root.knownPaths.size + root.unprovenPaths.size).toBe(500);
    expect(root.knownPaths.has("file_501.ts")).toBe(false);
  });
});

// ============================================================================
// 5. Dual Extension Factory Isolation Smoke
// ============================================================================

describe("Dual Extension Factory Isolation & Combined Harness Smoke", () => {
  it("instantiates both extensions simultaneously without event handler collision", () => {
    const savedEnv = process.env;
    process.env = { ...savedEnv };
    try {
      delete process.env.OMPCODE;
      process.env.DAM_HOPPER_AGENT_STATUS_URL = "ws://127.0.0.1:4801/v1/agent-status";
      process.env.DAM_HOPPER_AGENT_STATUS_TOKEN = "valid-token-123";

      const registeredHandlers: Record<string, Function[]> = {};
      const mockPi: OmpExtensionAPI = {
        on(event, handler) {
          if (!registeredHandlers[event]) registeredHandlers[event] = [];
          registeredHandlers[event].push(handler);
        },
      };

      // Load both extensions in the same OMP harness
      damHopperAgentStatusExtension(mockPi);
      damHopperSessionChangesExtension(mockPi);

      // Both extensions register session_start and agent_end
      expect(registeredHandlers.session_start.length).toBe(2);
      expect(registeredHandlers.session_switch.length).toBe(2);
      expect(registeredHandlers.agent_end.length).toBe(2);

      // Only Session Changes registers tool_call and tool_result
      expect(registeredHandlers.tool_call.length).toBe(1);
      expect(registeredHandlers.tool_result.length).toBe(1);
    } finally {
      process.env = savedEnv;
    }
  });
});

// ============================================================================
// 6. PR #82 Code Review Regression Suite
// ============================================================================

describe("PR #82 Code Review Regressions", () => {
  it("Issue 1: subdirectory launch anchors to canonicalRoot and falls back to launchCwd if ctx.cwd omitted", async () => {
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/private/session-changes/v1/register") {
          const body = (await req.json()) as Record<string, unknown>;
          return Response.json({
            serverEpoch: "epoch-sub",
            terminalIncarnation: "1",
            ompSessionId: body.ompSessionId as string,
            rootId: ".",
            baselineId: "base-sub-1",
            canonicalRoot: "/repo",
          });
        }
        if (url.pathname === "/private/session-changes/v1/capture") {
          const body = (await req.json()) as Record<string, unknown>;
          return Response.json({
            version: 1,
            captureId: body.captureId as string,
            results: (body.paths as string[]).map((p: string) => ({
              path: p,
              status: "captured",
              presence: "present",
            })),
          });
        }
        return new Response("Not found", { status: 404 });
      },
    });

    try {
      const httpUrl = `http://127.0.0.1:${server.port}/private/session-changes/v1`;
      const registry = new SessionChangesProducerRegistry();
      const producer = new SessionChangesProducer({
        httpUrl,
        token: "sub-test-token",
        registry,
      });

      // Terminal launched OMP in /repo/src subdirectory
      const root = await producer.registerSession("session-subdir", "main", "/repo/src");
      expect(root).not.toBeNull();
      expect(root?.canonicalRoot).toBe("/repo");
      expect(root?.launchCwd).toBe("/repo/src");
      expect(root?.rootCwd).toBe("/repo");

      // Case A: tool call with explicit ctx.cwd in subdirectory
      const ctxWithCwd: OmpExtensionContext = {
        agent: { kind: "main", id: "main" },
        cwd: "/repo/src",
      };
      await producer.handleToolCall("write", { path: "app.ts" }, ctxWithCwd, "call-sub-1");
      expect(root?.knownPaths.has("src/app.ts")).toBe(true);
      expect(root?.knownPaths.has("app.ts")).toBe(false);

      // Case B: tool call with MISSING ctx.cwd (falls back to launchCwd /repo/src)
      const ctxWithoutCwd: OmpExtensionContext = {
        agent: { kind: "main", id: "main" },
      };
      await producer.handleToolCall("write", { path: "utils.ts" }, ctxWithoutCwd, "call-sub-2");
      expect(root?.knownPaths.has("src/utils.ts")).toBe(true);
      expect(root?.knownPaths.has("utils.ts")).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  it("Issue 1: rejects registration if server canonicalRoot is missing or empty", async () => {
    const server = Bun.serve({
      port: 0,
      async fetch() {
        return Response.json({
          serverEpoch: "epoch-1",
          terminalIncarnation: "1",
          ompSessionId: "session-bad",
          rootId: ".",
          baselineId: "base-bad",
          // missing canonicalRoot
        });
      },
    });

    try {
      const httpUrl = `http://127.0.0.1:${server.port}/private/session-changes/v1`;
      const registry = new SessionChangesProducerRegistry();
      const producer = new SessionChangesProducer({
        httpUrl,
        token: "test-token",
        registry,
      });

      const root = await producer.registerSession("session-bad", "main", "/repo");
      expect(root).toBeNull();
    } finally {
      server.stop(true);
    }
  });

  it("Issue 2: preserves pendingCalls across session switch, attributes late result to origin session A, and rejects unoriginating results", async () => {
    const capturedBatches: Array<{ sessionId: string; paths: string[] }> = [];
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        const body = (await req.json()) as Record<string, unknown>;
        if (url.pathname === "/private/session-changes/v1/register") {
          return Response.json({
            serverEpoch: "epoch-1",
            terminalIncarnation: "1",
            ompSessionId: body.ompSessionId as string,
            rootId: ".",
            baselineId: `base-${body.ompSessionId as string}`,
            canonicalRoot: "/repo",
          });
        }
        if (url.pathname === "/private/session-changes/v1/capture") {
          capturedBatches.push({ sessionId: body.ompSessionId as string, paths: body.paths as string[] });
          return Response.json({
            version: 1,
            captureId: body.captureId as string,
            results: (body.paths as string[]).map((p: string) => ({
              path: p,
              status: "captured",
              presence: "present",
            })),
          });
        }
        return new Response("Not found", { status: 404 });
      },
    });

    try {
      const httpUrl = `http://127.0.0.1:${server.port}/private/session-changes/v1`;
      const registry = new SessionChangesProducerRegistry();
      const producer = new SessionChangesProducer({
        httpUrl,
        token: "test-token",
        registry,
      });

      // 1. Register Session A
      const rootA = await producer.registerSession("session-A", "main", "/repo");
      expect(rootA).not.toBeNull();

      // 2. Session A starts a tool call
      const ctxA: OmpExtensionContext = {
        agent: { kind: "main", id: "main" },
        cwd: "/repo",
      };
      await producer.handleToolCall("ast-edit", { files: ["src/a.ts"] }, ctxA, "call-A-1");
      expect(producer.pendingCalls.has(makePendingKey("session-A", "main", "call-A-1"))).toBe(true);

      // 3. Switch to Session B via handleSessionSwitch
      const rootB = await producer.handleSessionSwitch("session-B", "main", "/repo");
      expect(rootB?.ompSessionId).toBe("session-B");

      // Verify pendingCalls preserved "call-A-1" (was NOT cleared)
      expect(producer.pendingCalls.has(makePendingKey("session-A", "main", "call-A-1"))).toBe(true);

      // 4. Late tool result arrives for Session A's call-A-1
      await producer.handleToolResult(
        "ast-edit",
        { files: ["/repo/src/late-from-a.ts"] },
        ctxA,
        "call-A-1",
      );

      // Path MUST be attributed to Session A, NOT Session B!
      expect(rootA?.unprovenPaths.has("src/late-from-a.ts")).toBe(true);
      expect(rootB?.unprovenPaths.has("src/late-from-a.ts")).toBe(false);

      // 5. Tool result with missing/unknown origin is rejected immediately
      await producer.handleToolResult(
        "ast-edit",
        { files: ["/repo/src/unknown-origin.ts"] },
        { agent: { kind: "main", id: "main" } },
        "call-nonexistent",
      );
      expect(rootA?.unprovenPaths.has("src/unknown-origin.ts")).toBe(false);
      expect(rootB?.unprovenPaths.has("src/unknown-origin.ts")).toBe(false);

      // 6. Tool result without toolCallId is rejected immediately
      await producer.handleToolResult(
        "ast-edit",
        { files: ["/repo/src/no-id.ts"] },
        { agent: { kind: "main", id: "main" } },
        undefined,
      );
      expect(rootA?.unprovenPaths.has("src/no-id.ts")).toBe(false);
      expect(rootB?.unprovenPaths.has("src/no-id.ts")).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  it("Issue 2: isolates duplicate toolCallId across different agents", async () => {
    const registry = new SessionChangesProducerRegistry();
    const producer = new SessionChangesProducer({
      httpUrl: "http://127.0.0.1:4801/private/session-changes/v1",
      token: "test-token",
      registry,
    });

    const root1 = createRootSessionRegistration("sess-1", "epoch-1", "1", "base-1", "/repo");
    const root2 = createRootSessionRegistration("sess-2", "epoch-1", "1", "base-2", "/repo");
    registry.registerRoot("agent-1", root1);
    registry.registerRoot("agent-2", root2);

    // Both agent-1 and agent-2 issue tool calls with the identical toolCallId "call-shared"
    const ctx1: OmpExtensionContext = { agent: { kind: "sub", id: "agent-1" }, cwd: "/repo" };
    const ctx2: OmpExtensionContext = { agent: { kind: "sub", id: "agent-2" }, cwd: "/repo" };

    await producer.handleToolCall("write", { path: "file-1.ts" }, ctx1, "call-shared");
    await producer.handleToolCall("write", { path: "file-2.ts" }, ctx2, "call-shared");

    expect(producer.pendingCalls.has(makePendingKey("sess-1", "agent-1", "call-shared"))).toBe(true);
    expect(producer.pendingCalls.has(makePendingKey("sess-2", "agent-2", "call-shared"))).toBe(true);

    // Test A: Mismatched agent lookup is rejected (agent-2 cannot consume agent-1's call)
    await producer.handleToolCall("write", { path: "only-1.ts" }, ctx1, "call-only-1");
    const ctxMismatched: OmpExtensionContext = { agent: { kind: "sub", id: "agent-2" }, cwd: "/repo" };
    await producer.handleToolResult("edit", { path: "/repo/mismatched-target.ts" }, ctxMismatched, "call-only-1");
    expect(root1.unprovenPaths.has("mismatched-target.ts")).toBe(false);
    expect(root2.unprovenPaths.has("mismatched-target.ts")).toBe(false);
    expect(producer.pendingCalls.has(makePendingKey("sess-1", "agent-1", "call-only-1"))).toBe(true);

    // Test B: Ambiguous agentless lookup: context omits agent, but both agent-1 and agent-2 have "call-shared"
    await producer.handleToolResult("edit", { path: "/repo/ambiguous.ts" }, undefined, "call-shared");
    // Ambiguous lookup rejected: neither root receives the path, and both descriptors remain intact!
    expect(root1.unprovenPaths.has("ambiguous.ts")).toBe(false);
    expect(root2.unprovenPaths.has("ambiguous.ts")).toBe(false);
    expect(producer.pendingCalls.has(makePendingKey("sess-1", "agent-1", "call-shared"))).toBe(true);
    expect(producer.pendingCalls.has(makePendingKey("sess-2", "agent-2", "call-shared"))).toBe(true);

    // Test C: Resolve result for agent-1 explicitly
    await producer.handleToolResult("edit", { path: "/repo/file-1-edit.ts" }, ctx1, "call-shared");
    expect(root1.unprovenPaths.has("file-1-edit.ts")).toBe(true);
    expect(root2.unprovenPaths.has("file-1-edit.ts")).toBe(false);
    // Authoritative key deleted atomically
    expect(producer.pendingCalls.has(makePendingKey("sess-1", "agent-1", "call-shared"))).toBe(false);

    // Test D: Agentless duplicate from agent-1 cannot consume agent-2's descriptor because "call-shared" was ever ambiguous
    await producer.handleToolResult("edit", { path: "/repo/file-2-agentless.ts" }, undefined, "call-shared");
    expect(root2.unprovenPaths.has("file-2-agentless.ts")).toBe(false);
    expect(producer.pendingCalls.has(makePendingKey("sess-2", "agent-2", "call-shared"))).toBe(true);

    // Test E: Legitimate explicit agent-2 result resolves correctly
    await producer.handleToolResult("edit", { path: "/repo/file-2-edit.ts" }, ctx2, "call-shared");
    expect(root2.unprovenPaths.has("file-2-edit.ts")).toBe(true);
    expect(producer.pendingCalls.has(makePendingKey("sess-2", "agent-2", "call-shared"))).toBe(false);

    // Test F: Duplicate delivery after consumption is rejected
    await producer.handleToolResult("edit", { path: "/repo/duplicate.ts" }, ctx2, "call-shared");
    expect(root2.unprovenPaths.has("duplicate.ts")).toBe(false);
  });

  it("Issue 2: prevents descriptor collision when the same agent reuses callId across sessions", async () => {
    const registry = new SessionChangesProducerRegistry();
    const producer = new SessionChangesProducer({
      httpUrl: "http://127.0.0.1:4801/private/session-changes/v1",
      token: "test-token",
      registry,
    });

    const rootA = createRootSessionRegistration("sess-A", "epoch-1", "1", "base-A", "/repo");
    const rootB = createRootSessionRegistration("sess-B", "epoch-1", "1", "base-B", "/repo");
    registry.registerRoot("main", rootA);

    const ctxMain: OmpExtensionContext = { agent: { kind: "main", id: "main" }, cwd: "/repo" };

    // 1. Session A issues call-1
    await producer.handleToolCall("write", { path: "file-A.ts" }, ctxMain, "call-1");
    expect(producer.pendingCalls.has(makePendingKey("sess-A", "main", "call-1"))).toBe(true);

    // 2. Switch to Session B; main issues call-1 again in Session B
    registry.registerRoot("main", rootB);
    await producer.handleToolCall("write", { path: "file-B.ts" }, ctxMain, "call-1");

    // Attempt to overwrite in session A while in-flight is rejected: session B gets its own distinct key!
    expect(producer.pendingCalls.has(makePendingKey("sess-A", "main", "call-1"))).toBe(true);

    // 3. Late result arriving for call-1 without disambiguation is rejected as ambiguous across sessions
    await producer.handleToolResult("edit", { path: "/repo/ambig.ts" }, ctxMain, "call-1");
    // Neither session adopts the ambiguous result!
    expect(rootA.unprovenPaths.has("ambig.ts")).toBe(false);
    expect(rootB.unprovenPaths.has("ambig.ts")).toBe(false);
  });

  // ==========================================================================
  // PR #82 Re-review Deterministic Regression Matrix (R1 - R13)
  // ==========================================================================

  function createDeferred<T = void>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: any) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  function generateNestedPaths(count: number, prefix: string): string[] {
    const paths: string[] = [];
    for (let i = 0; i < count; i++) {
      paths.push(`src/modules/submodule_${i}/nested_feature_${i}/component_${prefix}_${i}.ts`);
    }
    return paths;
  }

  it("R1: multi-chunk late result delivery posts all chunks to session A across session switch", async () => {
    const recordedCaptures: any[] = [];
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        const url = new URL(req.url);
        const body = await req.json();
        if (url.pathname === "/private/session-changes/v1/register") {
          return Response.json({
            serverEpoch: "epoch-1",
            terminalIncarnation: "1",
            ompSessionId: body.ompSessionId,
            rootId: ".",
            baselineId: `base-${body.ompSessionId}`,
            canonicalRoot: "/repo",
          });
        }
        if (url.pathname === "/private/session-changes/v1/capture") {
          recordedCaptures.push(body);
          return Response.json({
            version: 1,
            captureId: body.captureId,
            results: (body.paths as string[]).map((p: string) => ({
              path: p,
              status: "captured",
              presence: "present",
            })),
          });
        }
        return new Response("Not found", { status: 404 });
      },
    });

    try {
      const httpUrl = `http://127.0.0.1:${server.port}/private/session-changes/v1`;
      const registry = new SessionChangesProducerRegistry();
      const producer = new SessionChangesProducer({ httpUrl, token: "test-token", registry });

      // 1. Register Session A
      const rootA = await producer.registerSession("session-A", "main", "/repo");
      expect(rootA).not.toBeNull();

      // 2. Begin tool call in Session A (glob only, no pre-edit captures)
      const ctxA: OmpExtensionContext = { agent: { kind: "main", id: "main" }, cwd: "/repo" };
      await producer.handleToolCall("ast-edit", { files: ["src/**/*.ts"] }, ctxA, "call-multi-1");

      // 3. Switch to Session B
      const rootB = await producer.handleSessionSwitch("session-B", "main", "/repo");
      expect(rootB?.ompSessionId).toBe("session-B");

      // 4. Deliver late result with 300 nested paths (> 16 KiB total JSON body)
      const paths = generateNestedPaths(300, "r1");
      await producer.handleToolResult(
        "ast-edit",
        { files: paths.map((p) => `/repo/${p}`) },
        ctxA,
        "call-multi-1",
      );

      // Verify at least 2 chunks were posted
      expect(recordedCaptures.length).toBeGreaterThanOrEqual(2);

      // Flatten and verify all paths posted
      const allPostedPaths = recordedCaptures.flatMap((c) => c.paths);
      expect(allPostedPaths).toHaveLength(paths.length);
      expect(new Set(allPostedPaths)).toEqual(new Set(paths));

      // Verify every capture named session A with complete original tuple
      for (const cap of recordedCaptures) {
        expect(cap.version).toBe(1);
        expect(cap.serverEpoch).toBe("epoch-1");
        expect(cap.terminalIncarnation).toBe("1");
        expect(cap.ompSessionId).toBe("session-A");
        expect(cap.rootId).toBe(".");
        expect(cap.baselineId).toBe("base-session-A");
        expect(cap.mode).toBe("unproven");
      }
      // Session B received 0 paths
      expect(rootB?.unprovenPaths.size).toBe(0);
    } finally {
      server.stop(true);
    }
  });

  it("R2: paused chunk 1 followed by switch to B still delivers chunk 2 to session A", async () => {
    const chunk1Received = createDeferred();
    const releaseChunk1 = createDeferred();
    const recordedCaptures: any[] = [];

    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        const url = new URL(req.url);
        const body = await req.json();
        if (url.pathname === "/private/session-changes/v1/register") {
          return Response.json({
            serverEpoch: "epoch-1",
            terminalIncarnation: "1",
            ompSessionId: body.ompSessionId,
            rootId: ".",
            baselineId: `base-${body.ompSessionId}`,
            canonicalRoot: "/repo",
          });
        }
        if (url.pathname === "/private/session-changes/v1/capture") {
          recordedCaptures.push(body);
          if (recordedCaptures.length === 1) {
            chunk1Received.resolve();
            await releaseChunk1.promise;
          }
          return Response.json({
            version: 1,
            captureId: body.captureId,
            results: (body.paths as string[]).map((p: string) => ({
              path: p,
              status: "captured",
              presence: "present",
            })),
          });
        }
        return new Response("Not found", { status: 404 });
      },
    });

    try {
      const httpUrl = `http://127.0.0.1:${server.port}/private/session-changes/v1`;
      const registry = new SessionChangesProducerRegistry();
      const producer = new SessionChangesProducer({ httpUrl, token: "test-token", registry });

      const rootA = await producer.registerSession("session-A", "main", "/repo");
      const ctxA: OmpExtensionContext = { agent: { kind: "main", id: "main" }, cwd: "/repo" };
      await producer.handleToolCall("ast-edit", { files: ["src/**/*.ts"] }, ctxA, "call-r2");

      const paths = generateNestedPaths(300, "r2");
      const resultPromise = producer.handleToolResult(
        "ast-edit",
        { files: paths.map((p) => `/repo/${p}`) },
        ctxA,
        "call-r2",
      );

      // Wait for chunk 1 to arrive at peer
      await chunk1Received.promise;

      // Switch to Session B while chunk 1 is paused
      const rootB = await producer.handleSessionSwitch("session-B", "main", "/repo");
      expect(rootB?.ompSessionId).toBe("session-B");

      // Release chunk 1
      releaseChunk1.resolve();
      await resultPromise;

      // Both chunks must be delivered to Session A with full tuple
      expect(recordedCaptures.length).toBeGreaterThanOrEqual(2);
      const allPostedPaths = recordedCaptures.flatMap((c) => c.paths);
      expect(allPostedPaths).toHaveLength(paths.length);
      expect(new Set(allPostedPaths)).toEqual(new Set(paths));

      for (const cap of recordedCaptures) {
        expect(cap.version).toBe(1);
        expect(cap.serverEpoch).toBe("epoch-1");
        expect(cap.terminalIncarnation).toBe("1");
        expect(cap.ompSessionId).toBe("session-A");
        expect(cap.rootId).toBe(".");
        expect(cap.baselineId).toBe("base-session-A");
        expect(cap.mode).toBe("unproven");
      }
      expect(rootB?.unprovenPaths.size).toBe(0);
    } finally {
      releaseChunk1.resolve();
      server.stop(true);
    }
  });

  it("R3: paused chunk 1 followed by session removal aborts chunk 2", async () => {
    const chunk1Received = createDeferred();
    const releaseChunk1 = createDeferred();
    const recordedCaptures: any[] = [];

    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        const url = new URL(req.url);
        const body = await req.json();
        if (url.pathname === "/private/session-changes/v1/capture") {
          recordedCaptures.push(body);
          if (recordedCaptures.length === 1) {
            chunk1Received.resolve();
            await releaseChunk1.promise;
          }
          return Response.json({
            version: 1,
            captureId: body.captureId,
            results: (body.paths as string[]).map((p: string) => ({
              path: p,
              status: "captured",
              presence: "present",
            })),
          });
        }
        return new Response("Not found", { status: 404 });
      },
    });

    try {
      const httpUrl = `http://127.0.0.1:${server.port}/private/session-changes/v1`;
      const registry = new SessionChangesProducerRegistry();
      const producer = new SessionChangesProducer({ httpUrl, token: "test-token", registry });

      const rootA = createRootSessionRegistration("session-A", "epoch-1", "1", "base-A", "/repo");
      registry.registerRoot("main", rootA);

      const ctxA: OmpExtensionContext = { agent: { kind: "main", id: "main" }, cwd: "/repo" };
      await producer.handleToolCall("ast-edit", { files: ["src/**/*.ts"] }, ctxA, "call-r3");

      const paths = generateNestedPaths(300, "r3");
      const resultPromise = producer.handleToolResult(
        "ast-edit",
        { files: paths.map((p) => `/repo/${p}`) },
        ctxA,
        "call-r3",
      );

      await chunk1Received.promise;
      // Remove session A from registry
      registry.removeRoot("session-A");
      releaseChunk1.resolve();
      await resultPromise;

      // Exactly 1 request posted; chunk 2 was rejected
      expect(recordedCaptures.length).toBe(1);
    } finally {
      releaseChunk1.resolve();
      server.stop(true);
    }
  });

  it("R4: paused chunk 1 followed by object replacement aborts chunk 2", async () => {
    const chunk1Received = createDeferred();
    const releaseChunk1 = createDeferred();
    const recordedCaptures: any[] = [];

    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        const url = new URL(req.url);
        const body = await req.json();
        if (url.pathname === "/private/session-changes/v1/capture") {
          recordedCaptures.push(body);
          if (recordedCaptures.length === 1) {
            chunk1Received.resolve();
            await releaseChunk1.promise;
          }
          return Response.json({
            version: 1,
            captureId: body.captureId,
            results: (body.paths as string[]).map((p: string) => ({
              path: p,
              status: "captured",
              presence: "present",
            })),
          });
        }
        return new Response("Not found", { status: 404 });
      },
    });

    try {
      const httpUrl = `http://127.0.0.1:${server.port}/private/session-changes/v1`;
      const registry = new SessionChangesProducerRegistry();
      const producer = new SessionChangesProducer({ httpUrl, token: "test-token", registry });

      const rootA = createRootSessionRegistration("session-A", "epoch-1", "1", "base-A", "/repo");
      registry.registerRoot("main", rootA);

      const ctxA: OmpExtensionContext = { agent: { kind: "main", id: "main" }, cwd: "/repo" };
      await producer.handleToolCall("ast-edit", { files: ["src/**/*.ts"] }, ctxA, "call-r4");

      const paths = generateNestedPaths(300, "r4");
      const resultPromise = producer.handleToolResult(
        "ast-edit",
        { files: paths.map((p) => `/repo/${p}`) },
        ctxA,
        "call-r4",
      );

      await chunk1Received.promise;
      // Replace with new object with identical tuple
      const replacementRoot = createRootSessionRegistration("session-A", "epoch-1", "1", "base-A", "/repo");
      registry.roots.set("session-A", replacementRoot);
      releaseChunk1.resolve();
      await resultPromise;

      expect(recordedCaptures.length).toBe(1);
      expect(replacementRoot.unprovenPaths.size).toBe(0);
    } finally {
      releaseChunk1.resolve();
      server.stop(true);
    }
  });

  it("R5: parameterized in-place tuple and identity mutation on same object aborts chunk 2", async () => {
    const fieldsToMutate = ["ompSessionId", "serverEpoch", "terminalIncarnation", "rootId", "baselineId"] as const;

    for (const field of fieldsToMutate) {
      const chunk1Received = createDeferred();
      const releaseChunk1 = createDeferred();
      const recordedCaptures: any[] = [];

      const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        async fetch(req) {
          const url = new URL(req.url);
          const body = await req.json();
          if (url.pathname === "/private/session-changes/v1/capture") {
            recordedCaptures.push(body);
            if (recordedCaptures.length === 1) {
              chunk1Received.resolve();
              await releaseChunk1.promise;
            }
            return Response.json({
              version: 1,
              captureId: body.captureId,
              results: (body.paths as string[]).map((p: string) => ({
                path: p,
                status: "captured",
                presence: "present",
              })),
            });
          }
          return new Response("Not found", { status: 404 });
        },
      });

      try {
        const httpUrl = `http://127.0.0.1:${server.port}/private/session-changes/v1`;
        const registry = new SessionChangesProducerRegistry();
        const producer = new SessionChangesProducer({ httpUrl, token: "test-token", registry });

        const rootA = createRootSessionRegistration("session-A", "epoch-1", "1", "base-A", "/repo");
        registry.registerRoot("main", rootA);

        const ctxA: OmpExtensionContext = { agent: { kind: "main", id: "main" }, cwd: "/repo" };
        await producer.handleToolCall("ast-edit", { files: ["src/**/*.ts"] }, ctxA, `call-r5-${field}`);

        const paths = generateNestedPaths(300, `r5-${field}`);
        const resultPromise = producer.handleToolResult(
          "ast-edit",
          { files: paths.map((p) => `/repo/${p}`) },
          ctxA,
          `call-r5-${field}`,
        );

        await chunk1Received.promise;
        // In-place mutate the specific field
        (rootA as any)[field] = "MUTATED";
        releaseChunk1.resolve();
        await resultPromise;

        // Exactly 1 request posted; chunk 2 was rejected due to identity mismatch
        expect(recordedCaptures.length).toBe(1);
      } finally {
        releaseChunk1.resolve();
        server.stop(true);
      }
    }
  });

  it("R5b: paused chunk 1 followed by clear() and new registration: old 503 does NOT disable new lifecycle", async () => {
    const chunk1Received = createDeferred();
    const releaseChunk1 = createDeferred();

    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        const url = new URL(req.url);
        const body = await req.json();
        if (url.pathname === "/private/session-changes/v1/register") {
          return Response.json({
            serverEpoch: "epoch-new",
            terminalIncarnation: "1",
            ompSessionId: body.ompSessionId,
            rootId: ".",
            baselineId: "base-new",
            canonicalRoot: "/repo",
          });
        }
        if (url.pathname === "/private/session-changes/v1/capture") {
          chunk1Received.resolve();
          await releaseChunk1.promise;
          return new Response("Service Unavailable", { status: 503 });
        }
        return new Response("Not found", { status: 404 });
      },
    });

    try {
      const httpUrl = `http://127.0.0.1:${server.port}/private/session-changes/v1`;
      const registry = new SessionChangesProducerRegistry();
      const producer = new SessionChangesProducer({ httpUrl, token: "test-token", registry });

      const rootOld = createRootSessionRegistration("session-A", "epoch-1", "1", "base-A", "/repo");
      registry.registerRoot("main", rootOld);

      const ctxA: OmpExtensionContext = { agent: { kind: "main", id: "main" }, cwd: "/repo" };
      await producer.handleToolCall("ast-edit", { files: ["src/**/*.ts"] }, ctxA, "call-r5b");

      const paths = generateNestedPaths(300, "r5b");
      const resultPromise = producer.handleToolResult(
        "ast-edit",
        { files: paths.map((p) => `/repo/${p}`) },
        ctxA,
        "call-r5b",
      );

      // Wait for chunk 1 to arrive at peer
      await chunk1Received.promise;

      // Reset lifecycle and register new session while old capture is paused
      registry.clear();
      expect(registry.registryEpoch).toBe(1);
      const rootNew = await producer.registerSession("session-A", "main", "/repo");
      expect(rootNew).not.toBeNull();
      expect(rootNew?.disabled).toBe(false);
      expect(producer.isPermanentlyDisabled).toBe(false);

      // Release old chunk 1 with 503
      releaseChunk1.resolve();
      await resultPromise;

      // Stale 503 must NOT permanently disable new lifecycle, and rootNew must remain enabled!
      expect(producer.isPermanentlyDisabled).toBe(false);
      expect(rootNew?.disabled).toBe(false);
    } finally {
      releaseChunk1.resolve();
      server.stop(true);
    }
  });

  it("R6: paused chunk 1 followed by clear() and reinserting same object aborts chunk 2", async () => {
    const chunk1Received = createDeferred();
    const releaseChunk1 = createDeferred();
    const recordedCaptures: any[] = [];

    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        const url = new URL(req.url);
        const body = await req.json();
        if (url.pathname === "/private/session-changes/v1/capture") {
          recordedCaptures.push(body);
          if (recordedCaptures.length === 1) {
            chunk1Received.resolve();
            await releaseChunk1.promise;
          }
          return Response.json({
            version: 1,
            captureId: body.captureId,
            results: (body.paths as string[]).map((p: string) => ({
              path: p,
              status: "captured",
              presence: "present",
            })),
          });
        }
        return new Response("Not found", { status: 404 });
      },
    });

    try {
      const httpUrl = `http://127.0.0.1:${server.port}/private/session-changes/v1`;
      const registry = new SessionChangesProducerRegistry();
      const producer = new SessionChangesProducer({ httpUrl, token: "test-token", registry });

      const rootA = createRootSessionRegistration("session-A", "epoch-1", "1", "base-A", "/repo");
      registry.registerRoot("main", rootA);

      const ctxA: OmpExtensionContext = { agent: { kind: "main", id: "main" }, cwd: "/repo" };
      await producer.handleToolCall("ast-edit", { files: ["src/**/*.ts"] }, ctxA, "call-r6");

      const paths = generateNestedPaths(300, "r6");
      const resultPromise = producer.handleToolResult(
        "ast-edit",
        { files: paths.map((p) => `/repo/${p}`) },
        ctxA,
        "call-r6",
      );

      await chunk1Received.promise;
      // Clear registry and reinsert the exact same object
      registry.clear();
      registry.registerRoot("main", rootA);
      releaseChunk1.resolve();
      await resultPromise;

      expect(recordedCaptures.length).toBe(1);
    } finally {
      releaseChunk1.resolve();
      server.stop(true);
    }
  });

  it("R7: paused chunk 1 followed by disabled root or 503 aborts chunk 2", async () => {
    // Case A: root.disabled set during pause
    {
      const chunk1Received = createDeferred();
      const releaseChunk1 = createDeferred();
      const recordedCaptures: any[] = [];

      const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        async fetch(req) {
          const body = await req.json();
          recordedCaptures.push(body);
          if (recordedCaptures.length === 1) {
            chunk1Received.resolve();
            await releaseChunk1.promise;
          }
          return Response.json({
            version: 1,
            captureId: body.captureId,
            results: (body.paths as string[]).map((p: string) => ({
              path: p,
              status: "captured",
              presence: "present",
            })),
          });
        },
      });

      try {
        const httpUrl = `http://127.0.0.1:${server.port}/private/session-changes/v1`;
        const registry = new SessionChangesProducerRegistry();
        const producer = new SessionChangesProducer({ httpUrl, token: "test-token", registry });
        const rootA = createRootSessionRegistration("session-A", "epoch-1", "1", "base-A", "/repo");
        registry.registerRoot("main", rootA);

        const ctxA: OmpExtensionContext = { agent: { kind: "main", id: "main" }, cwd: "/repo" };
        await producer.handleToolCall("ast-edit", { files: ["src/**/*.ts"] }, ctxA, "call-r7a");

        const paths = generateNestedPaths(300, "r7a");
        const resultPromise = producer.handleToolResult(
          "ast-edit",
          { files: paths.map((p) => `/repo/${p}`) },
          ctxA,
          "call-r7a",
        );

        await chunk1Received.promise;
        rootA.disabled = true;
        releaseChunk1.resolve();
        await resultPromise;

        expect(recordedCaptures.length).toBe(1);
      } finally {
        releaseChunk1.resolve();
        server.stop(true);
      }
    }

    // Case B: chunk 1 returns 503
    {
      const recordedCaptures: any[] = [];
      const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        async fetch(req) {
          const body = await req.json();
          recordedCaptures.push(body);
          return new Response("Service Unavailable", { status: 503 });
        },
      });

      try {
        const httpUrl = `http://127.0.0.1:${server.port}/private/session-changes/v1`;
        const registry = new SessionChangesProducerRegistry();
        const producer = new SessionChangesProducer({ httpUrl, token: "test-token", registry });
        const rootA = createRootSessionRegistration("session-A", "epoch-1", "1", "base-A", "/repo");
        registry.registerRoot("main", rootA);

        const ctxA: OmpExtensionContext = { agent: { kind: "main", id: "main" }, cwd: "/repo" };
        await producer.handleToolCall("ast-edit", { files: ["src/**/*.ts"] }, ctxA, "call-r7b");

        const paths = generateNestedPaths(300, "r7b");
        await producer.handleToolResult(
          "ast-edit",
          { files: paths.map((p) => `/repo/${p}`) },
          ctxA,
          "call-r7b",
        );

        expect(recordedCaptures.length).toBe(1);
        expect(rootA.disabled).toBe(true);
        expect(producer.isPermanentlyDisabled).toBe(true);
      } finally {
        server.stop(true);
      }
    }
  });

  it("R8: deadline exhaustion halts chunk processing without issuing expired requests", async () => {
    // Case A: start with deadline already exhausted -> 0 requests
    {
      const recordedCaptures: any[] = [];
      const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        async fetch(req) {
          const body = await req.json();
          recordedCaptures.push(body);
          return Response.json({
            version: 1,
            captureId: body.captureId,
            results: (body.paths as string[]).map((p: string) => ({
              path: p,
              status: "captured",
              presence: "present",
            })),
          });
        },
      });

      try {
        const httpUrl = `http://127.0.0.1:${server.port}/private/session-changes/v1`;
        const registry = new SessionChangesProducerRegistry();
        const producer = new SessionChangesProducer({
          httpUrl,
          token: "test-token",
          registry,
          captureTimeoutMs: 10,
        });

        const rootA = createRootSessionRegistration("session-A", "epoch-1", "1", "base-A", "/repo");
        registry.registerRoot("main", rootA);
        const ctxA: OmpExtensionContext = { agent: { kind: "main", id: "main" }, cwd: "/repo" };
        await producer.handleToolCall("ast-edit", { files: ["src/**/*.ts"] }, ctxA, "call-r8a");

        const originalNow = performance.now;
        try {
          const paths = generateNestedPaths(300, "r8a");
          let callIndex = 0;
          performance.now = () => {
            callIndex++;
            if (callIndex === 1) return 1000; // start time
            return 1050; // remaining <= 0 immediately
          };

          await producer.handleToolResult(
            "ast-edit",
            { files: paths.map((p) => `/repo/${p}`) },
            ctxA,
            "call-r8a",
          );

          expect(recordedCaptures.length).toBe(0);
        } finally {
          performance.now = originalNow;
        }
      } finally {
        server.stop(true);
      }
    }

    // Case B: advance time while chunk 1 is in-flight -> chunk 2 is halted
    {
      const recordedCaptures: any[] = [];
      let simulatedTime = 1000;
      const originalNow = performance.now;
      performance.now = () => simulatedTime;

      const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        async fetch(req) {
          const body = await req.json();
          recordedCaptures.push(body);
          // Advance simulated time past deadline
          simulatedTime = 5000;
          return Response.json({
            version: 1,
            captureId: body.captureId,
            results: (body.paths as string[]).map((p: string) => ({
              path: p,
              status: "captured",
              presence: "present",
            })),
          });
        },
      });

      try {
        const httpUrl = `http://127.0.0.1:${server.port}/private/session-changes/v1`;
        const registry = new SessionChangesProducerRegistry();
        const producer = new SessionChangesProducer({
          httpUrl,
          token: "test-token",
          registry,
          captureTimeoutMs: 10,
        });

        const rootA = createRootSessionRegistration("session-A", "epoch-1", "1", "base-A", "/repo");
        registry.registerRoot("main", rootA);
        const ctxA: OmpExtensionContext = { agent: { kind: "main", id: "main" }, cwd: "/repo" };
        await producer.handleToolCall("ast-edit", { files: ["src/**/*.ts"] }, ctxA, "call-r8b");

        try {
          const paths = generateNestedPaths(300, "r8b");
          await producer.handleToolResult(
            "ast-edit",
            { files: paths.map((p) => `/repo/${p}`) },
            ctxA,
            "call-r8b",
          );

          // Only chunk 1 issued before simulated time expired
          expect(recordedCaptures.length).toBe(1);
        } finally {
          performance.now = originalNow;
        }
      } finally {
        server.stop(true);
      }
    }
  });

  it("R9: ambiguity history overflow retains pending collision rejection for live descriptors", async () => {
    const registry = new SessionChangesProducerRegistry();
    const producer = new SessionChangesProducer({
      httpUrl: "http://127.0.0.1:0/mock",
      token: "test-token",
      registry,
    });
    const root1 = createRootSessionRegistration("sess-1", "epoch-1", "1", "base-1", "/repo");
    const root2 = createRootSessionRegistration("sess-2", "epoch-1", "1", "base-2", "/repo");
    registry.registerRoot("agent-1", root1);
    registry.registerRoot("agent-2", root2);

    const ctx1: OmpExtensionContext = { agent: { kind: "sub", id: "agent-1" }, cwd: "/repo" };
    const ctx2: OmpExtensionContext = { agent: { kind: "sub", id: "agent-2" }, cwd: "/repo" };

    // 1. Target call ID "target-X" held by both agent-1 and agent-2
    await producer.handleToolCall("ast-edit", { files: ["src/target.ts"] }, ctx1, "target-X");
    await producer.handleToolCall("ast-edit", { files: ["src/target.ts"] }, ctx2, "target-X");
    expect(producer.ambiguousCallHistory.has("target-X")).toBe(true);

    // 2. Churn 520 distinct collision IDs, consuming each pair immediately
    for (let i = 0; i < 520; i++) {
      const churnId = `churn-${i}`;
      await producer.handleToolCall("ast-edit", { files: ["src/c.ts"] }, ctx1, churnId);
      await producer.handleToolCall("ast-edit", { files: ["src/c.ts"] }, ctx2, churnId);
      // Consume both immediately so pendingCalls does not hit capacity
      await producer.handleToolResult("ast-edit", { files: ["/repo/src/c.ts"] }, ctx1, churnId);
      await producer.handleToolResult("ast-edit", { files: ["/repo/src/c.ts"] }, ctx2, churnId);
    }

    // "target-X" was evicted from bounded ambiguousCallHistory (capacity <= 500)
    expect(producer.ambiguousCallHistory.has("target-X")).toBe(false);

    // But both descriptors for "target-X" are STILL pending in pendingCalls!
    expect(producer.pendingCalls.has(makePendingKey("sess-1", "agent-1", "target-X"))).toBe(true);
    expect(producer.pendingCalls.has(makePendingKey("sess-2", "agent-2", "target-X"))).toBe(true);

    // 3. Agentless result for "target-X" must STILL be rejected due to Scope 1 live collision
    await producer.handleToolResult("ast-edit", { files: ["/repo/src/target-edit.ts"] }, undefined, "target-X");

    expect(root1.unprovenPaths.has("src/target-edit.ts")).toBe(false);
    expect(root2.unprovenPaths.has("src/target-edit.ts")).toBe(false);
    expect(producer.pendingCalls.has(makePendingKey("sess-1", "agent-1", "target-X"))).toBe(true);
    expect(producer.pendingCalls.has(makePendingKey("sess-2", "agent-2", "target-X"))).toBe(true);
  });

  it("R10: retained history rejects duplicate agentless resolution even after one descriptor is consumed", async () => {
    const registry = new SessionChangesProducerRegistry();
    const producer = new SessionChangesProducer({
      httpUrl: "http://127.0.0.1:0/mock",
      token: "test-token",
      registry,
    });
    const root1 = createRootSessionRegistration("sess-1", "epoch-1", "1", "base-1", "/repo");
    const root2 = createRootSessionRegistration("sess-2", "epoch-1", "1", "base-2", "/repo");
    registry.registerRoot("agent-1", root1);
    registry.registerRoot("agent-2", root2);

    const ctx1: OmpExtensionContext = { agent: { kind: "sub", id: "agent-1" }, cwd: "/repo" };
    const ctx2: OmpExtensionContext = { agent: { kind: "sub", id: "agent-2" }, cwd: "/repo" };

    // Register call-Y for both agents
    await producer.handleToolCall("write", { path: "f1.ts" }, ctx1, "call-Y");
    await producer.handleToolCall("write", { path: "f2.ts" }, ctx2, "call-Y");
    expect(producer.ambiguousCallHistory.has("call-Y")).toBe(true);

    // Explicitly consume agent-1's descriptor
    await producer.handleToolResult("edit", { path: "/repo/f1.ts" }, ctx1, "call-Y");
    expect(root1.unprovenPaths.has("f1.ts")).toBe(true);
    expect(producer.pendingCalls.has(makePendingKey("sess-1", "agent-1", "call-Y"))).toBe(false);

    // Now only agent-2's descriptor remains in pendingCalls.
    // An agentless result for call-Y must still be REJECTED because call-Y is in ambiguousCallHistory!
    await producer.handleToolResult("edit", { path: "/repo/f2-agentless.ts" }, undefined, "call-Y");
    expect(root2.unprovenPaths.has("f2-agentless.ts")).toBe(false);
    expect(producer.pendingCalls.has(makePendingKey("sess-2", "agent-2", "call-Y"))).toBe(true);

    // But an explicit agent-2 result succeeds
    await producer.handleToolResult("edit", { path: "/repo/f2-explicit.ts" }, ctx2, "call-Y");
    expect(root2.unprovenPaths.has("f2-explicit.ts")).toBe(true);
    expect(producer.pendingCalls.has(makePendingKey("sess-2", "agent-2", "call-Y"))).toBe(false);

    // A unique never-collided call-Z resolves agentless without issue
    await producer.handleToolCall("write", { path: "unique.ts" }, ctx1, "call-Z");
    await producer.handleToolResult("edit", { path: "/repo/unique.ts" }, undefined, "call-Z");
    expect(root1.unprovenPaths.has("unique.ts")).toBe(true);
  });

  it("R11: capacity limits enforce FIFO eviction and recency refresh", async () => {
    const registry = new SessionChangesProducerRegistry();
    const producer = new SessionChangesProducer({
      httpUrl: "http://127.0.0.1:0/mock",
      token: "test-token",
      registry,
    });
    const root = createRootSessionRegistration("sess", "epoch-1", "1", "base", "/repo");
    registry.registerRoot("main", root);
    const ctx: OmpExtensionContext = { agent: { kind: "main", id: "main" }, cwd: "/repo" };

    // 1. Test pendingCalls FIFO eviction capped at MAX_PENDING_CALLS (128)
    for (let i = 0; i < 150; i++) {
      await producer.handleToolCall("write", { path: `p_${i}.ts` }, ctx, `call-pending-${i}`);
    }
    expect(producer.pendingCalls.size).toBe(128);
    expect(producer.pendingCalls.has(makePendingKey("sess", "main", "call-pending-0"))).toBe(false);
    expect(producer.pendingCalls.has(makePendingKey("sess", "main", "call-pending-149"))).toBe(true);

    // 2. Test consumedCallKeys FIFO eviction capped at MAX_PENDING_CALLS (128)
    for (let i = 0; i < 150; i++) {
      const cId = `call-consumed-${i}`;
      await producer.handleToolCall("write", { path: `c_${i}.ts` }, ctx, cId);
      await producer.handleToolResult("edit", { path: `/repo/c_${i}.ts` }, ctx, cId);
    }
    expect(producer.consumedCallKeys.size).toBe(128);
    expect(producer.consumedCallKeys.has(makePendingKey("sess", "main", "call-consumed-0"))).toBe(false);
    expect(producer.consumedCallKeys.has(makePendingKey("sess", "main", "call-consumed-149"))).toBe(true);

    // 3. Test ambiguousCallHistory capacity limit & recency refresh ordering
    const freshRegistry = new SessionChangesProducerRegistry();
    const freshProducer = new SessionChangesProducer({
      httpUrl: "http://127.0.0.1:0/mock",
      token: "test-token",
      registry: freshRegistry,
    });
    const rA = createRootSessionRegistration("sess-A", "epoch-1", "1", "base", "/repo");
    const rB = createRootSessionRegistration("sess-B", "epoch-1", "1", "base", "/repo");
    freshRegistry.registerRoot("agent-A", rA);
    freshRegistry.registerRoot("agent-B", rB);
    const ctxA: OmpExtensionContext = { agent: { kind: "sub", id: "agent-A" }, cwd: "/repo" };
    const ctxB: OmpExtensionContext = { agent: { kind: "sub", id: "agent-B" }, cwd: "/repo" };

    // Fill ambiguousCallHistory to exact capacity 128 (IDs 0..127)
    for (let i = 0; i < 128; i++) {
      await freshProducer.handleToolCall("write", { path: "f.ts" }, ctxA, `shared-${i}`);
      await freshProducer.handleToolCall("write", { path: "f.ts" }, ctxB, `shared-${i}`);
      // Consume descriptors so pendingCalls doesn't hit cap
      await freshProducer.handleToolResult("edit", { path: "/repo/f.ts" }, ctxA, `shared-${i}`);
      await freshProducer.handleToolResult("edit", { path: "/repo/f.ts" }, ctxB, `shared-${i}`);
    }
    expect(freshProducer.ambiguousCallHistory.size).toBe(128);
    expect(freshProducer.ambiguousCallHistory.has("shared-0")).toBe(true);

    // Recency refresh: re-collide on "shared-0". It must update recency without growing size!
    await freshProducer.handleToolCall("write", { path: "f.ts" }, ctxA, "shared-0");
    await freshProducer.handleToolCall("write", { path: "f.ts" }, ctxB, "shared-0");
    await freshProducer.handleToolResult("edit", { path: "/repo/f.ts" }, ctxA, "shared-0");
    await freshProducer.handleToolResult("edit", { path: "/repo/f.ts" }, ctxB, "shared-0");
    expect(freshProducer.ambiguousCallHistory.size).toBe(128);

    // Now insert collision 128 ("shared-128"):
    // Because "shared-0" was refreshed to MRU, the OLDEST entry is now "shared-1"!
    await freshProducer.handleToolCall("write", { path: "f.ts" }, ctxA, "shared-128");
    await freshProducer.handleToolCall("write", { path: "f.ts" }, ctxB, "shared-128");
    expect(freshProducer.ambiguousCallHistory.size).toBe(128);
    expect(freshProducer.ambiguousCallHistory.has("shared-1")).toBe(false); // EVICTED!
    expect(freshProducer.ambiguousCallHistory.has("shared-0")).toBe(true);  // RETAINED because refreshed!
    expect(freshProducer.ambiguousCallHistory.has("shared-128")).toBe(true); // NEWLY ADDED!
  });

  it("R12: clear() purges all maps and sets, increments epoch, and allows clean re-registration", async () => {
    const registry = new SessionChangesProducerRegistry();
    const producer = new SessionChangesProducer({
      httpUrl: "http://127.0.0.1:0/mock",
      token: "test-token",
      registry,
    });

    const root = createRootSessionRegistration("sess-old", "epoch-1", "1", "base", "/repo");
    const root2 = createRootSessionRegistration("sess-other", "epoch-1", "1", "base", "/repo");
    registry.registerRoot("main", root);
    registry.registerRoot("other", root2);
    const ctx: OmpExtensionContext = { agent: { kind: "main", id: "main" }, cwd: "/repo" };
    const ctxOther: OmpExtensionContext = { agent: { kind: "sub", id: "other" }, cwd: "/repo" };

    // Collide on "old-call" so ambiguousCallHistory is populated
    await producer.handleToolCall("write", { path: "old.ts" }, ctx, "old-call");
    await producer.handleToolCall("write", { path: "old.ts" }, ctxOther, "old-call");
    // Consume descriptor for main so consumedCallKeys has makePendingKey("sess-old", "main", "old-call")
    await producer.handleToolResult("edit", { path: "/repo/old.ts" }, ctx, "old-call");

    expect(registry.roots.size).toBe(2);
    expect(registry.consumedCallKeys.size).toBe(1);
    expect(registry.ambiguousCallHistory.size).toBe(1);
    expect(registry.registryEpoch).toBe(0);

    // Call clear() twice
    registry.clear();
    expect(registry.registryEpoch).toBe(1);
    expect(registry.roots.size).toBe(0);
    expect(registry.pendingCalls.size).toBe(0);
    expect(registry.consumedCallKeys.size).toBe(0);
    expect(registry.ambiguousCallHistory.size).toBe(0);
    expect(registry.activeSessionId).toBeNull();
    expect(registry.isPermanentlyDisabled).toBe(false);

    registry.clear();
    expect(registry.registryEpoch).toBe(2);

    // Re-register session using the EXACT SAME sessionId "sess-old", agent "main", and toolCallId "old-call"
    const newRoot = createRootSessionRegistration("sess-old", "epoch-2", "1", "base-2", "/repo");
    registry.registerRoot("main", newRoot);

    await producer.handleToolCall("write", { path: "new.ts" }, ctx, "old-call");
    await producer.handleToolResult("edit", { path: "/repo/new.ts" }, undefined, "old-call");

    // Succeeds agentless because both consumedCallKeys tombstone and ambiguousCallHistory were purged
    expect(newRoot.unprovenPaths.has("new.ts")).toBe(true);
  });

  it("R13: paused /register during clear(): old 503 and old 200 responses are discarded without poisoning new lifecycle", async () => {
    // Case A: old /register returns 503
    {
      const registerReceived = createDeferred();
      const releaseRegister = createDeferred();

      const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        async fetch(req) {
          const url = new URL(req.url);
          const body = await req.json();
          if (url.pathname === "/private/session-changes/v1/register") {
            registerReceived.resolve();
            await releaseRegister.promise;
            return new Response("Service Unavailable", { status: 503 });
          }
          return new Response("Not found", { status: 404 });
        },
      });

      try {
        const httpUrl = `http://127.0.0.1:${server.port}/private/session-changes/v1`;
        const registry = new SessionChangesProducerRegistry();
        const producer = new SessionChangesProducer({ httpUrl, token: "test-token", registry });

        // Start registration in lifecycle 0
        const oldRegPromise = producer.registerSession("session-1", "main", "/repo");
        await registerReceived.promise;

        // Lifecycle reset while old /register is awaiting
        registry.clear();
        expect(registry.registryEpoch).toBe(1);

        // New lifecycle establishes healthy registration
        const freshRoot = createRootSessionRegistration("session-1", "epoch-fresh", "1", "base-fresh", "/repo");
        registry.registerRoot("main", freshRoot);
        expect(producer.isPermanentlyDisabled).toBe(false);

        // Release old /register with 503
        releaseRegister.resolve();
        const oldResult = await oldRegPromise;

        // Old registration discarded
        expect(oldResult).toBeNull();
        // New lifecycle NOT permanently disabled by old 503!
        expect(producer.isPermanentlyDisabled).toBe(false);
        expect(registry.roots.get("session-1")).toBe(freshRoot);
      } finally {
        releaseRegister.resolve();
        server.stop(true);
      }
    }

    // Case B: old /register returns 200 OK after new registration with same session and equal generation
    {
      const register1Received = createDeferred();
      const releaseRegister1 = createDeferred();
      let regCount = 0;

      const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        async fetch(req) {
          const url = new URL(req.url);
          const body = await req.json();
          if (url.pathname === "/private/session-changes/v1/register") {
            regCount++;
            if (regCount === 1) {
              register1Received.resolve();
              await releaseRegister1.promise;
              return Response.json({
                serverEpoch: "epoch-OLD",
                terminalIncarnation: "1",
                ompSessionId: body.ompSessionId,
                rootId: ".",
                baselineId: "base-OLD",
                canonicalRoot: "/repo",
              });
            } else {
              return Response.json({
                serverEpoch: "epoch-NEW",
                terminalIncarnation: "1",
                ompSessionId: body.ompSessionId,
                rootId: ".",
                baselineId: "base-NEW",
                canonicalRoot: "/repo",
              });
            }
          }
          return new Response("Not found", { status: 404 });
        },
      });

      try {
        const httpUrl = `http://127.0.0.1:${server.port}/private/session-changes/v1`;
        const registry = new SessionChangesProducerRegistry();
        const producer = new SessionChangesProducer({ httpUrl, token: "test-token", registry });

        // 1. First registration starts in lifecycle epoch 0, globalGeneration becomes 1
        const oldRegPromise = producer.registerSession("session-same", "main", "/repo");
        await register1Received.promise;

        // 2. Clear registry: registryEpoch becomes 1, globalGeneration resets to 0
        registry.clear();
        expect(registry.registryEpoch).toBe(1);

        // 3. Second registration in lifecycle epoch 1: globalGeneration becomes 1, activeSessionId becomes "session-same"
        const newRoot = await producer.registerSession("session-same", "main", "/repo");
        expect(newRoot).not.toBeNull();
        expect(newRoot?.baselineId).toBe("base-NEW");
        // Notice: ordinary globalGeneration is 1, activeSessionId is "session-same"!
        expect(producer.globalGeneration).toBe(1);
        expect(producer.activeSessionId).toBe("session-same");

        // 4. Release old registration response (issued with generation 1 and "session-same")
        releaseRegister1.resolve();
        const oldResult = await oldRegPromise;

        // StartEpoch check rejects the old response despite equal generation and session identity!
        expect(oldResult).toBeNull();
        expect(registry.roots.get("session-same")).toBe(newRoot);
        expect(registry.roots.get("session-same")?.baselineId).toBe("base-NEW");
      } finally {
        releaseRegister1.resolve();
        server.stop(true);
      }
    }
  });

  it("R14a: paused invalidation flush during handleAgentEnd followed by clear(): NO settled request is issued", async () => {
    const flushReceived = createDeferred();
    const releaseFlush = createDeferred();
    const recordedRequests: string[] = [];

    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        const url = new URL(req.url);
        recordedRequests.push(url.pathname);
        if (url.pathname === "/private/session-changes/v1/capture") {
          flushReceived.resolve();
          await releaseFlush.promise;
          return Response.json({
            version: 1,
            captureId: "timed-out-1",
            results: [{ path: "pending.ts", status: "captured", presence: "present" }],
          });
        }
        if (url.pathname === "/private/session-changes/v1/settled") {
          return Response.json({ accepted: true });
        }
        return new Response("Not found", { status: 404 });
      },
    });

    try {
      const httpUrl = `http://127.0.0.1:${server.port}/private/session-changes/v1`;
      const registry = new SessionChangesProducerRegistry();
      const producer = new SessionChangesProducer({ httpUrl, token: "test-token", registry });

      const root = createRootSessionRegistration("sess-flush", "epoch-1", "1", "base", "/repo");
      // Add a pending invalidation so handleAgentEnd executes flushPendingInvalidations
      root.pendingInvalidations.push({
        captureId: "timed-out-1",
        paths: ["pending.ts"],
        timestamp: Date.now(),
      });
      registry.registerRoot("main", root);

      const ctx: OmpExtensionContext = { agent: { kind: "main", id: "main" }, cwd: "/repo" };
      const endPromise = producer.handleAgentEnd(
        { willContinue: false, messages: [{ role: "assistant", stopReason: "stop" }] },
        ctx,
      );

      // Wait for flush /capture to arrive at peer
      await flushReceived.promise;

      // Clear registry while invalidation flush is paused
      registry.clear();
      expect(registry.registryEpoch).toBe(1);

      // Release flush
      releaseFlush.resolve();
      await endPromise;

      // Assert that /capture was recorded, but /settled was NEVER issued!
      expect(recordedRequests).toContain("/private/session-changes/v1/capture");
      expect(recordedRequests).not.toContain("/private/session-changes/v1/settled");
    } finally {
      releaseFlush.resolve();
      server.stop(true);
    }
  });

  it("R14b: paused /settled during clear() followed by 503 response: new lifecycle is NOT permanently disabled", async () => {
    const settledReceived = createDeferred();
    const releaseSettled = createDeferred();

    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/private/session-changes/v1/settled") {
          settledReceived.resolve();
          await releaseSettled.promise;
          return new Response("Service Unavailable", { status: 503 });
        }
        return new Response("Not found", { status: 404 });
      },
    });

    try {
      const httpUrl = `http://127.0.0.1:${server.port}/private/session-changes/v1`;
      const registry = new SessionChangesProducerRegistry();
      const producer = new SessionChangesProducer({ httpUrl, token: "test-token", registry });

      const rootOld = createRootSessionRegistration("sess-settled-old", "epoch-1", "1", "base", "/repo");
      registry.registerRoot("main", rootOld);

      const ctx: OmpExtensionContext = { agent: { kind: "main", id: "main" }, cwd: "/repo" };
      const endPromise = producer.handleAgentEnd(
        { willContinue: false, messages: [{ role: "assistant", stopReason: "stop" }] },
        ctx,
      );

      // Wait for /settled to arrive at peer
      await settledReceived.promise;

      // Clear registry while /settled is paused
      registry.clear();
      expect(registry.registryEpoch).toBe(1);

      // Establish new registration in new lifecycle
      const rootNew = createRootSessionRegistration("sess-settled-new", "epoch-2", "1", "base-2", "/repo");
      registry.registerRoot("main", rootNew);
      expect(producer.isPermanentlyDisabled).toBe(false);

      // Release /settled with 503
      releaseSettled.resolve();
      await endPromise;

      // Stale /settled 503 must NOT disable the new lifecycle or new root!
      expect(producer.isPermanentlyDisabled).toBe(false);
      expect(rootNew.disabled).toBe(false);
    } finally {
      releaseSettled.resolve();
      server.stop(true);
    }
  });

  it("R14c: paused invalidation flush during handleAgentEnd followed by root replacement: NO settled request is issued", async () => {
    const flushReceived = createDeferred();
    const releaseFlush = createDeferred();
    const recordedRequests: string[] = [];

    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        const url = new URL(req.url);
        recordedRequests.push(url.pathname);
        if (url.pathname === "/private/session-changes/v1/capture") {
          flushReceived.resolve();
          await releaseFlush.promise;
          return Response.json({
            version: 1,
            captureId: "timed-out-r14c",
            results: [{ path: "pending.ts", status: "captured", presence: "present" }],
          });
        }
        if (url.pathname === "/private/session-changes/v1/settled") {
          return Response.json({ accepted: true });
        }
        return new Response("Not found", { status: 404 });
      },
    });

    try {
      const httpUrl = `http://127.0.0.1:${server.port}/private/session-changes/v1`;
      const registry = new SessionChangesProducerRegistry();
      const producer = new SessionChangesProducer({ httpUrl, token: "test-token", registry });

      const rootOriginal = createRootSessionRegistration("sess-r14c", "epoch-1", "1", "base", "/repo");
      rootOriginal.pendingInvalidations.push({
        captureId: "timed-out-r14c",
        paths: ["pending.ts"],
        timestamp: Date.now(),
      });
      registry.registerRoot("main", rootOriginal);

      const ctx: OmpExtensionContext = { agent: { kind: "main", id: "main" }, cwd: "/repo" };
      const endPromise = producer.handleAgentEnd(
        { willContinue: false, messages: [{ role: "assistant", stopReason: "stop" }] },
        ctx,
      );

      // Wait for flush to arrive at peer
      await flushReceived.promise;

      // Replace root in registry with new object with same session ID (no clear)
      const replacementRoot = createRootSessionRegistration("sess-r14c", "epoch-1", "1", "base", "/repo");
      registry.roots.set("sess-r14c", replacementRoot);

      // Release flush
      releaseFlush.resolve();
      await endPromise;

      // Assert that /capture was recorded, but /settled was NEVER issued for the superseded root!
      expect(recordedRequests).toContain("/private/session-changes/v1/capture");
      expect(recordedRequests).not.toContain("/private/session-changes/v1/settled");
    } finally {
      releaseFlush.resolve();
      server.stop(true);
    }
  });

  it("R14d: paused multi-request invalidation flush followed by root replacement or tuple mutation aborts subsequent capture requests", async () => {
    type MutationAction = { type: "replaceIdentical" } | { type: "mutateField"; field: "ompSessionId" | "serverEpoch" | "terminalIncarnation" | "rootId" | "baselineId" };
    const cases: MutationAction[] = [
      { type: "replaceIdentical" },
      { type: "mutateField", field: "ompSessionId" },
      { type: "mutateField", field: "serverEpoch" },
      { type: "mutateField", field: "terminalIncarnation" },
      { type: "mutateField", field: "rootId" },
      { type: "mutateField", field: "baselineId" },
    ];

    for (const c of cases) {
      const capture1Received = createDeferred();
      const releaseCapture1 = createDeferred();
      const recordedCaptures: any[] = [];

      const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        async fetch(req) {
          const url = new URL(req.url);
          const body = await req.json();
          if (url.pathname === "/private/session-changes/v1/capture") {
            recordedCaptures.push(body);
            if (recordedCaptures.length === 1) {
              capture1Received.resolve();
              await releaseCapture1.promise;
            }
            return Response.json({
              version: 1,
              captureId: body.captureId,
              results: (body.paths as string[]).map((p: string) => ({
                path: p,
                status: "captured",
                presence: "present",
              })),
            });
          }
          return new Response("Not found", { status: 404 });
        },
      });

      try {
        const httpUrl = `http://127.0.0.1:${server.port}/private/session-changes/v1`;
        const registry = new SessionChangesProducerRegistry();
        const producer = new SessionChangesProducer({ httpUrl, token: "test-token", registry });

        const root = createRootSessionRegistration("sess-r14d", "epoch-1", "1", "base", "/repo");
        // Add two distinct pending invalidations so flushPendingInvalidations issues multiple /capture requests
        root.pendingInvalidations.push(
          { captureId: "flush-1", paths: ["file1.ts"], timestamp: Date.now() },
          { captureId: "flush-2", paths: ["file2.ts"], timestamp: Date.now() },
        );
        registry.registerRoot("main", root);

        const flushPromise = producer.flushPendingInvalidations(root);

        // Wait for first capture request to arrive
        await capture1Received.promise;

        if (c.type === "replaceIdentical") {
          // Replace root with a NEW object carrying the EXACT SAME identical tuple
          const replacementRoot = createRootSessionRegistration("sess-r14d", "epoch-1", "1", "base", "/repo");
          registry.roots.set("sess-r14d", replacementRoot);
        } else {
          // In-place mutate the specific tuple field
          (root as any)[c.field] = "MUTATED";
        }

        // Release capture 1
        releaseCapture1.resolve();
        await flushPromise;

        // Exactly 1 capture request was recorded; the second invalidation was aborted!
        expect(recordedCaptures.length).toBe(1);
        expect(recordedCaptures[0].captureId).toBe("flush-1");
      } finally {
        releaseCapture1.resolve();
        server.stop(true);
      }
    }
  });

  // ==========================================================================
  // P1 Regressions: Live-routing authorization & unbinding on failed switch
  // ==========================================================================

  it("R15a: failed registration during session switch fail-closes live tool routing and does NOT capture against previous session", async () => {
    const recordedCaptures: any[] = [];
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        const url = new URL(req.url);
        const body = await req.json();
        if (url.pathname === "/private/session-changes/v1/register") {
          if (body.ompSessionId === "session-A") {
            return Response.json({
              serverEpoch: "epoch-1",
              terminalIncarnation: "1",
              ompSessionId: "session-A",
              rootId: ".",
              baselineId: "base-A",
              canonicalRoot: "/repo",
            });
          }
          // Session B registration fails (simulated 500 error / network failure)
          return new Response("Internal Server Error", { status: 500 });
        }
        if (url.pathname === "/private/session-changes/v1/capture") {
          recordedCaptures.push(body);
          return Response.json({
            version: 1,
            captureId: body.captureId,
            results: (body.paths as string[]).map((p: string) => ({
              path: p,
              status: "captured",
              presence: "present",
            })),
          });
        }
        return new Response("Not found", { status: 404 });
      },
    });

    try {
      const httpUrl = `http://127.0.0.1:${server.port}/private/session-changes/v1`;
      const registry = new SessionChangesProducerRegistry();
      const producer = new SessionChangesProducer({ httpUrl, token: "test-token", registry });

      // 1. Session A registers successfully
      const rootA = await producer.registerSession("session-A", "main", "/repo");
      expect(rootA).not.toBeNull();
      expect(rootA?.ompSessionId).toBe("session-A");

      // 2. User switches to Session B, but registration fails
      const rootB = await producer.handleSessionSwitch("session-B", "main", "/repo");
      expect(rootB).toBeNull();

      // 3. Session B attempts to execute a supported tool call
      const ctxB: OmpExtensionContext = { agent: { kind: "main", id: "main" }, cwd: "/repo" };
      await producer.handleToolCall("write", { path: "src/new-in-b.ts" }, ctxB, "call-b-1");

      // 4. Verify fail-closed routing: zero capture requests were issued, rootA was not polluted!
      expect(recordedCaptures.length).toBe(0);
      expect(rootA?.knownPaths.has("src/new-in-b.ts")).toBe(false);
      expect(rootA?.unprovenPaths.has("src/new-in-b.ts")).toBe(false);
      expect(producer.pendingCalls.has(makePendingKey("session-A", "main", "call-b-1"))).toBe(false);
      expect(producer.pendingCalls.has(makePendingKey("session-B", "main", "call-b-1"))).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  it("R15b: failed switch leaves session A in-flight call attribution intact", async () => {
    const recordedCaptures: any[] = [];
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        const url = new URL(req.url);
        const body = await req.json();
        if (url.pathname === "/private/session-changes/v1/register") {
          if (body.ompSessionId === "session-A") {
            return Response.json({
              serverEpoch: "epoch-1",
              terminalIncarnation: "1",
              ompSessionId: "session-A",
              rootId: ".",
              baselineId: "base-A",
              canonicalRoot: "/repo",
            });
          }
          return new Response("Internal Server Error", { status: 500 });
        }
        if (url.pathname === "/private/session-changes/v1/capture") {
          recordedCaptures.push(body);
          return Response.json({
            version: 1,
            captureId: body.captureId,
            results: (body.paths as string[]).map((p: string) => ({
              path: p,
              status: "captured",
              presence: "present",
            })),
          });
        }
        return new Response("Not found", { status: 404 });
      },
    });

    try {
      const httpUrl = `http://127.0.0.1:${server.port}/private/session-changes/v1`;
      const registry = new SessionChangesProducerRegistry();
      const producer = new SessionChangesProducer({ httpUrl, token: "test-token", registry });

      // 1. Session A registers and starts a tool call
      const rootA = await producer.registerSession("session-A", "main", "/repo");
      const ctxA: OmpExtensionContext = { agent: { kind: "main", id: "main" }, cwd: "/repo" };
      await producer.handleToolCall("ast-edit", { files: ["src/file-a.ts"] }, ctxA, "call-a-inflight");
      expect(producer.pendingCalls.has(makePendingKey("session-A", "main", "call-a-inflight"))).toBe(true);

      // 2. Switch to Session B fails
      const rootB = await producer.handleSessionSwitch("session-B", "main", "/repo");
      expect(rootB).toBeNull();

      // 3. Late result for session A arrives
      await producer.handleToolResult(
        "ast-edit",
        { files: ["/repo/src/file-a-modified.ts"] },
        ctxA,
        "call-a-inflight",
      );

      // 4. Session A's late result is still attributed to Session A!
      expect(rootA?.unprovenPaths.has("src/file-a-modified.ts")).toBe(true);
      expect(recordedCaptures.length).toBe(1);
      expect(recordedCaptures[0].ompSessionId).toBe("session-A");
    } finally {
      server.stop(true);
    }
  });

  it("R15c: tool call while switch registration is in-flight fails closed", async () => {
    const registerBReceived = createDeferred();
    const releaseRegisterB = createDeferred();
    const recordedCaptures: any[] = [];

    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        const url = new URL(req.url);
        const body = await req.json();
        if (url.pathname === "/private/session-changes/v1/register") {
          if (body.ompSessionId === "session-A") {
            return Response.json({
              serverEpoch: "epoch-1",
              terminalIncarnation: "1",
              ompSessionId: "session-A",
              rootId: ".",
              baselineId: "base-A",
              canonicalRoot: "/repo",
            });
          }
          registerBReceived.resolve();
          await releaseRegisterB.promise;
          return Response.json({
            serverEpoch: "epoch-1",
            terminalIncarnation: "1",
            ompSessionId: "session-B",
            rootId: ".",
            baselineId: "base-B",
            canonicalRoot: "/repo",
          });
        }
        if (url.pathname === "/private/session-changes/v1/capture") {
          recordedCaptures.push(body);
          return Response.json({
            version: 1,
            captureId: body.captureId,
            results: (body.paths as string[]).map((p: string) => ({
              path: p,
              status: "captured",
              presence: "present",
            })),
          });
        }
        return new Response("Not found", { status: 404 });
      },
    });

    try {
      const httpUrl = `http://127.0.0.1:${server.port}/private/session-changes/v1`;
      const registry = new SessionChangesProducerRegistry();
      const producer = new SessionChangesProducer({ httpUrl, token: "test-token", registry });

      const rootA = await producer.registerSession("session-A", "main", "/repo");
      expect(rootA).not.toBeNull();

      // Start switch to session B
      const switchPromise = producer.handleSessionSwitch("session-B", "main", "/repo");
      await registerBReceived.promise;

      // While B's registration is in-flight, an edit is issued
      const ctxMain: OmpExtensionContext = { agent: { kind: "main", id: "main" }, cwd: "/repo" };
      await producer.handleToolCall("write", { path: "src/premature.ts" }, ctxMain, "call-premature");

      // Zero captures sent to A or B
      expect(recordedCaptures.length).toBe(0);
      expect(rootA?.knownPaths.has("src/premature.ts")).toBe(false);

      // Release B's registration
      releaseRegisterB.resolve();
      const rootB = await switchPromise;
      expect(rootB?.ompSessionId).toBe("session-B");
    } finally {
      releaseRegisterB.resolve();
      server.stop(true);
    }
  });

  // ==========================================================================
  // P2 Regressions: Resilient Invalidation Queue Retention & Coalescing
  // ==========================================================================

  it("R16a: failed invalidation request is retained in pending queue and successfully delivered on retry", async () => {
    let captureAttempts = 0;
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        const url = new URL(req.url);
        const body = await req.json();
        if (url.pathname === "/private/session-changes/v1/capture") {
          captureAttempts++;
          if (captureAttempts === 1) {
            // First attempt fails with 500
            return new Response("Internal Server Error", { status: 500 });
          }
          // Second attempt succeeds
          return Response.json({
            version: 1,
            captureId: body.captureId,
            results: (body.paths as string[]).map((p: string) => ({
              path: p,
              status: "captured",
              presence: "present",
            })),
          });
        }
        return new Response("Not found", { status: 404 });
      },
    });

    try {
      const httpUrl = `http://127.0.0.1:${server.port}/private/session-changes/v1`;
      const registry = new SessionChangesProducerRegistry();
      const producer = new SessionChangesProducer({ httpUrl, token: "test-token", registry });

      const root = createRootSessionRegistration("sess-r16a", "epoch-1", "1", "base", "/repo");
      root.pendingInvalidations.push({
        captureId: "timed-out-r16a",
        paths: ["retry-file.ts"],
        timestamp: Date.now(),
      });
      registry.registerRoot("main", root);

      // First flush: fails due to 500
      await producer.flushPendingInvalidations(root);

      // Must be RETAINED in queue!
      expect(root.pendingInvalidations.length).toBe(1);
      expect(root.pendingInvalidations[0].captureId).toBe("timed-out-r16a");

      // Second flush: succeeds
      await producer.flushPendingInvalidations(root);

      // Fully acknowledged: queue is now empty!
      expect(root.pendingInvalidations.length).toBe(0);
      expect(captureAttempts).toBe(2);
    } finally {
      server.stop(true);
    }
  });

  it("R16b: partial multi-chunk acknowledgment retains only unacknowledged paths", async () => {
    let captureCount = 0;
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        const url = new URL(req.url);
        const body = await req.json();
        if (url.pathname === "/private/session-changes/v1/capture") {
          captureCount++;
          if (captureCount === 1) {
            // Chunk 1 succeeds
            return Response.json({
              version: 1,
              captureId: body.captureId,
              results: (body.paths as string[]).map((p: string) => ({
                path: p,
                status: "captured",
                presence: "present",
              })),
            });
          }
          // Chunk 2 fails
          return new Response("Internal Server Error", { status: 500 });
        }
        return new Response("Not found", { status: 404 });
      },
    });

    try {
      const httpUrl = `http://127.0.0.1:${server.port}/private/session-changes/v1`;
      const registry = new SessionChangesProducerRegistry();
      const producer = new SessionChangesProducer({ httpUrl, token: "test-token", registry });

      const root = createRootSessionRegistration("sess-r16b", "epoch-1", "1", "base", "/repo");
      // 300 nested paths forces at least 2 chunks
      const paths = generateNestedPaths(300, "r16b");
      root.pendingInvalidations.push({
        captureId: "chunked-inv-1",
        paths: [...paths],
        timestamp: Date.now(),
      });
      registry.registerRoot("main", root);

      // First flush: chunk 1 succeeds, chunk 2 fails
      await producer.flushPendingInvalidations(root);

      // Invalidation still exists, but acknowledged chunk 1 paths were pruned!
      expect(root.pendingInvalidations.length).toBe(1);
      expect(root.pendingInvalidations[0].paths.length).toBeLessThan(300);
      expect(root.pendingInvalidations[0].paths.length).toBeGreaterThan(0);
    } finally {
      server.stop(true);
    }
  });

  it("R16c: coalesces concurrent flush calls on the same root without duplicate requests", async () => {
    let captureCount = 0;
    const captureReceived = createDeferred();
    const releaseCapture = createDeferred();

    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        const url = new URL(req.url);
        const body = await req.json();
        if (url.pathname === "/private/session-changes/v1/capture") {
          captureCount++;
          captureReceived.resolve();
          await releaseCapture.promise;
          return Response.json({
            version: 1,
            captureId: body.captureId,
            results: (body.paths as string[]).map((p: string) => ({
              path: p,
              status: "captured",
              presence: "present",
            })),
          });
        }
        return new Response("Not found", { status: 404 });
      },
    });

    try {
      const httpUrl = `http://127.0.0.1:${server.port}/private/session-changes/v1`;
      const registry = new SessionChangesProducerRegistry();
      const producer = new SessionChangesProducer({ httpUrl, token: "test-token", registry });

      const root = createRootSessionRegistration("sess-r16c", "epoch-1", "1", "base", "/repo");
      root.pendingInvalidations.push({
        captureId: "concurrent-inv",
        paths: ["file1.ts"],
        timestamp: Date.now(),
      });
      registry.registerRoot("main", root);

      // Start two concurrent flushes
      const p1 = producer.flushPendingInvalidations(root);
      const p2 = producer.flushPendingInvalidations(root);

      await captureReceived.promise;
      releaseCapture.resolve();

      await Promise.all([p1, p2]);

      // Exactly 1 request on wire was sent
      expect(captureCount).toBe(1);
      expect(root.pendingInvalidations.length).toBe(0);
    } finally {
      releaseCapture.resolve();
      server.stop(true);
    }
  });

  it("R15d: switching to already-retained session B fail-closes live routing while B's registration is paused or failed", async () => {
    const regB2Received = createDeferred();
    const releaseRegB2 = createDeferred();
    const recordedCaptures: any[] = [];
    let bRegistrationCount = 0;

    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        const url = new URL(req.url);
        const body = await req.json();
        if (url.pathname === "/private/session-changes/v1/register") {
          if (body.ompSessionId === "session-A") {
            return Response.json({
              serverEpoch: "epoch-1",
              terminalIncarnation: "1",
              ompSessionId: "session-A",
              rootId: ".",
              baselineId: "base-A",
              canonicalRoot: "/repo",
            });
          }
          bRegistrationCount++;
          if (bRegistrationCount === 1) {
            return Response.json({
              serverEpoch: "epoch-1",
              terminalIncarnation: "1",
              ompSessionId: "session-B",
              rootId: ".",
              baselineId: "base-B",
              canonicalRoot: "/repo",
            });
          }
          // Second registration for B is paused
          regB2Received.resolve();
          await releaseRegB2.promise;
          return new Response("Internal Server Error", { status: 500 });
        }
        if (url.pathname === "/private/session-changes/v1/capture") {
          recordedCaptures.push(body);
          return Response.json({
            version: 1,
            captureId: body.captureId,
            results: (body.paths as string[]).map((p: string) => ({
              path: p,
              status: "captured",
              presence: "present",
            })),
          });
        }
        return new Response("Not found", { status: 404 });
      },
    });

    try {
      const httpUrl = `http://127.0.0.1:${server.port}/private/session-changes/v1`;
      const registry = new SessionChangesProducerRegistry();
      const producer = new SessionChangesProducer({ httpUrl, token: "test-token", registry });

      // 1. Session B registers initially with main and an independent subagent
      const rootBInitial = await producer.registerSession("session-B", "main", "/repo");
      expect(rootBInitial).not.toBeNull();
      registry.registerRoot("independent-b", rootBInitial!);
      expect(registry.agentToRoot.get("independent-b")).toBe("session-B");

      // 2. User switches to Session A
      const rootA = await producer.handleSessionSwitch("session-A", "main", "/repo");
      expect(rootA?.ompSessionId).toBe("session-A");
      // Session B is still retained in registry.roots, and independent-b still maps to session-B!
      expect(registry.roots.has("session-B")).toBe(true);
      expect(registry.agentToRoot.get("independent-b")).toBe("session-B");

      // 3. User switches back to Session B, but registration is paused at peer
      const switchB2Promise = producer.handleSessionSwitch("session-B", "main", "/repo");
      await regB2Received.promise;

      // 4. While B's registration is in flight:
      // Even though session-B is in registry.roots, and independent-b is directly mapped to B in agentToRoot,
      // live routing MUST be fail-closed because session-B is not authorized!
      const ctxMain: OmpExtensionContext = { agent: { kind: "main", id: "main" }, cwd: "/repo" };
      const ctxIndep: OmpExtensionContext = { agent: { kind: "sub", id: "independent-b" }, cwd: "/repo" };
      await producer.handleToolCall("write", { path: "src/during-b-reg.ts" }, ctxMain, "call-during-b");
      await producer.handleToolCall("write", { path: "src/worker-reg.ts" }, ctxIndep, "call-indep-b");
      await producer.handleToolCall("write", { path: "src/agentless.ts" }, undefined, "call-agentless");

      expect(recordedCaptures.length).toBe(0);
      expect(registry.resolveRoot(ctxMain.agent)).toBeUndefined();
      expect(registry.resolveRoot(ctxIndep.agent)).toBeUndefined();
      expect(registry.resolveRoot(undefined)).toBeUndefined();

      // Release registration with failure (simulated 500 error)
      releaseRegB2.resolve();
      const rootB2 = await switchB2Promise;
      expect(rootB2).toBeNull();

      // After failed registration, independent-b STILL fails closed!
      expect(registry.resolveRoot(ctxIndep.agent)).toBeUndefined();
      expect(registry.resolveRoot(ctxMain.agent)).toBeUndefined();
      expect(registry.resolveRoot(undefined)).toBeUndefined();
    } finally {
      releaseRegB2.resolve();
      server.stop(true);
    }
  });

  it("R15e: multi-level descendant unbinding revokes entire subtree without affecting independent sibling agents on same or different root", async () => {
    const registry = new SessionChangesProducerRegistry();
    const producer = new SessionChangesProducer({
      httpUrl: "http://127.0.0.1:0/mock",
      token: "test-token",
      registry,
    });

    const rootA = createRootSessionRegistration("session-A", "epoch-1", "1", "base-A", "/repo");
    const rootSibling = createRootSessionRegistration("session-sibling", "epoch-1", "1", "base-S", "/repo");
    registry.registerRoot("main", rootA);
    registry.registerRoot("unrelated-on-a", rootA);
    registry.registerRoot("sibling-agent", rootSibling);

    // Build multi-level hierarchy: main -> child-1 -> grandchild-1
    registry.recordChildAgent("child-1", "main");
    registry.recordChildAgent("grandchild-1", "child-1");

    // Also discover lazy child through resolveRoot({ id: "lazy-child", parentId: "main" })
    const lazyRoot = registry.resolveRoot({ kind: "sub", id: "lazy-child", parentId: "main" });
    expect(lazyRoot).toBe(rootA);
    expect(registry.agentToRoot.get("lazy-child")).toBe("session-A");
    expect(registry.agentLineage.get("lazy-child")).toBe("main");

    expect(registry.agentToRoot.get("child-1")).toBe("session-A");
    expect(registry.agentToRoot.get("grandchild-1")).toBe("session-A");
    expect(registry.agentToRoot.get("unrelated-on-a")).toBe("session-A");
    expect(registry.agentToRoot.get("sibling-agent")).toBe("session-sibling");

    // Parent switch begins and unbinds main
    registry.unauthorizeSession();
    registry.unbindAgent("main");

    // Assert exact removal from agentToRoot and agentLineage for main and all descendants
    expect(registry.agentToRoot.has("main")).toBe(false);
    expect(registry.agentToRoot.has("child-1")).toBe(false);
    expect(registry.agentToRoot.has("grandchild-1")).toBe(false);
    expect(registry.agentToRoot.has("lazy-child")).toBe(false);
    expect(registry.agentLineage.has("child-1")).toBe(false);
    expect(registry.agentLineage.has("grandchild-1")).toBe(false);
    expect(registry.agentLineage.has("lazy-child")).toBe(false);

    // Sibling agents on the SAME root and DIFFERENT roots survive intact!
    expect(registry.agentToRoot.get("unrelated-on-a")).toBe("session-A");
    expect(registry.agentToRoot.get("sibling-agent")).toBe("session-sibling");
  });

  it("R15f: lineage eviction at capacity unbinds child so it cannot remain as a routable orphan upon reauthorization", async () => {
    const registry = new SessionChangesProducerRegistry();
    const producer = new SessionChangesProducer({
      httpUrl: "http://127.0.0.1:0/mock",
      token: "test-token",
      registry,
    });

    const rootA = createRootSessionRegistration("session-A", "epoch-1", "1", "base-A", "/repo");
    registry.registerRoot("main", rootA);
    registry.registerRoot("unrelated-direct", rootA);

    registry.recordChildAgent("child-to-evict", "main");
    expect(registry.agentToRoot.get("child-to-evict")).toBe("session-A");
    expect(registry.agentLineage.get("child-to-evict")).toBe("main");

    // 2. Fill agentLineage to capacity (MAX_CHILD_ENTRIES) with unrelated children whose parents are unresolved
    // Because parents are unresolved, agentToRoot does NOT grow, testing lineage-map eviction in isolation!
    for (let i = 0; i < MAX_CHILD_ENTRIES; i++) {
      registry.recordChildAgent(`unrelated-child-${i}`, `unresolved-parent-${i}`);
    }

    // Lineage map reached capacity, while agentToRoot stayed well below capacity
    expect(registry.agentLineage.size).toBe(MAX_CHILD_ENTRIES);
    expect(registry.agentToRoot.size).toBeLessThan(MAX_CHILD_ENTRIES);

    // child-to-evict was evicted from agentLineage at capacity.
    // Because lineage eviction unbinds the agent, child-to-evict must NOT survive in agentToRoot!
    expect(registry.agentLineage.has("child-to-evict")).toBe(false);
    expect(registry.agentToRoot.has("child-to-evict")).toBe(false);

    // 3. Clear authorization and re-authorize session A
    registry.unauthorizeSession();
    registry.authorizeSession("session-A");

    // The evicted child remains unbound and cannot route tool calls
    const ctxChild: OmpExtensionContext = { agent: { kind: "sub", id: "child-to-evict" }, cwd: "/repo" };
    expect(registry.resolveRoot(ctxChild.agent)).toBeUndefined();

    // But the unrelated direct agent on rootA and main remain routable!
    const ctxUnrelated: OmpExtensionContext = { agent: { kind: "sub", id: "unrelated-direct" }, cwd: "/repo" };
    expect(registry.resolveRoot(ctxUnrelated.agent)).toBe(rootA);
  });

  it("R15g: binding-map capacity eviction when parent is oldest aborts child registration so no orphan survives unbinding or reauthorization", async () => {
    const registry = new SessionChangesProducerRegistry();
    const producer = new SessionChangesProducer({
      httpUrl: "http://127.0.0.1:0/mock",
      token: "test-token",
      registry,
    });

    const rootA = createRootSessionRegistration("session-A", "epoch-1", "1", "base-A", "/repo");
    // 1. "main" is inserted first (oldest entry in agentToRoot)
    registry.registerRoot("main", rootA);
    expect(registry.agentToRoot.get("main")).toBe("session-A");
    // 2. Fill agentToRoot to capacity (MAX_CHILD_ENTRIES) with (MAX_CHILD_ENTRIES - 1) unrelated direct agents
    for (let i = 0; i < MAX_CHILD_ENTRIES - 1; i++) {
      registry.registerRoot(`unrelated-direct-${i}`, rootA);
    }
    expect(registry.agentToRoot.size).toBe(MAX_CHILD_ENTRIES);

    // 3. Now attempt to discover/record a new child of "main"
    // Because agentToRoot is at capacity, recording "new-child" evicts the oldest entry ("main")!
    // Because main was evicted, new-child's parent is no longer valid, so new-child MUST NOT be cached in agentToRoot!
    registry.recordChildAgent("new-child", "main");

    // "main" was evicted, and "new-child" was NOT registered as an orphan in agentToRoot
    expect(registry.agentToRoot.has("main")).toBe(false);
    expect(registry.agentToRoot.has("new-child")).toBe(false);

    // 4. Clear and reauthorize session A
    registry.unauthorizeSession();
    registry.authorizeSession("session-A");

    // "new-child" remains unbound and unroutable
    const ctxChild: OmpExtensionContext = { agent: { kind: "sub", id: "new-child", parentId: "main" }, cwd: "/repo" };
    expect(registry.resolveRoot(ctxChild.agent)).toBeUndefined();
  });

  it("R15h: out-of-order lineage discovery preserves chain resolution when parent is recorded later", async () => {
    const registry = new SessionChangesProducerRegistry();
    const producer = new SessionChangesProducer({
      httpUrl: "http://127.0.0.1:0/mock",
      token: "test-token",
      registry,
    });

    const rootA = createRootSessionRegistration("session-A", "epoch-1", "1", "base-A", "/repo");
    registry.registerRoot("main", rootA);
    registry.authorizeSession("session-A");

    // 1. Observe grandchild -> child BEFORE child is known
    registry.recordChildAgent("grandchild", "child");
    expect(registry.agentLineage.get("grandchild")).toBe("child");
    expect(registry.agentToRoot.has("grandchild")).toBe(false);

    // 2. Observe child -> main
    registry.recordChildAgent("child", "main");
    expect(registry.agentLineage.get("child")).toBe("main");
    expect(registry.agentToRoot.get("child")).toBe("session-A");

    // 3. Resolve grandchild by ID alone: resolves through lineage chain grandchild -> child -> main -> session-A
    const ctxGrandchild: OmpExtensionContext = { agent: { kind: "sub", id: "grandchild" }, cwd: "/repo" };
    expect(registry.resolveRoot(ctxGrandchild.agent)).toBe(rootA);
  });
  it("R15i: delayed call during paused registration cannot mutate lineage to become routable after switch", async () => {
    let registrationReceived = createDeferred();
    let releaseRegistration = createDeferred();

    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/private/session-changes/v1/register") {
          registrationReceived.resolve();
          await releaseRegistration.promise;
          return Response.json({
            version: 1,
            serverEpoch: "epoch-1",
            terminalIncarnation: "1",
            ompSessionId: "session-B",
            rootId: "rootB",
            baselineId: "base-B",
            root: "/repo",
            launchCwd: "/repo",
            disabled: false,
            rootCwd: "/repo",
            canonicalRoot: "/repo",
          });
        }
        return new Response("Not Found", { status: 404 });
      },
    });

    const registry = new SessionChangesProducerRegistry();
    const producer = new SessionChangesProducer({
      httpUrl: `http://127.0.0.1:${server.port}/private/session-changes/v1`,
      token: "test-token",
      registry,
    });

    try {
      const rootA = createRootSessionRegistration("session-A", "epoch-1", "1", "base-A", "/repo");
      registry.registerRoot("main", rootA);
      registry.recordChildAgent("child", "main");
      registry.authorizeSession("session-A");

      // Initially, child resolves to rootA
      const ctxChild: OmpExtensionContext = { agent: { kind: "sub", id: "child" }, cwd: "/repo" };
      expect(registry.resolveRoot(ctxChild.agent)).toBe(rootA);

      // 1. Switch to Session B (clears authorization and unbinds main & descendants synchronously)
      const switchPromise = producer.handleSessionSwitch("session-B", "main", "/repo");
      await registrationReceived.promise;

      // Authorization is cleared, main and child were unbound
      expect(registry.authorizedSessions.has("session-A")).toBe(false);
      expect(registry.authorizedSessions.has("session-B")).toBe(false);
      expect(registry.agentToRoot.has("child")).toBe(false);
      expect(registry.agentLineage.has("child")).toBe(false);

      // 2. Delayed call arrives from Session A with { id: "child", parentId: "main" }
      const delayedCtx: OmpExtensionContext = {
        agent: { kind: "sub", id: "child", parentId: "main" },
        cwd: "/repo",
      };
      // Must fail closed because parent is not authorized
      expect(registry.resolveRoot(delayedCtx.agent)).toBeUndefined();
      // Lazy discovery must NOT mutate agentLineage during unauthenticated / paused switch!
      expect(registry.agentLineage.has("child")).toBe(false);

      // 3. Release Session B's registration
      releaseRegistration.resolve();
      await switchPromise;

      // Session B is now active and authorized
      expect(registry.authorizedSessions.has("session-B")).toBe(true);
      const ctxMainB: OmpExtensionContext = { agent: { kind: "main" }, cwd: "/repo" };
      expect(registry.resolveRoot(ctxMainB.agent)?.ompSessionId).toBe("session-B");

      // 4. An ID-only lookup for "child" arrives in Session B
      // It must NOT route to Session B because lazy discovery was prevented!
      expect(registry.resolveRoot(ctxChild.agent)).toBeUndefined();
    } finally {
      releaseRegistration.resolve();
      server.stop(true);
    }
  });

  it("R16d: capacity shifting while head invalidation is paused at peer preserves object identity removal", async () => {
    const capture1Received = createDeferred();
    const releaseCapture1 = createDeferred();

    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        const url = new URL(req.url);
        const body = await req.json();
        if (url.pathname === "/private/session-changes/v1/capture") {
          if (body.captureId === "head-inv") {
            capture1Received.resolve();
            await releaseCapture1.promise;
            return Response.json({
              version: 1,
              captureId: body.captureId,
              results: (body.paths as string[]).map((p: string) => ({
                path: p,
                status: "unproven",
              })),
            });
          }
          return new Response("Internal Server Error", { status: 500 });
        }
        return new Response("Not found", { status: 404 });
      },
    });

    try {
      const httpUrl = `http://127.0.0.1:${server.port}/private/session-changes/v1`;
      const registry = new SessionChangesProducerRegistry();
      const producer = new SessionChangesProducer({ httpUrl, token: "test-token", registry });

      const root = createRootSessionRegistration("sess-r16d", "epoch-1", "1", "base", "/repo");
      // Populate queue to capacity (64 entries: inv-0 to inv-63)
      for (let i = 0; i < 64; i++) {
        root.pendingInvalidations.push({ captureId: i === 0 ? "head-inv" : `inv-${i}`, paths: [`f_${i}.ts`], timestamp: Date.now() });
      }
      expect(root.pendingInvalidations.length).toBe(64);
      registry.registerRoot("main", root);

      const flushPromise = producer.flushPendingInvalidations(root);
      // Wait for head-inv to be in-flight
      await capture1Received.promise;

      // While head-inv is in-flight, push 1 more entry through production recordTimedOutAttempt at capacity
      // This shifts position 0 (head-inv) and appends extra-inv at the end
      (producer as any).recordTimedOutAttempt(root, "extra-inv", ["extra.ts"]);
      expect(root.pendingInvalidations.length).toBe(64);
      expect(root.pendingInvalidations[0].captureId).toBe("inv-1");

      // Release capture for head-inv
      releaseCapture1.resolve();
      await flushPromise;

      // inv-0 (head-inv) was shifted at capacity and removed by identity
      expect(root.pendingInvalidations.some((i) => i.captureId === "head-inv")).toBe(false);
      // inv-1 was NOT deleted by a positional shift() bug; it survived and remains in queue!
      expect(root.pendingInvalidations[0].captureId).toBe("inv-1");
      expect(root.pendingInvalidations.some((i) => i.captureId === "extra-inv")).toBe(true);
      expect(root.pendingInvalidations.length).toBe(64);
    } finally {
      releaseCapture1.resolve();
      server.stop(true);
    }
  });

  it("R16e: unacknowledged or unrecognized path statuses retain unconfirmed paths in queue", async () => {
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        const body = await req.json();
        // Server acknowledges only path-1, returns unrecognized status for path-2
        return Response.json({
          version: 1,
          captureId: body.captureId,
          results: [
            { path: "path-1.ts", status: "unproven" },
            { path: "path-2.ts", status: "rejectedInvalidStatus" },
          ],
        });
      },
    });

    try {
      const httpUrl = `http://127.0.0.1:${server.port}/private/session-changes/v1`;
      const registry = new SessionChangesProducerRegistry();
      const producer = new SessionChangesProducer({ httpUrl, token: "test-token", registry });

      const root = createRootSessionRegistration("sess-r16e", "epoch-1", "1", "base", "/repo");
      root.pendingInvalidations.push({
        captureId: "inv-partial-status",
        paths: ["path-1.ts", "path-2.ts"],
        timestamp: Date.now(),
      });
      registry.registerRoot("main", root);

      await producer.flushPendingInvalidations(root);

      // path-1 was acknowledged and removed; path-2 remains queued!
      expect(root.pendingInvalidations.length).toBe(1);
      expect(root.pendingInvalidations[0].paths).toEqual(["path-2.ts"]);
    } finally {
      server.stop(true);
    }
  });
});
