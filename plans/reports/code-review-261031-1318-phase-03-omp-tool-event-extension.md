# Code Review — Phase 03: OMP tool-event extension

## Verdict

**Score: 4/10 — changes required.** Agent Status extraction is clean and the producer has the right event entrypoints, but tuple fencing, path ownership, boundedness and qualification contracts remain incomplete. Passing supplied unit/build checks do not establish Phase 03 acceptance.

Review only: no product/test/plan/task-state edits; no verification commands rerun. Findings below are static source analysis, not claimed runtime reproductions.

## Critical issues

No confirmed Critical-severity security exploit or destructive operation. The High-severity warnings below block acceptance because they can attribute edits to the wrong session/file, lose unknown evidence, or violate fail-open behavior.

## Warnings

### W1 — High: registration and tool results are not generation/origin fenced

**Evidence:** `server/src/agent_status/assets/omp-session-changes.ts:346-419,513-560,686-695,823-872`; `toolCallId` is declared at lines 56/63 but discarded by handlers at 851-860.

`session_switch` simply awaits another registration. It does not retire the previous root, advance a generation or cancel earlier requests. Every successful registration publishes after its await without checking whether it is still current. A delayed registration for A can therefore overwrite the main-agent mapping after B registered or repopulate a root after shutdown. A tool started in A but reporting its result after switching to B resolves the agent's *current* root and records result-only paths in B. The module registry is keyed only by sanitized OMP session ID, not collector/epoch/incarnation scope. Sole-root fallbacks also adopt unresolved main/missing identities; a subagent without `parentId` is registered as a root.

**Impact:** cross-session attribution and stale revival; violates the explicit no-ambient-adoption and switch/restart fencing requirements. **Confidence: high.**

**Correction:** capture a factory/root generation before registration; publish only if still live. Retire/cancel on switch/shutdown. Key registry ownership by collector and active tuple; bind bounded pending `(tuple, agentId, toolCallId)` metadata at tool_call and use that binding at tool_result, never current ambient resolution. Unprovable child/root identities stay untracked.

### W2 — High: normalization captures the wrong file for child cwd and outside absolute paths

**Evidence:** producer lines 182-232,590-603,697-729; Phase 03 lines 50-52.

Absolute paths not beneath cwd have their leading slash removed instead of being rejected. For cwd `/repo`, `/etc/config` becomes root-relative `etc/config`, potentially capturing `/repo/etc/config` while the tool edits `/etc/config`. With root cwd `/repo` and child cwd `/repo/pkg`, both `x.ts` and `/repo/pkg/x.ts` become `x.ts`, not `pkg/x.ts`; valid `../shared.ts` is rejected even when still inside `/repo`. Archive/database selectors such as `bundle.zip:member.ts` and `state.db:table` also pass as apparent ordinary local filenames. Backslashes are unconditionally reinterpreted even on POSIX.

**Impact:** misleading originals for unrelated paths; missed real edits. Server containment cannot recover intended ownership after the producer sends an already-wrong relative path. **Confidence: high.**

**Correction:** lexically resolve the target against the emitting cwd, then relativize against the registered root cwd; reject targets outside that root and unsupported URL/archive/database forms. Preserve platform semantics; keep filesystem authorization on the server. Add differing-root/child-cwd, outside-absolute, root `/`, and non-file-selector vectors.

### W3 — High: advertised caps are not enforced, and capture bodies violate the frozen wire contract

**Evidence:** producer lines 245-288,307-327,346-367,468-497,607-618,697-756; Phase 02 lines 15-17; Phase 03 lines 66-70.

The 501st and later paths are added to both sets in the overflow branch, so `MAX_PATHS_PER_ROOT` does not bound metadata. Result-only discovery bypasses the cap entirely. `agentLineage`/`agentToRoot` and concurrent HTTP work have no admission bound; unresolved lineage survives root cleanup. Root eviction removes the oldest entry without checking inactivity. All candidate paths are sent in one JSON body: hundreds of normal-length paths readily exceed the server's fixed 16 KiB request limit. Response bodies are consumed by unbounded `res.json()`; request/path lengths are not bounded either.

**Impact:** session-lifetime memory/request growth, avoidable allocation, lost active tracking and rejected multi-file captures. **Confidence: high.**

**Correction:** enforce admission before inserting/allocating; bound child and pending-request metadata, retire child entries, stop tracking with explicit incomplete coverage when saturated, and evict only inactive records. Byte-bound request/response JSON and chunk capture bodies below 16 KiB under one absolute tool deadline. Share in-flight same-path capture work rather than sending duplicate requests.

### W4 — High: failed unknown notifications are never flushed; future calls silently skip those paths

**Evidence:** producer lines 607-610,660-678,738-756; `unprovenPaths` has writes but no flush/acknowledgment consumer anywhere in the asset.

A failed capture inserts the path into `knownPaths`, then attempts one fire-and-forget invalidation. If that request also fails, later edits skip the path permanently; later successful contact never publishes the local unknown metadata. The same loss occurs for result-only discoveries. This is especially important when the server completed a pre-edit attempt but its acknowledgment was lost: best-effort invalidation alone does not establish the required conservative sealing.

**Impact:** missed unknown rows/incomplete coverage and potentially undowngraded unacknowledged captures. **Confidence: high.**

**Correction:** retain bounded pending unproven notifications, including the original captureId for timeout invalidation, and flush on later valid contact within the same live tuple. Never retry a preEdit read after execution. Fence/clear that queue on tuple retirement; do not add another awaited network deadline before releasing the tool.

### W5 — High: successful HTTP status is mistaken for a validated capture acknowledgment; malformed results can escape fail-open

**Evidence:** producer lines 497-498,546-559,648-659,851-855; OMP wrapper `/home/loidinh/WS/oh-my-pi/packages/coding-agent/src/extensibility/extensions/wrapper.ts:294-328` propagates pre-tool handler exceptions and blocks execution.

A 200 `{}` marks every requested path known without validating captureId/version/dispositions. Registration similarly casts arbitrary JSON to a tuple. A 200 payload with `results: [null]` reaches `item.status` outside `postJson`'s catch and rejects the awaited tool_call handler. Thus transport/collector payload errors can block the user's tool rather than fail open.

**Impact:** false acknowledgment, permanent capture suppression or blocked tool execution. **Confidence: high.**

**Correction:** decode bounded registration/capture responses and validate identity/attempt correlation. Missing or malformed path acknowledgments become unproven. Put a fail-open containment boundary around the complete capture hook, not just fetch/JSON parsing. Test malformed success payloads and unchanged tool input/result behavior.

### W6 — Medium: safe URL validation was weakened rather than preserved

**Evidence:** producer lines 133-151,473-487; existing Agent Status validator `omp-agent-status.ts:125-149`.

The producer accepts credentials, arbitrary path/query/fragment and rejects valid IPv6 loopback URLs supported by Agent Status. Appending `/capture` to a derived URL with a query/fragment puts the suffix into that component rather than the endpoint pathname. Fetch also follows redirects by default, so an initially loopback URL is not an enforced loopback-only request destination; a 307/308 can forward the metadata body off-loopback. Cross-origin bearer leakage is not asserted here.

**Impact:** inconsistent installation behavior, silent collection failures and loss of the local-only transport boundary. **Confidence: high.**

**Correction:** preserve the existing strict URL rules, including IPv6 loopback; reject credentials/search/hash, construct endpoint pathnames explicitly, and use `redirect: "error"`. Keep this asset standalone rather than importing another installed extension.

### W7 — Medium: settled events do not preserve turn outcome or sticky OFF state

**Evidence:** producer lines 164-171,762-785,823-848.

Every settled event emits a fresh random turn ID and `outcome: "completed"`, ignoring assistant stopReason/error/interruption and the declared mapping helper. Duplicates are not correlated with an originating turn; late ends resolve the current registration. A 503 from settled or result-only capture is ignored. A later session_start/switch can replace an already-disabled registration with an enabled one, although OFF→ON requires session restart.

**Impact:** inaccurate outcome metadata/deduplication and producer work continuing or reviving after OFF. **Confidence: high.**

**Correction:** retain bounded turn identity/outcome metadata, classify actual assistant stop reasons conservatively, fence origin as in W1, and centralize handling of trackingDisabled for all endpoints. Keep OFF sticky for the loaded registration/factory until restart.

### W8 — Medium: edit result reconciliation omits actual source/destination fields

**Evidence:** producer lines 714-733; installed OMP `/home/loidinh/WS/oh-my-pi/packages/coding-agent/src/edit/index.ts:232-267` emits `path`, `move`, `sourcePath` for single-file and per-file results.

The producer inspects only `path`. Result-only rename source/destination discoveries are not fully reconciled even though the plan explicitly calls for both. The tested Hashline header/parser input field does match current `edit/schemas.ts:39-41`, but result fixtures do not cover the real rename shape.

**Impact:** incomplete unknown provenance for result-only/missed rename targets. **Confidence: high.**

**Correction:** normalize/deduplicate bounded `path`, `sourcePath`, and `move` candidates for both result shapes; publish only unproven for newly discovered paths, never result bytes.

### W9 — High qualification gap: required Phase 03 boundary/race evidence is absent from the reviewed suite/report

**Evidence:** `server/tests/omp-session-changes.test.ts:181-302,466-510,686-728`; tester report lines 14-40,59-61; Phase 03 lines 27,35-36,61-64.

The timeout test immediately throws AbortError: it never waits 1500 ms, observes a deadline, or mutates a file after the hook. Factory tests only inspect registered handler names; they do not execute rebound root/sub/nested factories together. No controlled HTTP peer, late responses, switch/OFF/restart races, duplicate tool IDs across agents, same-path concurrency, path/body caps, or both-extensions-one-reporter test exists in the reviewed test file. The tester report lists no actual loopback boundary smoke command/results. Its broad coverage description therefore exceeds what these tests establish.

**Impact:** both Phase 03 tasks lack named acceptance/verification evidence despite 43 green tests. **Confidence: high about inspected tests/report; separate undisclosed smoke evidence remains unresolved.**

**Correction:** add the planned controlled-loopback factory smoke and meaningful race/bounds regressions after fixing W1-W8. Measure actual pre-tool ordering and one total 1.5 s budget with stated tolerance; do not relabel unit mocks as live OMP/server qualification.

## Suggestions — YAGNI / KISS / DRY

- Keep the successful architecture split: no imports from Agent Status, no competing WebSocket, no filesystem scanning or bash/eval inspection.
- Prefer a small tuple-scoped record plus bounded pending-call/unproven maps over a generic transport/state framework. These states are required correctness, not optional abstraction.
- Remove unused `PRODUCER_VERSION`, unused logger plumbing and the unused/misleading outcome mapper if not used by the corrected lifecycle. Collapse impossible duplicate `ast_edit` comparisons after underscore normalization. Avoid restyling unrelated Agent Status code.
- Factor test root/peer construction into a small fixture: repeated handwritten registrations obscure missing ownership/bounds fields. Restore environment keys with scoped cleanup; `Object.assign(process.env, originalEnv)` does not remove keys newly introduced by tests.
- Bun bundling is not TypeScript typechecking. Add a deliberately scoped typecheck gate rather than treating a clean bundle or Rust compilation as proof of TS type safety.

## Positive observations

- Agent Status no longer contains Session Changes HTTP/barrier references; semantic reporting/heartbeat/blocker/settle code remains isolated.
- Producer uses awaited pre-tool hooks, returns no input/result replacement, avoids baseline-byte retention/logging and skips unsupported tools.
- Hashline parsing covers all header blocks, CUT/register-only blocks, quoted MV destinations and excludes inserted `+` header-looking text.
- AST glob/result-only discoveries use `unproven`, not post-edit original reads; intermediate `willContinue` ends are ignored.

## Reviewed files and evidence

Primary changed files:
- `server/src/agent_status/assets/omp-session-changes.ts` — complete 874-line asset.
- `server/src/agent_status/assets/omp-agent-status.ts` — scoped diff and relevant validation/settle/factory sections.
- `server/tests/omp-session-changes.test.ts` — complete 728-line suite.
- `server/tests/omp-agent-status.test.ts` — relevant status/regression/factory sections and deletion diff.

Supporting evidence:
- `plans/261031-0949-lightweight-session-changes-refactor/{plan.md,phase-02-lightweight-per-file-engine.md,phase-03-omp-tool-event-extension.md}`.
- `plans/reports/tester-261031-1315-phase-03-omp-tool-event-extension.md`.
- `docs/{project-overview-pdr.md,code-standards.md}`, `README.md`, approved design report.
- Installed OMP `src/edit/{schemas.ts,index.ts}`, `src/tools/ast-edit.ts`, `src/extensibility/tool-event-input.ts`, `src/extensibility/extensions/{types.ts,wrapper.ts}` — selected contract sections.

Approximate scope: 2,100 lines of implementation/tests plus supporting contract sections. Plan/task state intentionally unchanged under the assigned no-tracking ownership constraint. Phase 03 acceptance remains incomplete; downstream Rust endpoints are intentionally out of this producer boundary and are not themselves reported as defects.

## Validation commands / results

**Executed by this reviewer:** read/search of scoped code/contracts and `git diff -- server/src/agent_status/assets/omp-agent-status.ts server/src/agent_status/assets/omp-session-changes.ts server/tests/omp-agent-status.test.ts server/tests/omp-session-changes.test.ts`. New files were reviewed directly; the diff contains only the two tracked-file changes.

**Previously reported evidence, not rerun by this reviewer** (tester report linked above):

| Command | Reported result |
|---|---|
| `bun test server/tests/omp-agent-status.test.ts server/tests/omp-session-changes.test.ts` | Exit 0; 43 pass, 0 fail, 190 assertions; 257 ms |
| `bun build --target bun server/src/agent_status/assets/omp-agent-status.ts server/src/agent_status/assets/omp-session-changes.ts --outdir /tmp/omp-build-check` | Exit 0; 2 entrypoints bundled; 4 ms |
| `cargo check --manifest-path server/Cargo.toml` | Exit 0; 0 warnings/errors; 0.82 s |
| `cargo test --manifest-path server/Cargo.toml --test 'agent_status*'` | Reported 32 pass across 3 suites |
| `cargo test --manifest-path server/Cargo.toml --test 'session_changes*'` | Reported 7 pass across 5 suites |
| `pnpm --filter @dam-hopper/ui test session-changes` | Reported 20 pass across 4 files |

No reviewer runtime reproductions, lint/typecheck, real HTTP boundary smoke or live OMP journey executed. Type coverage and test coverage percentage: not measured. Static warnings are independent of the reported green checks.

## Unresolved questions

- Is there a separate controlled-loopback factory smoke artifact covering real ordering/deadline/late-response/lineage cases? None is identified by the inspected tester report or test suite. Main should supply it or retain this gate as incomplete; this is not a demand for downstream live-server qualification.
