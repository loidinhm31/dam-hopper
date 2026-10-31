# Code Review — Phase 03 OMP tool-event extension, Cycle 2

## Verdict

**Score: 5/10 — changes required; Phase 03 acceptance incomplete.** URL safety, exception containment, child-cwd rebasing and rename-field reconciliation improved. Core first-touch provenance, real session-switch fencing and hard bounds remain incorrect. Green selected tests do not establish the named timing/race/loopback acceptance criteria.

Review only: no source/test/plan/task-state changes; no build/test/lint commands rerun. Findings are static source analysis, not claimed runtime reproductions. Plan state intentionally unchanged under assignment's no-tracking constraint.

## Critical issues

None confirmed at Critical severity. No demonstrated remote execution, secret exfiltration or destructive filesystem operation. High warnings below block acceptance: they can publish misleading originals or attribute work to the wrong session.

## Warnings

### W1 — High: live tokens do not fence actual session switches or registry ownership

**Evidence:** `server/src/agent_status/assets/omp-session-changes.ts:443-456,495-525,633-690,741-759,902-919,1098-1123`.

- Tokens are keyed by session ID. Starting B does not advance A's token or retire A. If A registration is delayed, B registers, then A returns, both tokens still match and A resets the main-agent mapping to A. The actual `session_switch` handler only registers the new ID.
- Registry keys remain bare OMP session IDs, not collector/epoch/incarnation scope. Missing-agent and unresolved-main sole-root fallbacks remain; a `sub` without `parentId` is still registered as an independent root.
- Pending calls are keyed only by `toolCallId`; stored `agentId` and `baselineId` are not checked. Calls with no concrete candidates return before recording an origin. AST glob-only results, evicted pending calls and late results after shutdown therefore use current ambient root resolution.
- Capture responses publish after `await` with no live-registration check. Shutdown does not abort pending HTTP work; tokens/pending calls are producer-instance-local while root ownership is module-global.

**Impact:** cross-session attribution and stale routing/revival remain possible. **Confidence: high.**

**Correction:** own a factory/root generation that advances on every switch/shutdown; retire previous agent bindings before awaiting registration. Publish only against the captured live collector/tuple/generation. Record supported calls even when candidate paths are empty; key and validate origin by agent/call/tuple, including baseline identity. Do not replace missing origin with an ambient root. Reject unprovable child lineage.

### W2 — High: unknown paths are retried as pre-edit reads after execution

**Evidence:** producer `:425-427,762-798,834-874,970-992`; frozen contract `phase-02-lightweight-per-file-engine.md:15-17`.

`pendingUnprovenFlush` stores only path strings. Its consumer appends those paths to a new `mode: "preEdit"` request with a fresh capture ID. Unknown/unproven dispositions do not enter `knownPaths`, so subsequent edits also retry them as preEdit. The original timed-out attempt ID is lost after the immediate best-effort invalidation.

Concrete failure sequence: capture A and its invalidation both fail to reach the peer; the tool mutates A; a later capture for B includes A as preEdit. The server can now adopt A's post-edit bytes as its original. This violates the central first-touch guarantee. A syntactically valid response that omits A only queues it; it does not immediately invalidate the possibly completed attempt. Result-only unknown paths are never added to the flush queue, and failed result notifications are discarded. Successful `/settled` contact does not flush anything.

**Impact:** fabricated historical originals, lost unknown rows and unsafe late acknowledgments. **Confidence: high.**

**Correction:** retain bounded `(attemptId, paths)` unproven notifications; send them only with `mode: "unproven"` under the original live tuple. Never re-read any attempted/unknown/result-only path after its tool may have run. Treat all terminal path dispositions as tracked, distinguish acknowledgment from provenance, and preserve failed result-only notifications. Flush on subsequent valid contact without adding another awaited pre-tool deadline.

### W3 — High: metadata, HTTP work and request/response bodies remain insufficiently bounded

**Evidence:** producer `:291-340,354-410,448-480,569-571,603-614,743-770,834-850,923-989,1052-1063`; Phase 03 `:66-70`.

- Once 500 known paths are reached, overflow still inserts every extra path into `unprovenPaths`. Unknown/result-only paths do not count toward admission, so those sets can grow across calls without reaching the known-path cap. Candidate arrays retained by pending calls have no path-count/length bound. `sessionLiveTokens` is never pruned.
- `MAX_PENDING_CALLS` evicts descriptors, not active requests. There is no HTTP admission bound or same-path in-flight sharing; `inFlightCaptures` is unused. Rebound producers multiply instance-local work.
- `chunkCapturePaths` measures UTF-16 string length, not UTF-8 bytes, accepts an oversized singleton unchanged, and repeatedly copies/serializes a growing chunk. Result-only `/capture` requests bypass chunking entirely. Unicode filenames can exceed the server's 16 KiB limit despite a nominal 12 KiB chunk.
- `res.json()` buffers an unbounded response. Register response strings have no bounds either.
- Root admission still evicts the oldest root without checking activity; lineage admission can evict active ownership mappings.

**Impact:** memory/request growth, missed active tracking and server-rejected captures. **Confidence: high.**

**Correction:** admit against one bounded tuple-scoped path table covering all dispositions; bound identifiers/path bytes and pending metadata before retention. Refuse active-root eviction and expose incomplete coverage on saturation. Bound actual request concurrency and share same-path work. Compute actual UTF-8 payload size, reject oversized singletons, chunk both modes and cap response bytes before JSON decoding.

### W4 — High: response decoding is still not identity/capture-correlated

**Evidence:** producer `:611-618,675-689,834-858`; tests `server/tests/omp-session-changes.test.ts:422-465,484-495`.

Registration directly trusts arbitrary JSON: it does not check requested session/root identity, required tuple fields or string types/bounds. Capture decoding only requires an object with a results array. It ignores `version` and `captureId`, accepts result paths not requested by the chunk, and treats any object containing a string path as acknowledged even if status is missing/invalid. Such an item removes its pending flush. An unrelated result marked captured can insert an arbitrary path into `knownPaths`.

The new outer try/catch correctly contains the tested `[null, "invalid"]` response, but this is not strict acknowledgment validation.

**Impact:** false capture suppression, lost invalidation and registry pollution on malformed/wrong-attempt responses. **Confidence: high.**

**Correction:** decode bounded registration and capture responses before any mutation; require exact requested identity/version/captureId, a permitted disposition and membership in the requested path set. Missing, malformed, duplicate-conflicting or unrelated acknowledgments cannot establish original evidence; preserve and invalidate the affected attempt conservatively.

### W5 — Medium: the 1500 ms total deadline is not strict, and exhausted chunks are dropped

**Evidence:** producer `:727-788,800-827`; Phase 03 `:25,53-54`.

The deadline starts after path parsing/filtering. A chunk with only 1–99 ms left receives a minimum 100 ms timeout (`Math.max(100, ...)`), exceeding the remaining budget. When elapsed time is exhausted, the loop marks only the current chunk unproven then breaks; all later chunks are forgotten. Chunk building/serialization also occurs after the timer start without a cancellable budget check.

**Impact:** tool latency can exceed the stated bound; multi-chunk calls lose unknown evidence for untouched capture chunks. **Confidence: high.**

**Correction:** establish one absolute hook-entry deadline; never increase remaining time. At exhaustion, queue bounded unproven evidence for all remaining candidates, not only the first skipped chunk. Keep total release time and tolerance explicit in a real delayed-peer regression.

### W6 — Medium: rebasing still changes valid local filenames and mishandles drive-absolute paths

**Evidence:** producer `:206-239,254-274`; tests `:77-109`.

Backslashes are unconditionally separators and surrounding whitespace is trimmed. On POSIX, `dir\\name.ts` is a literal filename, not `dir/name.ts`; write targets with meaningful leading/trailing spaces are also changed. On Windows, `C:\\repo\\x.ts` becomes `C:/repo/x.ts` but fails the slash-only absolute test and is appended to child cwd. Selector rejection covers only a small extension list, omitting supported archive forms such as `.jar:member`, `.7z:member`, `.tar.xz:member`.

**Impact:** the producer can capture a different root-relative file than the tool changes, despite improved ordinary child-cwd containment. **Confidence: high for deterministic path transformation; platform runtime qualification remains unmeasured.**

**Correction:** follow emitting platform path semantics, preserve legitimate filename bytes, resolve absolute drive/UNC forms correctly where supported, and reject the actual non-filesystem selector grammar. Add POSIX literal-backslash/space and Windows absolute-path vectors rather than asserting a universal slash-normalization policy.

### W7 — Medium: settled identity and sticky OFF remain incomplete

**Evidence:** producer `:633-690,1001-1045,1098-1123`; installed OMP `src/extensibility/shared-events.ts:201-220`.

Aborted/error classification and 503 handling improved, but real `AgentEndEvent` has no `turnId`; without an agent-start/turn lifecycle binding every settle generates a fresh UUID. Settled events resolve the current root rather than an originating turn. Missing/unknown stop reasons still become completed. A subsequent session_start/switch always creates a fresh `disabled: false` registration on HTTP success, so a loaded factory disabled by OFF can revive after ON without the required restart. The fire-and-forget invalidation also ignores 503.

**Impact:** stale or duplicate settled metadata, false outcome specificity and OFF→ON behavior contrary to the lifecycle contract. **Confidence: high.**

**Correction:** bind bounded turn identity and origin at agent/turn start; deduplicate settles and classify absent evidence as unknown. Keep disabled state sticky for the loaded factory/registration until restart; centralize disabled handling for all producer requests.

### W8 — High qualification gap: required smoke/race/timing coverage is still absent

**Evidence:** test suite `:155-183,319-360,363-420,467-541,603-653,709-742`; Phase 03 `:27,35-36,61-64`.

- The switch test directly writes `producer.sessionLiveTokens.set("session-old", 999)` instead of invoking the actual switch handler. It cannot detect W1's A→B race.
- The timeout test throws AbortError immediately; no delayed peer, elapsed deadline, late acknowledgment or tool filesystem mutation is exercised. Its successful flush fixture accepts preEdit rereads and asserts only queue removal, concealing W2.
- The dual-extension harness counts registered handlers only. It never invokes session_start, creates/counts WebSockets, verifies notifications or toggles OFF. It is not a one-reporter lifecycle smoke.
- No actual HTTP listener/controlled loopback peer appears in the reviewed suite. No executed rebound root/sub/nested factories, independent-root/duplicate-call-ID races, same-path concurrency, 500/501 admission or multi-chunk total-time test is present. Chunking tests use ASCII string length with tolerance, not UTF-8 wire limits. Existing CUT/register-only, AST result-only and intermediate-settle acceptance also lacks explicit current regressions.

**Impact:** both producer tasks remain short of named acceptance/verification, regardless of selected tests passing. **Confidence: high for inspected suite and supplied smoke descriptions; separate undisclosed evidence unresolved.**

**Correction:** test public extension handlers against a controlled loopback peer with deferred/late responses and real pre-tool mutation ordering. Exercise actual switch/shutdown/OFF/ON flows, root/child factories, saturation and malformed identity/attempt responses. Keep these producer boundary tests distinct from downstream live OMP/server qualification.

## Cycle 1 finding disposition

| Previous finding | Cycle 2 assessment |
|---|---|
| W1 generation/origin | Not resolved; token plumbing exists but actual switches do not fence old ownership |
| W2 path ownership | Partially resolved; ordinary child-cwd/outside-root paths fixed; platform/selector cases remain |
| W3 bounds | Not resolved; constants/chunk helper do not enforce complete retained/wire/request bounds |
| W4 unknown evidence | Unsafe implementation; retry queue rereads unknown paths as preEdit |
| W5 fail-open/validation | Exception containment improved; identity/attempt validation still missing |
| W6 URL safety | Resolved by static inspection: IPv6, credentials/query/hash rejection, redirect error |
| W7 settled/OFF | Partially resolved; abort/error and endpoint 503 handling improved, turn/OFF lifecycle incomplete |
| W8 rename fields | Fields now reconciled for both shapes; deduplicate paths before admission/sending |
| W9 qualification | Not resolved; expanded labels/fixtures do not establish requested boundary behavior |

## Suggestions — security, performance, architecture, YAGNI/KISS/DRY

1. Preserve the good standalone split: no Agent Status imports, competing WebSocket, filesystem scanning, script inspection or raw baseline retention.
2. Prefer one explicit bounded root/tuple state machine and a small bounded attempt queue over partially overlapping `knownPaths`/`unprovenPaths`/flush sets. Required ownership/provenance states are not optional abstractions.
3. Delete dead scaffolding: unused `inFlightCaptures`, `PRODUCER_VERSION`, production-unused outcome mapper and backward-compatible normalization alias. If sharing capture work is implemented, use the existing field rather than adding another cache. Avoid compatibility aliases for a new clean-cutover asset.
4. Use a Set for reconciled path/sourcePath/move results before counting/sending; the current rename example can send target twice. Replace repeated growing-array serialization in chunking with incremental byte accounting plus a final bounded serialization.
5. Factor small test root/peer fixtures; assert observable requests and mutation ordering instead of directly changing production tokens. Restore all environment mutations with scoped cleanup: Agent Status's `Object.assign(process.env, originalEnv)` at test line 480 runs during suite declaration and does not remove newly added keys after tests.
6. Keep logger errors bounded/redacted; do not pass arbitrary transport/tool exceptions to logging. Bun bundling is not TypeScript typechecking; add a scoped typecheck gate rather than claiming type safety from build output.

## Reviewed files

Primary:
- `server/src/agent_status/assets/omp-session-changes.ts` — full 1,149-line implementation.
- `server/tests/omp-session-changes.test.ts` — full 742-line current suite.
- `server/src/agent_status/assets/omp-agent-status.ts` — extraction diff; semantic settle and factory sections.
- `server/tests/omp-agent-status.test.ts` — extraction diff; status lifecycle and factory/env sections.

Supporting:
- `plans/261031-0949-lightweight-session-changes-refactor/{plan.md,phase-02-lightweight-per-file-engine.md,phase-03-omp-tool-event-extension.md}`.
- Prior review and tester reports: `plans/reports/{code-review-261031-1318,tester-261031-1315}-phase-03-omp-tool-event-extension.md`.
- `README.md`, `docs/{project-overview-pdr.md,code-standards.md}`; published development rules/primary workflow/code-review skill.
- Installed OMP `src/edit/{schemas.ts,index.ts}`, `src/tools/ast-edit.ts`, `src/extensibility/extensions/{types.ts,wrapper.ts}`, `src/extensibility/shared-events.ts` — selected current contract sections.

Approximately 2,100 implementation/test lines plus supporting contracts/diffs inspected. No plan/task tracking updated by this review.

## Validation commands / results

**Executed by reviewer:** static reads/searches, `git diff --stat && git status --short`, and scoped `git diff -- server/src/agent_status/assets/omp-agent-status.ts server/tests/omp-agent-status.test.ts`. New untracked files read directly. No runtime reproduction, build, test, lint or typecheck performed by reviewer.

**Fresh results supplied by testing owner `EvcTesterCycle1`, not rerun or independently reproduced:**

| Command | Supplied result |
|---|---|
| `bun test server/tests/omp-agent-status.test.ts server/tests/omp-session-changes.test.ts` | PASS; 39 pass, 0 fail, 184 assertions; 255 ms; 17 status + 22 producer tests |
| `env -u OMPCODE bun test server/tests/omp-session-changes.test.ts` | PASS; 22 pass, 98 assertions; 63 ms |
| `bun build --target bun server/src/agent_status/assets/omp-agent-status.ts server/src/agent_status/assets/omp-session-changes.ts --outdir /tmp/omp-build-check` | PASS; 4 ms; status 16,899 B, producer 25,217 B |
| `cargo check --manifest-path server/Cargo.toml` | PASS; exit 0; 0.19 s |
| `cargo test --manifest-path server/Cargo.toml --test 'session_changes_*'` | Supplied PASS; 7 tests across 5 suites; 0.02 s |
| `cargo test --manifest-path server/Cargo.toml --test 'agent_status_*'` | Supplied PASS; 32 tests across 3 suites; 0.06 s |

The tester's supplied “loopback/factory smoke” evidence describes URL validation and handler counts, not an actual controlled HTTP peer or executed reporting lifecycle. Tester also described an earlier OMPCODE-dependent standalone failure; current inspected test lines 711-739 explicitly clone/restore env and delete OMPCODE, so that earlier failure is not asserted as a current defect. The on-disk Cycle 1 tester report still records older 43-test/17,566-byte producer results; it is not Cycle 2 evidence.

Type coverage, coverage percentage and lint counts: **not measured**. No live OMP/server journey or controlled-loopback smoke result established. Rust/UI downstream implementation is outside this producer review, not itself a defect here.

## Unresolved questions

- Does an additional actual controlled-loopback factory smoke artifact exist? None appears in the inspected tests or testing owner's supplied evidence. It must establish ordering/deadline/lineage/races, not merely URL validation or handler registration.
