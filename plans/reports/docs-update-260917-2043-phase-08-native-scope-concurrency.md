# Documentation Update Report — Phase 08 Native Scope Concurrency

**Date:** 2026-09-17 20:43  
**Scope:** Unified Multi-Profile Workbench Phase 08 — native scope concurrency and platform integration  
**Workspace:** `/home/loidinh/WS/dam-hopper`

## Current State Assessment

Phase 08 source and contracts now document concurrent Windows native SSH scopes:
explicit `openClient`, `openScope`, `closeScope`, and `reconcileKnownScopes`; true
client-epoch teardown; `(scopeId, connectionProfileId)` runtime ownership; scoped
credential/trust cleanup; exact main-window IPC; and explicit Phase 05 Browser
target ownership. Linux focused evidence is 135/135. Windows S13 runtime,
DPAPI, WebView2, disposable SSH, and packaged qualification remain unverified.

## Changes Made

- Added `docs/phase-08-native-scope-concurrency.md` (249 LOC): lifecycle,
  isolation, IPC/ACL, persistence/trust, React bridge, Browser owner, platform
  matrix, verification, and source map.
- Updated `docs/system-architecture.md`: unified header now includes Phase 08;
  replaced stale one-active-scope/13-command forwarding section with the
  concurrent scope architecture and current 21-command boundary.
- Updated `docs/code-standards.md`: native lifecycle, counter, teardown,
  retention, ACL, and scope-keyed runtime rules.
- Updated `docs/project-overview-pdr.md`: PR-007 status and new PR-007B
  requirements/acceptance criteria/evidence.
- Updated `docs/codebase-summary.md`: current Repomix metrics and Phase 08
  source/contract map.
- Updated `docs/api-reference.md`: native forwarding IPC documented separately
  from REST/WebSocket APIs.
- Updated `docs/frontend-components.md`: host/context/hook lifecycle and
  Browser owner separation.
- Updated `docs/native-browser-debug-support.md`,
  `docs/phase-05-agents-ports-and-browser.md`, and
  `docs/user-guide-multi-server-profiles.md` with explicit Browser owner and
  native scope behavior.
- Updated `docs/README.md` with Phase 08 guide navigation.
- Generated `repomix-output.xml` with Repomix v1.18.0.
- Plan/roadmap/changelog files intentionally left to the Phase08PlanStatusUpdate
  owner.

## Repomix Evidence

`repomix -o ./repomix-output.xml --style xml` completed successfully:

- 2,020 files
- 4,521,635 tokens
- 18,834,182 characters
- 5 security-flagged files excluded by Repomix scan

`docs/codebase-summary.md` records these generated metrics and preserves the
read-only-compaction caveat.

## Gaps Identified

1. Windows S13 runtime and packaged evidence is still required; Linux tests do
   not qualify Windows-gated manager/runtime, DPAPI, WebView2, or live SSH.
2. Rust warnings remain non-blocking in `apps/native/src-tauri/src/lib.rs` and
   `src/main.rs`; release ownership must decide cleanup timing.
3. Existing legacy docs remain above the 800-LOC target: API reference,
   code standards, frontend components, PDR, and system architecture. New
   Phase 08 guide is 249 LOC; broad modularization was not mixed into this
   phase closeout.

## Recommendations

1. Run Windows S13: two concurrent scopes, equal IDs, global port/limit checks,
   scoped close/failure cleanup, epoch teardown, stale/permission negatives,
   Browser target/relay, DPAPI, and WebView2.
2. Run Windows-target Cargo/build validation for Windows-gated modules before
   native release claims.
3. Decide whether current Rust warnings are cleaned before packaging.
4. Schedule modular refactors for the five oversized legacy docs; preserve the
   new dedicated Phase 08 guide as the maintained entry point.

## Validation

- `node ~/.omp/agent/evcrate/scripts/validate-docs.cjs docs/` completed.
- Validator confirmed **451 internal links working**.
- Validator emitted broad heuristic warnings for existing code/config references
  (1,352 code-reference and 321 config-key findings); no link failure was
  reported. These warnings include legacy changelog and cross-domain terms and
  are not treated as Phase 08 source failures.
- Line counts: Phase 08 guide 249; codebase summary 615; README 448; native
  Browser guide 116; multi-profile guide 301; Phase 05 guide 190.

## Unresolved Questions

1. Which Windows runner/device and disposable SSH endpoints will execute S13?
2. Should the non-blocking Rust warnings be cleaned before native packaging?
3. When should oversized legacy docs be split into topic directories?
