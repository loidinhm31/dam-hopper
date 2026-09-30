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
- **Implementation underway; 2/7 phases complete (29%).** Phase 00 baseline and contract fixtures and Phase 01 shared snapshot publisher are complete. Canonical implementation target: [host-resource SSE architecture](../../docs/architecture/host-resource-sse.md). One unchanged monitor, metadata-only **new revision** on changed freshness config (retains observation instants; no sampling/alerts), shared bounded encoder and metadata-only periodic status, 32 global/4 subject authenticated body leases, matched status/full snapshot+metrics, one current owner+QueryClient stream, WS alerts/history and REST fallback. No host actions, settings, sampler rewrite, extra protocol or new collector.
- [Validation matrix C01–C43](./validation-matrix.md): scenario/setup/assertions/evidence by phase, all pending. Development rules file `docs/development-rules.md` is absent in current tree; use [AGENTS.md](../../AGENTS.md), existing source conventions and frozen architecture instead.
- Prior [overload analysis](./research/host-overload-analysis.md), [local collector-only profile](./research/local-collector-profile.md), [transport research](./research/sse-transport-and-security.md), [client research](./research/client-lifecycle-and-cutover.md). Exploratory reports are subordinate to the architecture: bearer Fetch, two persisted reads/check, independent supervisor, both snapshot **and** metrics cutover, 15 s snapshot/5 s visible detail REST fallback, not EventSource/cookies or body-polled auth.

## Phases
| Phase | Deliverable | Status |
|---|---|---|
| [00 — baseline and contract fixtures](./phase-00-baseline-and-contract-fixtures.md) | Map existing behavior/fixtures; no tests against unimplemented route. | DONE (2026-09-30 16:41:39 +07:00) · 100% |
| [01 — shared snapshot publisher](./phase-01-shared-snapshot-publisher.md) | Atomic pair/epoch/revision/observation metadata, demand-driven bounded shared encoding. | DONE (2026-09-30) · 100% |
| [02 — authenticated SSE endpoint](./phase-02-authenticated-sse-endpoint.md) | Route/Origin/admission/auth/body lifetime/status/shutdown. | Pending · 0% |
| [03 — profile-owned stream client](./phase-03-profile-owned-stream-client.md) | Owner fetch, framed parser, freshness, retry/coordinator fences. | Pending · 0% |
| [04 — resource query and UI cutover](./phase-04-resource-query-and-ui-cutover.md) | QueryClient/root binding, dual-key arbitration, fleet/detail/WS/history. | Pending · 0% |
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
- **Post-implementation integration/release gates remain pending:** `cargo test --manifest-path server/Cargo.toml` (the Phase 00 baseline is not the final integrated run); `pnpm --filter @dam-hopper/ui build` (tsc only); `pnpm --filter @dam-hopper/web build` and `pnpm --filter @dam-hopper/web preview --host 127.0.0.1 --port 4173` for actual app; UI tests/browser; `pnpm lint`; `pnpm check` (native build), plus exact [phase-05 optimized harness/release and browser recipe](./phase-05-overload-security-and-browser-qualification.md). Phase 00's targeted baseline and server suite are recorded in its plan; each remaining stage stays pending without observed command, runId, source, units, p95 population and browser screenshot.
- Server first then qualified client. Old UI/new server remains REST/WS; new UI/old server 404/405 falls back REST; switching gate bars **both** resource REST and WS cache mutation; AUTH_BLOCKED latches until valid authenticated pair/new generation, non-resource WS bridge intact. OS shutdown revokes before drain, forces accepted HTTP/WS I/O cancellation by +10 s via narrow listener wrapper; that bounds HTTP drain, **not total process exit** under blocked collector syscall. Rollback prior UI/backend **artifacts**, preserve REST/WS/sampler. Docs become “current” only on applicable passing gates. Phase 00 adds baseline fixtures and profiling tools only; no SSE application implementation is delivered.

## Validation Summary

**Plan approved:** 2026-09-29. **Phase 00 implementation:** DONE (2026-09-30; 100%). **Phase 01 shared snapshot publisher:** DONE (2026-09-30; 100%); targeted monitor and publisher tests passed 19/19, code review scored 9.0/10 with no critical/high findings and four non-blocking medium recommendations. See the [Phase 01 plan](./phase-01-shared-snapshot-publisher.md) and [review](../reports/code-review-260930-1838-phase-01-shared-snapshot-publisher.md). **Overall:** 2/7 phases complete (29%); Phases 02–06 and release qualification remain pending.
### Confirmed Decisions
- **Shared collection/publication:** one existing monitor per server process, one atomic snapshot/metrics cache and one shared latest-only encoded frame per published revision. No per-subscriber collector or extra collector pool. Fleet/detail share a connection for the same owner and QueryClient; cross-tab pooling is not included.
- **Delivery limits:** **32 global / 4 per authenticated user**, confirmed after explaining these count response-body/network connections, not collectors. Separate connections retain independent authorization and bounded delivery state.
- **Shutdown:** **10-second forced HTTP I/O cutoff** from the OS signal, including accepted HTTP/WS connections; emission revoked immediately and feature-task cleanup bounded to 2 seconds. Preserve later PTY cleanup. This does not promise termination of blocked collector syscalls or total process exit within 10 seconds.
- **First rollout:** **Linux web and the actual deployed proxy first**, with named reference and weak Linux hosts. Native remains unqualified until its capability/owner-bound fallback gates pass; native-specific evidence does not block an otherwise qualified Linux-web-only release. No native SSE support claim from web results.

### Action Items
- No architecture revision required by these answers. Confirmed decisions are reflected in phases 05–06 and the validation matrix; shared monitor/publisher, 32/4 limits and the 10-second cutoff already match implementation-phase contracts. Retain native scenarios for later native qualification, never mark them passed or delete them.
- Before release qualification, name the reference/weak machines and deployed proxy configuration. All remaining implementation phases are pending.

## Unresolved questions
- Identify reference + weak target hardware, live proxy/LB buffering/compression/idle behavior and native runtime authenticated-stream capability before **target-specific** release qualification. Their unknown state blocks that target, not architecture design.
