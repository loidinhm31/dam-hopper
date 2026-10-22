---
title: "Android terminal rendering, retained history, and replay repair"
description: "Preserve rendered text and reading position; remove replay duplicates and demonstrated VT redraw artifacts."
status: completed
priority: P1
branch: feat/android-native-app
tags: [bugfix, android, kotlin, compose, terminal]
created: 2026-10-23
---

# Android terminal remediation

## Scope and routing

Complex-fix route, then existing-plan code workflow for this focused remediation. Related baseline: [Android native app](../261015-1647-android-native-app/plan.md); do not advance its release phase. User requests planning, actor assignments, and coordinated fixes for the preceding Android investigation. Keep existing native Kotlin/Compose terminal architecture; no server/web/Tauri changes, dependency replacement, PTY restart, automatic keystroke replay, or speculative IME workaround.

## Evidence baseline

Prior `evc-debugger` investigation compiled unchanged production terminal classes and exercised two temporary JVM harnesses. Confirmed: cursor blink changes rendered row count (3→1→3) and content revision; screen auto-scrolls every revision; entire history becomes new styled strings; shrinking grid loses bottom/right text. Source-proven ordinary reattach race can render live bytes then the same delta replay (OLD, NEW, NEW); surface-boundary reproduction, not live transport proof. DECAWM disable and delete-character are ignored, producing demonstrated ghost rows/suffixes. Ordinary live dedup, replay CPR/DA suppression, and no synthetic local input echo worked. No device was attached during investigation; Android FPS/visual/IME behavior remains unqualified.

## Design and contracts (integration owner: parent)

1. Preserve original domain boundaries and owner/generation/incarnation fences. Keep bounded scrollback; do not retain unlimited raw output or repeatedly parse history.
2. Unchanged grid rows retain cached styled representations. Dirty rows invalidate on every mutation, erase, shift, reset, resize, and alternate-screen operation. Cursor styling must not regenerate all history or change output geometry. Blink never advances `VtTerminalSurface.updateRevision`; actual content/geometry publications do.
3. `VtTerminalSurface.lines` remains observable `AnnotatedString` rows for the active screen. Add `lineIds: List<Long>` with unique stable row identities suitable for Compose keys; IDs survive row scrolling into history and cannot collide across reset/alternate buffers. Maintain existing public feed/resize/blink APIs unless clean caller migration is required.
4. Main-buffer viewport resize preserves displaced text within the existing history bound, including horizontal shrink/grow and cursor anchoring; implement coherent wrap/reflow semantics, not resurrection of erased content. Alternate buffer remains isolated and without scrollback. Both dimensions remain positive.
5. Repair demonstrated `CSI ?7h/l` (DECAWM) and `CSI P` (DCH), including reset defaults, default/zero parameter handling, and wide-cell integrity. Do not advertise full xterm conformance.
6. Add `TerminalSessionController.beginAttach(): ULong`: synchronously closes/reset replay gate, preserves accepted offset and current rendered text, returns captured replay request offset. Caller invokes before asynchronous work, sends null only for offset zero. Delta replay uses byte-offset reconciliation, never rolls accepted offset backward; reset snapshots/incarnation changes stay authoritative. Gaps do not silently skip missing bytes. Input and protocol replies stay fenced until replay drains.
7. UI follows output only while already at bottom; user scrolling disables following until returning to bottom. Cursor blink must not trigger scroll. List state is session-scoped, stable row IDs anchor retained history. Measure monospace glyph width/line height using the same text style/density/font scale as displayed rows; no second Compose soft wrapping.
8. Remove active screen's REST prefill that bypasses controller replay ownership; authoritative WebSocket replay remains. All attachment callers in active and retained shells enter replay gate before sending. Reattach exceptions must not leave input enabled against an uncertain baseline.

Attachment clarification: invoke `beginAttach()` exactly once per attempt. Controller recovery invokes it before callbacks; recovery callers consume the provided offset without a second reset. Serialize/coalesce pending sends per controller, without new retries or wire fields. The protocol has no attach-attempt ID; same-incarnation reset snapshots remain authoritative.

## Actors and exclusive file ownership

| Actor | Role | Exclusive files | Dependencies |
|---|---|---|---|
| Parent | Architecture, top-level plan, integration, final evidence | This plan; docs/architecture/android-native-client.md; no shared source edits while child owners active | All terminal reports before dependent work |
| TerminalCore (`evc-fullstack-developer`) | Cached rows, cursor presentation, resize preservation, VT gaps | `features/terminal/VtTerminalGrid.kt`, `VtTerminalEngine.kt`, `VtTerminalSurface.kt`, `VtTerminalCell.kt`; focused engine/surface/grid JVM tests; narrowly scoped terminal helper files if needed | Contracts above |
| ReplayCore (`evc-fullstack-developer`) | Begin-attach API, delta reconciliation, replay fencing | `features/terminal/TerminalSessionController.kt`, `TerminalReplayGate.kt`; related controller/gate JVM tests | Contracts above |
| TerminalUi (`evc-ui-ux-designer`) | Follow policy, stable list keys, measured geometry, attachment caller migration | `ui/screens/ProjectTerminalScreen.kt`, `WorkbenchScreen.kt`; narrowly scoped terminal presentation helper/test | Exact surface/controller APIs above; no edits to core files |
| Verification (`evc-tester`) | One integrated compile/test pass and real-code smoke, device surface if reachable | No production edits; temporary harness outside tracked source only | All implementation actors complete |
| Review (`evc-code-reviewer`) | Correctness, performance, lifecycle/security review | Read-only | Verification report |
| Documentation (`evc-docs-manager`) | Update live behavior and honest qualification status | `native-app/README.md`, relevant architecture subsection/acceptance docs by handoff | Successful smoke; no concurrent parent docs edits |

Paths under `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/` unless otherwise stated; JVM tests under sibling `src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/`.

## Execution

- [x] Planner refine detailed implementation phase against these fixed boundaries; return risk/acceptance report, not competing top-level scope.
- [x] Spawn TerminalCore, ReplayCore, TerminalUi together; wait for all three terminal reports. No build/lint/test/formatter mid-flight. Agents add only behavioral regression tests, do not run checks until integrated.
- [x] Verify contracts/callsites, integrate necessary corrections under explicit file handoff.
- [x] Run verification actor after integration. One targeted shared JVM test pass plus Android compile/build; real production-class smoke for changed paths. Inspect actual UI when device/emulator available; never substitute JVM proof for Android visual evidence.
- [x] Run exactly one code reviewer per cycle; resolve correctness findings and repeat affected checks.
- [x] Update docs and completion ledger with exercised evidence and unresolved device gates. Do not auto-commit or push.

Detailed phase: [phase-01-terminal-remediation.md](./phase-01-terminal-remediation.md) (planner-owned creation).

## Acceptance gates

- Blink keeps row count/IDs/content revision stable; unchanged history not re-styled per blink/output. Dirty-row publications maintain styles and terminal semantics.
- A user reading history stays anchored during blink and new output, including bounded eviction; bottom-follow still works and switches cleanly between sessions.
- Shrink/grow preserves main text/cursor within stated bound; width reflow never duplicates/drops wide glyphs; erase/reset and alternate screen still authoritative.
- DECAWM-off overwrites right edge instead of wrapping; DCH shifts and blanks the row, preserving wide-cell invariants.
- Live-before-delta replay, queued-live overlap, duplicate/stale delta, reset/truncation, gaps, and incarnation transitions never append the same accepted bytes twice or leak replay replies/input.
- All attach callsites use captured offset from `beginAttach`; no direct REST writes to surface in active flow.
- Integrated shared JVM tests and Android compilation succeed, or exact external prerequisite recorded without false completion. Smoke must exercise real changed classes. Device visual/performance gate cannot be marked passed without observed device evidence.

JVM suite 111/111 passed (`dev.damhopper.nativeapp.features.terminal.*`). Android `:androidApp:assembleDebug` successful. Production-class smoke passed on real compiled classes. Device visual/IME/performance gate remains BLOCKED_PENDING_DEVICE (no attached Android hardware). Code review completed with 9.5/10 score.
## Unresolved questions

No product decision blocks source fixes. Exact user echo trigger/application, device/keyboard/font scale, and attached device availability remain diagnostic/qualification unknowns; do not invent answers or change IME behavior speculatively.
