---
title: "Native terminal font resizing"
description: "Add persisted terminal font sizing through header controls and two-finger pinch without disrupting scroll, focus, or PTY ownership."
status: completed
priority: P2
effort: 4h
branch: feat/android-native-app
tags: [feature, android, kotlin, compose, terminal, preferences]
created: 2026-10-23
---

# Native terminal font resizing

## Overview

Wire the active Project Terminal flow to the existing local font preference. Add `A-`, `${terminalFontSize}sp`, `A+` before `Diag` and `+ New Terminal`; resize through two-finger pinch on terminal output. Reuse measured text geometry and the existing controller resize path.

## Preflight Contract

- **Planning output:** this overview and [Phase 01](./phase-01-terminal-font-resize.md) only; no Kotlin edits, implementation, task-state hydration, or implementation approval.
- **Implementation output:** three existing shared Kotlin files, two existing test files, and scoped architecture/README documentation; exact ownership in Phase 01.
- **Bounds:** `WorkbenchPreferences.clampFont`, 10..32sp; buttons step ±1sp; line height = clamped font size + 4sp.
- **Persistence:** use the injected `PreferencesStore`; initialize from a clamped load, save only changed integer sizes using a fresh load/copy/save. Preserve unrelated preferences. No new preference schema or remote-sync path.
- **Visible default change:** existing stored/default preference wins: fresh installs render 13sp/17sp instead of today's hardcoded 12sp/16sp. At 12sp preserve the 16sp baseline; do not change the preference default.
- **Gesture contract:** `pointerInput(preferencesStore)` + `awaitEachGesture`; calculate zoom and consume changes only at `pressedCount >= 2`. One-finger `LazyColumn` scrolling and tap-to-focus remain intact. Prove pinch completion does not synthesize a tap.
- **Preservation:** JetBrains Mono, `calt 0`, immutable snapshots, row keys, follow intent, replay/input fencing, controller lifetime, and server-owned PTYs stay unchanged.
- **Non-goals:** editor/system font changes, alternate terminal surfaces, transport/protocol changes, new dependencies, scaling transforms, generalized settings observation, telemetry, or retries.
- **Owner:** Main coordinates one serialized implementation owner, one integrated verification pass, and scoped docs ownership; no concurrent writers on the terminal screen.
- **Design gate pending:** coordinator must reconcile the fixed 12sp/16sp architecture description before implementation; authoring scope cannot modify external docs. See first durable task.
- **Related overlap:** [icon/font reuse](../261023-0747-android-icon-font-reuse/plan.md) declares `in_progress` and owns `ProjectTerminalScreen.kt`; Main resolves writer ownership before implementation. Current source already contains the required typography; no dependency inferred from that status label.
- **Informational baseline:** [ANR remediation](../261023-0232-android-terminal-anr-remediation/plan.md); preserve its snapshot/geometry contracts, without treating prior reported results as this feature's evidence.

## Phases

| Phase | Deliverable | Status | Effort |
| --- | --- | --- | --- |
| [01 — Terminal font resize](./phase-01-terminal-font-resize.md) | Policies, store wiring, header/pinch UI, tests, native acceptance, docs | Completed | 4h |

## Acceptance and verification

- Buttons and pinch update the same clamped state, readout, persisted preference, measured text metrics, and active PTY geometry without restart or duplicate attachment.
- Required future checks: `:shared:jvmTest`, `:androidApp:testDebugUnitTest`, `:androidApp:assembleDebug`, plus real multitouch/scroll/focus/relaunch/TUI smoke; source assertions alone cannot qualify runtime behavior.
- Artifacts require valid links, <80-line overview, complete phase sections, one exact durable-task fence, unique IDs, acyclic dependencies, literal file ownership, and matching markers.
- Planning evidence: current source/docs inspected; Advisor design feedback incorporated. Independent route review, final validation/interview, architecture reconciliation, and implementation checks remain coordinator-owned and pending.

## Side-Effect Review Checklist

- [x] Unrelated preference fields preserved; same-size events produce no state change/save.
- [x] No write per pointer event unless the rounded/clamped integer changes; rapid zoom leaves final local/server geometry consistent.
- [x] Single-finger scroll/tap/IME work; pinch lifecycle and cancellation cause no stray focus, scroll jump, or input.
- [x] Header actions reachable on narrow screens and large system font; usable touch targets and accessible labels.
- [x] Session switching, paused follow, replay, TUI reflow, and controller ownership preserved.
- [x] No secrets/output persisted or logged; no schema, permission, security, server, web, or Tauri changes.
- [x] Architecture/README describe the measured variable font and distinguish actual evidence from pending device qualification.

## Unresolved questions

No product decisions outstanding. Coordinator gates: related-plan writer arbitration, architecture design reconciliation, independent review/final validation. Runtime evidence is intentionally not claimed.
