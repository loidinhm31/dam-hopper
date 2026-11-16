# Host Browser CDP streaming — phases 01–09 review

Date: 2026-11-09. Branch `feat/ai-os-redesign`. Scope `3f20a8a9..cdfa9c6b`, selected [original plan](../261108-0237-host-browser-cdp-streaming/plan.md). Three parallel code reviewers, two bounded researchers (four primary sources total), scoped scout plus coordinator source verification and real runtime probes. **Request changes; not technically ready for rollout.** No product code changed. Original completion labels/task state untouched; administrative DONE does not establish acceptance.

## Highest-priority findings

### 1. P1 — Closing a live Browser crashes the entire OS shell [REPRODUCED]
`packages/ui/src/os/BrowserStreamKeepAliveHost.tsx:303–312,558–570,632–667,690–723` moves a React-owned child with `appendChild`, but React still deletes it from the parking parent. Actual-source OS → Browser chooser → streamed page → Close enters ErrorBoundary with `NotFoundError: removeChild`. Native target deletion succeeds; shell failure is local DOM ownership, not missing DELETE. Use existing imperatively created host + `createPortal` pattern from `MonacoKeepAliveHost.tsx:182–207,247–266`. [Crash evidence](261109-2251-host-browser-evidence/close-crash.png).

### 2. P1 — Agent viewport changes permit wrong-coordinate, stale-epoch input [REPRODUCED]
`server/src/browser_host/screencast.rs:694–714`, `media.rs:908–923,965–966`; gateway/session reconciliation does not share authoritative geometry with producer/input. After managed900×700/epoch2, raw CDP changes native viewport1000×800; trusted BHJF geometry becomes1000×800 **still epoch2**. Old epoch2 input is accepted. Displayed center `(0.5,0.5)` clicks native `(450,350)`, not `(500,400)`. Unify geometry/epoch/cache/input fencing and reconcile flattened session→target identity before enabling input.

### 3. P1 — Lease release reports success without releasing native keys [REPRODUCED]
`server/src/api/browser_host.rs:907–910` discards returned release events. Remote page records Shift keydown; release returns200; no keyup arrives. Related overflow/gap paths discard releases; PointerCancel CDP dispatch is a no-op (`media.rs:1047`). Dispatch releases on the original channel before clearing held state; propagate failures, actively expire leases.

### 4. P1 — Ordinary page requests bypass configured Browser origin policy [REPRODUCED IN DEV]
`server/src/browser_host/media.rs:95–106`, `screencast.rs:229–254`, `api/browser_host.rs:418–426`, `network_policy.rs:132–143`. Managed pages never install request interception; creation uses CORS origins rather than Browser target/asset policy and broadly permits dev loopback. Real unapproved loopback page create returned201; its image reached another unapproved loopback server. No raw agent injection involved. Production redirect/metadata exposure is source-backed risk, **not attempted runtime access**. Install central policy before first navigation; retain documented non-egress-boundary caveat.

### 5. P1 — CDP discovery trusts Host and downgrades to cleartext [REPRODUCED]
`server/src/browser_host/cdp_gateway.rs:145–167`. With public-origin env unset, approved-Origin GET plus `Host:review-attacker.example` returns200 and `ws://review-attacker.example/api/browser/cdp/ws`. A client following discovery can connect to a request-controlled destination; TLS deployments also receive ws rather than wss. This confirms reflected authority, not performed bearer exfiltration. Parse a trusted configured origin; reject missing/invalid authority.

### 6. P1 — OS input/control lifecycle incomplete [FOCUS REPRODUCED; OTHER PATHS SOURCE-REVIEWED]
`BrowserStreamKeepAliveHost.tsx:607–658`: canvas gesture leaves actual focus on DIV, never textarea; normal keyboard/IME/Android keyboard activation lacks its production entrypoint. `BrowserApp.tsx:290–305` sets Controlling without renewing/clearing lease; 30s expiry or pause/resume strands that state. Persisted sessions are not re-listed/adopted; missing incarnation is replaced by `"1"`. Wire exact owner/session/demand/lease lifetime, proxy focus and reconnect reconciliation.

### 7. P1 — Logout/selection fences can outlive their authority [SOURCE-REVIEWED]
`ServerProfilesDialog.tsx:463–474` and Settings disconnect/increment generation before invoking old-generation Browser fence, which therefore no-ops. Artifact handoff checks Browser/auth state before waiting for entry lock (`store.rs:634–685`); final PTY write can follow intervening navigation/revocation (`selection.rs:277–302`). No interleaving reproduction claimed. Fence/blacken before disconnect; make final navigation/reset/auth authority and synchronous incarnation-checked PTY mutation one ordered operation.

### 8. P1 — Target/reset lifecycle lacks one publication owner [SOURCE-REVIEWED]
`media.rs:86–120` uses separate get/create/register operations; API returns201 despite failed producer setup. Concurrent retries can allocate duplicate native targets. Failed close drops native identity/frees capacity before confirmed absence. In-flight old-epoch create can commit after reset/logout. Native popup/destruction/crash events are not authoritative SessionRegistry transitions. Serialize native allocation/close/reset commit, preserve pending identity and reconcile ambiguous outcomes; enforce configured caps.

### 9. P1 — Stream pairing/recovery and concurrent transitions unsafe [SOURCE-REVIEWED]
`screencast.rs:193–223,340–402`: start holds state lock then requests geometry; resize holds geometry then requests state → concurrent lock inversion. Control sockets bypass viewer permit and input pair-readiness checks; half-pairs only reap on later registrations (`media.rs:783–923`, `attachments.rs:374–425`). Lossy event ingress ignores lag, actor closure does not reliably drive restart while demand persists. No fault-injection execution claimed; fix ordered transition ownership and timer-owned pair admission/recovery.

### 10. P2 — Viewport API rejects its own string epoch [REPRODUCED]
`server/src/api/browser_host.rs:719–724` expects numeric u64 while DTO/request types permit string; `viewportEpoch:"1"` returns422, numeric1 returns200 with `"2"`. Input converts counters through Number (`input-controller.ts:421–431`), losing u64 identity above2^53. Canonical decimal strings end-to-end; migrate all consumers without numeric compatibility shims.

## Additional actionable findings retained in detailed reviews
- **Lifecycle/admission:** restart ignores persisted containment identity; reset writes lack filesystem durability barriers; completed marker plus surviving tombstone wedges recovery; expired full ticket table cannot recover and global check races; serial auth rechecks exceed promised windows; retired sessions accumulate; actual listener-loopback authority absent and empty production Origin allowlist fails open.
- **Stream/viewer:** full128MiB payload ceiling excludes ingress/candidates/transient decode/pack overlap; cleanup ordering emits sequence gaps/releases on replacement lease; stale tickets admit Closed sessions; owner reattach preserves old pixels/input rectangle; active decode can paint old viewport epoch; IME transaction deduplication can duplicate/drop genuine input.
- **OS/selection/logout:** late attachment can outlive suppression/demand; pending create/failed delete loses closure ownership; native dialogs never reach/resume actual UI; stale navigation watcher remains registered after overflow; artifact unlink failures forgotten; deleted artifacts leave unbounded selection registrations; anonymous logout can falsely confirm revocation of an unsent saved token; reset responses can mutate replacement-owner context.
- Exact traces, confidence, minimal fixes and test blind spots: [backend L1–L14](evc-code-reviewer-261109-2251-lifecycle-admission.md), [stream SI-01–SI-12](evc-code-reviewer-261109-2251-stream-input.md), [OS/selection O/S/L/Q findings](evc-code-reviewer-261109-2251-os-selection-qualification.md). IDs are report-local; this list does not claim every path reproduced.

## Nine-phase acceptance disposition
| Phase | Review outcome |
|---|---|
| 01 Adapter/contracts | Command pre-reservation and framing present; runtime/deployment qualification incomplete; Windows fail-closed is not implemented containment |
| 02 Managed lifecycle | Stable external lock/reset worker ordering present; recovery/durability/reset-publication findings block acceptance |
| 03 Admission/control | URL predicate/ticket hashing present; request policy, pair admission, cleanup/cap/timing findings block acceptance |
| 04 Raw gateway | Real connectOverCDP works with approved Origin; reflected discovery authority and geometry reconciliation block acceptance |
| 05 Producer/fanout | Actual BHJF publication/ACK works; transition/recovery/global accounting/native target ownership unresolved |
| 06 Viewer client | Focused parser/decoder tests pass; native coordinate/release and string-counter defects reproduced; owner/IME fences unresolved |
| 07 OS cutover | Real stream displayed; explicit Close crashes shell; adoption/control/text/modal lifecycle incomplete |
| 08 Selection/logout | Revoke-first server reset, source ownership and Cancel-first dialog retained; final authority/retention/local fence findings unresolved |
| 09 Qualification | Tests/typechecks pass within scope; actual app oracles/fixtures do not establish their named security/performance/device claims |

## Verification and rejected hypotheses
| Fresh check | Result |
|---|---|
| Focused Rust,15 integration suites | 125 passed;2 ignored |
| UI browser-host/client unit suites | 61 passed |
| Chromium browser components,6 files | 23 passed |
| UI TypeScript build + E2E TypeScript check | Both passed |
| Exact-source OS + production backend/native Chromium | Real JPEG display; shell crash and input/security defects above reproduced |

Full commands, scenarios and observations: [runtime report](review-261109-2251-host-browser-runtime.md). No full-app E2E success, full-suite pass, native Windows/physical Android/human signoff or soak claimed.

Rejected/stale claims: current fixture **does** pass `--web-dir` and does **not** use unsupported `--role`; reset worker is spawned before asynchronous teardown; normal native DELETE succeeds; API resize **does** set expected input epoch. Numeric resize continued streaming in this engine; unconditional resize-freeze hypothesis rejected. These are not new findings.

## Qualification evidence gaps
- Same-target spec opens chooser without binding a live target; permits fallback target, checks attached canvas/REST rather than post-interference frames/epoch/input. Performance/Android use invalid creation UUIDs; mobile context options are not propagated.
- Performance matrix compares authored constants, not measured matched10Hz polling CPU/RSS/latency/final-frame workloads. Reported tuning bandwidth/fidelity/systematic evaluation lacks raw measurements.
- Security suite mostly exercises predicates/mock handles; platform tests use orderly terminate/manual event sink/tombstone, not parent-death/restart/live PTY fault scenarios. Absence of hardware evidence is a blocker, not a fabricated failed run.
- Replace incidental/wiring assertions with real consumer-visible behavior checks; delete tautological tuning-grid tests rather than re-pin them.

## Improvement handoff
[Four-phase remediation plan](../261109-2251-host-browser-review-remediation/plan.md): backend authority/lifecycle → stream/input contracts → OS owner/portal lifecycle → integrated qualification/docs. Single integration owner; shared files require sequential publication. Plan authoring does not authorize implementation. Original phase10 rollout must remain blocked until severe defects and required receipts are closed.

## Research basis
- [Chrome remote-debugging profile requirement](https://developer.chrome.com/blog/remote-debugging-port).
- [Chromium149 DevTools HTTP handler](https://raw.githubusercontent.com/chromium/chromium/149.0.7827.55/content/browser/devtools/devtools_http_handler.cc).
- [Chromium149 screencast Page handler](https://raw.githubusercontent.com/chromium/chromium/149.0.7827.55/content/browser/devtools/protocol/page_handler.cc).
- [ImageBitmap.close](https://developer.mozilla.org/en-US/docs/Web/API/ImageBitmap/close).
- [Security research](evc-researcher-261109-2251-cdp-security.md), [stream research](evc-researcher-261109-2251-stream-lifecycle.md). Source-version mechanics inform checks; deployed engine behavior takes precedence over unsupported extrapolation.

## Unresolved questions
No product decision required to fix confirmed defects. Native Windows implementation/runner, physical Android and human receipts, crash/power-loss schedules and measured soak evidence remain missing release prerequisites. No approval, waiver, commit or push inferred.
