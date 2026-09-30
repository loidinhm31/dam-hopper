# Phase 06 — Documentation, rollout and rollback

## Context links
- [Canonical plan](./plan.md) · [validation matrix](./validation-matrix.md) · [phase 05 gate](./phase-05-overload-security-and-browser-qualification.md) · [frozen design](../../docs/architecture/host-resource-sse.md).
- [Current API docs](../../docs/api-reference.md) · [current system architecture](../../docs/system-architecture.md) · [current UI guide](../../docs/frontend-components.md) · [current configuration](../../docs/configuration/server-configuration.md).

## Overview
- Date: 2026-09-29. Priority: P2. Implementation: **pending (0%)**. Review: **pending**. Requires full phase-05 structural/security/performance/browser release qualification and 00–04 implementation; documentation describes reality only after evidence, not while contract is still proposed.
- Ship a reversible **delivery-only** change: existing cached REST snapshot/metrics and WS alerts/history stay intact; no new runtime setting, endpoint for mutation, monitor cadence change, DB migration, settings UI or protocol alias.
- **User-confirmed rollout scope (2026-09-29):** [validation decisions](./plan.md#validation-summary) select **Linux web and the actual deployed proxy first**, with reference and weak Linux hosts qualified. Keep one shared monitor/publisher, **32 global / 4 per-user delivery connections**, and the **10-second HTTP I/O cutoff**; no claim that this bounds blocked collector syscalls or total process exit.

## Key Insights
- `docs/system-architecture.md` currently says “Proposed host-resource SSE delivery (not implemented)” and REST remains authoritative; `docs/api-reference.md` likewise documents REST as authoritative after reconnect. Do not convert these to shipped/current before gates. Frozen `docs/architecture/host-resource-sse.md` is authoritative design, with two unanswered *deployment* qualifications (proxy and native), not permission to invent a toggle.
- Existing docs mention a 100 ms process budget in `docs/system-architecture.md`; actual default process deadline is 150 ms (clamped config), and the 500 ms snapshot deadline is a wait, not a blocking syscall/CPU bound. Correct the *documentation* discrepancy; leave sampler untouched.
- New server/old client keeps REST/WS. New client/old server sees `/events` 404/405 and becomes REST_ONLY for that connection generation; an older browser may keep long-lived old JS through a backend upgrade. Qualification includes mixed-version active sessions and existing proxy behaviors.

## Requirements
1. Public API docs state GET `/api/system/resources/v1/events` **authenticated bearer Fetch** (no cookie/EventSource/query token), payload/control exact fields and limits, status-before-data and age semantics, error/429/503 codes, 15 s controls, no `id:`/replay, proxy/CORS policy; REST snapshot 15 s and visible detail metrics 5 s on fallback, no resource REST while LIVE/hidden or auth blocked; visible alert history 30 s/coalesced WS invalidation.
2. UI docs tell end users what changes on the actual fleet/detail surface (last-known offline/hidden, per-section stale despite live socket, unsupported/old server REST fallback, MFA-required vs auth-unavailable, WS notifications/history without SSE cache rollback). Force Machine to Sleep/idle-suspend remains unchanged and independently authorized; no extra UI setting.
3. Operations explain server-first then client roll forward, deploy-specific proxy gate (disable buffering/compression; HTTP/1.1 + HTTP/2; idle-read timeout ≥45 s), per-process 32/subject 4, startup/collector stalls vs stream delivery, N=32 successful auth supervisor ≈12.8 persisted DB reads/s **modeled**, capability-checked native fallback. Report reference/weak-host results only with phase-05 **same-run optimized test-harness** counts/serialization and independent release-binary CPU/RSS comparison explicitly attributed. Whole-monitor default-cadence ≤2% target requires separate phase-00 real monitor profiler; ten collector-only deep scans never qualify it. Unavailable metric producer => null+reason/blocked, never zero or green.
4. Rollback uses **artifact/version replacement**, not phantom config flag: replace new UI bundle with prior REST/WS UI, let active streams close/drain, keep compatible new server; or after clients roll back, replace backend with prior server (new JS clients already loaded fall back on 404/405). Keep both REST endpoints, WS non-resource bridge/history/unread and sampler config in either direction. OS signal immediately revokes SSE emission, feature tasks ≤2 s and force-cancels accepted HTTP/WS I/O by +10 s; this bounds **HTTP drain, not total process exit** if collector blocking syscall stalls. Later PTY cleanup remains ordered. On auth/security violation stop affected deployment, roll back client distribution and/or backend artifact; credentials/host-action settings unchanged.
5. Before marking Linux-web delivery “current”, phase-05 actual browser/HTTP/DB/reference/weak-host/deployed-proxy gates must pass. Native capability/runtime evidence is a **later native-specific release gate**, not a blocker for an otherwise qualified Linux-web-only release. Keep C42 pending/blocked and native support explicitly unqualified until its own tests pass; do not delete or mark native scenarios passed. Shared-code regressions, unsupported-transport fallback behavior and the existing native build check remain required. No false release notes, tests or dates.

## Architecture
```text
new backend first: REST + WS unchanged; new SSE route additive
             ↓ old clients still REST/WS
new clients: supported owner-bound bearer Fetch + validated full pair -> LIVE
             ↓ 404/405/unsupported/error/hidden/auth-blocked rules per contract
fallback: existing REST snapshot + metrics (only where authorized/visible) + WS history
rollback client artifact -> REST/WS; rollback backend after clients -> old REST/WS
```
No shared stream across server processes; 32 is per-process. Proxy buffering and multi-origin HTTP/1.1 connection contention are real deployment-specific gates, not a reason for more server collectors or higher limits. Native capability must be observed per packaged target; unsupported means REST with exact owner, no browser-global shim.

## Related code files
| Action | Repo-relative path | Scope |
|---|---|---|
| ExistingModify **after gate** | `docs/architecture/host-resource-sse.md`; `docs/system-architecture.md`; `docs/api-reference.md` | Reconcile design status/current reality and actual API/security/monitor budget, without changing frozen design decisions. |
| ExistingModify **after gate** | `docs/frontend-components.md`; `docs/user-guide-multi-server-profiles.md`; `docs/configuration/server-configuration.md` | Actual owner lifecycle, user-visible fallback and server-owned cadence/proxy ops; explicitly no new SSE setting. |
| ExistingModify **after gate** | `docs/CHANGELOG.md`; `docs/project-roadmap.md`; `docs/README.md` | Feature delivery and release evidence links; preserve historical completed entries unrelated to SSE. |
| ReadOnly | `docs/phase-06-preferences-settings-usage-and-host.md`; `docs/linux-systemd.md`; `docs/ws-protocol-guide.md`; `package.json` | Check for contradictory current instructions, release/service configuration and gate scripts; edit only if verified SSE contradiction, as a separate ≤5-path packet. |
| ReadOnly | `plans/260929-1522-host-resources-sse/research/local-collector-profile.md`; `plans/260929-1522-host-resources-sse/research/host-overload-analysis.md` | Collector-only evidence and non-normative model; do not rewrite history. |

## Implementation Steps
1. **Q06-A — API/design docs owner (3 paths):** `docs/architecture/host-resource-sse.md`, `docs/system-architecture.md`, `docs/api-reference.md`. Inputs: signed-off phase-05 matrix and observed 01–04 contracts. Switch proposed→implemented **only for qualified target**; clarify changed clamped freshness config is metadata-only new immutable revision retaining actual observation times, no sampling/alert, unchanged config no revision; no per-reader fullpair clone for status. Document bearer Fetch/Origin/auth 503 `AUTH_UNAVAILABLE`, frame-too-large vs generic 503, 32/4, complete controls/data and retry semantics. Differentiate feature ≤2 s predrain, HTTP accepted connection force I/O ≤10 s from OS signal (including WS) and blocking-collector process-exit limitation; current 100 ms prose corrected to 150 ms actual default. Do not imply forced TCP bytes recalled or listener addition changes public wire.
2. **Q06-B — client/operator docs owner (3 paths):** `docs/frontend-components.md`, `docs/user-guide-multi-server-profiles.md`, `docs/configuration/server-configuration.md`. Inputs: actual qualified browser/native/proxy outcomes. Describe seven modes plus *local* `switching` gate (no resource REST/WS mutation between synchronous fence and LIVE), fresh equal-revision reconnect paired baseline, AUTH_BLOCKED from STARTING cancels snapshot+metrics and remains through retry/hidden until valid authenticated pair or new generation; visible snapshot/metrics matching revision+TTL, 15 s/5 s fallback, history/unread and **non-resource WS bridge** preserved across QC changes. Operators: proxy ≥45 s idle, 15 s controls, no extra SSE config, independent collector-stall vs forced HTTP drain diagnoses, no secret telemetry. Document only existing server tuning, 150 ms cooperative process/500 ms wait.
3. **Q06-C — release record owner (3 paths):** `docs/CHANGELOG.md`, `docs/project-roadmap.md`, `docs/README.md`. Inputs: Q06-A/B integrated, actual Q05 target-specific pass/fail/blocked. Date feature entry with redacted runId link, named host/proxy/native scope, optimized-harness-only serialization/render evidence vs actual release PID CPU/RSS and test-hook overhead, whole-monitor baseline separate. Roadmap completed only on qualified target; no ten-scan extrapolation, unrun suite or invented signoff. Historical entries untouched.
4. **Q06-D — single docs/release integrator (no concurrent shared-file edits):** Reconcile public docs and [C01–C43](./validation-matrix.md) evidence. Use Q06-B-owned `docs/configuration/server-configuration.md` for runbook; old client/new backend REST+WS; new client/old backend REST on 404/405; live tab backend replacement and native unsupported. Verify rollbacks via prior UI then prior backend **artifacts**, both REST endpoints and all non-resource WS delivery; no host action semantics changed. Check status/age in actual browser, HTTP forced-drain vs collector total-process caveat and no unmeasured performance pass.

**Copy-ready worker instruction:** “Edit only assigned documentation paths, after phase-05 applicable gates pass; skip builds, tests, lint and formatters mid-flight. One integrator owns conflicting files and runs release checks after handoff. No implementation edits, credentials, invented feature flag/setting or unmeasured performance claim.”

## Todo list
- [ ] Q06-A API and architecture status reconciled with real implementation/gates.
- [ ] Q06-B Client guide and proxy/native operations updated for qualified targets.
- [ ] Q06-C Release notes/roadmap/README only after actual gate success.
- [ ] Q06-D Version-matrix rollout/rollback smoke, contradiction review and final status/evidence.

## Success Criteria
- **Future integrator commands, not run for this plan:** `cargo test --manifest-path server/Cargo.toml`; `pnpm --filter @dam-hopper/ui build` (tsc only); `pnpm --filter @dam-hopper/ui test`; `pnpm --filter @dam-hopper/ui test:browser`; `pnpm --filter @dam-hopper/web build`; `pnpm --filter @dam-hopper/web preview --host 127.0.0.1 --port 4173` (actual app, separate terminal); `pnpm lint`; `pnpm check` (native build). Also [phase-05's concrete optimized authenticated harness/release runner, 30 min soak, actual Chromium, deployed proxy/native gates](./phase-05-overload-security-and-browser-qualification.md); suites alone cannot pass them.
- Observe old client/new backend and new client/old backend on actual HTTP and UI; REST+WS/non-resource bridge preserved, 404/405 REST_ONLY and 15 s/5 s fallback, paired LIVE disables both REST pollers, WS history/notifications intact. Revert prior client/backend artifacts without SSE setting or REST/WS removal; OS-signal predrain/forced HTTP ≤10 s and collector syscall caveat separate; host-action permissions unchanged.
- Links resolve, current/proposed wording reflects **only qualified** state; API matches observed payload/errors; per-metric producer, units, population/null+reason and host/build/test-vs-release attribution correct. Named reference/weak/proxy/native limits disclosed; no test run claimed without evidence.

## Risk Assessment
- Premature “shipped” doc/roadmap while auth DB test skipped or proxy buffers streams misleads operators: require matrix evidence with per-target release gate. Edge proxy/browser origin caps and native streaming support cannot be assumed from a local test.
- Deploying clients before server increases 404/405 fallback and retry attempts; deploy server first and preserve REST to keep mixed versions benign. Rolling backend downgrade ends open SSE; client treats EOF/404 as bounded fallback, not auth failure. Removing REST or changing sampler during revert breaks compatibility: explicitly forbidden.

## Security Considerations
- Bearer Fetch/Origin control remains the only SSE browser credential path; docs must not suggest query tokens, cookies, native EventSource, or relaxed CORS. Never log token, session or raw host-resource payload during rollout. Client terminal errors must not erase unrelated WS credentials; `AUTH_UNAVAILABLE` blocks resource REST. Rollback does not disable authentication/MFA or alter privileged force-sleep authorization.

## Next steps
- After documented target-specific go, deploy backend then client gradually; monitor admission rejections, auth DB and CPU/RSS/stream status in existing operational observation systems where available (no new telemetry feature). Revert client then backend on security, overload or freshness regression, retain redacted evidence and reopen phase-05 gate before retry.

## Unresolved questions
- Confirm each production proxy/LB/CDN route's buffering/compression/idle policy, actual reference + weak Linux targets and packaged native streaming capabilities as explicit target-specific gates; no protocol change or config toggle is implied.
