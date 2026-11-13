---
title: "Host Browser review remediation"
description: "Repair reviewed authority, lifecycle, streaming and OS defects, then establish honest integrated release evidence."
status: in-progress
priority: P1
effort: not-estimated
branch: feat/ai-os-redesign
tags: [bugfix, frontend, backend, auth, critical]
created: 2026-11-09
---
# Host Browser review remediation

## Outcome and authority
Repair existing owners across original phases 01–09; preserve same-target human/agent browsing and bounded streaming. Phase 02 implementation is in progress in the uncommitted working tree; no Phase 02 review or release approval has been granted.

## Phases
| Phase | Priority | Status |
|---|---|---|
| [01 Backend authority, native targets and durable cleanup](phase-01-backend-authority-lifecycle.md) | P1 | partial, 4/5 tasks |
| [02 Stream/input authority, recovery and bounds](phase-02-stream-input-contracts.md) | P1/P2 | in progress; recovery lifecycle tests failing |
| [03 OS ownership, presentation and interaction](phase-03-os-viewer-lifecycle.md) | P1/P2 | pending |
| [04 Integrated qualification and documentation](phase-04-integrated-qualification-docs.md) | P1/P2 | pending |
Four phases, 17 durable tasks; Phase 01 partial (4/5 tasks completed 2026-11-10; Windows containment blocked). Phase 02 work in progress, phases 03–04 pending. Missing native Windows access blocks its task and final qualification, not reachable Linux repairs.

**2026-11-13 handoff:** [Phase 02 work and failing recovery regressions](phase-02-stream-input-contracts.md#current-execution-handoff-2026-11-13). Changes are uncommitted and unreviewed; task checkboxes remain open until their acceptance and review gates pass.

## Settled design and order
- Keep Rust CDP actor, dedicated Page sessions, target-only BHJF 16-byte immutable `Bytes`, prompt native ACK independent of viewer credits, current React/Axum runners. No sidecar, framework, compatibility shim, iframe fallback or parallel registries.
- Unify target lifecycle and geometry in existing owners; single integration owner serializes shared writes. Backend core → stream/input → OS → qualification. Windows implementation remains a separately gated Phase 01 task required before final platform qualification; never a hardware wait blocking unrelated repairs. P1 shell-close crash is the first bounded Phase 03 repair once prerequisites settle.
- Keep canonical decimal-string counters end-to-end; synchronize backend/client callers in Phase 02. Preserve configured admission caps, original-target releases, exact socket/owner identity and revoke-before-reset ordering.
- Windows remains unsupported/fail-closed until real Job/DACL implementation AND native proof. Required Windows, physical Android, human visual and measured soak evidence are blocking prerequisites, not optional user choices.
- Existing scope retained: Android web, not native Android; explicit copy/find, denied ancillary permissions/transfers, no raw-CDP/WS/WebRTC/DNS/local-user isolation claim. No acceptance shrink by default.

## Evidence and finding index
[Consolidated coordinator review](../reports/code-review-261109-2251-host-browser-nine-phases.md) and [sanitized map](../reports/scout-261109-2251-host-browser-map.md) cover all original phases. Report-local IDs below are qualified, never conflated:
- **LA** = [lifecycle/admission](../reports/evc-code-reviewer-261109-2251-lifecycle-admission.md), L1–L14 → Phase 01 task map.
- **SI** = [stream/input](../reports/evc-code-reviewer-261109-2251-stream-input.md), SI-01–SI-12 → Phases 02–03 task maps.
- **OSQ** = [OS/selection/qualification](../reports/evc-code-reviewer-261109-2251-os-selection-qualification.md), O1–O8, S1–S4, L1–L2, Q1–Q5 → Phases 01,03–04 task maps.
- [Runtime R1–R7](../reports/review-261109-2251-host-browser-runtime.md): reproduced close crash, missing proxy focus, raw geometry/click drift, missing native release, string-epoch 422, Host reflection and unapproved dev target/subresource access. No metadata attack, bearer exfiltration or Android keyboard result claimed.
- Remaining reviewer traces are static/source-backed, with unexecuted race/timing outcomes; Q5 platform/human/soak gaps are unexecuted release gates, not observed platform failures. No P0 established.
- Existing 125 backend + 61 unit + 23 browser passes and UI/E2E TypeScript checks are scoped prior evidence, not remediation or full-app proof. Numeric resize streamed; ordinary successful DELETE worked. Do not revive rejected blanket freeze/missing-close or stale fixture guesses.
- Research: [CDP/security](../reports/evc-researcher-261109-2251-cdp-security.md), [stream/lifecycle](../reports/evc-researcher-261109-2251-stream-lifecycle.md). Current reviewer/map corrections supersede historical research carryovers; pinned Chromium source is not deployed-engine qualification.

## Dependencies, documentation and gates
- [Original plan](../261108-0237-host-browser-cdp-streaming/plan.md), [contracts](../261108-0237-host-browser-cdp-streaming/architecture-contracts.md), [A01–A40 matrix](../261108-0237-host-browser-cdp-streaming/acceptance-matrix.md) remain read-only. Original phase 10 is overlapping documentation/rollout work, not inherited approval; serialize through this plan's final documentation owner rather than edit both plans.
- Existing [browser architecture](../../docs/architecture/host-browser-cdp-streaming.md) and [system architecture](../../docs/system-architecture.md) are baseline, not proof. Preferred architecture.md absent per verified intake. Scoped authoring forbids maintained-doc edits now; implementation must reconcile intended invariants at task entry and actual behavior in Phase 04, not claim Gate 1 publication already happened.
- Related auth/device-login and OS/privacy writers overlap; coordinator serializes them. No imported whole-plan dependency or completion claim.
- Phase 04 owns one coherent verification/review reconciliation after implementation; task verification strings are future checks, not executed receipts. Use actual engine/binary/SPA identity, commands, exits, raw records and human/device provenance; failures/skips stay failures/pending.
- No launch approval while any severe finding, missing required proof or failed gate remains. Rollout only after gate closure; disable/drain Browser before rollback, preserve profile/lock/tombstone, never promise undo of credential deletion.
- Existing docs/changelog paths and exact ownership are in Phase 04. Phase 02 implementation has begun, but remains unreviewed and does not constitute release approval.

## Unresolved questions
None requiring a product decision. Native Windows runner, physical Android/human receipts and raw matched measurements remain unavailable blocking verification prerequisites until supplied and exercised.
