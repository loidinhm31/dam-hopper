---
title: "Phase 16 — Ports tunnels idle consent and host controls"
description: "Expose current remote host/port/tunnel/maintenance capabilities without pretending Android is the execution host."
status: pending
priority: P2
effort: unestimated
branch: feat/android-native-app
tags: [feature, frontend, android, kotlin, compose, ports, tunnels, cloudflared, host]
created: 2026-10-15
---

# Phase 16 — Ports tunnels idle consent and host controls

## Context Links

- [Overview](./plan.md) · [scope and acceptance](./scope-and-acceptance.md) · [contracts/modules](./contracts-and-modules.md) · [execution guide](./execution-guide.md).
- [Proposed architecture](../../docs/architecture/android-native-client.md) · [reviewed research](./research/android-platform-research.md).
- Dependencies: [Phase 06](./phase-06-adaptive-shell-projects-worktrees-and-config.md)

## Overview

- Date: 2026-10-15. Priority: P2. Implementation status: **pending**. Review status: **pending**. Progress: **0%**.
- Scope: P01, H02, C03 remote host actions.
- Goal: Expose current remote host/port/tunnel/maintenance capabilities without pretending Android is the execution host.
- No implementation performed by this plan. Paths and commands below are future work; evidence must be observed, not inferred.

## Key Insights

- Explicit Cloudflared tunnels outlive PTY/origin loss and remain public until stopped; 3h reminder is not expiry.
- Idle consent is bound to a live WS capability; general host-action executor is currently unavailable by server design.

## Requirements

- Remote ports and Cloudflared install/status/create/list/stop/reminder catch-up.
- Idle status/timing/force/consent with capabilities/request revisions and current role/session freshness.
- Remote SSH credential status/load/forget, diagnostics/cache/reset and current host-action capability/audit presentation; no invented updater/restart APIs.

## Architecture

HostControlRepository and TunnelRepository use explicit server owner; exact-socket receipt is requested only for current consent decision. UI distinguishes command admission, current status and observed execution result.

## Related Code Files

Existing references (read/reuse contracts; no server/web modification by default):
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/docs/api/system-services.md`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/docs/api/idle-suspend.md`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/docs/architecture/agent-store-ports-and-browser.md`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/server/src/api/router.rs`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/server/src/api/ws.rs`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/docs/system-architecture.md`

Proposed implementation files (create unless introduced earlier; modify thereafter):
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/TunnelRepository.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/HostControlRepository.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/IdleConsentController.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/HostControlScreens.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/RemoteSshCredentialsScreen.kt`

No deletion of existing web/Tauri hosts or unrelated files. Any necessary backend contract change requires a documented design/compatibility review before code.

## Implementation Steps

1. Implement owner-qualified detected port/tunnel list and explicit Cloudflared install/create/stop flows; mark public exposure, failed/ready/stopped state and current server installation capability.
2. Re-list tunnels after reconnect and reconcile authoritative reminderDue; preserve tunnel identity across port/PTy owner loss, no automatic stop or server-restart restore.
3. Implement idle-suspend status, server capability/reason and mutable complete timing pair; keep startup-owned policy/agent matchers read-only where contract requires.
4. Render pending consent with expiry/revision and explicit approve/deny; obtain exact live-socket connectionId/decisionCapability at action time and discard it on termination.
5. Implement force-suspend request/denial/outcome presentation with explicit host label; uncertain acknowledgement does not auto-retry or claim host already slept.
6. Implement remote SSH key/agent/status/load/forget without local SSH-forwarding engine; maintain server-only credential custody and passphrase interaction rules from actual API.
7. Implement diagnostics export/cache/reset and routed host-action capability/audit/intent flow only where server advertises actual support; preserve unavailable reasons and never add client privilege bypass/updater/restart functionality.
8. Exercise real tunnel origin/PTy loss and explicit Stop/reminder catch-up, stale-socket consent/revocation races, unsupported host actions and isolated maintenance/reset effects. Real host suspend remains an operator-controlled acceptance environment.

## Todo List

- [ ] Deliver remote ports/tunnels and exposure/reminder semantics.
- [ ] Deliver exact-capability idle controls and truthful host state.
- [ ] Deliver existing SSH/maintenance/capability UI without invented execution paths.
- [ ] Update requirement/evidence ledger and affected docs after actual runtime proof; record device/server/version limitations.

## Success Criteria

- Origin loss does not close a live tunnel; Stop affects correct owner ID and stale events cannot mutate replacements.
- HTTP-only/stale receipt or wrong revision cannot approve suspend; admission response is not labelled actual suspension.
- Server-unavailable host actions are explicit; no Android-local executor, generic restart/updater or hidden SSH forwarding.
- Verification: run changed consumer behavior and record actual output/state; use [execution guide](./execution-guide.md). Compilation/tests alone do not satisfy native-surface acceptance.

## Risk Assessment

- Testing suspend/reset on a real development host is disruptive; use operator-selected isolated host and disposable projects.
- Public exposure survives origin replacement; warnings and retained tunnel list must remain accurate.

## Security Considerations

- Decision capabilities/passphrases/diagnostic content redacted and never persisted.
- Explicit destructive confirmation and current role/session checks; no automatic force/retry on denied or ambiguous actions.

## Next Steps

Phase17 integrates settings/privacy and lifecycle for these controls; Phase18 qualifies supported host/OS combinations only.

## Unresolved Questions

- Resolve this phase's dependency/device/license/capability decisions in the acceptance ledger before marking done; escalate retained requirements that cannot be met rather than narrowing scope.
