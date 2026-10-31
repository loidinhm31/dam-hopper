# Code Review — Phase 03 OMP tool-event extension, Cycle 3

## Verdict

**Score: 5/10 — changes required; Phase 03 acceptance incomplete.** Registration-response generation fencing, unproven-only flushing, UTF-8 measurement, capture envelope correlation, unknown outcome defaults and real HTTP coverage improved. These do not resolve the broader ownership, attempt invalidation, concurrency and qualification findings.

Review-only: source/test/plan/task-state unchanged. Report is the only file authored. Findings below are static source analysis, not runtime reproductions. Build/test results attributed to the testing owner, not independently rerun.

## Critical issues

None confirmed at Critical severity. No demonstrated arbitrary remote request, filesystem mutation or credential disclosure. High warnings below still block acceptance because they affect baseline provenance, session attribution and bounded tool latency.

## Warnings

### W1 — High: generation fencing covers registration responses, not the active root lifecycle

**Evidence:** `server/src/agent_status/assets/omp-session-changes.ts:460-555,656-725,833-922,1171-1195`.

`handleSessionSwitch` advances an instance-local generation and clears pending calls, but does not retire the previous root or its cached descendant bindings. Once A has registered and a child has cached A, switching the main producer to B leaves that child mapped to A. An A capture already awaiting HTTP never checks generation, current root ownership or `disabled` after its await: it can publish results, send subsequent preEdit chunks and flush stale metadata after switch/shutdown/OFF. Shutdown removes metadata but does not abort requests. Root keys are still bare session IDs, not the required collector/epoch/incarnation-qualified identity.

**Impact:** discarded-session callbacks continue work and root/sub routing can remain attached to an obsolete session. **Confidence: high.**

**Correction:** capture a shared root/tuple generation, retire live bindings before awaiting a switch, and recheck ownership after every await and before each subsequent request/publication. Abort obsolete requests. Preserve retained server history separately from live producer routing.

### W2 — High: result-only child discoveries are dropped; pending origins remain ambiguous

**Evidence:** producer `:753-799,944-970,1233-1241`; installed OMP `src/extensibility/extensions/types.ts:545-567`.

A rebound child factory only records lineage; its `activeSessionId` remains null. For glob-only AST calls, `handleToolCall` returns before recording any pending descriptor. The child result resolves the correct shared root, then rejects it because `root.ompSessionId !== this.activeSessionId`. Thus required child glob/directory result-only paths never become unproven records.

Other pending calls remain keyed solely by `toolCallId`; stored `agentId` and `baselineId` are not validated on retrieval. Clearing/evicting a descriptor falls back to ambient current-root resolution. A late A result after A→B can therefore attach discoveries to B. `session_start`/`session_switch` also still register a `sub` with no parent as an independent root, and sole-root fallbacks remain.

**Impact:** lost coverage or cross-agent/session attribution. **Confidence: high.**

**Correction:** record bounded origins for all supported calls, including empty concrete-path sets; key/check agent, call and full tuple; never replace a missing origin with the ambient root. Resolve legitimate child results from their recorded shared owner, not child-local active session state. Reject unprovable child lineage.

### W3 — High: retry metadata loses the timed-out capture ID

**Evidence:** producer `:434-445,895-917,1077-1108`; frozen engine contract `phase-02-lightweight-per-file-engine.md:15-17`.

The immediate best-effort invalidation correctly reuses `captureReq.captureId`. If that request fails, only path strings survive in `pendingUnprovenFlush`; later flushing generates fresh IDs. Missing-path responses similarly queue paths without issuing/preserving an invalidation for the original attempt.

The contract makes `unproven` invalidate the specific timed-out attempt while preserving independently acknowledged originals. A fresh unrelated ID cannot reliably identify which pending/late publication must be downgraded. Sending only unproven mode fixes post-edit rereads, but not late-attempt provenance.

**Impact:** an unacknowledged late capture can escape its invalidation. **Confidence: high for protocol mismatch; actual server consequence remains downstream qualification.**

**Correction:** retain a bounded queue of original attempt IDs plus paths/full tuple and resend invalidations under those IDs; use separate identities for genuinely result-only discoveries.

### W4 — High: hard bounds still fail under concurrency and oversized metadata

**Evidence:** producer `:401-427,465-497,603-639,780-815,856-906,974-1058`.

- Admission checks sets before awaiting HTTP, without reserving slots. With 499 tracked paths, two concurrent distinct first touches both admit and later produce 501. Same-path requests are not shared. Known/unproven sets can overlap when concurrent/conflicting responses disagree.
- `MAX_PENDING_CALLS` bounds descriptor count, not active requests; evicted descriptors leave requests running. Whole candidate arrays are retained before the 500-path admission check, without path-count or byte bounds.
- `chunkCapturePaths` measures UTF-8 now, but an oversized singleton is still emitted unchanged. Identifier strings and individual path bytes are not bounded. `res.json()` buffers an unbounded response.
- Root/lineage admission still evicts oldest entries without checking activity; the regression explicitly endorses active-root eviction rather than the plan's inactive-only eviction/refusal.

**Impact:** memory/HTTP growth, rejected oversized requests and silent tracking loss. **Confidence: high.**

**Correction:** synchronously reserve against one bounded path state table shared by factories; share in-flight same-path capture; bound request concurrency, path/identifier bytes, response bytes and retained descriptors before allocation. Reject oversized singletons. Refuse new roots when only active entries remain.

### W5 — High/Medium: awaited result delivery has no total deadline; pre-call timeout still has a floor

**Evidence:** producer `:833-860,1050-1058,1092-1098`; installed OMP `src/extensibility/extensions/wrapper.ts:520-536`.

Result-only discoveries await every chunk with a fresh 1000 ms timeout. OMP awaits the tool_result handler, so N delayed chunks can hold tool completion for approximately N seconds. There is no single total budget or bounded delivery worker. Unproven flushes can overlap across calls and duplicate immediate invalidations.

The pre-call loop also still uses `Math.max(10, remaining)`: a chunk with less than 10 ms remaining receives a longer timeout than the remaining deadline. Synchronous path parsing/chunk serialization is unbounded by input size, and chunking repeatedly serializes/copies growing arrays.

**Impact:** multi-file tools can stall far beyond the stated total capture budget; unnecessary CPU/network work. **Confidence: high.**

**Correction:** release tool_result without an unbounded per-chunk wait; deliver retained unknown metadata through a bounded, tuple-fenced worker or one absolute budget. Never increase remaining pre-call time. Use incremental UTF-8 accounting and bound input-derived metadata before chunking.

### W6 — Medium: response validation is still partial

**Evidence:** producer `:700-715,868-901,1058-1062,1094-1102`.

Capture envelope version/ID/path membership checks improved. However, any object with an allowed string path is acknowledged even with missing/invalid status; it enters unproven state but removes the pending invalidation. Conflicting duplicate results are not rejected. Result-only/flush requests clear pending work on HTTP success without validating a correlated acknowledgment. Register decoding still accepts truthy non-string epoch/incarnation/baseline fields, arbitrary rootId and unbounded strings.

**Impact:** malformed responses can suppress required invalidation or poison ownership metadata. **Confidence: high.**

**Correction:** decode bounded registration/capture DTOs before mutation. Require exact root/session, string types/lengths, permitted dispositions and consistent duplicates. Invalid/missing acknowledgments must preserve same-attempt unproven work.

### W7 — Medium: path normalization still captures different valid POSIX filenames

**Evidence:** producer `:214-241,280-286,324-343`; tests `server/tests/omp-session-changes.test.ts:78-120`.

Whitespace trimming and unconditional backslash conversion remain. On POSIX, `name\\part.ts` and a filename containing leading/trailing spaces are distinct literal filenames, not the transformed target. The drive-letter fix addresses the tested Windows case but not platform-correct normalization. Selector filtering still omits supported forms such as `.jar:member` and `.tar.xz:member`.

**Impact:** baseline capture can refer to a different file than the tool mutates. **Confidence: high.**

**Correction:** preserve literal POSIX filename bytes, apply Windows separators/drive semantics only for Windows paths, and reject the actual supported selector grammar. Add vectors for literal backslashes/spaces and omitted archive forms.

### W8 — Medium: settled metadata still lacks originating-turn identity

**Evidence:** producer `:1114-1166,1229-1273`; installed OMP `src/extensibility/shared-events.ts:198-228`.

Unknown outcomes now correctly default to unknown. But real `AgentEndEvent` has no `turnId`; production therefore generates a fresh UUID for every settle, without agent/turn-start ownership or duplicate suppression. It resolves the current root at agent_end rather than an originating turn, so a late turn end can settle a newly selected session. Factory-level 503 stickiness is improved; immediate fire-and-forget invalidation can still set only that producer's permanent-disable flag without disabling the shared root used by rebound factories.

**Impact:** stale/duplicate settled records and incomplete shared OFF fencing. **Confidence: high.**

**Correction:** bind bounded turn identity/owner at the real start lifecycle; deduplicate terminal settles and discard stale origins. Propagate disabled state to the exact shared registration for every transport route.

### W9 — High acceptance gap: real HTTP smoke is useful, but required producer qualification remains absent

**Evidence:** tests `:165-192,224-300,307-538,544-577`; Phase 03 `:25-36,48-64`.

- HTTP tests invoke `SessionChangesProducer` directly, not real extension handlers with actual pre-tool filesystem mutation ordering.
- No executed rebound root/sub/nested factory lifecycle, independent-root duplicate-call-ID race, child-first lineage, concurrent 499→501 admission or same-path-sharing regression.
- No current tests for malformed/version/capture-ID response matrix, failed invalidation followed by same-attempt retry, unproven flush behavior, result-only AST delivery, OFF→ON stickiness, intermediate settled turns, CUT/register-only edits or single/per-file rename reconciliation.
- The UTF-8 test uses ASCII paths and allows an extra 100 bytes. The 500-path test preloads only known paths and makes one rejected call; it is not HTTP or concurrency coverage.
- The 50 ms deadline test allows elapsed <180 ms and does not cover a multi-chunk total deadline or late publication after tool mutation.
- The dual-extension test only counts installed handlers; it does not run session lifecycle, count WebSockets, exercise notifications or toggle OFF.
- Tester evidence explicitly predates the edit changing the switch test to call handleSessionSwitch. The current test is not established by that run.

**Impact:** both Phase 03 tasks remain short of named acceptance despite selected suites passing. **Confidence: high.**

**Correction:** add public-handler controlled-peer regressions for these producer-owned behaviors and collect a fresh coherent-snapshot run. Live Rust/OMP/server integration remains downstream and is not required to reproduce these producer defects.

## Suggestions — security, performance, architecture, YAGNI/KISS/DRY

1. Preserve the standalone split and deletion of old Agent Status capture/barrier code. Do not introduce another installed runtime dependency just to split this bundled asset.
2. Prefer one small explicit tuple-owned path/attempt state machine over overlapping sets and instance-local lifecycle flags. These states implement required correctness, not optional abstraction.
3. Delete new-asset compatibility/dead surfaces (`normalizeRelativePath`, unused producer version/outcome mapper) if not needed by real production callers; do not retain exports solely for self-tests.
4. Replace repeated growing-chunk serialization with incremental byte accounting; deduplicate result path/sourcePath/move entries before counting/sending.
5. Keep diagnostics bounded/redacted: logger calls currently receive arbitrary caught errors (`:925,1070,1168`). Do not log tool payloads, full paths or transport exceptions verbatim.
6. Fix existing status-test environment cleanup (`omp-agent-status.test.ts:415-480`) with actual per-test cleanup; the suite-declaration Object.assign does not restore deleted/new keys after tests.
7. Bun bundling is not TypeScript typechecking. Use the appropriate scoped configuration rather than the nonexistent root tsconfig; do not infer type coverage from bundle success.

## Reviewed files

Primary:
- `server/src/agent_status/assets/omp-session-changes.ts` — complete 1,280-line producer.
- `server/tests/omp-session-changes.test.ts` — complete 577-line current suite.
- `server/src/agent_status/assets/omp-agent-status.ts` — extraction diff and semantic settle/factory lifecycle sections.
- `server/tests/omp-agent-status.test.ts` — extraction diff, validation/harness and factory/environment sections.

Supporting:
- `plans/261031-0949-lightweight-session-changes-refactor/{plan.md,phase-02-lightweight-per-file-engine.md,phase-03-omp-tool-event-extension.md}`.
- Cycle 2 review and Cycle 3 tester reports.
- `README.md`, `docs/{project-overview-pdr.md,code-standards.md}`; published AGENTS/development rules/primary workflow/code-review skill and verification reference.
- Installed OMP `src/edit/schemas.ts`, selected `edit/index.ts` result fields, `tools/ast-edit.ts` result fields, `extensibility/extensions/{types.ts,wrapper.ts}`, `extensibility/shared-events.ts`.

Approximately 2,200 primary source/test/diff lines plus supporting contracts inspected. No plan/task tracking updated under assignment's no-tracking constraint.

## Validation commands / results

**Reviewer executed:** static reads/searches; `git diff --stat && git status --short`; scoped Agent Status extraction diff; `bash -c 'date +%y%m%d'`. No builds/tests/linters/typechecks rerun; testing owner owns that lane.

**Supplied by EvcTesterCycle3**, corroborated with its report `plans/reports/tester-261031-1535-phase-03-omp-tool-event-extension-cycle-3.md`; not independently reproduced:

| Command | Supplied result |
|---|---|
| `bun test server/tests/omp-agent-status.test.ts server/tests/omp-session-changes.test.ts` | PASS: 36 tests, 0 failures, 183 assertions, 311 ms; status 17 / producer 19 |
| `bun build --target bun server/src/agent_status/assets/omp-agent-status.ts server/src/agent_status/assets/omp-session-changes.ts --outdir /tmp/omp-build-check` | PASS: 3 ms; 16,899 B status / 28,447 B producer |
| `cargo check --manifest-path server/Cargo.toml` | PASS: 0.19 s; no errors/warnings reported |
| `cargo test --manifest-path server/Cargo.toml --test 'agent_status*'` | PASS: 32 tests across 3 suites; 0.07 s |
| `cargo test --manifest-path server/Cargo.toml --test 'session_changes*'` | PASS: 7 tests across 5 suites; 0.02 s |
| `pnpm --filter @dam-hopper/ui test session-changes` | PASS: 20 tests across 4 files; 785 ms |
| `bun x tsc --noEmit --project tsconfig.json` | BLOCKED: TS5058, missing root tsconfig.json |

The supplied Bun run is not evidence for the subsequently edited switch regression. Existing Rust/UI regressions do not qualify the new producer wire protocol. Type coverage, test coverage percentage and lint issue counts: not measured.

## Unresolved questions

- Correct scoped TypeScript-check configuration for these standalone assets remains unresolved; the tester's root-config invocation cannot typecheck them.
- No fresh execution evidence covers the current switch-test edit or the missing producer behaviors above. No additional qualification artifact was supplied.
