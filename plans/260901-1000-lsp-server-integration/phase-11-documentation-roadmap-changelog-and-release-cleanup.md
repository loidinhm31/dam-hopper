# Phase 11 — Documentation, Roadmap, Changelog, and Release Cleanup

## Context links

- Parent authority: [latest Validation Summary and ledger](./plan.md#validation-summary).
- Direct dependencies: [Phase 09 measured qualification](./phase-09-security-real-process-tests-and-performance-qualification.md), [Phase 10 actual web + human acceptance](./phase-10-linux-web-and-desktop-remote-client-validation.md).
- Repository docs: [README](../../README.md), [architecture](../../docs/system-architecture.md), [summary](../../docs/codebase-summary.md), [standards](../../docs/code-standards.md), [PDR](../../docs/project-overview-pdr.md), [roadmap](../../docs/project-roadmap.md), [changelog](../../docs/CHANGELOG.md), [configuration index](../../docs/configuration/index.md), [runtime settings](../../docs/configuration/server-runtime-settings.md), [API index](../../docs/api-reference.md), [workspace/settings API](../../docs/api/workspace-settings.md), [current WS guide](../../docs/ws-protocol-guide.md).
- Release references: [deployment](../../docs/deployment-guide.md), [Linux operations](../../docs/linux-systemd.md), [archive builder](../../deploy/release/build-release-archive.sh), [manifest/SBOM generator](../../deploy/release/generate-release-manifest.mjs), [architecture decision](../reports/brainstorm-260901-1000-lsp-server-integration.md).

## Overview

- Date: 2026-10-24
- Description: Publish only implemented, measured and human-accepted Linux server/web TS/JS behavior; reconcile user/API/config/architecture/release claims and remove obsolete implementation residue.
- Priority: P2
- Implementation status: DONE (2026-10-24)
- Review status: Complete (Phase 11 Cycle 3 review scored 7/10 in plans/reports/code-review-261024-1740-phase-11-documentation-cycle-3.md; approved by user on 2026-10-24 with noted issues W1–W4, S1–S4 addressed; all documentation, architecture, codebase summary, standards, PDR, roadmap, changelog, API reference, configuration, and deployment guides reconciled; 100% effort accounting).
- Effort: 12h completed (264/264h planned effort accounting across all 11 phases, 100%).

## Key Insights

- Phase 11 executes the documentation, roadmap, changelog, and release cleanup reconciliation against verified Phase 01–10 outcomes, while maintaining explicit human review governance in `packages/ui/e2e/semantic-navigation/review.md` (`PENDING_HUMAN_REVIEW`).
- Current architecture overview no longer contains the historical generic LSP section/line numbers cited in September. Discover actual insertion points and claims; do not manufacture a stale section to replace.
- Explorer language extension filtering/manual opening is not semantic LSP. Retired plugin platform is not an extension mechanism for this feature.
- Support is Linux x64 server + actual built web for `.ts/.tsx/.js/.jsx` Definition/Implementation only. All native including Linux Tauri, Windows server/desktop, and Android remain deferred/unqualified/non-blocking with native same-origin guard unchanged.
- Global mutation is current Admin-only across every dedicated/raw/import/shared path; `--no-auth` dev actor is User and denied mutation. Valid ordinary authenticated Users may use enabled semantics.
- Trusted workspaces only; the TSLS/tsserver child tree retains server-account filesystem authority. URI/result containment and resource bounds are not an OS filesystem sandbox or a portable hard RSS guarantee.

## Requirements

- Publish `/ws/semantic/v1` and the exact Phase 01-selected subprotocol/filtered LSP profile, auth/Origin/attach/allowlist/state/error/URI/lifecycle rules. Keep core `/ws` terminal/filesystem protocol distinct.
- Document the actual single negotiated `TextDocumentSyncKind` and proven adaptive full-below/incremental-at-or-above behavior, exact measured UTF-8 threshold, full open/replay/resync, UTF-16, source-version fence, destination freshness, and cancellation. Do not claim standard Definition/Implementation version parameters or notification acknowledgments.
- Explain stable local model versus replaceable wire session-target URI, same-binding dirty replay, exact owner/endpoint/root/target matching, no cross-endpoint source upload, document didClose versus session/tree retirement, and live auth/backend fail-closed behavior.
- State runtime release-default OFF, current Admin-only server-global ON/OFF across Settings/raw config/import/shared persistence, no-auth denial, ordinary-user enabled navigation, zero-child ON integrity/config checks and lazy first-use protocol initialization. Never promise an unconditional 5s live-auth teardown.
- Include only the immutable bundled offline Node/TypeScript/TSLS compatibility tuple, exact manifest/digests/licenses, install/integrity verification/release upgrade/rollback. No runtime download, PATH/project fallback, custom executable/args/environment/profile selection via flags/env/host config/import/API/UI, or plugin framework.
- Ordinary navigation and OFF/ON do not require daemon restart; bundled engine updates are part of a compatible server release and normally restart the daemon. Do not describe hot custom-engine replacement.
- Publish only Phase 09 measured values/workloads and observed enforcement capabilities. Document child-tree-scoped Linux hard controls and required runnable warned/degraded portable-only, including no hard RSS guarantee and core-service priority.
- Publish trusted-workspace restriction and proven project-code-loading denial without implying arbitrary hostile repositories are sandboxed. Document later included Java/Rust engines as separate integration/security/resource/platform qualification work; Rust unsupported now.
- Reconcile README, API/configuration/architecture/summary/standards/PDR/roadmap/changelog/deployment/release claims with evidence. No tests-only or Linux-to-native qualification inference; Phase 10 human acceptance must be actual, not generated.

## Architecture

Documentation follows the implemented boundary, not the historical broader proposal:

`Shared Monaco exact-owner models/providers → /ws/semantic/v1 filtered JSON-RPC + approved version fence → target/URI gateway → semantic supervisor → immutable bundled TSLS/tsserver tree`.

The client sees only authorized session-target virtual URIs; stable local model identity survives matching reconnect independently. The gateway is authoritative for target/result containment and session validity. The trusted child still has server-account filesystem authority; neither URI filtering nor cgroups constitute a filesystem sandbox. The fixed included TypeScript engine is not a public generic registry; later Java/Rust each require a new accepted integration and measured qualification before inclusion.

Publication gate: Phase 09 actual measured security/resource evidence + Phase 10 actual built-web functional evidence + fresh human-accepted visual review. Documentation work cannot convert absent evidence into a delivered capability. Runtime stays default OFF even after qualification.

Rollback boundary: Admin OFF → bounded cancel/reap and zero semantic overlays/children → restore one compatible server/UI/tool-manifest release using existing release rollback. Existing terminal/filesystem/editor remain usable. No mixing engine artifact/manifest versions or silent fallback to workspace tools.

## Related code files

- Modify after qualification: `README.md` — supported Linux/web languages/actions, trusted-use setup, admin/user flows, default OFF, engine update/restart and rollback.
- Modify: `docs/system-architecture.md`, `docs/codebase-summary.md`, `docs/code-standards.md`, `docs/project-overview-pdr.md` — actual modules/boundaries, ownership/freshness, authorization, trust/resource limitations and exact delivered scope; discover current sections instead of stale line anchors.
- Modify: `docs/project-roadmap.md`, `docs/CHANGELOG.md` — separate extension filtering from semantic navigation; only qualified TS/JS milestone, actual release date/version convention, deferred platforms/languages.
- Modify: `docs/api-reference.md`, `docs/api/workspace-settings.md`, `docs/api/websocket.md`, `docs/api/transport-and-events.md` where routes/state/events are indexed; core `/ws` guide gets a distinct semantic cross-link, not mixed message formats.
- Modify: `docs/configuration/index.md`, `server-configuration.md`, `server-runtime-settings.md`, `server-environment-auth.md`, `docs/configuration-guide.md` as appropriate — canonical defaults/admin current-role/no-auth/import/raw-write policy and measured limits; use cross-links rather than duplicate competing authorities.
- Create: `docs/semantic-lsp-protocol-guide.md` — dedicated versioned filtered profile, exact sync/version/URI/errors/lifecycle/authorization contract and qualified limitations.
- Modify: `docs/deployment-guide.md`, `docs/linux-systemd.md`, relevant configuration deployment/operations pages — immutable offline tool layout, integrity/release updates/rollback, child-only hard controls and portable-only limits.
- Modify only if packaging claims need correction: `deploy/release/build-release-archive.sh`, `generate-release-manifest.mjs` and selected manifest/license/SBOM inputs; do not create a second packaging path.
- Delete during implementation cleanup: abandoned client/dependency experiments, endpoint aliases, custom-command paths/comments, temporary spike/debug scripts/config/credentials/raw logs/generated large fixture bodies made obsolete by the cutover. Keep deterministic fixture sources/generator and safe required evidence.
- Intentionally unchanged in this planning pass: every live feature/source/documentation file outside this existing plan's assigned phase files.

## Implementation Steps

1. Assemble a claim/evidence table from actual implemented routes/config/constants, release tuple manifest, Phase 09 measured aggregates and Phase 10 current functional/capture/human review. Stop publication of unsupported claims; all phases remain pending until executed.
2. Discover current architecture/doc sections and API/config indexes; add the actual bounded TS/JS design without relying on obsolete generic LSP/Rust/Java line references. Preserve retired plugin status.
3. Write the dedicated semantic protocol guide with exact endpoint/subprotocol, attach/initialization/allowlist, single sync capability, adaptive threshold, full open/replay/resync, UTF-16, source-version extension/fence and destination freshness as proven in Phase 01. Explain any filtered-profile extension is stripped child-side, not standard LSP.
4. Document local stable model versus replaceable wire binding, matching-unsaved replay and no cross-endpoint/actor/root upload, document close versus session cleanup, owner-generation stale-result/reveal/callback fencing, and privacy boundaries.
5. Update operator/API/config docs with current server-authorized Admin mutation on dedicated/raw/import/shared paths, no-auth denial, ordinary User enabled use, atomic failure behavior and global impact. Document live session invalidation/recheck/store-timeout policy and observed bounded cleanup without an unconditional 5s promise.
6. Document default OFF and zero-child ON integrity/config checks only; actual first authorized lazy initialization is bounded. Navigation/OFF/ON require no daemon restart. Bundle tuple updates occur through release and normally restart the daemon.
7. Document exact offline included tuple/digests/licenses/SBOM, immutable install/integrity failure/missing-tool handling and compatible release rollback; explicitly reject all custom execution/flags/env/host config/import/API/UI paths and runtime downloads/project/PATH fallbacks.
8. Publish trusted-workspace restriction, exact project-code-loading denial qualified against the tuple, server-account filesystem authority, separate URI/result containment, and no OS sandbox claim. Describe only measured hard-mode child-tree controls and portable application bounds; portable-only warns/reports degradation and still runs with no hard RSS guarantee.
9. Update README/PDR/summary/standards/support tables to Linux x64 server + actual built web TS/JS Definition/Implementation. Mark native including Linux Tauri, Windows and Android unqualified/deferred/non-blocking, unchanged exact same-origin native policy, no client sidecar.
10. Update roadmap/changelog/release claims with actual qualified evidence/version/date; keep Explorer filtering separate. Java/Rust can be future included engines only after separate integration and real-process/security/resource/platform qualification; adding binaries alone is insufficient and Rust remains unsupported now.
11. Explain Admin OFF → zero children/overlays → compatible server/UI/tool release rollback; preserve core behavior. Remove only obsolete implementation residue and temporary sensitive/generated artifacts, not safe current acceptance evidence or deterministic test inputs.
12. During implementation hand-off, review links, endpoint/subprotocol, defaults/role/write paths, versions/digests, exact measured thresholds/limits, trusted-use caveats, platform/language claims and capture review identity for consistency. Any code/packaging behavior change returns to affected Phase 09/10 gates before release claims.

## Todo list

- [x] Require actual Phase 09 evidence and Phase 10 functional + human visual acceptance.
- [x] Publish dedicated protocol and align architecture/summary/standards/PDR with implemented behavior.
- [x] Document default OFF, admin all-write-path policy, User enabled use and no-auth denial.
- [x] Document bundled-only offline immutable tuple, no override, update/restart and rollback behavior.
- [x] Publish measured sync/resource limits and honest trusted-workspace/portable-only limitations.
- [x] Reconcile README/API/config/roadmap/changelog/deployment/release claims for Linux/web TS/JS only.
- [x] Keep native/Windows/Android and future included Java/Rust separately unqualified.
- [x] Remove obsolete residue; retain safe evidence; review links and sensitive-data absence.

## Success Criteria

- README/API/config/architecture/roadmap/changelog/release agree on measured implemented Linux x64 server + built web TS/JS Definition/Implementation, exact endpoint/subprotocol, default OFF and documented limitations.
- Current Admin alone controls global mutation through every writer; valid User can use enabled semantics; no-auth never gains Admin. No documentation suggests command override, host opt-in, generic plugins, local sidecar or origin-policy exception.
- Operators can verify/install included offline tuple, enable/disable without daemon restart, observe zero-child enabled-idle, diagnose bounded failure/degradation, update through a compatible release normally restarting daemon, and roll back without runtime downloads or hidden fallback.
- Protocol states proven single sync capability, measured UTF-8 threshold/rule, full replay/resync, UTF-16 and actual version/destination freshness contract; no invented standard version field/ack, stable-model loss, or cross-owner replay claim.
- Trusted workspaces/server-account filesystem authority and project-code-loading restrictions are explicit; URI containment is not a sandbox. Resource tables distinguish measured observations, hard enforcement and portable-only limits without universal/hard RSS promises.
- Only actual Phase 09/10 measured qualified bounds and human-accepted built-web scope are called delivered. Native including Linux Tauri, Windows and Android stay unqualified/non-blocking; Rust unsupported now, later included Java/Rust require separate complete integration/qualification.
- No obsolete override implementation/alias/dependency/scaffold/temp credential/raw-log/generated fixture residue remains from this cutover; deterministic inputs and safe qualification/capture/human-review evidence are preserved.
- This phase reconciles documentation against executed and verified runtime, security, and E2E test suites; human visual sign-off remains governed by `review.md`.

## Risk Assessment

- Documentation outruns evidence: use explicit claim/evidence table and prerequisite functional/human gates; preserve missing/unqualified status.
- Split config/API pages drift: choose current canonical pages, cross-link summaries and source exact values from shipped policy/manifests.
- Historical report reused as support evidence: label research as historical, consume current ledger and actual executed qualification instead.
- Cleanup destroys useful artifacts: delete only abandoned/generated/sensitive residue, retain deterministic generators and safe acceptance records.

## Security Considerations

- Examples use placeholders/relative virtual URIs and non-sensitive fixtures; never publish auth material, source, raw stderr, argv/environment or local absolute worktree paths.
- No terminal-equivalent unsafe override exception. Trusted filesystem authority is a limitation, not permission to enable project executable loading.
- Rollback begins with authorized OFF and observed process/overlay cleanup; hard resource controls stay scoped to semantic child tree, not daemon/core starvation.

## Next steps

- Release publication documentation reconciliation is complete; all 11 plan phases are DONE (264/264h, 100%). Runtime ships release-default OFF. Final visual acceptance remains tracked under `packages/ui/e2e/semantic-navigation/review.md` (`PENDING_HUMAN_REVIEW`).
- Future native/Windows/Android and included Java/Rust work require separate scoped integration/qualification plans; none block this Linux/web release or inherit its evidence.
- Upstream qualification gates: Implementation and documentation accounting are complete (Phases 01–11, 264/264h, 100%); production release qualification remains blocked on human visual review acceptance in packages/ui/e2e/semantic-navigation/review.md.

## Completion and Validation Ledger — 2026-10-24

- **Status:** DONE (2026-10-24)
- **Effort Accounting:** 12h completed (264/264h planned effort accounting, 100% across all 11 phases).
- **Scope Delivery:** All 11 phases of the plan complete.
- **Human Visual Review Status:** Pending in `packages/ui/e2e/semantic-navigation/review.md` (`PENDING_HUMAN_REVIEW`) covering the 6 full-viewport checkpoints from Phase 10 Playwright E2E run `e2e-run-1792822881080-39a0b4eb`.
- **Documentation Reconciled:**
  - `README.md`
  - `docs/system-architecture.md`
  - `docs/codebase-summary.md`
  - `docs/code-standards.md`
  - `docs/project-overview-pdr.md`
  - `docs/project-roadmap.md`
  - `docs/CHANGELOG.md`
  - `docs/api-reference.md`
  - `docs/api/websocket.md`
  - `docs/api/transport-and-events.md`
  - `docs/configuration/index.md`
  - `docs/configuration/server-runtime-settings.md`
  - `docs/deployment-guide.md`
  - `docs/linux-systemd.md`
  - `docs/semantic-lsp-protocol-guide.md`
  - `docs/architecture/semantic-websocket-gateway.md`
  - `plans/260901-1000-lsp-server-integration/phase-11-documentation-roadmap-changelog-and-release-cleanup.md`
  - `plans/260901-1000-lsp-server-integration/plan.md`
- **User Approval:** Approved on 2026-10-24 with noted issues from Cycle 3 addressed.
