# DamHopper Project Roadmap

**Updated:** 2026-10-04. This page tracks current delivery and qualification state rather than preserving expired implementation plans. Archived plan notices are in [CHANGELOG archive](./CHANGELOG-archive.md).

## Recently delivered

| Area | Current status |
| --- | --- |
| Native Evcrate Advisor | **Complete.** The Rust service, authenticated admin-only API, shared React panel, per-server default-off setting, routing editor/model discovery, Workspace integration, and plugin-platform retirement are delivered. See [Native Advisor architecture](./architecture/native-advisor.md). |
| Git commit rewrite and squash | **Complete.** Commit message rewrite and contiguous-chain squash use captured branch/HEAD CAS; publication remains a separate exact-OID leased operation. See [Git history architecture](./architecture/git-history-search.md). |
| Cognito Mode | **Complete.** Configurable shortcut/style, ephemeral overlay, capture-phase input isolation, and browser qualification are delivered. It remains an in-app visual mask only; native platform behavior is not claimed beyond recorded evidence. |
| Multi-profile workbench | **Delivered.** Web/Linux shared behavior is qualified; profile and generation ownership remains a core invariant. Windows native S13 is still a separate platform gate. |
| Agent Status | **Delivered.** OMP and native Codex/Claude integration are Linux-qualified for the documented versions; other provider versions and server platforms remain unqualified. See [Agent Status architecture](./architecture/agent-status.md). |
| Idle suspend and diagnostics | **Implemented.** Runtime and helper safety contracts are documented; real-host automatic-suspend canary/rollout remains an operations gate. |

## Open qualification and planning gates

- **Frontend test restructuring:** a plan is pending, but plan-only; no Playwright application-E2E restructuring is implemented or authorized by that plan. Existing Vitest/component coverage remains current.
- **Host-resource SSE:** implementation phases are documented, but deployed-proxy identification/verification, target-host CPU/RSS and soak evidence, live-browser qualification, and native C42 remain pending or blocked. Do not treat implementation completion as release qualification. See [SSE architecture](./architecture/host-resource-sse.md).
- **Windows native workbench:** Windows S13 runtime qualification is separate from the completed web/Linux shared workbench evidence.
- **Browser child WebView:** Windows v1 is documented as supported; Linux child/relay runtime behavior remains unverified. See [Native Browser Debug](./native-browser-debug-support.md).
- **Agent provider/platform coverage:** existing Linux qualification applies only to the documented OMP, Codex, and Claude versions; no broader provider-version or non-Linux runtime qualification is implied.

These are qualification boundaries, not permission to implement unapproved plans. Check the owning feature contract before making changes.

## Retired scope

The DamHopper trusted plugin platform, plugin SDK/runner, plugin APIs, plugin host bridge, and plugin release assets are retired. Native Advisor replaced the platform's former Advisor integration. `Agent Store` distribution remains a separate product area. Do not reactivate plugin plans or archived requirements as current work.

## Current references

- [Product requirements](./project-overview-pdr.md)
- [System architecture](./system-architecture.md)
- [Codebase summary](./codebase-summary.md)
- [Code standards](./code-standards.md)
- [Testing guide](./testing.md)
- [Current changelog](./CHANGELOG.md) and [archive](./CHANGELOG-archive.md)
