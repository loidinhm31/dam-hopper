## Code Review Summary

**Score: 6/10. Disposition: Phase 01 remains blocked; do not open dependent phases.**

### Scope
- Selected plan: `plans/261108-0237-host-browser-cdp-streaming/phase-01-compatibility-contracts.md`.
- Reviewed all ten assigned paths: `server/src/browser_host/{process,cdp,protocol,mod}.rs`, `server/tests/browser_host_{adapter,process,compatibility}.rs`, selected-plan `architecture-contracts.md`, `phase-01-compatibility-contracts.md`, `reports/engine-qualification.md`.
- Supporting review: `server/{Cargo.toml,Cargo.lock,src/lib.rs,examples/browser_host_qualification.rs}`, `packages/ui/e2e/{fixtures/browser-host-qualification.ts,os-host-browser/compatibility.spec.ts}`, selected-plan `plan.md`, existing tester report, README/PDR/code standards and installed review/development workflows. Approximately 3,000 implementation/test lines.
- Applied code-review skill directly from installed `SKILL.md`. No source or plan/task-state edits; ownership retained by Main. Only this report created.

### Overall assessment
Good direction: generated schema without full chromiumoxide runtime, immutable target-scoped Bytes framing, bounded stderr chunks, explicit cancellation, no sandbox-disable flag, conservative nonunit-input qualification claims. Remaining implementation contradicts several frozen safety contracts; tests passing does not establish acceptance.

### Critical issues
- None established as a deployed exploitable vulnerability in this review. High-priority contract failures below block qualification.

### Warnings

1. **High — command reservations occur too late; actor-wide memory bound not enforced.** `server/src/browser_host/cdp.rs:194-224,317-360`.
   Every concurrent caller serializes/allocates before awaiting bounded-channel send; arbitrarily many blocked send futures retain JSON outside channel accounting. Pending-command/byte checks occur only after dequeue. `queued_payload_bytes` counts already-sent requests awaiting responses, not the unsent writer queue; `peak_queued_bytes` therefore cannot prove actual queued-memory ceiling. Violates architecture §2 reserve-before-enqueue/max64 total.
   **Correction:** reserve total command slots and byte budget before retaining serialized output; reject admission immediately when full. Bound serialization itself; release reservations on cancellation/response/write failure. Add saturated/stalled-writer tests covering callers outside channel. Confidence: high.

2. **High — parent-death supervision does not contain descendants.** `server/src/browser_host/process.rs:204-210,383-408`; process tests `:61-150`.
   `PR_SET_PDEATHSIG(SIGTERM)` targets only the browser leader, is not inherited by forked children, ignores setup failure, and lacks a parent-death race check. Group-killing Drop guards do not execute after supervisor SIGKILL. Existing tests cover explicit terminate/failed launch, not supervisor death, unrelated PTY survival or root-crash descendants. Linux parent-death acceptance remains unproven, not completed.
   **Correction:** checked, race-safe parent-death supervision that ensures group/descendant teardown independently of normal Rust Drop; retained child inventory plus native supervisor-kill/root-crash/PTY-isolation tests. Confidence: high.

3. **High — qualification helper violates startup/output/cleanup safety contract.** `packages/ui/e2e/fixtures/browser-host-qualification.ts:28-65,85-115,128-147`; architecture `:20`.
   Cargo uses unbounded readline records and inherited stderr. Binary stderr is inherited, stdout is discarded without accounting after readiness (`resolved` returns immediately), and no total 64KiB output caps exist. Timeout/overflow/build timeout kill only root; cleanup resolves after kill without descendant proof/reap, with a 3s forced kill racing the launcher's 3s TERM grace. Can orphan builds/browser descendants and silently exceed fixture output limits.
   **Correction:** incremental byte-capped record parsing, continued bounded output draining, exact executable artifact selection, group/Job ownership and bounded reap on every partial-start/failure/normal path; exercise overflow and startup-failure cases. Confidence: high.

4. **Medium — launcher bypasses explicit-engine/minimal-flag contract.** `server/src/browser_host/process.rs:78-128,152-186`; architecture `:18-19`.
   No provisioned path silently selects PATH/system candidates, allowing an unqualified engine. Built-in flags include explicitly excluded background-throttling overrides (`--disable-backgrounding-occluded-windows`, `--disable-renderer-backgrounding`) and unnecessary protection reductions (`--disable-ipc-flooding-protection`, `--disable-hang-monitor`). Profile chmod and stale port-file removal errors are ignored.
   **Correction:** production launch requires configured executable; remove copied overrides/unneeded flags; fail closed when profile restriction or stale endpoint removal cannot be established. Confidence: high.

5. **Medium — malformed required responses disappear instead of failing owner.** `server/src/browser_host/cdp.rs:447-453,456-470`.
   Example: `{"id":1,"error":{"code":"bad","message":"x"}}` fails whole-envelope deserialization; known operation remains pending until timeout. Current id-only test covers only a successfully parsed envelope. Invalid JSON is similarly ignored, contrary malformed-framing closure requirement.
   **Correction:** parse minimal routing identity separately, reject malformed known response for that operation, close on unrouteable invalid framing; tests for wrong error/result types and invalid JSON. Confidence: high.

6. **Medium — wire validator is looser than frozen contract.** `server/src/browser_host/protocol.rs:95-121,154-156,203-211`; architecture `:9,103`.
   Zero counters are explicitly accepted/tested despite contract `[1-9][0-9]{0,19}`. UUID parsing accepts noncanonical representations. CSS dimensions have no upper viewport bounds, so arbitrarily large finite geometry validates even with `inputTrusted:true`.
   **Correction:** enforce positive counters, canonical UUID form, documented CSS viewport bounds; negative fixtures for each. Any intended contract amendment must migrate all consumers, not silently relax validation. Confidence: high.

7. **Medium — evidence/checklist still overstates completion.** Phase file `:198-200`; engine report `:35,81-96`; compatibility test `:90-168`; adapter tests `:214-240`.
   Process task is checked complete although it requires native Windows proof and parent-death/PTY-isolation proof. Report claims mocked 10s deadline and 32-message/2MiB queue validation, but inspected adapter/unit coverage contains no such deadline/saturated-writer assertions. Compatibility fixture checks one initial frame and one ACK/screenshot, not resize, animation-to-final-static, old-run accounting or separate simultaneous sessions. Missing binary hash/retained raw-evidence references also prevent exact-engine reproducibility.
   **Correction:** Main reopen unsupported task acceptance; keep entire phase blocked; remove unsupported verification claims and enumerate missing Phase 01 cases rather than shifting them solely to Phase 05. Retain exact binary hash and raw records with commands. Confidence: high.

### Suggestions / KISS–YAGNI–DRY
- Keep module boundary and generated method types; no second runtime/listener abstraction needed. For screencast events, avoid `Value` payload cloning into new String/metadata (`cdp.rs:489-500`); use an owned typed required-event DTO. Unknown-event parsing need not build full arbitrary params trees.
- Reuse one bounded reservation/cleanup mechanism rather than independent counters and root-only timers.
- Correct stale test labels/comments: CSS body zoom is not browser zoom, document scroll is not nonzero visual offset, one screenshot is not recovery-policy proof (`browser_host_compatibility.rs:308-344,392,450-459,544`). Report already accurately acknowledges these limitations.
- Endpoint scanner always searches the first `ws://` occurrence and never reprocesses an undelimited token on EOF (`process.rs:483-510`); unrelated earlier WS text or a final URL without newline can cause false timeout. Parse the known DevTools announcement incrementally and handle EOF tail.

### Positive observations
- No viewer/subscription secrets embedded in shared BHJF header; contiguous immutable publication buffers support intended no-per-viewer-copy design.
- Checked envelope lengths, duplicate-field rejection via typed serde structs, JPEG SOF/dimension validation and JS-safe timestamp ceiling.
- Cancellation check before dequeue write and periodic abandoned-sender cleanup are small, appropriate changes.
- Native Windows launch fails closed; geometry/native-zoom limitations explicitly retained. No false release pass recommended.

### Validation commands / results
- This reviewer executed **no compile, test, lint, formatter or smoke commands**; integration verification belongs to Main/tester. Static inspection only; findings above not runtime reproductions.
- `git diff --stat` and scoped dependency/source diff: inspected successfully. Browser-host files absent from tracked diff; reviewed actual working-tree contents directly.
- Assignment supplies **28 passing tests**; not independently verified here.
- Historical `plans/reports/tester-261108-1201-phase-01-compatibility-contracts.md:18-27` records adapter 11/process 3/compatibility 1/Playwright 4 = **19 passed**, plus all-target cargo check. Older counts/fixtures; not evidence for current 28-test state.
- Main validation commands: `cargo test --manifest-path server/Cargo.toml --lib browser_host::cdp::tests -- --nocapture`; `cargo test --manifest-path server/Cargo.toml --test browser_host_adapter --test browser_host_process --test browser_host_compatibility -- --nocapture`; `cargo check --manifest-path server/Cargo.toml --all-targets`; `pnpm --filter @dam-hopper/ui exec playwright test e2e/os-host-browser/compatibility.spec.ts`. Real-engine qualification must require explicit provisioned engine/non-skipping configuration; Windows requires native runner. Add missing adversarial scenarios before claiming their acceptance.
- Coverage/type-coverage percentages: not measured. Lint count: not measured.

### Unresolved questions
- Where are current 28-test raw results and the candidate executable SHA-256 retained? Only historical 19-test report was located among reviewed evidence.
- Native Windows runner/evidence remains unavailable; supported Windows contract cannot be frozen yet.
