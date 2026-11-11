# Browser Host Video/Audio Streaming — Cycle 13 Code Review

## Code Review Summary

**Score: 9/10. Code approval: APPROVED WITH NOTES.**

**No remaining blocking source finding identified in this review.** Both Cycle 12 findings are corrected in the inspected implementation and regression assertions. One low-priority reporting discrepancy remains. Final feature/plan acceptance is **not yet established**: the inspected artifacts do not supply the plan's real output-browser audible/privacy/two-viewer/FPS/latency qualification. Code approval must not be represented as that final qualification.

## Scope

Original 18 requested files reviewed across the initial assessment and focused remediation cycles:

- `server/src/browser_host/config.rs`
- `server/src/browser_host/protocol.rs`
- `server/src/browser_host/process.rs`
- `server/src/browser_host/stealth.rs`
- `server/src/browser_host/screencast.rs`
- `server/src/browser_host/media.rs`
- `server/src/config/tests.rs`
- `server/tests/browser_host_process.rs`
- `server/tests/browser_host_media.rs`
- `packages/ui/src/api/browser-host-types.ts`
- `packages/ui/src/browser-host/pcm-player.ts`
- `packages/ui/src/browser-host/pcm-player.test.ts`
- `packages/ui/src/browser-host/stream-controller.ts`
- `packages/ui/src/browser-host/stream-controller.test.ts`
- `packages/ui/src/os/BrowserStreamKeepAliveHost.tsx`
- `packages/ui/src/os/BrowserStreamKeepAliveHost.test.tsx`
- `packages/ui/src/os/apps/BrowserApp.tsx`
- `packages/ui/src/os/apps/BrowserApp.test.tsx`

Authorized native integration expansion: `server/src/browser_host/cdp.rs` and `server/src/api/browser_host.rs`, documented in Phase 01 lines 61–62/85 and backend ownership in `tasks.json`.

Focus: changed feature, relevant lifecycle context and successive remediation; not whole-repository coverage. Supporting evidence: overview, Phase 01, Phase 02, README/PDR/code standards, browser architecture, session/navigation context, memory-reservation ownership, QA and implementation reports. Published code-review skill/development rules applied. Approximate analyzed LOC not independently counted.

**Only this report written.** Product/tests/plans/task state remain unchanged by reviewer. Updated plans: none; Main owns finalization.

## Verification Evidence

Reviewer inspected source and recorded artifacts; **no reviewer-run builds, tests, lint or live probes**. Fresh QA-recorded **Cycle 13** results (`reports/qa-report.md:39-48`):

| Gate | Recorded outcome |
| --- | --- |
| Rust process/media/screencast integration command | Exit 0; 40 passed, 4 ignored |
| Focused producer authority/admission test | Exit 0; 1 passed |
| Focused browser config test | Exit 0; 1 passed |
| Four focused UI test files | Exit 0; 89 passed |
| UI TypeScript build | Exit 0 |
| PCM player physical size | 199 lines; below 200 |

These are QA-attributed outcomes, not independent reviewer executions. Source inspection supports the remediation disposition below; passing commands are not treated as proof of unexercised live journeys.

## Overall Assessment / Cycle 12 Disposition

### C12-H2 — Resolved in inspected source and regression coverage

- The `#` substring capability heuristic is gone. Commands retain method and expected URL (`screencast.rs:89-101,243-249,311-334`). The exact prior-document snapshot survives eligible navigation until the actual outcome is known.
- A Page.navigate response with a loader ID establishes cross-document handling and clears same-document restoration (`:359-386`). A same-document outcome needs a matching event and successful response without a loader (`:392-405,501-517`).
- The restoration helper unretires the surviving document and advances its capture subgeneration (`:169-191`). Fragment removal no longer depends on the destination containing `#`.
- Unit assertions cover event-before-response fragment addition and response-before-event fragment removal, with rejection of old generations (`:2807-2875`). A real Chromium capture case navigates from `/grandchild#section-frag` to `/grandchild` and requires PCM under the new epoch (`browser_host_media.rs:1493-1514`). Same-document history back is also exercised (`:1516-1545`).

### C12-H6 — Resolved for the reported event/response ambiguity

- Native event projection now supplies frame ID, URL and navigation type to the synchronous listener (`cdp.rs:1094-1114`). The listener rejects another frame ID, rejects `historyApi` events against a pending managed operation and matches the expected destination (`screencast.rs:485-519`).
- A new loader response clears any earlier same-document flag and restoration snapshot; it cannot consume the operation as same-document (`:359-386`). Only the correlated loader commit establishes the cross-document outcome (`:422-430`).
- Unit assertions inject old-page history events plus a synthetic same-URL fragment event before a new-loader response, require pending authority, then require the exact loader commit and reject old document PCM (`:2877-2924`). Cross-document history has a separate old-page-history-event regression (`:2999-3028`).
- The prior same-document synthetic response oracle now correctly omits loaderId (`:2818-2831,2846-2868`).
- Retired-document drains now reject without demoting an otherwise newly committed authority (`:1540-1542`), avoiding the earlier stale-drain availability failure.
- Live capture covers a cross-document `#anchor` destination binding a different document (`browser_host_media.rs:1551-1581`). The adversarial old-page-event interleaving is directly asserted by the unit cases; the inspected live excerpt does **not** itself inject that interleaving. These are distinct evidence layers.

### Earlier security/lifecycle corrections retained

Explicit per-command epochs, pre-enqueue stale rejection, late admitted-operation fencing, session-lifetime commit observation, initial-navigation authority and watcher-before-no-op restoration remain present. Earlier review cycles also addressed strict object parsing, actual embedded relay, pre-demand capture, graph teardown/restart, checked audio sequence, shared reservation ownership, MIME fallback, direct privacy subscriptions and bounded player scheduling. No historical finding is carried forward merely because it appeared in an earlier report.

## Critical Issues

None confirmed in inspected changes. No whole-subsystem assurance of unchanged authentication/Chromium containment claimed.

## High Priority Findings

None remaining identified in the inspected scope.

## Medium Priority Improvements

None newly identified. Final live qualification is a required acceptance gate below, not an invented observed source defect.

## Low Priority Suggestions

### C13-L1 — Implementation report describes different video defaults than current source/plan

**Evidence:** `reports/implementation-report.md:7,20` states JPEG quality 80 and a default producer interval of 42 ms. Actual config is JPEG75/24 FPS (`config.rs:13-16`), while legacy producer defaults remain quality65/100 ms (`screencast.rs:28-30,626-627`). These source choices match the overview and Phase 01 contracts (`plan.md:15,24,40`; Phase 01 `:18-20`).

**Impact:** handoff readers can misidentify the effective defaults and incorrectly conclude that the required constructor compatibility changed. The discrepancy is in reporting, not an observed code-policy failure.

**Correction:** Main updates the implementation report to distinguish configured production 24 FPS/JPEG75 from legacy 100 ms/JPEG65 constructors. Do not change correct source to match the report.

**Confidence:** high; directly conflicting inspected text. Nonblocking for source approval.

## Security / Quality Verification

Source-inspection assessment, separate from recorded execution:

| Requirement | Disposition |
| --- | --- |
| No Runtime.enable / Runtime.addBinding | Preserved in reviewed changes; native correlation uses Page traffic. Original stealth installation order retained. |
| Exact autoplay allowlist | Exact `--autoplay-policy=no-user-gesture-required`; no reviewed sandbox/TLS/site-isolation weakening. |
| PCM/base64/JSON bounds | Matching 4,800 decoded bytes / 6,400 base64 chars / 8 KiB JSON; bounded format/decode checks. Separate original 1 KiB inbound-control cap retained. |
| Strict identity/fencing | Session/incarnation/profileEpoch/producerRun/subscriptionEpoch, required document epoch and checked audioSeq retained. Explicit stale dispatch rejection, exact loader handling and same-document restoration now address the reported authority defects. |
| Untrusted page envelope | Mandatory object/docId/positive subDocGen; bounded chunks; raw arrays and retired documents rejected. Hidden bridge is not treated as a security boundary. |
| Mute/Cognito/LockScreen/hide/reset/retirement | Direct source subscriptions and synchronous gain/source flushes present; root/viewer-local ownership maintained. Final actual output-browser silence still requires live evidence. |
| Resource/performance bounds | Bounded ring/queue/source/dispatch state, shared PCM and reservation ownership, source cleanup/restart and no audio-video-credit coupling retained. Runtime latency/memory not measured by reviewer. |
| Video policy/credits | Configured 24 FPS/JPEG75, fallback quality, 15 ms pending flush, legacy 100 ms constructors and independent native ACK/video credits retained. Presented FPS not measured here. |
| Player/UI | Dependency-free player; current QA count 199 lines; bounded scheduling, resume/autoplay cue and accessible lease-independent toggle. |
| Error handling | Explicit stale rejection and failed-response cleanup present. Navigation authority changes are checked at native lifecycle boundaries rather than hidden by playback-error suppression. |

## Positive Observations

- Exact native loader outcomes now override ambiguous early same-document events.
- Regression oracles cover both event/response orderings and explicitly assert rejected old document/subgeneration data.
- Test fixtures include actual Chromium PCM capture and embedded sources instead of relying exclusively on script substring assertions.
- Audio remains viewer-local, bounded and independent of video credits; privacy teardown is imperative rather than waiting for React effect timing.
- Production policy and legacy constructor behavior remain separated, as required by the plan.

## Recommended Actions / Plan Compliance

1. Correct the nonblocking implementation-report discrepancy above.
2. Complete final plan qualification with real host Chromium **and an output browser**: ordinary media/WebAudio audible and contiguous playback; immediate silence and no replay for every privacy/retirement gate; gesture/autoplay recovery; two viewers; delivered/presented FPS and audio latency/queue duration under recorded conditions. See Phase 02 `:111,123-124` and overview `:39-43`.
3. Keep capture evidence, mocked playback assertions and real output-browser results explicitly separate. QA's successful focused gates do not by themselves close every phase acceptance criterion.
4. Main owns maintained docs and plan/task finalization. Overview/phase statuses remain pending; reviewer neither marks tasks complete nor treats their status as proof of a code defect. Record the actual remaining acceptance evidence before final feature approval.
5. No additional reviewer reruns of already successful checks requested merely for confirmation; Main/QA owns integrated verification.

## Metrics

- **Score:** 9/10, qualitative reviewer assessment.
- **Current findings:** 0 critical; 0 high; 0 medium; **1 low reporting discrepancy**.
- **QA evidence:** six current commands recorded passing; no reviewer-run check result asserted.
- **Player:** 199 physical lines; under-200 requirement satisfied.
- **Type/test coverage:** percentages not measured; recorded TypeScript build/test totals above.
- **Lint issues:** not measured; no clean-lint claim.
- **Code approval:** APPROVED WITH NOTES.
- **Final feature/plan acceptance:** pending named live qualification and coordinator finalization.

## Unresolved Evidence

- No inspected artifact establishes final real output-browser audible/gapless playback, all privacy silence journeys, two-viewer independence and measured FPS/audio latency.
- The adversarial old-page-event interleaving is asserted at the unit authority boundary; no equivalent injected live-engine ordering is claimed by this review.
