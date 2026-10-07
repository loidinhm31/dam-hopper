# DamHopper Project Roadmap

**Updated:** 2026-10-05. This page tracks current delivery and qualification state. Historical delivery notices are in the [changelog](./CHANGELOG.md).

## Recently delivered

| Area | Current status |
| --- | --- |
| SQLite authentication lite mode | **Complete.** Environment-selected SQLite authentication (`DAM_HOPPER_LITE_MODE=true`, `DAM_HOPPER_AUTH_SQLITE_PATH`) with MongoDB remaining the default and no automatic backend fallback. Includes STRICT tables, WAL durability (one server process per local auth file, no network filesystems), mandatory production 32-byte `DAM_HOPPER_MFA_KEY_FILE`, disabled-by-default registration (`POST /api/auth/register` creates disabled `user` accounts with `auth_version = 0`; `401 ACCOUNT_DISABLED` until local operator approval and explicit `admin` promotion, with no automatic first-user admin rights), canonical local `sqlite3` operator runbooks, and application E2E qualification (`e2e/sqlite-auth-lite-mode/sqlite-auth-lite-mode.spec.ts` with `authBackend: "sqlite"` and no MongoDB container). See [Server Environment & Authentication](./configuration/server-environment-auth.md#operator-account-approval-and-role-promotion-runbook), [Authentication API](./api/authentication.md), and [Authentication State & Cryptography](./architecture/authentication-state-and-cryptography.md). |
| Native Evcrate Advisor | **Complete.** The Rust service, authenticated admin-only API, shared React panel, per-server default-off setting, routing editor/model discovery, Workspace integration, and plugin-platform retirement are delivered. See [Native Advisor architecture](./architecture/native-advisor.md). |
| Git commit rewrite and squash | **Complete.** Commit message rewrite and contiguous-chain squash use captured branch/HEAD CAS; publication remains a separate exact-OID leased operation. Extended in PR #47 to support inactive local branches and leased publication via `target_branch`. See [Git history architecture](./architecture/git-history-search.md). |
| Quick tunnel isolation | **Complete (PR #46).** Ephemeral Cloudflared quick tunnels isolate host configuration (`--config ""`), rewrite dev server host headers (`--http-host-header localhost`), and enforce a single-authority supervisor exit lifecycle. |
| Frontend test restructuring & E2E journeys | **Complete (PR #44).** Restructured into 4-tier runner architecture: `cargo test` backend tests, Vitest unit tests, Vitest browser component tests, and `@playwright/test` application E2E user journeys with container fixtures, deterministic auth seeding, visual capture policy (`capture-policy.ts`), and CI quality gate. See [Testing guide](./testing.md). |
| Cognito Mode | **Complete.** Configurable shortcut/style, ephemeral overlay, input isolation through event capture, and browser qualification are delivered. It remains an in-app visual mask only; native platform behavior is not claimed beyond recorded evidence. |
| Multi-profile workbench | **Delivered.** Web/Linux shared behavior is qualified; profile and generation ownership remains a core invariant. Windows native S13 is still a separate platform gate. |
| Agent Status | **Delivered.** OMP and native Codex/Claude integration are Linux-qualified for the documented versions; other provider versions and server platforms remain unqualified. See [Agent Status architecture](./architecture/agent-status.md). |
| Idle suspend and diagnostics | **Implemented.** Runtime and helper safety contracts are documented; real-host automatic-suspend canary/rollout remains an operations gate. |

## Open qualification gates

- **Application E2E workflow gaps (P1/P2):** While the 4-tier testing runner architecture, container runtime, and three foundational journeys are delivered, documented workflow gaps remain open for application-level Playwright coverage (see [Testing guide](./testing.md#ranked-integrated-workflow-gaps)): P1 docked/split/mobile layouts, multi-profile/project switching, persistent settings & full policy editing, terminal & workflow continuity; P2 file editing & Git mutations, media sessions & token revocation, and native desktop host & WebView2.
- **Host-resource SSE:** the implementation is documented, but deployed-proxy identification/verification, target-host CPU/RSS and soak evidence, live-browser qualification, and native C42 remain pending or blocked. Do not treat implementation completion as release qualification. See [SSE architecture](./architecture/host-resource-sse.md).
- **Windows native workbench:** Windows S13 runtime qualification is separate from the completed web/Linux shared workbench evidence.
- **Browser child WebView:** Windows v1 is documented as supported; Linux child/relay runtime behavior remains unverified. See [Native Browser Debug](./native-browser-debug-support.md).
- **Agent provider/platform coverage:** existing Linux qualification applies only to the documented OMP, Codex, and Claude versions; no broader provider-version or non-Linux runtime qualification is implied.

These are qualification boundaries, not permission to implement unapproved changes. Check the owning feature contract before making changes.

## Retired scope
<a id="trusted-plugin-platform-2026-09-22"></a>

The DamHopper trusted plugin platform, plugin SDK/runner, plugin APIs, plugin host bridge, and plugin release assets are permanently retired. Native Advisor replaced the platform's former Advisor integration. `Agent Store` distribution remains a separate product area. Former specifications and removal procedures are documented in the [Retired Plugin Platform Archive Record](./archive/retired-plugin-platform.md).

## Current references

- [Product requirements](./project-overview-pdr.md)
- [System architecture](./system-architecture.md)
- [Codebase summary](./codebase-summary.md)
- [Code standards](./code-standards.md)
- [Testing guide](./testing.md)
- [Changelog](./CHANGELOG.md)
