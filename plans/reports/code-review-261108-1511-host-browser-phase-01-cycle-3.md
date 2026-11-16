## Code Review Summary — Phase 01, Cycle 3

**Score: 8/10 for reviewed changes. TERMINAL: scoped hardening substantially addressed; Phase 01 remains blocked. No dependent-phase approval.**

### Scope
- Primary files: `server/src/browser_host/{command_budget,cdp,protocol}.rs`; `server/examples/browser_host_qualification.rs`; `server/tests/browser_host_adapter.rs`; `packages/ui/e2e/os-host-browser/compatibility.spec.ts` — approximately 2,665 lines.
- Supporting inspection: `server/src/browser_host/mod.rs`; selected containment/endpoint sections of `process.rs` and `server/tests/browser_host_process.rs`; TS qualification helper; selected `browser_host_compatibility.rs` sections.
- Requirements/evidence: selected-plan `plan.md`, `phase-01-compatibility-contracts.md`, `architecture-contracts.md`, `reports/engine-qualification.md`; Cycle 2 report; README, PDR, code standards, published development workflow and code-review skill/reference; `agent://Phase01TesterRun2` terminal verification report.
- Focus: Cycle 2 warnings 1, 6, protocol portion of 7, bounded-forwarding/Origin portion of 4. Other warnings checked for disposition only, not reopened as new regressions.
- Source, plans and task state unchanged. Only this report written; integration owner owns plan updates. No scoped TODO/FIXME/HACK/XXX or Rust unimplemented markers found.

### Overall assessment
Reservation ownership now simple and coherent: one private budget, one RAII token moving from serializer to queue to pending map. Presence-preserving parsing separates routing from response validation without adding a second runtime. Frame payload/metadata ownership transfer removes prior avoidable copies. Exact Origin checks apply after bearer authentication to both discovery and upgrade. No new critical/high implementation regression established in this slice. Remaining concerns: timing-sensitive tests, incomplete qualification of already-open relay/session obligations, and outstanding Phase 01 gates.

### Critical issues
- None established in reviewed changes. Existing containment/fixture blockers below remain material; this is not a production-readiness/security sign-off.

### Targeted checks and evidence

| Requirement | Review result / evidence |
|---|---|
| Nonwaiting slot before serialization | `cdp.rs:278-309`: `reserve_slot()?` precedes wire serialization; `command_budget.rs:31-56`: atomic compare/exchange rejects at 64, no waiter queue. |
| Reserve bytes before every append | `cdp.rs:174-194`: checks 64 KiB limit, calls `reservation.grow(data.len())`, then appends. `command_budget.rs:62-99`: checked global growth rejects beyond 2 MiB; failed growth does not mutate ownership. |
| 64 total / 2 MiB / queue 32 | Constants `protocol.rs:15-20`; shared budget created at `cdp.rs:254`, bounded mpsc at `:234`, nonwaiting `try_send` at `:314-330`. Reservations cover serialization, queued commands, active write and response wait—not separate 64-pending plus 32-queued allowances. |
| Release on every exit | `CommandReservation::drop`, `command_budget.rs:107-111`; serialization/queue Full/Closed exits `cdp.rs:302-330`; cancelled/expired dequeue `:401-410`; write failure/close `:414-427`; response-map removal `:533-535`; sweep removal `:481-496`; teardown drains queue/map `:623-630`. Caller cancellation releases on dequeue/sweep, not synchronously at caller abort. |
| Unrouteable framing closes actor | `cdp.rs:504-524,527-531,539-551`: size/UTF-8/JSON/object/routing checks; `:473-477,613-630`: pending and queued owners fail before bounded socket close. Real transport oversize can surface as `Transport` from tungstenite before application `MessageTooLarge`; actor still closes. |
| Routeable bad response fails owner only | Minimal untyped envelope `cdp.rs:102-119`; owner removed and completed at `:533-535`; object-only result/error and typed nested error checks `:635-653`. `send_typed` validates required response fields separately at `:348-355`. |
| Explicit null distinct from absent | `cdp.rs:96-118`: custom deserializer preserves `Some(Value::Null)`; result+null-error, null-result and null-error rejected by `response_outcome`. |
| Strict required screencast fields | `cdp.rs:559-594`: outer string session, params object, integer native session, string data, metadata object and six finite required numbers. Malformed known event closes connection rather than silently stranding native credit. This is structural validation, not JPEG/base64/run-credit qualification. |
| Positive counters / CSS ceilings | `protocol.rs:101-117`: canonical positive ASCII decimal, u64 overflow rejected. `:26-30,149-158`: CSS width <=1920 and height <=1080; offsets retain separate 10,000,000 bound. Below-100% zoom remains explicitly unqualified, not silently accepted via wider geometry. |
| Relay size / deadline / Origin | Example `:177-190`: 4 MiB message/frame caps on both sockets before forwarding; `:195-242`: each explicit forwarding/close write bounded to 5s and failures exit relay; `:129-130,149-150,171-172,270-279`: exact single Origin or absent Origin, always after bearer auth. Sequential best-effort closes can take another 5s per side; no claim of a 5s total teardown. |

**Budget interpretation:** measured bytes are serialized logical payload length, not allocator capacity, caller DTOs, parsed responses, or transport buffers (`cdp.rs:157-166`). Do not present 2 MiB as total Rust heap/RSS proof. Documented single-task read/sweep pause during a <=5s stalled write is accepted scope limitation, not a new finding (`:596-599`).

### Warnings

1. **Medium — fixed sleeps still make two adapter assertions scheduling-sensitive.** `server/tests/browser_host_adapter.rs:305-322,359-372` sleeps 50ms before checking exactly 50 events and 100ms before assuming oversize shutdown completed. [INFERENCE] Slow scheduling/loopback delivery can fail correct code; current successful run does not remove that race. **Correction:** wait for the counter under an overall timeout or use an ordered response barrier; put a command in flight before the oversized frame and await its terminal failure instead of sleeping. Confidence high, static finding; no flaky failure observed.

2. **Medium — forwarding hardening implemented, not fully behaviorally qualified.** `compatibility.spec.ts:155-203` exercises exact/absent/rejected Origins and oversized **client** input; no repeated-Origin case, upstream oversized reply, or stalled write deadline case. Example code has the corresponding caps/deadline checks, so this is evidence coverage, not an established broken bound. **Correction:** add focused opposite-direction oversize and stalled-write cases plus duplicate-Origin rejection. Confidence high. Broader Cycle 2 warning 4 remains below.

### Cycle 2 disposition / existing blockers — not new regressions

| Prior warning | Current disposition |
|---|---|
| **1: command admission** | Addressed in inspected implementation. New tests exercise queue saturation with a deliberately stalled sink, 64 unanswered commands, 2 MiB shared-byte rejection and teardown/cancel/sweep release (`cdp.rs:794-892`; adapter `:249-303,554-614`; budget `:118-139`). |
| **6: malformed response handling** | Addressed for reviewed framing/envelope cases. Tests distinguish immediate owner failure with continued usability from connection-fatal malformed input, including nulls and positional error arrays (`adapter:468-552`). |
| **7: wire/endpoint strictness** | Positive counters and CSS ceilings addressed, with negative fixtures (`adapter:60-90,159-174`). **Endpoint portion remains open:** path still prefix/nonempty/length-only (`process.rs:593-601`); tests accept `/123` and `/abc-123` (`browser_host_process.rs:12-14,153-165`). Not a new regression or source change requested here. |
| **4: qualification relay/session safety** | Size caps, explicit write deadlines, error exits and exact Origin policy addressed. **Still open:** discovery engine/target metadata hardcoded (`example:133-161`); no simultaneous internal actor/Page session plus independent agent-session proof (example state/startup `:28-82`; spec `:118-153` uses one Playwright connection). Existing obligation, not satisfied by remote `21*2` evaluation. |
| **2: parent death / descendants — High** | Open. Checked/race-safe descendant supervision absent: ignored leader-only `PR_SET_PDEATHSIG` (`process.rs:201-210`); Drop/group guard cannot execute after supervisor SIGKILL (`:383-408`). No native Windows implementation (`:213-217`). |
| **3: TS fixture output/group cleanup — High** | Partial progress: raw Cargo stdout now counted as bytes before readline; normal cleanup closes stdin and awaits child exit (`helper:41-52,141-166`). Still 10 MiB Cargo cap, inherited stderr, no continued post-readiness stdout accounting, readiness measured as JS string length; timeout/startup failure signal root only (`:28-49,67-70,98-127`). Awaiting root exit does not prove descendants gone. |
| **5: provisioned engine / flags — Medium** | Open. Automatic engine discovery remains (`process.rs:78-128`); copied background/IPC/hang-monitor overrides remain (`:169-185`); permission/stale-file failures ignored (`:158-161`). |
| **8: evidence/task overstatement — Medium** | Partially corrected: all three phase tasks unchecked (`phase:198-200`); candidate hash recorded (`engine report:16`); new mocks genuinely cover deadlines/queue/byte bounds. Still no retained current raw-output references in inspected engine report; process qualification wording omits parent-death failure; phase first task still says pre-reservation/framing fixes pending. Initial-frame/one-ACK/one-screenshot test is not resize/final-static/old-run/single-per-epoch proof (`browser_host_compatibility.rs:90-168`); stale stronger comments persist at `:133,150,392,450-459`. |

**Other retained gates:** native Windows, native browser zoom/nonzero visual offsets/screencast-pixel mapping, and global relay two-connection admission remain unqualified/unimplemented. Engine report `:64-96` and phase task state keep platform/geometry gate blocked. No reduction of Phase 01 acceptance or downstream gate implied.

### Suggestions / KISS–YAGNI–DRY
- Keep the private reservation module and direct ownership transfer; no additional counter framework or retry layer needed.
- Strengthen budget regression assertions: at slot saturation prove a custom serializer was never invoked; after a successful response prove all 64 slots/bytes become reusable. Current release tests often assert only one slot becomes available, which would not catch a partial slot leak (`cdp.rs:832-844,864-865`). Static RAII reasoning is stronger than those assertions.
- Keep legitimate transport-boundary doubles: stalled sink plus notification tests actual cancellation/admission, not a tautology. Byte test also checks independently admitted payload volume, not only the implementation's peak counter. Routeable-malformed tests require a subsequent successful command. Remote evaluate proves transport execution, not session independence or image mapping.
- Do not replace pending geometry qualification with the DOM-center normalization test: its divide/multiply cancellation is useful input-delivery smoke only, already acknowledged in engine report `:77`.

### Validation commands / results
- **Executed by this reviewer:** static reads/searches, initial `git diff --stat && git status --short`, real report timestamp lookup, scoped unfinished-marker search. No compilation/tests/lint/formatter/smoke rerun; single integration owner retains execution ownership.
- **Assignment-supplied and corroborated by tester terminal report `agent://Phase01TesterRun2:12-46`; not independently executed/raw-log audited here:**

| Command | Reported result |
|---|---|
| `timeout 600 cargo test --manifest-path server/Cargo.toml --lib browser_host` | 7 passed; 1421 filtered |
| `timeout 600 cargo test --manifest-path server/Cargo.toml --test browser_host_adapter -- --nocapture` | 18 passed |
| `timeout 600 cargo test --manifest-path server/Cargo.toml --test browser_host_process` | 12 passed |
| `timeout 600 env DAM_HOPPER_BROWSER_EXECUTABLE=/usr/bin/google-chrome DAM_HOPPER_REQUIRE_BROWSER=1 cargo test --manifest-path server/Cargo.toml --test browser_host_compatibility -- --nocapture` | 2 passed; Chrome 157.0.8103.38 |
| `timeout 600 cargo check --manifest-path server/Cargo.toml --all-targets` | Pass; no browser_host warnings; 12 pre-existing warnings outside reviewed scopes reported |
| `timeout 600 pnpm --filter @dam-hopper/ui test:e2e:typecheck` | Pass |
| `timeout 900 env DAM_HOPPER_BROWSER_EXECUTABLE=/usr/bin/google-chrome DAM_HOPPER_BROWSER_QUALIFY=1 pnpm --filter @dam-hopper/ui exec playwright test e2e/os-host-browser/compatibility.spec.ts` | 6 passed |

- Supplied total: **45 passed / 0 failed / 0 skipped**. Browser/adapter scope results are not full-suite, native-Windows, load, or release qualification.
- Lint totals, type-coverage percentage and test-coverage percentage: not measured.

### Recommended actions
1. Integration owner retain Phase 01/dependents blocked; reconcile stale first-task/evidence wording without checking incomplete acceptance complete.
2. Replace two fixed-sleep adapter assertions; fill missing opposite-direction/deadline/duplicate-Origin qualification cases.
3. Resolve existing containment/helper/session/engine-policy/endpoint/evidence and platform/geometry gates under their existing ownership, then run their targeted proof commands. Passing current tests does not waive them.

### Unresolved questions
- Durable location for current raw verification output and missing session/containment/geometry observations remains unspecified in inspected evidence; candidate hash is now present.
- Native Windows implementation/runner and authoritative native-zoom/nonzero-offset/pixel-mapping evidence remain unavailable prerequisites, not open product-scope choices.
