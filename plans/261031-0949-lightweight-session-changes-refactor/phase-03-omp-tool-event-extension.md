# Phase 03 — OMP tool-event extension

Priority P1 · completed (2026-10-31 17:23:46 +07:00) · 0.40d · owner: OMP producer implementer.
Context: [engine/wire contract](phase-02-lightweight-per-file-engine.md), [managed packaging](phase-01-config-and-extension-lifecycle.md), existing `server/src/agent_status/assets/omp-agent-status.ts::damHopperAgentStatusExtension`, `server/tests/omp-agent-status.test.ts` (Bun).

## Evidence and design

Approved design cites actual OMP sources under `/home/loidinh/WS/oh-my-pi/packages/coding-agent/src/`: `extensibility/extensions/wrapper.ts:281-310` awaits `tool_call`; `:520-543` emits post-execution `tool_result`; `types.ts:546-568` documents rebound extension factories and `ctx.agent.kind/id/parentId`; `:1500-1602` defines event inputs/details. `tools/ast-edit.ts:46-53` accepts `paths: string[]` including directories/globs; its result details include `cwd`, `files` and per-file replacement metadata. `edit/index.ts:255-282` provides single-file or `perFileResults` details. These are local source evidence, not a runtime qualification claim or a new product dependency.

Create standalone bundled `omp-session-changes.ts`; do not import the Agent Status extension or acquire a competing status WebSocket reporter. Reuse the validated loopback collector URL and bearer environment contract (`DAM_HOPPER_AGENT_STATUS_URL`, `DAM_HOPPER_AGENT_STATUS_TOKEN`) for private HTTP. Session Changes registers metadata independently and never changes status/notification admission or tool output.

Factory closures are rebound per subagent: a closure-local root session ID alone is insufficient. Use a module-scoped, bounded in-process registry keyed by root agent lineage and active server tuple. Root `session_start`/`session_switch` publishes registration; child factories resolve `ctx.agent.parentId` recursively to an existing root using agent IDs, not their independent child session-manager IDs. Root and in-process `sub` (`task`) paths share one `ompSessionId` record. Never infer a root from a stale last-global-session variable or drop every child with `hasUI !== true`.

Execution order: `omp-tool-event-producer` is the unblocked graph root despite this concern's Phase 03 filename. Implement the complete standalone asset against the frozen Phase 02 wire contract before Rust bundling. Its boundary compile/tests/local loopback smoke use the real extension with a controlled HTTP peer; they prove producer behavior, not the not-yet-implemented server protocol. Live OMP/server integration remains the downstream final journey. No production fallback, placeholder asset or protocol shim is permitted.

## Durable tasks

```evcrate-tasks
[
  {
    "id": "omp-tool-event-producer",
    "title": "Implement standalone pre-edit capture extension and isolate Agent Status",
    "blocked_by": [],
    "allowed_files": ["server/src/agent_status/assets/omp-session-changes.ts", "server/src/agent_status/assets/omp-agent-status.ts", "server/tests/omp-agent-status.test.ts", "server/tests/omp-session-changes.test.ts"],
    "constraints": ["Use awaited tool_call and post-execution tool_result hooks; never change tool inputs/results, deny tools or block a tool longer than a single 1500 ms total capture deadline.", "Track only write, Hashline edit including MV/REM, and concrete-file ast_edit; do not scan/glob/read originals in the extension or inspect bash/eval scripts.", "Root and rebound subagent factories share bounded process registry fenced by serverEpoch, terminalIncarnation and root ompSessionId; no cross-session adoption.", "Remove Session Changes capture/barrier/settled coupling from omp-agent-status.ts; preserve its existing semantic status, notification, heartbeat and settle behavior."],
    "acceptance": ["Root session start/switch registers metadata without file content reads; in-process task/nested child edits publish under the correct root OMP identity.", "Pre-edit hooks capture every Hashline block source and MV destination before tool execution, plus write and literal ast_edit targets, once per path.", "Timeout/error returns normally and marks paths unproven; glob/directory AST result-only concrete paths are unknown, never backfilled from post-edit bytes.", "Settled agent_end only sends metadata and ignores willContinue intermediate turns; stale callbacks after switch, OFF or restart cannot mutate another record.", "Agent Status standalone extension has no Session Changes HTTP/barrier work; its reporting/notification lifecycle remains intact."],
    "verification": ["Before this task completes compile both assets with bun build --target bun server/src/agent_status/assets/omp-agent-status.ts server/src/agent_status/assets/omp-session-changes.ts --outdir <isolated-temp-build-dir>, then run bun test server/tests/omp-agent-status.test.ts server/tests/omp-session-changes.test.ts. Author the basic producer tests in this task; never wait for qualify-omp-producer to create its test file.", "Smoke the real extension factory/event handlers with a temporary loopback HTTP peer and actual pre-tool mutation ordering; exercise registration, capture, unknown timeout and root/child tuple routing without requiring future Rust endpoints. A boundary peer is not live server/OMP qualification.", "Collect independent local review and compile/tests/smoke evidence now, then release managed-extension-lifecycle; final integrated OMP journey remains an additional descendant gate."]
  },
  {
    "id": "qualify-omp-producer",
    "title": "Author OMP producer parsing, fail-open and lineage regressions",
    "blocked_by": ["omp-tool-event-producer"],
    "allowed_files": ["server/tests/omp-session-changes.test.ts", "server/tests/omp-agent-status.test.ts"],
    "constraints": ["Use current OMP event shapes and fixture payloads derived from local schemas; mocks prove boundary behavior only, not installed-host compatibility.", "Tests and registry metadata are bounded; never retain complete tool patches/results or raw baseline bytes in producer state.", "No product-source writes from this regression task; report a failing contract to its implementation owner before final execution."],
    "acceptance": ["Tests cover write, multiple Hashline headers, quoted/spaced MV targets, REM, CUT-only and register cross-file paste, and AST concrete/glob/directory/result-only paths.", "Tests cover root/sub/nested factories, independent roots, child-first unresolved lineage, duplicate tool IDs in different agents and switch/restart races.", "Tests prove tool runs after capture completion or deadline, one total 1.5s budget across a multi-file call, unknown sealing and no wait on unreachable collector.", "Both extensions loaded together still produce one Agent Status reporter; turning Session Changes OFF never disables Agent Status or notifications."],
    "verification": ["At this task boundary compile both extension assets with bun build --target bun server/src/agent_status/assets/omp-agent-status.ts server/src/agent_status/assets/omp-session-changes.ts --outdir <isolated-temp-build-dir> and run bun test server/tests/omp-agent-status.test.ts server/tests/omp-session-changes.test.ts; record exact totals and timing-test tolerance.", "Smoke real handlers against a local loopback peer with deferred/late responses, child switches and capture deadline; collect review/evidence for the expanded regressions without waiting for server or UI descendants. Real OMP task-agent journey belongs only to integrated qualification."]
  }
]
```

- [x] <!-- evcrate-task:omp-tool-event-producer --> Implement standalone pre-edit capture extension and isolate Agent Status
- [x] <!-- evcrate-task:qualify-omp-producer --> Author OMP producer parsing, fail-open and lineage regressions

## Ordered implementation

### `omp-tool-event-producer`

1. Implement default extension export with strict loopback URL/protocol and token validation, bounded HTTP bodies and abortable requests. If environment/lineage/registration is unavailable, return normally; never open remote arbitrary URLs or emit status hello/lease traffic.
2. On root `session_start`, resolve actual root `ctx.sessionManager.getSessionId()` and register metadata. On root `session_switch`, fence old callbacks before registering new identity. Associate child agent IDs through `parentId` with the active root tuple; children without a provable parent stay untracked until resolvable, not assigned to an ambient root. Use `session_shutdown` to release registry entries and pending requests; server retention remains governed by existing PTY lifecycle.
3. Track pending tool calls by `(root tuple, agent id, toolCallId)`. Derive concrete paths relative to each emitting context's cwd, then map into registered root; server remains authority. Internal non-filesystem URLs, archives/remote/database targets and outside-root paths are not local originals.
4. Parse current OMP write path input and Hashline edit patch input from its installed schema, not from result display strings alone. Read schema module referenced by `edit/index.ts` before implementing parser. For `[path#TAG]`, identify header paths without treating inserted patch text as headers; include both source and target for `MV`, source for `REM`, and every block even if it contains only CUT or a cross-file register paste. Honor quoted destination syntax and deduplicate normalized paths.
5. For `ast_edit`, only literal concrete file targets are pre-capture candidates. A literal directory is not a file; server returns unsupported/unknown without enumerating it. Never expand globs in the extension or server. `tool_result.details.files`/`cwd` supplies concrete observed AST paths after execution; record any previously uncaptured path with `mode: unproven`. Use edit single/per-file result metadata to reconcile actual source/destination paths and catch result-only discoveries as unknown.
6. Await `/capture` before supported tools run, with one absolute 1500 ms budget covering registration readiness, all paths/chunks and requests, not 1500 ms per file. Share in-flight same-path work; never await an unbounded worker queue. Abort at deadline, catch all errors and return `undefined` (no block/input/result modifications). Keep bounded unproven notifications for affected paths; do not await a second network deadline before releasing the tool. If server stays unreachable, keep only bounded local unknown metadata and flush on later valid contact within the same tuple.
7. On capture timeout, request `unproven` for that capture attempt so late success cannot be claimed as acknowledged pre-edit evidence. Never retry a preEdit read after execution. Existing acknowledged originals survive later failed capture attempts. Tool result errors do not automatically mean no mutation; preserve honest unknown evidence for any discovered possibly touched path.
8. On settled `agent_end` (`willContinue !== true`), send metadata `/settled` under the originating tuple/turn. Child turn ends cannot switch root identity or trigger a diff. If root switch/OFF/restart invalidates a response, discard it and do not adopt a new baseline implicitly. OFF replies stop producer work for that registration; a restart-loaded enabled session registers afresh.
9. Remove old Session Changes registration, prepare/activate/receipt/failure/lookup barrier and settled HTTP methods/hooks from Agent Status asset. Move only relevant safe transport/outcome helpers to the new asset as needed; do not export a shared runtime abstraction that requires another installed file. Update status-only tests in place.
10. Create basic `server/tests/omp-session-changes.test.ts` and run asset compile, focused Bun tests, local HTTP boundary smoke and review before completing this task. Existing `omp-agent-status.test.ts` must pass after extraction. The regression successor expands this already passing suite; neither file creation nor first evidence is deferred.

### `qualify-omp-producer`

1. Expand the already existing/passing `server/tests/omp-session-changes.test.ts` using the `bun:test` convention; instantiate root and rebound child factories over one module registry and controlled HTTP boundary.
2. Prove capture resolves before tool mutation; timeout always releases supported tool while sealing unknown, including a response arriving after timeout and an OFF race.
3. Feed realistic Hashline/AST fixtures, nested agents and independent roots. Check body/path bounds, no complete-patch logging, no HTTP work for unsupported tools, and unchanged tool errors/results.
4. Preserve status adapter tests for reconnect, settle outcomes, approvals, heartbeat and notifications. Compile/run the focused suites and local smoke/review before completing this task; later finalizer independently runs cross-layer suites and real OMP after its prerequisites are complete.

## Failure, rollback and security/bounds

- Unknown/unproven is deliberate reduced fidelity, not a fabricated success. Do not advertise coverage of arbitrary scripts, unresolved globs, independent processes or sessions that started before extension load.
- Cap process maps at server limits (32 roots, 500 known paths/root) and bounded pending tool/request entries; evict only inactive metadata or stop tracking with incomplete coverage. No unbounded timeout retry queue, session-ID guessing or secret-bearing logs.
- Registry fencing must distinguish Session Changes server epoch from Agent Status's own epoch representation. Use `/register` response identity, not WebSocket epoch coercion.
- Physical OFF removal prevents future loading; server gate handles already loaded extensions immediately. OFF→ON requires restart of active OMP sessions; do not silently hot-load or revive stale registrations.
- Rollback is OFF and safe removal; pure Agent Status asset remains installed. Never restore the old capture barrier as fallback.
