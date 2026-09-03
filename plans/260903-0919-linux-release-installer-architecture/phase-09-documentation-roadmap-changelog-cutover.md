# Phase 09 — Documentation, Roadmap, Changelog, and Release Cutover

## Context Links

- [Parent plan](./plan.md)
- [Phase 08 validation](./phase-08-behavioral-security-failure-validation.md)
- [Accepted brainstorm](../reports/brainstorm-260903-0919-linux-release-installer-architecture.md)
- [Repository README](../../README.md)
- [Linux systemd guide](../../docs/linux-systemd.md)
- [System architecture](../../docs/system-architecture.md)
- [Roadmap](../../docs/project-roadmap.md)
- [Changelog](../../docs/CHANGELOG.md)

## Overview

- **Date:** 2026-09-03
- **Description:** Cut all maintained documentation to the attested release installer, record verified support and breaking changes, and remove obsolete checkout-runner guidance.
- **Priority:** P1
- **Implementation status:** Pending
- **Review status:** Pending
- **Effort:** 8h

## Key Insights

- Current README/systemd guide recommends reset → build → install even though reset leaves assets that install rejects. The cutover must remove, not annotate, that path.
- `docs/linux-systemd.md` mixes maintained format 2 with a long executable-looking format-1 history. Keeping it after runner deletion would invite unsafe operator use.
- Code standards incorrectly claim musl and universal Rust SPA serving. Architecture/docs must distinguish the release API-only unit, dedicated web unit, explicit Docker combined mode, Pages, desktop, and unsupported nohup.
- Documentation may claim only Phase 08 evidence. Unrun external MongoDB, firewall/Tailscale, DNS/TLS, or unsupported distros remain explicit operator/deferred boundaries.

## Requirements

### Functional

- Make `README.md` quickstart download `dam-hopper-install.sh`, verify/use it, install one role pending, inspect status, activate explicitly, and show rollback/recovery.
- Rewrite `docs/linux-systemd.md` in place as the authoritative Fedora 44 x86_64 release/install/role/activation/rollback/recovery/migration guide; remove all format-1 and deleted script commands.
- Document exact CLI grammar, prerequisites (`curl`, `gh`, tar/gzip, sudo, systemd), trust flow, files/owners, role matrix, ports, health, 20s+10s gate, state transitions, retention, failure states, and no-build guarantee.
- Document web `apiUrl`/managed-profile behavior and exact API HTTP/WebSocket origin configuration without claiming TLS/firewall/Tailscale automation.
- Update architecture/codebase/code standards/PDR/API/config/profile docs to match API-only default, dedicated web host, health schemas, release manager, and current state boundary.
- Update roadmap only after implementation/test/review evidence; add changelog entry with migration steps and breaking removal of `linux:production`, `linux:reset`, old unit, and format-1 cleanup path.
- Keep Docker, Pages, desktop, and nohup ownership explicit. Do not imply they are published or managed by the Linux release installer.

### Non-functional

- No stale reference to deleted paths/commands except changelog historical context clearly labeled non-executable.
- All relative links resolve; command examples use exact implemented `--help` output and never include placeholders presented as runnable.
- Large docs are edited in place and reduced where possible; rewritten `docs/linux-systemd.md` stays below 800 lines.
- Security limitations and rollback data limits are prominent, not buried in release notes.

## Architecture

Documentation ownership after cutover:

- `README.md`: shortest supported bootstrap/role/activate journey.
- `docs/linux-systemd.md`: authoritative operator and incident-recovery contract.
- `docs/system-architecture.md`: publisher → manifest → role view → units → durable transaction data flow and invariants.
- `docs/configuration-guide.md` + `docs/user-guide-multi-server-profiles.md`: API URL, managed runtime profile, exact origins, tokens, user config/state.
- `docs/api-reference.md`: API/web health payloads and API-only default.
- `docs/code-standards.md` + `docs/codebase-summary.md` + `docs/project-overview-pdr.md`: contributor structure, release contract, support boundary.
- `docs/project-roadmap.md` + `docs/CHANGELOG.md`: evidence-backed completion and breaking cutover history.
- `docs/README.md` + `docs/linux-nohup.md`: correct index/deployment contrast and legacy conflict warnings.

No duplicate deployment guide is created. Historical details useful for archaeology live in Git/changelog, not executable operator blocks.

## Related Code Files

### Create

- None.

### Modify

- `README.md` — release bootstrap quickstart and no-build target requirements.
- `docs/README.md` — authoritative deployment index and corrected host split.
- `docs/linux-systemd.md` — full in-place operator contract rewrite under 800 lines.
- `docs/linux-nohup.md` — explicit incompatibility with manager-owned ports/state; no migration authority.
- `docs/configuration-guide.md` — host/runtime config, API CORS/WS origins, state ownership, removed commands.
- `docs/user-guide-multi-server-profiles.md` — managed deployed profile precedence/token reset behavior.
- `docs/api-reference.md` — exact API/web health schemas and ownership.
- `docs/system-architecture.md` — publisher, trust, role, filesystem, service, transaction, recovery diagrams/invariants.
- `docs/code-standards.md` — GNU/vendored build truth, three Rust binaries, API-only/default and web-host rules, release module conventions.
- `docs/codebase-summary.md` — new modules/binaries/workflows/deployment status/runtime inventory.
- `docs/project-overview-pdr.md` — Linux release requirement, acceptance criteria, and out-of-scope boundary.
- `docs/project-roadmap.md` — evidence-backed phase completion and follow-up exclusions.
- `docs/CHANGELOG.md` — release installer feature, migration, security boundary, and breaking old-runner removal.

### Delete

- None. Obsolete executable paths were deleted in Phase 07; stale historical prose is removed from maintained docs.

## Implementation Steps

1. Collect terminal Phase 08 tester/reviewer results, exact implemented `--help`, release asset names, health JSON, unit properties, and measured Fedora evidence. Do not write completion claims from the plan alone.
2. Delegate the bounded evidence and full documentation path list to `evcrate-docs-manager`; require it to read current roadmap/changelog first and update existing files only.
3. Replace README quickstart with bootstrap → pending status → explicit activate. Include exact server/web/both examples and explicit prerequisites.
4. Rewrite `docs/linux-systemd.md`: support matrix, trust chain, host preparation, role config, first install, upgrade, activation, status, rollback, recovery, format-2 migration, files/owners, security/exposure, troubleshooting, evidence limits.
5. Delete executable-looking format-1/manual build/reset sections and all obsolete source checkout commands. Do not retain aliases or deprecation recipes.
6. Update architecture diagram/data flow and filesystem state; state that concrete units, not `current`, execute releases and recovery one-shot gates boot.
7. Reconcile web profile/API origin docs and both health payloads. Explicitly separate public runtime URL metadata from browser-local credentials.
8. Correct code standards/summary/PDR claims: GNU glibc profile, vendored libraries not musl, dedicated web host, explicit Docker combined mode, exact module/file ownership.
9. Add roadmap completion only for observed gates. Add changelog breaking/migration entry with preserved runtime and rollback limitations.
10. Search all maintained docs/package/workflows for `linux:production`, `linux:reset`, `run-linux-production.sh`, `reset-linux-production.sh`, `dam-hopper.service`, format-1 install commands, implicit `/opt/dam-hopper/web`, musl portability, and old port claims. Every occurrence must be removed or clearly historical/non-runnable.
11. Validate relative links, Markdown structure, CLI examples against `--help`, asset names against manifest, and `docs/linux-systemd.md` line count `<800`.
12. Verify the terminal `evcrate-docs-manager` report and changed-file scope. If docs change a contract rather than reflect code, return to owning code phase; never resolve drift by documenting an unimplemented behavior.
13. Run final focused reviewer/docs verification. Mark plan/phase status completed only after actual implementation evidence and owner workflow permits it; this planning delivery remains pending.

## Todo List

- [ ] Gather exact Phase 08 evidence and implemented CLI/asset contracts.
- [ ] Delegate and wait for terminal docs-manager result.
- [ ] Rewrite the authoritative Linux operator guide in place.
- [ ] Update architecture, API/config/profile, standards/summary/PDR docs.
- [ ] Update roadmap and changelog from observed evidence.
- [ ] Remove stale/deleted command references and validate links/examples/line count.
- [ ] Pass final documentation review.

## Success Criteria

- A new operator can install server, web, or both from public assets, observe pending state, activate, inspect, rollback, and recover using only maintained instructions and no checkout/build toolchain.
- Every documented command exists in actual `--help`; every asset/path/port/identity/health field matches manifest and Phase 08 evidence.
- `docs/linux-systemd.md` is under 800 lines and contains no runnable format-1/reset/build-from-checkout path.
- Maintained docs contain zero unqualified references to deleted production scripts, old single unit, implicit systemd SPA serving, musl artifact, or install-enables-before-start behavior.
- Architecture, README, config/profile docs, PDR, roadmap, and changelog agree on role lockstep, pending install, explicit activation, health rollback, and state limits.
- Roadmap/changelog completion language cites terminal tester/reviewer/Fedora evidence and lists any unrun boundaries truthfully.
- `evcrate-docs-manager` and final reviewer return terminal success with no unresolved broken links or contract drift.

## Risk Assessment

- **Docs outrun implementation:** Build every statement from terminal evidence and implemented help/schema output.
- **Historical command remains discoverable:** Remove executable blocks and use changelog-only historical wording.
- **Oversized architecture docs:** Replace obsolete deployment sections rather than append a second design.
- **Exposure misunderstanding:** Repeat that direct wildcard ports require operator TLS/firewall/Tailscale/CORS policy.
- **Rollback overclaim:** State exactly that immutable files/units roll back; arbitrary SQLite/MongoDB/external writes do not.

## Security Considerations

- Never publish real hostnames, usernames beyond accepted service identity, tokens, env contents, SQLite paths beyond contract, workflow logs, or attestation credentials.
- Examples never pipe network output to root and never offer checksum-only fallback.
- Troubleshooting preserves fail-closed state and evidence; it does not advise deleting locks/journals/releases or disabling SELinux/systemd protections.

## Next Steps

After docs-manager and final review pass, the owner may approve an actual protected-tag release. Multi-architecture, package repositories, detached keys, auto-update, TLS/proxy/firewall automation, API service-account migration, and breaking DB migrations require separate plans. Unresolved questions: none.
