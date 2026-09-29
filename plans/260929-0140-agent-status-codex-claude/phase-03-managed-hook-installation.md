# Phase 03 — Managed installation and complete removal

## Context links
[Plan](./plan.md) · [Contract §6](./design-contract.md) · [Phase 02](./phase-02-private-hook-ingress.md)

## Overview
Date: 2026-09-29. Priority P1. Estimate 8h. Implementation Pending / 0%; review Pending.
Deliver real server-side install/status/update/uninstall without clobbering native configuration or leaving active dangling hooks.

## Key Insights
Existing OMP single-file installation is reusable precedent, not a complete multi-file transaction. Native hooks need registrations, launcher and ownership metadata. Codex definition trust is separate from installation. Claude higher-precedence policies may prevent execution.

## Requirements
Explicit existing absolute config root; API-selected path equals actual runtime identity. Preserve user hooks/notify/config, refuse modified owned files, atomic per-file writes and honest cross-file recovery. No sudo, broad ACL changes, feature/trust bypass or automatic reenablement.

## Architecture
Concrete Codex/Claude managers share only existing path/hash/atomic primitives. Native config registrations invoke a safely quoted stable packaged binary through a managed launcher. An ownership manifest records only exact managed entries/assets. Install registers last; uninstall deregisters first and requires reload/restart before cached invocation is impossible.

## Related code files
Modify:
- `server/src/agent_status/integration.rs`, `mod.rs`: shared safe-path/hash primitives and management result/readiness DTOs; preserve OMP CLI.
- `server/src/api/agent_status.rs`, `server/src/api/router.rs`: concrete GET/POST/DELETE native integration routes and explicit directory resolution.
- `server/src/main.rs`: native management subcommands.
- `server/tests/agent_status_integration.rs`, `server/src/api/tests.rs`: actual filesystem/API behavior.
Create:
- `server/src/agent_status/codex_integration.rs`, `claude_integration.rs`: native config merges/owned fragment removal.
- `server/src/agent_status/assets/native-agent-status.sh`: embedded launcher template only if needed; no runtime jq/Node/Python dependency.
Delete: obsolete native owned assets only during successful managed uninstall; no Herdr/user hooks.

## Implementation Steps
1. Factor minimal safe filesystem boundary only where reused: existing root, no symlinked ancestors/targets, regular readable config, write permissions, bounded content; directory-relative no-follow mutation where supported.
2. Define shared mutation serialization/revision checks. Stage assets/manifest, then atomically publish native config registration; recover partial installs by inspecting owned entries, never assuming multiple renames are one transaction.
3. Codex: merge hooks.json, or existing same-layer inline TOML hook representation; do not create duplicate representations. Preserve comments when modifying TOML. Respect disabled hooks and leave `/hooks` trust to user.
4. Claude: merge exact owned command handlers into settings.json without replacing sibling matchers/handlers; classify disableAllHooks/managed-only/unknown effective settings.
5. Resolve stable executable installation path, check agent-user execution permission, safely quote spaces/metacharacters without interpolating event data. Asset version/hash is not proof of native hook trust.
6. Implement status distinction: installation vs runtime readiness vs removal-in-progress/conflict. No directory creation in status or guessed API-user home substitution.
7. Uninstall removes owned registrations, invalidates eligibility, reports restart-required if live sessions may cache them, then finalizes owned asset deletion after verified restart/absence. Never leave registered missing command while returning success. Preserve modified items and identify the exact conflict.
8. Smoke CLI/API install twice, update, modified conflict, partial failure and full uninstall under isolated native homes with preexisting hooks; prove unrelated configuration unchanged semantically and user formatting/comments preserved where supported.

## Todo list
- [ ] Safe native config merges and exact managed ownership.
- [ ] Trust/policy/readiness and restart-aware removal.
- [ ] CLI/API filesystem lifecycle smoke and regression coverage.

## Success Criteria
Agent Store and CLI target the same explicit path. No unmanaged hook removed. After completed uninstall plus restart, no DamHopper registration, launcher/manifest or invocation remains. Empty dirs/files removed only when owned. Repeated uninstall is idempotent.

## Risk Assessment
Stale in-memory hook configuration can invoke deleted launchers. Cross-file failure can strand registrations; expose recoverable partial states. User editing native config during install must cause conflict/retry by user, not lost changes.

## Security Considerations
Protect manifest permissions; never store full native configs or secrets. Respect service euid and targeted provisioning; never grant broad home access. Codex trust hashes cannot be synthesized/approved by installer.

## Next steps
Phase 05 consumes the concrete management/readiness APIs. Phase 06 proves installed agent behavior and post-uninstall absence, not only filesystem hashes.
