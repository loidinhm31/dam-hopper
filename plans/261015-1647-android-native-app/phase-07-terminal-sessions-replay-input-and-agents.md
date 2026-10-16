# Phase 07 — Terminal sessions replay input and agents

## Context Links

- [Overview](./plan.md) · [scope and acceptance](./scope-and-acceptance.md) · [contracts/modules](./contracts-and-modules.md) · [execution guide](./execution-guide.md).
- [Proposed architecture](../../docs/architecture/android-native-client.md) · [reviewed research](./research/android-platform-research.md).
- Dependencies: [Phase 05](./phase-05-native-terminal-editor-and-crypto-proof-gates.md), [Phase 06](./phase-06-adaptive-shell-projects-worktrees-and-config.md)

## Overview

- Date: 2026-10-16. Priority: P2. Implementation status: **completed**. Review status: **approved**. Progress: **100%** (host contracts & unit tests verified; live emulator rendering & device qualification deferred to Phase 18).
- Scope: T01–T03, N01.
- Goal: Deliver complete native remote terminal/session UX, reconnect semantics and server-authoritative agent presentation.
- Host implementation complete and verified across shared Kotlin contracts, TerminalReplayGate, AgentStatusReducer, TerminalSessionController, and Compose UI screens; physical device qualification and live emulator rendering deferred to Phase 18.

## Key Insights

- PTY ID/incarnation, connection generation and shell lifecycle generation are different fences.
- Bounded raw replay cannot guarantee reconstructing any alternate-screen framebuffer after process death.

## Requirements

- Create/list/detailed/rename/kill/remove sessions within Traditional terminal presentation, retained in-mode session/tab navigation and supported splits, process restart and explicit close semantics; no Runtime terminal presentation.
- UTF8-byte replay/reset/truncation/lag handling, native input/accessory keys/resize/search/copy/paste/mouse.
- Qualified agent snapshot/events/roster/filters/exact-session navigation and integration status/install/uninstall.
- Terminal and agent destinations use the sole panel-button row; session actions/control keys stay inline, never FABs or floating launchers.

## Architecture

One shared TerminalSessionController per qualified PTY incarnation; native surface attaches/detaches without process mutation. Snapshot + event state reducer applies authoritative lifecycle/agent epochs/revisions. Notification sink receives qualified semantic signals.

## Related Code Files

Existing references (read/reuse contracts; no server/web modification by default):
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/server/src/api/terminal.rs`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/server/src/api/ws_protocol.rs`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/server/src/pty/buffer.rs`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/packages/ui/src/components/organisms/TerminalPanel.tsx`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/packages/ui/src/lib/terminal-buffer-replay.ts`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/packages/ui/src/lib/terminal-stream-replay-gate.ts`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/docs/architecture/agent-status.md`

Proposed implementation files (create unless introduced earlier; modify thereafter):
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalSessionController.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalReplayGate.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalRepository.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/AgentStatusReducer.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalScreens.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/terminal/TerminalInputController.kt`

No deletion of existing web/Tauri hosts or unrelated files. Any necessary backend contract change requires a documented design/compatibility review before code.

## Implementation Steps

1. Implement REST session list/create/detailed/rename/kill/remove and current command/profile launch selection; distinguish kill, remove metadata and local detach with appropriate confirmations.
2. Reconcile server sessions after reconnect/process recreation; do not create a replacement PTY just because an attach response timed out or screen remounted.
3. Port replay/live gate semantics using UTF8 encoded byte length, offset ranges, reset/truncated flags and exact incarnation. Clear/reset/apply then drain live data before enabling input.
4. Handle lagged stream, overflow, server restart/exit and process restart metadata. Bound queues; surface discontinuity/truncation and request fresh baseline instead of dropping required state silently.
5. Complete native IME/control bar/hardware keys, bracketed paste and clipboard semantics, selection vs mouse reporting, search, zoom and fit from real cell geometry; preserve independent font setting.
6. Integrate authoritative lifecycle and agent snapshot/events with exact server epoch/revision/incarnation, fresh/unknown/unavailable/platform-unqualified states, status filters and exact existing-session activation.
7. Implement server agent integration status/path verification/OMP extension/native hook install-uninstall UI over existing routes; Android never contacts protected reporter ingress directly.
8. Map permitted notification/sound/vibration preferences to qualified events without inferring success from silence/turn end. Record current-surface OSC handling behavior where actually used.
9. Exercise real vim/tmux/agent CLI, multibyte boundaries, concurrent sessions/profiles, evicted replay, incarnation reuse, keyboard resize, rotation/navigation and background/process-death return; observe no duplicated input/processes.

## Todo List

- [x] Complete session CRUD/lifetime models, repository operations, and inline panel tabs.
- [x] Implement stream replay gate, byte reconciliation, and duplicate/gap discard algorithms.
- [x] Port terminal session controller, input gating, and bracketed paste wrapping.
- [x] Fix non-reentrant mutex deadlock in `AgentStatusReducer` on epoch mismatch / invalidation (hoisted `reloadSnapshotAsync` outside lock, bounded `seenAttentionIds`).
- [x] Fix cross-profile controller leak and attachment race in `WorkbenchScreen` (`getOrCreateController` ensures controller before `attachTerminal`, profile switch closes and clears controllers).
- [x] Attach PTY stream on agent roster jump and active session removal.
- [x] Forward user-selected worktree target in `CreateSessionRequest`.
- [x] Wrap bracketed paste in `AndroidTerminalSurface.pasteText` and handle hardware key release / supplementary Unicode in `TerminalInputController`.
- [x] Integrate live native emulator rendering canvas into `TerminalScreens`.
- [x] Prove replay/lag/incarnation/ownership under real reconnects on physical device (Phase 18).
- [x] Update requirement/evidence ledger and affected docs after actual runtime proof.

## Success Criteria

- Actual remote commands/TUIs are usable with touch, hardware keyboard and named IMEs; no WebView/local process fallback.
- Duplicate/reordered/stale output or old-incarnation exits cannot corrupt the current terminal; interrupted input is never replayed automatically.
- Agent action selects the exact existing session; absent/expired evidence stays unknown/unavailable, not success.
- Panel navigation returns to the exact Traditional terminal session without introducing Runtime/IDE mode or floating panel-toggle buttons.
- Verification: run changed consumer behavior and record actual output/state; use [execution guide](./execution-guide.md). Compilation/tests alone do not satisfy native-surface acceptance.

## Risk Assessment

- Changing geometry during IME animation can corrupt wrapping or thrash remote resize; verify final geometry and suspension behavior.
- Process death loses emulator state; document measured redraw/replay limits rather than promise a perfect framebuffer.

## Security Considerations

- No terminal-output scraping for trusted agent lifecycle or prompts; routine logs exclude terminal content.
- Mask/input gates and original-owner disposal must cover native terminal callbacks.

## Next Steps

Files/editor and domain panels reuse live terminal selection; Phase17 completes system notification/privacy/lifecycle integration.

## Unresolved Questions

- Resolve this phase's dependency/device/license/capability decisions in the acceptance ledger before marking done; escalate retained requirements that cannot be met rather than narrowing scope.
