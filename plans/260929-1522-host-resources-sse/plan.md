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
- **Plan status: IN PROGRESS (5/7 phases complete; 71%; updated 2026-09-30).** Phases 00 baseline/fixtures, 01 shared snapshot publisher, 02 authenticated SSE endpoint, 03 profile-owned stream client, and 04 resource query/UI cutover are complete. Canonical implementation target: [host-resource SSE architecture](../../docs/architecture/host-resource-sse.md). One unchanged monitor, metadata-only **new revision** on changed freshness config (retains observation instants; no sampling/alerts), shared bounded encoder and metadata-only periodic status, 32 global/4 subject authenticated body leases, matched status/full snapshot+metrics, one current owner+QueryClient stream, WS alerts/history and REST fallback. No host actions, settings, sampler rewrite, extra protocol or new collector.
- [Validation matrix C01–C43](./validation-matrix.md): scenario/setup/assertions/evidence by phase, all pending. Development rules file `docs/development-rules.md` is absent in current tree; use [AGENTS.md](../../AGENTS.md), existing source conventions and frozen architecture instead.
- Prior [overload analysis](./research/host-overload-analysis.md), [local collector-only profile](./research/local-collector-profile.md), [transport research](./research/sse-transport-and-security.md), [client research](./research/client-lifecycle-and-cutover.md). Exploratory reports are subordinate to the architecture: bearer Fetch, two persisted reads/check, independent supervisor, both snapshot **and** metrics cutover, 15 s snapshot/5 s visible detail REST fallback, not EventSource/cookies or body-polled auth.

## Phases
| Phase | Deliverable | Status |
|---|---|---|
| [00 — baseline and contract fixtures](./phase-00-baseline-and-contract-fixtures.md) | Map existing behavior/fixtures; no tests against unimplemented route. | DONE (2026-09-30 16:41:39 +07:00) · 100% |
| [01 — shared snapshot publisher](./phase-01-shared-snapshot-publisher.md) | Atomic pair/epoch/revision/observation metadata, demand-driven bounded shared encoding. | DONE (2026-09-30) · 100% |
| [02 — authenticated SSE endpoint](./phase-02-authenticated-sse-endpoint.md) | Route/Origin/admission/auth/body lifetime/status/shutdown. | DONE (2026-09-30) · 100% |
| [03 — profile-owned stream client](./phase-03-profile-owned-stream-client.md) | Owner fetch, framed parser, freshness, retry/coordinator fences. | DONE (2026-09-30) · 100% |
| [04 — resource query and UI cutover](./phase-04-resource-query-and-ui-cutover.md) | QueryClient/root binding, dual-key arbitration, fleet/detail/WS/history. | DONE (2026-09-30) · 100% |
| [05 — overload, security and browser qualification](./phase-05-overload-security-and-browser-qualification.md) | Same-process optimized ignored `#[cfg(test)]` live harness and redacted JSONL counters; separate authenticated release PID CPU/RSS, 30 min soak, visible Chromium app, reference/weak/proxy/native gates. | Pending · 0% |
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
- **Final integrated/release gates remain pending:** the full Rust server suite (`cargo test --manifest-path server/Cargo.toml`), full UI unit/browser suites, web app build/preview (`pnpm --filter @dam-hopper/web build` and `pnpm --filter @dam-hopper/web preview --host 127.0.0.1 --port 4173`), `pnpm lint`, `pnpm check` (native build), and the Phase 05 optimized harness/release/browser recipe. Phase 04 scoped validation passed 136 UI unit tests across 8 files, 4 browser tests, and `pnpm --filter @dam-hopper/ui build` (TypeScript only); these do not replace the final integrated/release gates. Phase 00 targeted server results and Phase 03 scoped results are recorded in their plans; the remaining integrated stages stay pending until their commands and qualification evidence are recorded.
- Server first then qualified client. Old UI/new server remains REST/WS; new UI/old server 404/405 falls back REST; switching gate bars **both** resource REST and WS cache mutation; AUTH_BLOCKED latches until valid authenticated pair/new generation, non-resource WS bridge intact. At OS signal, revoke SSE emission immediately and bound publisher/feature-task cleanup by one absolute ≤2 s budget from signal onset; force accepted HTTP/WS I/O at +10 s via narrow listener wrapper. This bounds HTTP drain, **not** total process exit under blocked collector syscall or later cleanup. Rollback prior UI/backend **artifacts**, preserve REST/WS/sampler. Docs become “current” only on applicable passing gates. Phase 00 delivered baseline fixtures and profiling tools; Phase 02 delivers the authenticated SSE endpoint; Phase 04 delivers owner-fenced resource query/UI cutover; Phase 05 qualification and final release gates remain pending.

## Validation Summary

**Plan approved:** 2026-09-29. **Phase 00 baseline:** DONE (2026-09-30; 100%). **Phase 01 shared snapshot publisher:** DONE (2026-09-30; 100%). **Phase 02 authenticated SSE endpoint:** DONE (2026-09-30; 100%); scoped validation passed **9/9 integration tests** and **6/6 unit tests**; review scored **9.2/10** ([review report](../reports/code-review-260930-2020-phase-02-authenticated-sse-endpoint.md)). **Phase 03 profile-owned stream client:** DONE (2026-09-30; 100%); scoped validation passed **96/96 tests across 6 files**, UI build passed, and review scored **9.8/10** ([review report](../reports/code-review-260930-2148-phase-03-cycle2.md)). **Phase 04 resource query and UI cutover:** DONE (2026-09-30; 100%); scoped validation passed **136 unit tests across 8 files** and **4 browser tests (140/140 total)**, UI build passed; Cycle 2 review scored **9.9/10** ([review report](../reports/code-review-260930-2321-phase-04-owner-fenced-resource-query-ui-cutover-cycle-2.md); [tester report](../reports/tester-260930-2318-phase-04-owner-fenced-resource-query-ui-cutover-cycle-2.md)). Overall: **5/7 phases complete (71%)**; Phases 05–06 and release qualification remain pending.
### Confirmed Decisions
- **Shared collection/publication:** one existing monitor per server process, one atomic snapshot/metrics cache and one shared latest-only encoded frame per published revision. No per-subscriber collector or extra collector pool. Fleet/detail share a connection for the same owner and QueryClient; cross-tab pooling is not included.
- **Delivery limits:** **32 global / 4 per authenticated user**, confirmed after explaining these count response-body/network connections, not collectors. Separate connections retain independent authorization and bounded delivery state.
- **Shutdown:** one absolute **≤2-second feature-cleanup budget** from OS signal onset for publisher shutdown and tracked task cleanup; emission revoked immediately; forced HTTP I/O cutoff at signal+10 seconds includes accepted HTTP/WS connections. This does not promise termination of blocked collector syscalls or total process exit within 10 seconds.
- **First rollout:** **Linux web and the actual deployed proxy first**, with named reference and weak Linux hosts. Native remains unqualified until its capability/owner-bound fallback gates pass; native-specific evidence does not block an otherwise qualified Linux-web-only release. No native SSE support claim from web results.

### Action Items
- No architecture revision required by these answers. Confirmed decisions are reflected in phases 05–06 and the validation matrix; shared monitor/publisher, 32/4 limits and the 10-second cutoff already match implementation-phase contracts. Retain native scenarios for later native qualification, never mark them passed or delete them.
- Before release qualification, name the reference/weak machines and deployed proxy configuration. Phases 05–06 remain pending.

## Unresolved questions
- Identify reference + weak target hardware, live proxy/LB buffering/compression/idle behavior and native runtime authenticated-stream capability before **target-specific** release qualification. Their unknown state blocks that target, not architecture design.
