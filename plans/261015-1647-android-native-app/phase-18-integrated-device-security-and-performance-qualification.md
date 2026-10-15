# Phase 18 — Integrated device security and performance qualification

## Context Links

- [Overview](./plan.md) · [scope and acceptance](./scope-and-acceptance.md) · [contracts/modules](./contracts-and-modules.md) · [execution guide](./execution-guide.md).
- [Proposed architecture](../../docs/architecture/android-native-client.md) · [reviewed research](./research/android-platform-research.md).
- Dependencies: [Phase 12](./phase-12-complete-git-and-safe-history-workflows.md), [Phase 17](./phase-17-preferences-privacy-notifications-and-lifecycle.md)

## Overview

- Date: 2026-10-15. Priority: P2. Implementation status: **pending**. Review status: **pending**. Progress: **0%**.
- Scope: All included scope rows; GATE-C.
- Goal: Prove end-to-end native behavior and retained feature parity on real supported Android/device/server combinations.
- No implementation performed by this plan. Paths and commands below are future work; evidence must be observed, not inferred.

## Key Insights

- JVM unit tests or an APK build are not proof of native UI/IME/PTY/media behavior.
- Visual acceptance requires fresh full-app captures and human review; no synthetic ACCEPTED from green CI.

## Requirements

- Deterministic isolated real-server/device journeys covering every included ledger row and denial/edge conditions.
- API29/current emulator plus named physical ARM64 device,16KiB environment for every native binary path and actual native input/accessibility.
- Security/license/dependency/performance/soak budgets and full baseline web/server regression only for changed integration surfaces.
- Qualify TERMINAL + Traditional only: one top icon + short text panel row below server/project header, horizontally scrollable and always visible with IME; one selected content area on every phone/tablet/foldable size. No IDE/Runtime mode, More menu, second navigation surface, floating button or wide-screen terminal/panel dock.

## Architecture

Native Android instrumentation drives the installed app against isolated real authenticated Rust servers, disposable real Git/filesystem/Agent Store/workflow fixtures and controlled network faults. Shared deterministic tests cover reducer/byte/identity boundaries; tests never substitute mocks for integration evidence.

## Related Code Files

Existing references (read/reuse contracts; no server/web modification by default):
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/docs/testing.md`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/docs/code-standards.md`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/packages/ui/e2e/`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/server/tests/`

Proposed implementation files (create unless introduced earlier; modify thereafter):
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/WorkbenchJourneys.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonTest/kotlin/dev/damhopper/nativeapp/OwnershipAndReplayTests.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/scripts/run-device-journeys.sh`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/scripts/audit-apk-security.sh`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/docs/android-native-acceptance.md`

No deletion of existing web/Tauri hosts or unrelated files. Any necessary backend contract change requires a documented design/compatibility review before code.

## Implementation Steps

1. Implement deterministic fixture provisioning/cleanup for two authenticated servers/accounts and real project/Git/worktree/files/media/workflow/store data; use canonical operator/auth fixtures, not no-auth acceptance.
2. Write permanent behavioral tests only for meaningful invariants: replay ordering/UTF8 boundaries, owner/incarnation replacement, CAS/safe mutation, stale model results, crypto tamper and lifecycle transitions. Avoid source-copy/wiring/mock-echo/incidental-default tests.
3. Run every included panel journey in TERMINAL/Traditional mode through the top icon + short text row below server/project header. On phones/tablets/foldables, verify horizontal scrolling, selected-button reveal, IME visibility and one selected content area; no More menu, floating/secondary navigation, excluded mode or wide-screen dock. Cover role denials, profile isolation, editor/Git/transfers/media/workflows/store/host/settings, and prove panel return preserves the same terminal/controllers.
4. Inject network loss/delay/reordering where supported, auth/MFA expiry, server restart, Android process death/Doze/rotation/navigation and concurrent mutations; verify actual final server files/refs/processes and app state.
5. Audit APK dependency graph/manifest/backup/exports/TLS/cookies/logs/secrets and every native .so ABI/ELF/APK alignment; run native code paths in an actual16KiB-capable environment, not only static alignment.
6. Measure frozen reference-device terminal throughput/input/render responsiveness, editor1/5MiB boundaries, transfer memory and stream/watch teardown through a bounded soak; compare against Phase01 approved budgets.
7. Capture redacted full-app viewport evidence, device/server/version/ABI/page-size metadata and explicit human ACCEPTED/REJECTED visual review; CI can verify assertions only.
8. Run affected existing server/web tests/builds once after integration changes settle, inspect failures as real regressions, and record unqualified platform/proxy/provider combinations instead of broad pass claims.
9. Produce requirement-to-evidence release matrix with every included row passed or a concrete blocking defect. No missing retained feature may be relabelled preview exception.

## Todo List

- [ ] Exercise complete native real-server journeys and failure invariants.
- [ ] Audit binary/security/license and measured performance/soak.
- [ ] Record human-reviewed evidence and GATE-C pass/block decision.
- [ ] Update requirement/evidence ledger and affected docs after actual runtime proof; record device/server/version limitations.

## Success Criteria

- Every included requirement has fresh observed evidence on its declared supported matrix; no mock-only or build-only certification.
- No cross-profile mutation, unsafe replay, plaintext crypto fallback or repository-integrity regression under injected failures.
- All native ABI/page-size and approved performance/security budgets pass; unresolved blocking defects prevent release.
- NAV01 passes actual phone/tablet/foldable/IME/rotation journeys: top row below server/project header, icon + short text, single-line horizontal scrolling, row visible with IME and one selected content area. All panels remain reachable; no FAB/IDE/Runtime/More menu/secondary navigation/wide-screen terminal-panel dock, and returning preserves the original live session/controllers.
- Verification: run changed consumer behavior and record actual output/state; use [execution guide](./execution-guide.md). Compilation/tests alone do not satisfy native-surface acceptance.

## Risk Assessment

- Test fixtures can accidentally hit real user hosts; require explicit isolated endpoint allowlist and disposable roots.
- Emulator-only success misses hardware IME/OEM/memory behavior; physical ARM64 device mandatory.

## Security Considerations

- Test logs/artifacts redact passwords/MFA/passphrases/tokens/cookies/capabilities/private content; encrypted test secrets not committed.
- No privileged host suspend/reset/public tunnel against non-disposable targets without operator-controlled acceptance setup.

## Next Steps

Only GATE-C-qualified scope proceeds to Phase19 signed release; otherwise fix the owning phase and rerun affected acceptance without narrowing requirements.

## Unresolved Questions

- Resolve this phase's dependency/device/license/capability decisions in the acceptance ledger before marking done; escalate retained requirements that cannot be met rather than narrowing scope.
