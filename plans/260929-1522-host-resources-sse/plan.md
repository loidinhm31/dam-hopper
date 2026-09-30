---
title: "Bounded authenticated host-resource SSE delivery"
description: "Replace eligible visible host-resource and metrics polling with one owner-bound authenticated stream while retaining REST and WS compatibility."
status: in-progress
priority: P2
effort: not-estimated
branch: main
tags: [backend, frontend, api, auth, performance]
created: 2026-09-29
---

# Host-resource SSE delivery plan

## Scope and decision
- **Plan status: IN PROGRESS (6/7 phases complete; 86%; updated 2026-10-01).** Phases 00–05 are closed; Phase 06 documentation and rollout remains pending. Phase 05 closes implementation and scoped qualification, not target-specific release qualification. Canonical implementation target: [host-resource SSE architecture](../../docs/architecture/host-resource-sse.md). One unchanged monitor, metadata-only new revisions on freshness config changes, shared bounded encoding, metadata-only status, 32 global/4 subject body leases, paired snapshot+metrics, owner+QueryClient stream, WS alerts/history and REST fallback. No host actions, settings, sampler rewrite, or extra protocol/collector.
- [Validation matrix C01–C43](./validation-matrix.md) records scenario/setup/assertions/evidence by phase. Unrun browser, release-PID, soak, host and deployed-proxy gates remain pending or blocked, never passed by inference. Development rules file `docs/development-rules.md` is absent in current tree; use [AGENTS.md](../../AGENTS.md), existing source conventions and frozen architecture instead.
- Prior [overload analysis](./research/host-overload-analysis.md), [local collector-only profile](./research/local-collector-profile.md), [transport research](./research/sse-transport-and-security.md), [client research](./research/client-lifecycle-and-cutover.md). Exploratory reports are subordinate to the architecture: bearer Fetch, two persisted reads/check, independent supervisor, both snapshot **and** metrics cutover, 15 s snapshot/5 s visible detail REST fallback, not EventSource/cookies or body-polled auth.

## Phases
| Phase | Deliverable | Status |
|---|---|---|
| [00 — baseline and contract fixtures](./phase-00-baseline-and-contract-fixtures.md) | Map existing behavior/fixtures; no tests against unimplemented route. | DONE (2026-09-30 16:41:39 +07:00) · 100% |
| [01 — shared snapshot publisher](./phase-01-shared-snapshot-publisher.md) | Atomic pair/epoch/revision/observation metadata, demand-driven bounded shared encoding. | DONE (2026-09-30) · 100% |
| [02 — authenticated SSE endpoint](./phase-02-authenticated-sse-endpoint.md) | Route/Origin/admission/auth/body lifetime/status/shutdown. | DONE (2026-09-30) · 100% |
| [03 — profile-owned stream client](./phase-03-profile-owned-stream-client.md) | Owner fetch, framed parser, freshness, retry/coordinator fences. | DONE (2026-09-30) · 100% |
| [04 — resource query and UI cutover](./phase-04-resource-query-and-ui-cutover.md) | QueryClient/root binding, dual-key arbitration, fleet/detail/WS/history. | DONE (2026-09-30) · 100% |
| [05 — overload, security and browser qualification](./phase-05-overload-security-and-browser-qualification.md) | Test-only live harness, DB-backed HTTP/security qualification and runner; target-specific browser/release/host/proxy gates remain distinct release criteria. | DONE (2026-10-01) · 100% scoped closeout; release qualification gates pending |
| [06 — documentation and rollout](./phase-06-documentation-and-rollout.md) | Evidence-conditioned docs and mixed-version artifact rollout/rollback; distinguish bounded HTTP drain from collector-limited whole-process exit. | Pending · 0% |

## Dependencies and handoffs
```text
00 baseline/fixtures
  ├─> 01 monitor pair + publisher ─> 02 authenticated SSE endpoint ─┐
  └─> 03 owner fetch + parser + coordinator ─────────────────────────┤
                                                                    v
                       04 dual-query/fleet/detail/WS cutover ─> 05 qualification ─> 06 docs/rollout
```
- 01 and 03 are parallel only after 00; share the **frozen architecture contract**, not source files. 02 needs 01. 04 needs 02+03. Each detailed phase partitions work into ≤5 paths per packet; one integrator owns shared-file merges and runs gates only after all units land. No mid-flight builds/tests/formatters/lint.
- Do not claim feature or qualification complete from the ten deep-scan samples (47.075 ms mean CPU, 7,505 B deep-only maximum, 518 PIDs, zero deadlines); baseline excludes legacy sampler/startup, encoding, auth, browser and proxy.

## Release decision and evidence
- Go only after phase-05 [matrix C01–C43](./validation-matrix.md) structural/auth/freshness/consumer/browser gates, named reference CPU/RSS/p95 and 30 min soak **with their own producers** plus deployment-specific proxy/native checks. Auth fixture `None` when test Mongo missing is blocked, never passed. Ten deep scans (47.075 ms mean collector CPU) cannot qualify whole monitor; optimized test-only counters/serialization/commit→visible belong to same real monitor/router PID, not a release-binary proof. Separate authenticated release server CPU/RSS run and phase-00 whole-monitor profiler must be attributed, missing evidence null+reason/blocked.
- **Integrated/release gates remain pending:** full Rust server suite (`cargo test --manifest-path server/Cargo.toml`), full UI unit/browser suites, web build/preview, `pnpm lint`, `pnpm check`, named reference/weak-host baseline, matched authenticated release-PID comparison, 30-minute N=32 soak, actual browser loopback, and deployed-proxy qualification. Phase 05 scoped suite passed **11/11 tests**, but the current C16/17 test only verifies persisted revocation and C19 only checks idle feature shutdown; neither proves live stream revocation or forced active HTTP/WS shutdown. The live harness smoke used N=0/1/32 with 1 s warmup, 2 s measurement and no soak; it observed 429 for 33rd/fifth probes, but the fifth was attempted at global saturation and is not independent per-subject evidence. It recorded zero serialization samples and reported browser loopback blocked; its summary status is not an aggregate qualification. Test-only auth targets, admission subjects, and cleanup details are SHA-256-digested; Main reran the focused suite 11/11 after these edits, and removed the pre-fix smoke artifact. This smoke does not establish release performance, browser, proxy or target-host behavior. Phase 04 scoped validation passed 136 UI unit tests, 4 browser tests, and UI TypeScript build; those do not replace integrated gates.
- Server-first rollout remains: old UI/new backend uses REST/WS; new UI/old backend falls back to REST; switching bars resource REST and WS cache writes; AUTH_BLOCKED persists until valid paired data/new generation; non-resource WS remains. On OS signal, revoke SSE and bound feature cleanup to ≤2 s; force accepted HTTP/WS I/O at +10 s, not total exit under blocked collection. Roll back UI/backend artifacts only. Phase 05 scoped closeout is DONE (2026-10-01); browser, release-PID, soak, reference/weak-host and deployed-proxy gates remain pending, with no release GO until applicable evidence passes.

## Validation Summary

**Plan approved:** 2026-09-29. **Phase 00:** DONE (2026-09-30; 100%). **Phase 01:** DONE (2026-09-30; 100%). **Phase 02:** DONE (2026-09-30; 100%; 9/9 integration and 6/6 unit tests; review 9.2/10). **Phase 03:** DONE (2026-09-30; 100%; 96/96 tests; review 9.8/10). **Phase 04:** DONE (2026-09-30; 100%; 136 unit + 4 browser tests; review 9.9/10). **Phase 05:** DONE (2026-10-01; 100% scoped closeout); qualification suite 11/11. Current C16/17 assertions only verify persisted revocation; C19 only checks idle shutdown. The live smoke measured N=0/1/32 for 1 s warmup + 2 s each, no soak, zero serialization samples; it observed 429 for 33rd/fifth probes, with the fifth confounded by global saturation, and browser loopback blocked. Test-only auth targets, admission subjects, and cleanup details are SHA-256-digested; the focused suite passed 11/11 after the redaction edits, and the pre-fix smoke artifact was removed. No release CPU/RSS, 30-minute soak, reference/weak-host or deployed-proxy signoff is claimed. See [Phase 05 plan](./phase-05-overload-security-and-browser-qualification.md) and [validation matrix](./validation-matrix.md). Overall: **6/7 phases complete (86%)**; Phase 06 remains pending.
### Confirmed Decisions
- **Shared collection/publication:** one existing monitor per server process, one atomic snapshot/metrics cache and one shared latest-only encoded frame per published revision. No per-subscriber collector or extra collector pool. Fleet/detail share a connection for the same owner and QueryClient; cross-tab pooling is not included.
- **Delivery limits:** **32 global / 4 per authenticated user**, confirmed after explaining these count response-body/network connections, not collectors. Separate connections retain independent authorization and bounded delivery state.
- **Shutdown:** one absolute **≤2-second feature-cleanup budget** from OS signal onset for publisher shutdown and tracked task cleanup; emission revoked immediately; forced HTTP I/O cutoff at signal+10 seconds includes accepted HTTP/WS connections. This does not promise termination of blocked collector syscalls or total process exit within 10 seconds.
- **First rollout:** **Linux web and the actual deployed proxy first**, with named reference and weak Linux hosts. Native remains unqualified until its capability/owner-bound fallback gates pass; native-specific evidence does not block an otherwise qualified Linux-web-only release. No native SSE support claim from web results.

### Action Items
- No architecture revision required by these answers. Confirmed decisions are reflected in phases 05–06 and the validation matrix; shared monitor/publisher, 32/4 limits and the 10-second cutoff already match implementation-phase contracts. Retain native scenarios for later native qualification, never mark them passed or delete them.
- Before release qualification, name reference/weak target hardware and deployed proxy configuration. Phase 06 remains pending; target-specific release gates remain pending even though Phase 05 scoped implementation/qualification is closed.

## Unresolved questions
- Identify reference + weak target hardware, live proxy/LB buffering/compression/idle behavior and native runtime authenticated-stream capability before **target-specific** release qualification. Their unknown state blocks that target, not architecture design.
