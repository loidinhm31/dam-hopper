# LSP Semantic Navigation — Execution Contract

Authority: [plan.md](./plan.md#validation-summary). Short overview: [evc-cmd-plan.md](./evc-cmd-plan.md).

Plan revision applied 2026-10-23. Implementation remains **Pending, 0%**.

| Phase | Status / progress | Effort | Direct dependencies |
|---|---|---|---|
| [01 — Protocol/dependency/real-process spike](./phase-01-protocol-dependency-real-process-spike.md) | Pending / 0% | 24h | Reconciled policy + partially superseded ADR |
| [02 — LSP framing/child owner](./phase-02-lsp-framing-and-child-owner.md) | Pending / 0% | 16h | 01 |
| [03 — Bundled provisioning/resources](./phase-03-pinned-tool-provisioning-and-resource-controls.md) | Pending / 0% | 28h | 02 |
| [04 — Session supervisor](./phase-04-semantic-session-supervisor.md) | Pending / 0% | 28h | 03 |
| [05 — Authenticated semantic gateway](./phase-05-authenticated-semantic-websocket-gateway.md) | Pending / 0% | 28h | 04 |
| [06 — Admin-only global toggle; bundled-only](./phase-06-global-hot-toggle-and-unsafe-override-gate.md) | Pending / 0% | 20h | 05 |
| [07 — Shared Monaco client/navigation](./phase-07-shared-monaco-semantic-client-and-navigation.md) | Pending / 0% | 32h | 01, 05, 06 |
| [08 — Lifecycle/recovery](./phase-08-lifecycle-invalidation-and-recovery.md) | Pending / 0% | 20h | 04, 05, 06, 07 |
| [09 — Security/process/performance qualification](./phase-09-security-real-process-tests-and-performance-qualification.md) | Pending / 0% | 40h | 03, 08 |
| [10 — Actual Linux server + web qualification](./phase-10-linux-web-and-desktop-remote-client-validation.md) | Pending / 0% | 16h | 09 |
| [11 — Documentation/release cleanup](./phase-11-documentation-roadmap-changelog-and-release-cleanup.md) | Pending / 0% | 12h | 09, 10 |

**264h provisional**, replacing historical 198h. Failed spike/redesign requires explicit reassessment; no feasibility or release support is yet proven.

## Execution gates

- Release scope: Linux x64 server + actual built web, TS/JS Definition/Implementation. Default OFF; current Admin alone mutates global intent across dedicated/import/raw/shared write paths. User navigation is allowed when enabled; no-auth mutation denied.
- Trusted workspaces only. Child retains server-account filesystem authority; result/URI containment is not an OS sandbox. Bundled immutable engines only; no custom executable/args/env/host opt-in/import/UI configuration.
- Phase 01 G0–G8 are explicit STOP/GO: finite pre-execution bounds, exact tuple/layout/pins, transport/lazy bundle, child config, single-kind adaptive sync, version/destination freshness, project execution-hook suppression, tree ownership and actual-web/provider/model coexistence. No Phase 02 until all GO.
- Phase 03 enforces passed initial bounds before admission. Phase 09 tunes final measured limits/threshold and freezes budgets before final qualification. Missing optional hard controls allows warned runnable portable-only, not hard RSS claims.
- Startup/ON integrity checks create zero children; first authorized lazy session owns protocol validation. OFF cleanup/cancellation does not wait for socket output. Live auth5s polling +2s store budget is not a5s teardown guarantee.
- Phase 10 needs actual authenticated built-web journeys, fresh non-sensitive captures and human acceptance. Native including Linux Tauri, Windows and Android remain unqualified/deferred/non-blocking; native same-origin policy unchanged.
- Engine updates ship through qualified bundled server releases, normally restarting the daemon; normal navigation and OFF/ON do not. Later included Java/Rust engines need separate integration/security/resource qualification.

Historical Phase 06/10 filenames are retained for links, not their superseded policy. [ADR supersession register](../reports/brainstorm-260901-1000-lsp-server-integration.md#decision-status).

