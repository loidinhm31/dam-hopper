# LSP Semantic Navigation — Plan Overview

[Canonical plan and validation ledger](./plan.md) · [Execution contract](./cmd-plan.md)

Revised in place 2026-10-23. Implementation **Pending, 0%**; effort **264h provisional**.

| Phase | Status / progress | Effort | Dependencies |
|---|---|---|---|
| [01 — Protocol/dependency/real-process spike](./phase-01-protocol-dependency-real-process-spike.md) | Pending / 0% | 24h | Reconciled policy + ADR |
| [02 — LSP framing/child owner](./phase-02-lsp-framing-and-child-owner.md) | Pending / 0% | 16h | 01 |
| [03 — Bundled provisioning/resource controls](./phase-03-pinned-tool-provisioning-and-resource-controls.md) | Pending / 0% | 28h | 02 |
| [04 — Session supervisor](./phase-04-semantic-session-supervisor.md) | Pending / 0% | 28h | 03 |
| [05 — Authenticated semantic gateway](./phase-05-authenticated-semantic-websocket-gateway.md) | Pending / 0% | 28h | 04 |
| [06 — Admin-only global toggle; bundled-only](./phase-06-global-hot-toggle-and-unsafe-override-gate.md) | Pending / 0% | 20h | 05 |
| [07 — Shared Monaco client/navigation](./phase-07-shared-monaco-semantic-client-and-navigation.md) | Pending / 0% | 32h | 01, 05, 06 |
| [08 — Lifecycle/recovery](./phase-08-lifecycle-invalidation-and-recovery.md) | Pending / 0% | 20h | 04, 05, 06, 07 |
| [09 — Security/process/performance qualification](./phase-09-security-real-process-tests-and-performance-qualification.md) | Pending / 0% | 40h | 03, 08 |
| [10 — Actual Linux server + web qualification](./phase-10-linux-web-and-desktop-remote-client-validation.md) | Pending / 0% | 16h | 09 |
| [11 — Documentation/release cleanup](./phase-11-documentation-roadmap-changelog-and-release-cleanup.md) | Pending / 0% | 12h | 09, 10 |

## Boundaries and gates

- Linux x64 server + web first; TS/JS Definition/Implementation only; runtime default OFF.
- Current Admin alone mutates global intent through every write path; ordinary authenticated User navigation allowed when enabled, no-auth global mutation denied.
- Trusted workspaces, no OS sandbox claim, bundled immutable engines only; no custom-command configuration.
- Phase 01 G0–G8 require real proof before downstream implementation: tuple/pins, protocol/sync/version/destination freshness, execution-hook suppression, process-tree cleanup, stable models/provider coexistence and actual web navigation.
- Initial finite bounds precede exposure; Phase 09 tunes measured final limits/threshold. Portable-only is runnable degraded mode, not hard RSS containment.
- Phase 10 requires actual built-web journeys, fresh captures and human acceptance. Native/Linux Tauri, Windows and Android stay deferred/non-blocking; native origin guard unchanged.
- No feature code, runtime qualification or support claim delivered by this plan revision. Review plan, then execute Phase 01.
