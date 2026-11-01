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
});
