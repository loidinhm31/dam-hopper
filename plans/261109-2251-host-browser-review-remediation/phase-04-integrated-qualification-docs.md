# Phase 04 — Integrated qualification and documentation

## Context links
[Overview](plan.md) · [Phase 03](phase-03-os-viewer-lifecycle.md) · [Consolidated review](../reports/code-review-261109-2251-host-browser-nine-phases.md) · [OSQ Q1–Q5](../reports/evc-code-reviewer-261109-2251-os-selection-qualification.md) · [Runtime evidence](../reports/review-261109-2251-host-browser-runtime.md) · [Original A01–A40 matrix](../261108-0237-host-browser-cdp-streaming/acceptance-matrix.md) · [Testing rules](../../docs/testing.md).

## Overview
Date: 2026-11-09 · Priority: P1 truthful integrated/platform acceptance, P2 measured/docs reconciliation · Status: pending · Effort: not estimated. Entire Phase 03 prerequisite; platform qualification also requires native Windows implementation/proof. Integration owner runs checks after shared edits land, one coherent sequence, not competing suites.

## Key Insights
- Finding map: `repair-app-qualification` ← OSQ:Q1,Q2,Q4 and Q3 executable-security scope; `qualify-platform-security` ← OSQ:Q3,Q5 integrated/native proof; `measure-performance-human` ← OSQ:Q2,Q3,Q5 measurement/device proof; `reconcile-release-docs` ← OSQ:Q3,Q5 claim reconciliation. These are coverage overlaps, not duplicate findings or alternate task IDs.
- Q1/Q2/Q4 are source-proven fixture/oracle defects; Q3 is unsupported claim scope; Q5 is missing execution evidence, not an observed failed platform run. Existing 125 backend/61 unit/23 browser passes plus UI and E2E typechecks do not close full-app gates.
- Prior ledgers and original plan remain read-only historical evidence. New execution reports belong under this plan's future reports directory; no report/task state is created by authoring.

## Requirements
- Build/pin exact current SPA and native binary/engine identities, never accept arbitrary dist/index.html. Complete actual Browser chooser or exact supported adoption, correlate one logical/native/window target, use valid UUID keys, propagate mobile/touch/user-agent context options.
- Register cleanup immediately at each resource acquisition, including setup failure; drain/bound both process pipes, await contained exit before profile removal, close target server/contexts on all paths. No-browser/runner absence is explicit blocked/skipped required gate, not pass.
- Same-target tests must require production BHJF frame advancement and remote DOM/input markers after agent Page.disable/stopScreencast/viewport/navigation on that exact target; no fallback target, swallowed command or canvas-attached/REST-only oracle. Delayed old-epoch input must be rejected; native keyup/mouseup observed.
- Mandatory real privacy/PIN/hidden/modal canvas-blackening, no late paint, socket/demand/lease/input state and sibling continuity. Gesture-driven focus/remote text, complete IME sequences, native dialog, popup, reload/adopt/restart, ambiguous create/close and full logout/reset branches required, not optional assertions.
- Cover A01–A40 without rewriting original matrix: evidence report maps each row and every report-qualified finding to exact task, command, expected/observed result and unresolved blocker. Preserve extension/cooperative/HtmlPreview regressions, bounded copy/find, safe ancillary denials and frame-denying target behavior.
- Actual production REST/discovery/live WS/role/Origin matrix includes unauthenticated/ordinary/Admin/foreign/noauth/listener cases; auth deadline/demotion/revoke/slow-store while media writer blocked; two targets/two viewers plus real PTY echo/control responsiveness. Predicate/mock credits/manual event-sink sends cannot establish these outcomes.
- Linux service-user launch/sandbox/lock/orphan/startup failure/parent SIGKILL+immediate manager replacement/reset interruption/full-disk/denied-delete and rollback require real descendant inventory, durable profile state and unrelated PTY survival. Native Windows repeats installed Job-before-resume/DACL/lock/reset/parent-death proof from Phase 01 on actual supported host; crosscompile or deliberate fail-closed error is not support.
- Exact engine first-static/final-settled/resize/restart/dedicated-session ACK behavior and real SPA DPR1/2, scroll, page scale and browser zoom80/125/200% marker mapping mandatory. Keep unqualified geometry input-disabled; fail-closed alone does not satisfy full zoom qualification.
- Matched actual 10Hz polling baseline is test-only, same machine/engine/workload/q65/1280x900; measure production FPS/bytes/frame age/drops/queues/p50-p95 input-to-application-present, CPU/RSS and payload high-water. No inferred physical-display latency or constants-as-benchmark. Static zero periodic screenshots; <=1 bounded recovery per epoch; explicit pause stop<=2s/heartbeat<=15s.
- Retain proposed goals: sustained8–10 presented FPS, p95 input-to-application-present<=300ms, real PTY echo p95 increase<=100ms over matched baseline, >=60s no monotonic retained-payload growth and <=128MiB covered payload ceiling. Record raw samples/warmup/repeats; missed goals block technical acceptance pending bounded tuning/architecture decision, not invented SLO success.
- Tuning at most12 approved q55/65/75 × max960x675/1280x900 × everyNth1/2 settings. Current release stays everyNth1 unless exact-engine final-frame proof separately qualifies2; none pass means stop/revisit architecture, never ACK pacing/production polling/endless tuning.
- Actual desktop Chrome/Firefox human visual receipts and physical Android Chrome web keyboard/IME Vietnamese+Japanese/paste/tap/drag/scroll/cancel/zoom required, with person/date/device/browser/version/outcome/full-viewport evidence. Mobile emulation, programmatic textarea focus and synthetic composition are not those receipts.

## Architecture
Existing fixtures/runners exercise installed production paths; tests observe native DOM and BHJF presentation, not test-created substitute controllers. Evidence chain: exact revisions/hashes/config → authentic run → raw record → per-finding/A-row disposition → independent review → documentation/canary decision. Separate exercised regression, static repair, missing native/human gate and failed outcome; no green aggregate can erase severe findings.

## Related code files
Modify exact existing fixture/spec/security/platform/example paths in contracts; new report/raw-record files only under this plan's future `reports` directory. Documentation owner alone modifies existing README.md, docs/architecture/host-browser-cdp-streaming.md, docs/api/browser-host.md, docs/system-architecture.md, docs/code-standards.md, docs/codebase-summary.md, docs/project-roadmap.md, docs/CHANGELOG.md, docs/testing.md, docs/deployment-guide.md and docs/windows-release-packaging.md after evidence. No original plan/ledger edits or new documentation convention.

## Implementation Steps
### repair-app-qualification
1. Repair build identity, fixture cleanup/output/context handling, UUIDs and supported chooser/adoption. Replace tautological tuning constants tests and incidental assertions with mandatory actual consumer-visible oracles; no optional privacy/IME/same-target checks or swallowed commands.
2. Author deterministic fault schedules for all static review traces using legitimate I/O/auth/clock boundaries without mocking away native behavior being claimed. Correlate real target/frame/DOM/pair/lease state through shell and agent interference.
### qualify-platform-security
3. After all source/test edits land, run one coherent compile/unit/browser/app/security sequence and targeted fault cases. Record exact per-command exits, ignored/skipped cases and regressions; independent review remains required after repair, unresolved severe finding blocks release.
4. Execute native Linux/Windows installed-host failure matrix with real PTY and descendant inventories, credential/reset recovery and disabled→matching SPA→enabled canary/rollback; missing native runner or unimplemented contract stays blocked.
### measure-performance-human
5. Run matched polling/stream workloads (static, animation/scroll, resize/recovery, blocked viewer/raw relay, two targets/viewers plus PTY) and bounded tuning, persist raw numbers/plots as evidence not manufactured claims. Collect actual human/physical-device receipts and classify every original acceptance row.
### reconcile-release-docs
6. Documentation owner updates existing paths from observed source/evidence; correct broad qualification claims, wire/counter/geometry/target/request policy/reset authority, actual TOML fields and trusted public-origin setup. Publish explicit support/unsupported matrix, remaining gates, native browser provisioning, canary and irreversible-wipe rollback limits. Never rewrite history as fresh verification or mark administrative DONE technical acceptance.

## Todo list
```evcrate-tasks
[
  {
    "id": "repair-app-qualification", "title": "Repair exact-source fixtures and real application behavior oracles", "blocked_by": ["wire-browser-interaction"],
    "allowed_files": ["packages/ui/e2e/fixtures/host-browser-app.ts", "packages/ui/e2e/fixtures/browser-host-qualification.ts", "packages/ui/e2e/os-host-browser", "packages/ui/e2e/os-lifecycle/host-browser.spec.ts", "server/examples/browser_host_qualification.rs", "server/tests/browser_host_security.rs", "server/tests/browser_host_platform.rs"],
    "constraints": ["No stale SPA, alternate target, optional safety assertions or synthetic substitute for claimed live behavior; fix test causes without suppressing failure; do not alter original evidence."],
    "acceptance": ["OSQ:Q1,Q2,Q4 and executable Q3 gaps addressed: current build identity proven, real chooser/session bound, valid UUID/mobile context, setup failures cleaned, bounded pipes/exits, mandatory same-target/DOM/frame/privacy/input/dialog/logout oracles; tautological constants-only performance checks removed."],
    "verification": ["Future coordinator after all edits: pnpm --filter @dam-hopper/ui build; pnpm --filter @dam-hopper/ui test:e2e:typecheck; pnpm --filter @dam-hopper/web build; pnpm --filter @dam-hopper/ui test:e2e os-host-browser os-lifecycle/host-browser.spec.ts --project=chromium --workers=1; explicitly inject each fixture setup failure and assert no leaked server/tree/profile/context."]
  },
  {
    "id": "qualify-platform-security", "title": "Establish real integrated security, containment and failure evidence", "blocked_by": ["repair-app-qualification", "implement-windows-containment"],
    "allowed_files": ["server/tests/browser_host_security.rs", "server/tests/browser_host_platform.rs", "server/tests/browser_host_process.rs", "server/tests/browser_host_lifecycle.rs", "server/tests/browser_host_shutdown.rs", "server/tests/browser_host_selection.rs", "server/tests/browser_host_logout.rs", "server/tests/browser_host_input.rs", "server/tests/browser_host_auth.rs", "server/tests/browser_host_admission.rs", "server/tests/browser_host_gateway.rs", "server/tests/browser_host_screencast.rs", "server/tests/browser_host_media.rs", "server/tests/browser_host_bounds.rs", "packages/ui/e2e/os-host-browser", "packages/ui/e2e/os-lifecycle/host-browser.spec.ts", "plans/261109-2251-host-browser-review-remediation/reports"],
    "constraints": ["One integration owner, no simultaneous suites over half-edited files; native Windows/real PTY/crash proof cannot be replaced by mocks, crosscompile or fail-closed return; retain all failure and skip records."],
    "acceptance": ["OSQ:Q3,Q5 integrated gaps close only with authentic native/production receipts; every LA/SI/OSQ source defect has a meaningful regression and no unresolved severe review finding; Linux/Windows service-user containment, durable interrupted reset, actual routes/WS/role revocation, two-target/viewer isolation and PTY continuity demonstrated."],
    "verification": ["Future: cargo build --manifest-path server/Cargo.toml --bin dam-hopper-server; cargo test --manifest-path server/Cargo.toml --test browser_host_adapter --test browser_host_process --test browser_host_lifecycle --test browser_host_shutdown --test browser_host_admission --test browser_host_auth --test browser_host_input --test browser_host_gateway --test browser_host_screencast --test browser_host_media --test browser_host_bounds --test browser_host_selection --test browser_host_logout --test browser_host_security --test browser_host_platform; repeat relevant suites on native Windows and run documented real SIGKILL/reset/storage/auth/post-fence schedules, preserving exact commands/exits and OS/engine/hash/process/PTY observations; inspect severe findings with independent review."]
  },
  {
    "id": "measure-performance-human", "title": "Measure matched workloads and collect authentic device/human acceptance", "blocked_by": ["qualify-platform-security"],
    "allowed_files": ["packages/ui/e2e/os-host-browser/performance.spec.ts", "packages/ui/e2e/os-host-browser/android.spec.ts", "packages/ui/e2e/os-host-browser/same-target.spec.ts", "packages/ui/e2e/fixtures/host-browser-app.ts", "plans/261109-2251-host-browser-review-remediation/reports"],
    "constraints": ["Baseline polling is test-only; <=12 approved settings, no production ACK pacing/polling, no synthetic human/device receipt; unsupported geometry remains input-disabled until actual proof."],
    "acceptance": ["OSQ:Q2,Q3,Q5 measurement/device gaps close only with raw matched CPU/RSS/bytes/FPS/latency/PTY/payload soak records, engine static/final/zoom proof, actual physical Android web and desktop Chrome/Firefox human receipts; every A01-A40 row has honest disposition; missing or failed mandatory receipt blocks release."],
    "verification": ["Future: pnpm --filter @dam-hopper/ui test:e2e os-host-browser/performance.spec.ts os-host-browser/same-target.spec.ts --project=chromium --workers=1; execute corrected Android journey on actual attached physical Android Chrome with real keyboard/IME/human operation; record exact device commands and raw baseline/stream workload samples, >=60s retention run, full-viewport evidence, human names/dates/results and all missed thresholds without converting emulation/typecheck into proof."]
  },
  {
    "id": "reconcile-release-docs", "title": "Reconcile existing documentation and block unsupported release claims", "blocked_by": ["measure-performance-human"],
    "allowed_files": ["README.md", "docs/architecture/host-browser-cdp-streaming.md", "docs/api/browser-host.md", "docs/system-architecture.md", "docs/code-standards.md", "docs/codebase-summary.md", "docs/project-roadmap.md", "docs/CHANGELOG.md", "docs/testing.md", "docs/deployment-guide.md", "docs/windows-release-packaging.md", "plans/261109-2251-host-browser-review-remediation/reports"],
    "constraints": ["Documentation owner sole maintained-doc writer; original selected plan/reports untouched, no Git/publication authority; missing gates stay visible even if task cannot close."],
    "acceptance": ["OSQ:Q3,Q5 unsupported claims reconciled to authentic evidence; architecture/API/standards/changelog/roadmap match actual owners, canonical counters and policy/config; native support and all remaining gates explicit; controlled enable/rollback preserves credentials/tombstone, wiped data not promised recoverable; severe finding or missing gate means no launch approval."],
    "verification": ["Future documentation review traces every empirical statement to raw receipt and every interface to current source; inspect links, exact config and support matrix; repeat isolated canary/disable-drain/rollback with compatible binaries and seeded non-production profile; final ledger separates reproduced regression fixes, static findings, failed/skipped/unexecuted gates and human receipts. No documentation claim substitutes for missing execution."]
  }
]
```
- [ ] <!-- evcrate-task:repair-app-qualification --> Repair fixtures and behavior oracles
- [ ] <!-- evcrate-task:qualify-platform-security --> Qualify integrated security/platform behavior
- [ ] <!-- evcrate-task:measure-performance-human --> Measure workloads and obtain human/device proof
- [ ] <!-- evcrate-task:reconcile-release-docs --> Reconcile existing docs and release gates

## Success Criteria
All 45 report-local findings mapped across this plan with evidence-backed closure or explicit blocking disposition; A01–A40 retained without shrinking scope. Applicable compile/typechecks, focused and actual application checks, independent review, Linux/native Windows fault proof, physical Android/human observations, raw matched soak and canary/rollback all complete before technical launch approval. No prior count or authoring result grants approval.

## Risk Assessment
Fixture fallback can silently validate wrong bytes/target; exact identity and mandatory remote oracles prevent it. Fault injection uses isolated temp credentials/processes, never production profiles. Missing hardware/operators or missed performance goals block release; owner records precise missing prerequisite and preserves reachable work, not a fabricated pass or automatic waiver.

## Security Considerations
Evidence must redact bearer/tickets/native endpoints/page secrets and use isolated managed roots; actual request-policy tests use owned local sinks, not cloud metadata probes. Keep explicit raw-CDP/full-host privilege and non-egress-boundary caveats. Rollback cannot reverse confirmed credential wipe; no public release while severe authority/privacy findings remain.

## Next steps
Coordinator reviews final evidence/plan validation and chooses separately authorized implementation/release operations; this plan executes none. Unresolved questions: none requiring product decisions. Windows runner/implementation proof, physical Android/human availability, crash/storage schedules and raw measured soak remain blocking until authentically exercised.
