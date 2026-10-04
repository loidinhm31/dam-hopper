# DamHopper Documentation

Use this index to find maintained product, architecture, API, development, and operations references. The root [README](../README.md) covers repository setup and common development commands.

## Start here

- [Project overview and PDR](./project-overview-pdr.md) — product scope, requirements, security and acceptance criteria.
- [System architecture](./system-architecture.md) — runtime components, ownership, and data flows.
- [Codebase summary](./codebase-summary.md) — repository map and current subsystem inventory.
- [Project roadmap](./project-roadmap.md) — delivered work and open qualification gates.

## Development references

- [Code standards](./code-standards.md) — Rust, React, transport, ownership, testing, and security practices.
- [Testing guide](./testing.md) — test suites and development verification.
- [Frontend components](./frontend-components.md) — shared UI composition and lifecycle.
- [Configuration guide](./configuration-guide.md) and [configuration index](./configuration/index.md) — project, UI, and server configuration.
- [API reference](./api-reference.md), [authentication API](./authentication-api.md), [workflow API](./workflow-api.md), and [WebSocket protocol](./ws-protocol-guide.md).

## Feature architecture and guides

| Reference | Scope |
| --- | --- |
| [Multi-server profiles](./user-guide-multi-server-profiles.md) | Profile setup and independently scoped connections |
| [Native Advisor](./architecture/native-advisor.md) | Native Rust service, admin access, policy, history, and UI |
| [Agent status](./architecture/agent-status.md) | OMP and native Codex/Claude status reporting and ownership |
| [Git history search](./architecture/git-history-search.md) | Search, query ownership, persisted selection, and Git views |
| [Host-resource SSE](./architecture/host-resource-sse.md) | Stream architecture and remaining rollout qualification |
| [Files, editor, search, and Git](./phase-03-files-editor-search-git.md) | Profile-qualified IDE resources and safe Git operations |
| [Terminal continuity and workflow](./phase-04-terminal-continuity-workflow-navigation.md) | PTY identity, lifecycle, persistence, and navigation |
| [Idle-suspend security](./terminal-idle-suspend-security.md) | Linux helper IPC, admission, and fail-closed behavior |
| [Media isolation and encryption](./phase-07-media-isolation-and-encryption.md) | Owner-bound media tickets and encrypted writes |
| [Cognito preferences and host settings](./phase-06-preferences-settings-usage-and-host.md) | Preference ownership, privacy mode, host resources, and settings |

## Operations and release

- [Linux systemd](./linux-systemd.md), [Linux release manager](./linux-release-manager.md), and [Linux runtime provisioning](./linux-release-runtime-provisioning.md).
- [Windows release packaging](./windows-release-packaging.md) and [release manifest](./linux-release-manifest.md).
- [Release publisher and bootstrap](./linux-release-publisher-bootstrap.md), [nohup recovery](./linux-nohup.md), and [deployment codebase summary](./codebase-summary-release.md).

## Change history

- [Current changelog](./CHANGELOG.md)
- [Archived changelog notices](./CHANGELOG-archive.md)

The former DamHopper plugin platform is retired. Any plugin-platform design pages retained in this repository are historical references only; Native Advisor is the current implementation. Expired plan records are archived rather than maintained as active product requirements.
