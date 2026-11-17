# Independent plan review — targeted follow-up

## Terminal status / coverage
- **COMPLETE. R1/R2/R3 consistently propagated into revised plan contracts; no residual material finding established on these surfaces.**
- Dispositions below concern planning corrections, **not implementation finding closure, deployed qualification, final user validation or implementation authorization**.
- One allowed targeted follow-up only; not another whole-plan audit. Only this artifact written.

## Exact revised surfaces inspected
All selected paths below relative to `plans/261117-0949-pr87-devtools-security-remediation/`:
- `plan.md:1-63` — triage, policy, serialization, acceptance, pending gates.
- `phase-01-command-effect-boundary.md:1-37` — ServiceWorker policy/inventory, literal ownership, task acceptance/verification.
- `phase-03-control-capability-lifecycle.md:1-73` — shared UI/CDP input lifecycle, task ownership, cancellation and successor barrier.
- `phase-04-target-session-isolation.md:1-40` — separate domain enforcement versus target/session ownership and qualification.
- `phase-05-regressions-qualification-docs.md:1-91` — R1/R2 native oracles, literal qualification/docs ownership, R3 serialization.
- `reports/evidence-and-design.md:1-73` — provenance, R1–R3 dispositions, transaction contracts and gate register.
- Oversized lines read unabridged; no omitted task acceptance/constraint text assumed.

## Supporting evidence inspected
Repository-relative unless noted:
- Original `plans/261117-0949-pr87-devtools-security-remediation/reports/independent-plan-review.md:1-64`.
- `server/src/browser_host/devtools_filter.rs:53-132`: current ServiceWorker command/event passthrough remains the source basis for R1.
- `server/src/api/browser_host.rs:2535-2556`: direct raw DevTools writes establish R2's distinct path.
- `server/src/browser_host/control_input.rs:235-308`; `input.rs:1094-1163,1317-1378`; `input_native_release.rs:1-79`: existing prepare/acknowledge, captured identity and native release owner.
- `docs/api-reference.md:1-29`; `docs/api/browser-host.md:521-572`: canonical link, bodyless mint and old forwarding prose establish R3.
- `plans/261109-2251-host-browser-review-remediation/phase-04-integrated-qualification-docs.md:69-78`: overlapping `reconcile-release-docs` ownership explicitly includes canonical API.
- Installed `planning/references/plan-review.md:1-46`, planning/code-review skills and shared development guidance applied; explicit report-only assignment takes precedence over implementation-review duties.
- Reused original review's upstream evidence: [ServiceWorker PDL](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/ServiceWorker.pdl), [Chromium handler](https://raw.githubusercontent.com/chromium/chromium/main/content/browser/devtools/protocol/service_worker_handler.cc), [page handler wiring](https://raw.githubusercontent.com/chromium/chromium/main/content/browser/devtools/render_frame_devtools_agent_host.cc). Not independently refetched or matched to deployed engine in this pass.

## Accepted-finding dispositions
### R1 — Addressed in plan; execution evidence still outstanding
- Phase 01 `:11-15,27-30` specifies command default-deny, event suppression, unconditional context-wide lifecycle denial even for holder, and bounded analogous nonlocal-effect inventory with evidence/policy/regression mapping.
- Phase 04 `:11-18,30-33` carries enforcement into commands/results/events, embedded arrays and owned flattened sessions. Parent/child or service-worker Target ownership explicitly cannot substitute for domain scope proof. Exceptions require deployed evidence and complete effect/payload enforcement; stop-all never becomes holder-authorized.
- Literal filter/API/test ownership is present in Phase 01 `:27` and Phase 04 `:30`; qualification fixtures/tests in Phase 05 `:68`.
- Phase 05 `:29-33,69-71` requires independently established B worker before A actual-proxy attempts, metadata absence, original live-instance nonce/channel after EACH lifecycle attempt, and owned frontend/worker/OOPIF compatibility. Registration persistence or automatic worker restart cannot pass.
- Overview `:30,45,49,62` and evidence/design `:20,52,69,73` agree; upstream source is not a deployed receipt.

### R2 — Addressed in plan; execution evidence still outstanding
- Phase 03 `:19-25` inventories key/mouse/touch/drag/gesture/IME/stateful variants: account through existing authority or deny. Pending obligations precede dispatch; bounded native reply correlation distinguishes confirmation, rejection and ambiguity.
- Same physical-state ledger spans UI/CDP, pending AND confirmed holds, repeat/concurrent release semantics, captured epoch/native target/session/connection identity. No separate channel refcounts or replacement-target lookup.
- Fence/revoke → cancel/drain → captured-identity release → confirmation → successor is explicit. DevTools cancellation/disconnect with outstanding work/holds enters captured-epoch transition; cleanup uses independent internal permit, no locks across network awaits. Failed/uncertain cleanup remains unavailable/reconcile/retire; late callbacks cannot retire replacement. Prior committed JS is not rolled back.
- Literal owner modules/filter/relay/tests appear in Phase 03 `:52`; constraints/acceptance/future barriers `:53-55` preserve these obligations. Phase 04 `:11,17,31` retains them on child routes.
- Phase 05 `:26-28,68-71` requires CDP and both mixed-channel directions, cancellation/ambiguity/failure, original-target native keyup/mouseup before successor, and clean fresh-holder input—not ledger counts alone.
- Overview `:32,45,50` and evidence/design `:21,41-43,57` agree, including serialized existing-ledger handoff.

### R3 — Addressed in plan; publication evidence still outstanding
- Phase 05 `:55-57,77-80` adds literal `docs/api/browser-host.md` ownership and authenticated JSON viewer/control proof, auth/viewer/target binding, actual denial statuses, assets/WS/refresh/revocation/remint, child/ServiceWorker/download policy and raw-CDP exception. Bodyless and old forwarding guidance must be removed; API index remains navigation.
- Explicit cross-plan `reconcile-release-docs` serialization and re-read of landed content appears in task constraints, not prose alone. Overview `:41,51,61` and evidence/design `:22,57,68` retain Main's exclusive handoff gate.

## Residual findings / status consistency
- **No additional material finding established within revised R1–R3 surfaces.** Future implementation TODOs are not defects merely because unexecuted.
- Overview `:48,53-63`, Phase 05 `:90-91` and evidence/design `:61-73` consistently remain pending targeted follow-up/validation and blocked on shared-file handoff; none marks the plan ready or claims findings resolved. Coordinator must consume this report separately from final validation.

## Checks not run / unresolved evidence
- No tests, builds, lint/typecheck, browser/native execution, installation, agents, Git operations or source/plan/task-state edits. No unchanged-phase or whole-codebase re-audit.
- Deployed executable/protocol and ServiceWorker reachability/scope, live worker/OOPIF fixtures, actual proxy metadata/liveness, native release-before-successor and positive frontend compatibility remain unverified future qualification gates, not inferred successes.
- Main still owns final validation, privileged raw-authority risk disposition and exclusive source/input/canonical-doc handoff. Original exploit traces remain unavailable. No further review loop requested or implied.
