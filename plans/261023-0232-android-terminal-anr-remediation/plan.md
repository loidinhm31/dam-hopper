---
title: "Android terminal ANR remediation: atomic display snapshots"
description: "Eliminate the terminal ANR hot path by replacing per-row SnapshotStateList updates with immutable display snapshots and one Compose state publication."
status: completed
priority: P1
branch: feat/android-native-app
tags: [performance, android, kotlin, compose, terminal, anr]
created: 2026-10-23
---

# Android Terminal ANR Remediation: Atomic Display Snapshot

## Problem Statement

When loading a terminal with a large scrollback history (300KB–500KB) or running active AI harness sessions, the Android application freezes and triggers a 5-second `Input dispatching timed out (MotionEvent)` ANR crash dialog.

Root cause confirmed by Android DropBox ANR traces (`dumpsys dropbox --print data_app_anr` at 02:30:48) and debugger profiling:
1. PTY output processing updated terminal rows on the Compose UI path by mutating `SnapshotStateList` collections (`lines` and `observableLineIds`) element by element.
2. Those persistent-vector mutations triggered repeated structural comparisons in `AbstractList.orderedEquals`; with thousands of rows and repeated chunks, the work scaled poorly and blocked UI input.
3. Large scrollback histories (more than 300 KB) and sustained TUI/AI output kept the Android UI thread busy long enough to trigger the 5-second `Input dispatching timed out (MotionEvent)` ANR.
4. Initial replay could appear healthy because it arrived as a snapshot rather than the many fragments seen during live output.

## Implemented Architecture

### 1. Immutable display snapshot
- `RenderedRow` stores a stable row ID and styled text variants; `TerminalDisplaySnapshot` groups rendered rows, Compose lines, row IDs, cursor state, content revision, and generation.
- `VtTerminalSurface.displaySnapshot` is Compose state with `referentialEqualityPolicy()`. Snapshot-reference comparison is O(1); the renderer publishes each completed snapshot through one Compose state assignment instead of mutating a `SnapshotStateList` per row. Snapshot construction visits rendered rows, and downstream Compose invalidation/rendering costs are separate.
- `ProjectTerminalScreen` reads the snapshot as one state value and uses stable row IDs as `LazyColumn` keys.

### 2. Content revision and cursor presentation
- `RenderedRow.baseText` stores the unpadded row text. Revision checks compare row identity and `baseText` identity, so cursor-only presentation changes do not advance the content revision.
- Cursor blinking publishes a presentation update without acquiring `bufferLock` and preserves content revision and row IDs.
- Published snapshots carry `surfaceGeneration`; reset, clear, and close advance it so display state remains associated with the active surface lifetime.

### 3. Scope of this fix
- This remediation removes the per-element persistent-vector comparison hot path. It does not introduce a dedicated background ingestion worker or a 33 ms frame-paced publisher, and it does not claim that parsing or snapshot construction is O(1).
- Existing terminal replay, byte-offset reconciliation, and lifecycle behavior remain in place; broader live-server and device qualification are tracked separately.

## Implemented Areas

1. `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalDisplaySnapshot.kt`
   - Defines `RenderedRow`, `TerminalDisplaySnapshot`, and cursor-presentation updates.
2. `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/VtTerminalSurface.kt`
   - Builds and atomically publishes snapshots, compares unpadded base text for content revisions, and updates cursor presentation without taking `bufferLock`.
3. `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectTerminalScreen.kt`
   - Consumes the published snapshot and keys terminal rows by stable IDs.
4. `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/`
   - Exercises terminal rendering, row identity, cursor presentation, replay, and related behavior.

## Implemented Criteria

- [x] Terminal display is published as one immutable Compose snapshot rather than per-row `SnapshotStateList` mutations.
- [x] Cursor-only presentation updates preserve row IDs and content revision; unpadded `baseText` is used for content revision checks.

## Reported Validation

The remediation handoff reports these results; they were not independently rerun for this documentation update. No standalone emulator log, tested revision, or frame-measurement method is linked here.

- 111/111 shared JVM terminal tests passed.
- `:androidApp:assembleDebug` succeeded.
- A 50,000-line live-stream run on `Medium_Phone_API_36` recorded zero ANRs and zero dropped frames.

## Remaining Qualification

The reported emulator stress result is specific to that run, not a universal no-ANR guarantee. It does not by itself establish touch/accessory-key responsiveness, byte-perfect delivery across all replay/network conditions, full-screen TUI behavior, or final-prompt rendering. These are limits of this performance result, not claims of separate ledger entries; project-level live-server, physical-device, visual, and IME qualification remains open in the [Phase 18 Android Native Acceptance Ledger](../../docs/android-native-acceptance.md#721-phase-18-integrated-device-security-and-performance-qualification-baseline).

## Completion Summary

The task scope identifies the Android terminal ANR remediation as complete and names atomic display snapshots as its resolution; this plan's `completed` status records that fix, not the broader runtime qualifications. The delivered fix replaces per-row state-list mutations with immutable snapshot publication and cursor-only presentation updates. The earlier worker/frame-pacing proposal was not part of this completed scope and is not claimed as implemented. Broader project-level qualification remains open in the Phase 18 acceptance ledger.
