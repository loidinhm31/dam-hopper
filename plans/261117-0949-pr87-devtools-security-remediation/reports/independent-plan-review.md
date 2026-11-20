# Independent plan review — PR #87 DevTools remediation

## Terminal status and scope
- **Review: COMPLETE. Plan: revision required; not implementation authorization or final user validation.**
- Findings: **1 high, 2 medium**. Read-only challenge; only this report written.
- Requested four findings, envelope variants, positive ownership, event/snapshot/reconnect/capacity ordering, control fencing, pre-existing script effects, raw exception, overlap, acceptance, docs and rollback inspected.
- No source/plan/task-state edits, builds, tests, browser execution, installations, agents or Git operations.

## Inspected evidence
Paths relative to repository root unless absolute/URL. Ranges identify inspected substantive text; source inspection is not exploit reproduction.
- Selected directory `plans/261117-0949-pr87-devtools-security-remediation/`: `plan.md:1-56`; `phase-01-command-effect-boundary.md:1-36`; `phase-02-frame-download-ownership.md:1-53`; `phase-03-control-capability-lifecycle.md:1-71`; `phase-04-target-session-isolation.md:1-39`; `phase-05-regressions-qualification-docs.md:1-86`; `reports/evidence-and-design.md:1-61`.
- Related directory `plans/261109-2251-host-browser-review-remediation/`: `plan.md:1-53`; `phase-02-stream-input-contracts.md:1-77,79-102` and `phase-03-os-viewer-lifecycle.md:1-92` (oversized ownership/handoff lines partly tool-truncated); `phase-04-integrated-qualification-docs.md:1-94` (oversized verification line partly truncated).
- Historical `plans/261116-0223-browser-native-chromium-devtools/plan.md:1-50`.
- `server/src/browser_host/devtools_filter.rs:1-18,53-132`; `devtools.rs:19-29,33-58,70-77,79-190`.
- `server/src/api/browser_host.rs:2141-2323,2398-2601`.
- `server/src/browser_host/selection.rs:1805-1845,1910-2028`; `cdp.rs:1493-1625,1736-1751,1784-1797`.
- `server/src/browser_host/input.rs:258-265,375-403,498-607,737-770,790-953,1094-1163,1317-1378`; `input_native_release.rs:1-79`; `control_input.rs:170-308`.
- `server/src/browser_host/attachments.rs:120-204,516-680`; `manager.rs:2195-2240,2315-2345,2580-2640`; `cdp_gateway.rs:27-130,645-745,940-1030`; `media.rs:2890-2925,2945-3015`; `stealth.rs:1-140`.
- `server/tests/browser_host_devtools.rs:820-1078`.
- `packages/ui/src/os/apps/BrowserApp.tsx:965-1020,1250-1305`; `packages/ui/src/os/browser/browser-devtools-dock.tsx:1-38,90-104,149-151` (declarations/visible statements, not elided effect bodies).
- `packages/ui/e2e/fixtures/host-browser-app.ts:20-85,300-430,460-540,623-674`; `host-browser-journey-target.ts:1-83`; `packages/ui/playwright.config.ts:1-69`; `packages/ui/package.json:1-76`.
- `README.md:1-126`; `docs/code-standards.md:1-130`; `docs/project-overview-pdr.md:141-160,175-188`; `docs/testing.md:1-130`; `docs/architecture/host-browser-cdp-streaming.md:8-18,130-202`; `docs/api-reference.md:1-110`; `docs/api/browser-host.md:1-25,521-572`. Targeted searches also located relevant system-architecture/roadmap/changelog entries; no full-doc audit claimed.
- Installed guidance: `/home/loidinh/.omp/agent/evcrate/AGENTS.md:1-56`, `workflows/development-rules.md:1-44`; skills `planning/SKILL.md:1-113`, `planning/references/plan-review.md:1-46`, `planning/references/task-management.md:1-137`, `code-review/SKILL.md:1-143`, `docs-seeker/SKILL.md:1-97`.
- Primary external evidence: [ServiceWorker protocol definition](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/ServiceWorker.pdl), entire response; [Chromium ServiceWorkerHandler](https://raw.githubusercontent.com/chromium/chromium/main/content/browser/devtools/protocol/service_worker_handler.cc), lines 1–572; [page-session handler wiring](https://raw.githubusercontent.com/chromium/chromium/main/content/browser/devtools/render_frame_devtools_agent_host.cc), matched lines 52,479. Moving upstream references, not deployed-version qualification.

## Material findings

### R1 — High: non-Target worker authority remains unspecified
- **Plan:** `phase-01-command-effect-boundary.md:10-13`; `phase-04-target-session-isolation.md:11-17`; `phase-05-regressions-qualification-docs.md:27-28`.
- The concrete command/event enumeration covers Browser/Target/session routing but leaves ordinary domains forwarded. `ServiceWorker` is a separate browser-context surface, not an opaque Target wrapper. Generic “future known target-bearing routes” does not specify its registration/version authority or context-wide commands.
- **Evidence:** current `devtools_filter.rs:65-72,93-104` passes ServiceWorker commands/events. Upstream `ServiceWorkerHandler::SetRenderer` selects the renderer's storage-partition context; `Enable` watches that context; `OnWorkerVersionUpdated` publishes script URLs, target IDs and controlled-client target IDs; `StopAllWorkers` invokes `StopAllServiceWorkers`. Page sessions install this handler (`render_frame_devtools_agent_host.cc:479`). Protocol explicitly defines those commands/events.
- **Failure scenario:** holder of tab A enables ServiceWorker while foreign tab B has a live worker in the same partition. A Target-only remediation can pass every listed Target discovery/query/attach check yet relay B's registration/version/client metadata. It can also forward `ServiceWorker.stopAllWorkers`, affecting B without any foreign targetId or flattened sessionId.
- **Impact/confidence:** foreign-worker metadata/control bypass of F4; **high confidence in the missing policy surface**, deployed-engine reachability remains a qualification gate, not a reproduced attack.
- **Smallest correction:** explicitly deny ServiceWorker commands/events unless independently proven target-scoped; context-wide lifecycle commands must remain denied. Add actual-route ServiceWorker enable/version/registration and stop/unregister attempts with independently live B-worker metadata/liveness oracles. Carry this surface into Phase 01/04 policy and Phase 05 acceptance; preserve owned dedicated-worker/OOPIF debugging and qualify frontend compatibility.

### R2 — Medium: DevTools native input holds have no release-ledger contract
- **Plan:** `phase-03-control-capability-lifecycle.md:7,19-23,50-53`; regression matrix `phase-05-regressions-qualification-docs.md:25-26`.
- Ordered command admission/revocation is specified, but allowed raw Input commands are not required to join the existing held-key/button ledger. Preserving the old release hook alone does not extend its coverage to the new direct-CDP path.
- **Evidence:** `control_input.rs:235-279,304` explicitly prepares/captures native input before submission and confirms releases afterward. `input.rs:1317-1371` records holds; `:1105-1127` releases only recorded events on their captured native identity. DevTools currently writes raw commands directly (`api/browser_host.rs:2544-2546`); media translates the same native key/mouse methods (`media.rs:2966-3005`).
- **Failure scenario:** A sends `Input.dispatchKeyEvent(rawKeyDown)` or `Input.dispatchMouseEvent(mousePressed)` through DevTools, then releases/expires/disconnects. New authority fencing prevents later A commands, but an empty UI-input ledger permits successor publication without the corresponding native release. B inherits unresolved native input state; mixed UI/DevTools releases can also desynchronize tracking.
- **Impact/confidence:** lease-handoff/native-input correctness gap; **high confidence in missing bookkeeping requirement**, native manifestation unexecuted. This is managed-input cleanup, not a demand to undo arbitrary pre-fence JavaScript/timers.
- **Smallest correction:** define supported stateful Input methods explicitly; integrate their prepare/acknowledge/release accounting with the existing authority owner and captured native identity, or deny unsupported stateful variants. Add proxy-originated held key/button plus mixed-channel release/expiry/transfer tests; require native release before successor, retaining unavailable/retire behavior on ambiguity.

### R3 — Medium: clean API cutover omits its canonical documentation file
- **Plan:** `phase-05-regressions-qualification-docs.md:49-52,69-75`.
- **Evidence:** `docs/api-reference.md:3,26` delegates browser endpoint details to `docs/api/browser-host.md`. That file explicitly says “No request body is required” at `:529` and documents old authority/filter behavior at `:558,566-568`. The docs task's `allowed_files` excludes it, while Phase 03 intentionally removes bodyless mint (`phase-03-control-capability-lifecycle.md:12-16`).
- **Failure scenario:** all planned docs edits land, but the linked canonical API still instructs callers to mint without viewer/control proof and says worker/child events are forwarded. Supported callers follow a now-rejected contract; published security semantics contradict the remediation.
- **Impact/confidence:** breaking-contract/documentation completeness; **high confidence**.
- **Smallest correction:** add `docs/api/browser-host.md` to Phase 05 writable ownership and update request example, denial semantics, assets/WS control binding, revocation and child policy there. Serialize this file with the other plan's `reconcile-release-docs` task (`phase-04-integrated-qualification-docs.md:71-75`). Keep the API index a link, not a competing endpoint specification.

## Checks and satisfactory design boundaries
- Read-only JSON/link inspection: five phase fences, nine unique task IDs, exact task fields, matching markers, normalized literal writable paths, valid ordered acyclic dependency chain; every Markdown file-link target in selected artifacts exists. Two absent writable paths are explicitly planned new artifacts, not missing prerequisites.
- Phase 01 denies Page download override independently of valid control authority; malformed/binary/batch/nested and flattened bypasses have explicit negative acceptance.
- Phase 02 requires positive parent/frame provenance, subscribe-before-snapshot ordering, gap/capacity invalidation, connection namespaces and immutable GUID ownership; unknown attribution is not a compatibility pass.
- Phase 03 correctly identifies the existing post-successor hook race (`input.rs:598-604`), fences at the authority owner, races stalled writes and withholds successor on ambiguity. Previously committed scripts/timers are explicitly outside rollback guarantees.
- Raw `/api/browser/cdp/*` exception is explicit and consistent with `cdp_gateway.rs:716-720` and architecture `:18,189`; this review does not reinterpret it as viewer-lease enforcement or universal exclusivity.
- Overlapping source/docs work is serialized, stale download-denial scope is recorded, unrelated platform work is not imported as a blanket dependency. Positive frontend/file/DOM/worker-existence oracles are substantially stronger than current root-only native regression.
- Rollback disables/drains the feature, matches server/SPA and does not promise to undo files/scripts. No rollback defect established.

## Missing evidence and unresolved questions
- Original supplied Chromium traces were not independently available/verified. No deployed engine, OOPIF/worker parentage, real frontend journey, filesystem outcome or race execution verified here; named future qualification gates remain mandatory, not findings merely because implementation is future work.
- Upstream ServiceWorker evidence must be matched to the selected deployed executable/protocol; verify actual-route reachability and resulting policy/compatibility, never claim current upstream source as a native test receipt.
- Official protocol landing pages returned a redirect and a tool path-policy denial respectively; primary raw protocol/source evidence above was reachable. No local policy changed.
- Main still owns review triage, final prompt validation, raw-authority risk acceptance and exclusive shared-file handoff. Resolve R1–R3 in affected phase/task/acceptance contracts before readiness; this report grants no implementation or release approval.
