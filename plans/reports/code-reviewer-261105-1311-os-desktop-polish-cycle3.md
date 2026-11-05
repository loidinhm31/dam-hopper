# OS Desktop Polish — Cycle 3 Code Review

- **score: 5/10**
- **critical_count: 1**
- **Disposition: request changes.** The original same-mounted-window repeat-ID path is mitigated, but the identity alignment exposes a release-blocking fresh-terminal launch dead-end. Durable dispatch/retry safety remains incomplete.

## Scope and evidence

Re-reviewed the C1 changes in `packages/ui/src/os/action-executor.ts`, `apps/TerminalsApp.tsx`, and `OsResourceHost.tsx`; traced their real shell, keep-alive host, TerminalPanel, registry, persistence and creation callers. Rechecked current source for Cycle 2 carryovers in chooser apps, window context, deep links, input dispatcher, palette, Search, Settings, iframe host, launcher and qualification claims. Read PDR, code standards, published development rules/code-review skill, architecture contracts and Cycle 2 report. This is a delta/carryover review, not a new whole-repository audit.

No production code, tests or task/plan status edited. No reviewer-run build, lint, tests or live reproduction. Behavioral consequences below are **source-derived [INFERENCE]**, not runtime observations. Tester peer reports its five assigned verification gates passed, but explicitly states existing checks do not cover executor → resource host → app PTY creation/usability; that peer report is not independently exercised verification here.

## Critical issues

### C1 — Fresh terminal windows hide their only creation control before a PTY exists

**Evidence:** `packages/ui/src/os/action-executor.ts:295-316`; `packages/ui/src/os/OsResourceHost.tsx:202-235,255-261`; `packages/ui/src/components/organisms/TerminalPanel.tsx:450-459,1252-1253,1388-1398`; `packages/ui/src/os/apps/TerminalsApp.tsx:85-107,198-212,255-283`; `packages/ui/src/lib/terminal-registry.ts:30-33,60-77`.

Executor reserves a fresh ID and opens a window; it does not create the PTY. ResourceHost immediately mounts a TerminalPanel with that same ID. TerminalPanel registers its local xterm before inventory verification. TerminalsApp's lookup/subscription equates this registry entry with `hasAttachedTerminal`, hiding the entire inactive-session overlay and its sole `handleLaunchSession` button. Missing remote inventory leaves TerminalPanel idle; its recovery create callback explicitly rejects. No independent creation effect exists in TerminalsApp.

**Failure/impact:** the fresh executor-created terminal renders a local xterm but cannot ordinarily start a remote PTY. Its dispatch-capable reservation also remains unresolved and blocks another compatible reservation. A possible transient button click before registration is not a valid launch mechanism. Pre-created sessions from other producers can attach; this finding concerns the executor's fresh-window path, not every terminal producer.

**Confidence:** high, source-established cross-component control flow; runtime reproduction pending. Classified Critical under the review rubric's breaking-change category, not as a demonstrated security exploit or data-loss event.

**Correction:** separate local renderer registration from confirmed remote creation/attachment. Keep an explicit, reachable launch operation for a fresh reservation, with one durable attempt authorizing exactly one send. Do not fix visibility by reintroducing blind create/retry. Main's acceptance oracle: actual executor → OsResourceHost → TerminalsApp with empty inventory, reachable creation control, exactly one create with the reserved ID, durable exact receipt, and usable attached PTY output.

## Warnings

### W1 — High: retry remains stuck after any launch error

`packages/ui/src/os/apps/TerminalsApp.tsx:79-81,155-157,181-190,277-292`.

Retry changes appState `createError` but never clears local `launchError`. The button branches on that local error, so after failure every subsequent click rotates IDs again instead of invoking launch. Clear presentation error only as part of a permitted state transition; do not treat clearing it as authorization to retry an uncertain request.

### W2 — High: fresh-ID rotation is not a fresh durable reservation; dispatch gate is presentation-local

`packages/ui/src/os/apps/TerminalsApp.tsx:36-37,83-100,143-162,181-190`; `packages/ui/src/os/persistence.ts:43-48,1228-1263`.

Retry replaces requested/session/terminal ID and resets `dispatched`, but retains the old `attemptId` and performs no reservation. If the UI dead-ends are repaired without addressing this, a later create can bypass compatible unresolved history and settle the old receipt with a different terminal ID; settlement accepts this mismatch. This path is currently masked by C1/W1, not claimed runtime-exercised. Restored-window appState keeps only sessionId/cwd, and the app's create handler never checks the surviving durable journal; an appState boolean cannot establish cross-reload single-dispatch authority.

Use the surviving journal as authority at every create boundary. Unknown outcomes remain blocked; after authoritative non-creation, reserve a distinct attempt/ID pair. Never reuse a token across identities or rely on persisting a UI flag as the safety fix.

### W3 — High: ambiguous failures still settle as definitely not created

`packages/ui/src/os/apps/TerminalsApp.tsx:108-127,133-162`; `packages/ui/src/os/persistence.ts:1107-1112,1239-1263`.

Timeout/disconnect and the explicit owner-change exception after successful creation all reach `confirmed-not-created`, reopening compatible creation although a PTY may exist. A removed/replaced window returns before settling known successful provenance. Publication precedes unawaited settlement; its result is ignored. `String(sessionRes.incarnation)` is used without validating exact/safe numeric provenance.

Distinguish proven pre-dispatch rejection from uncertain post-dispatch outcomes. Durably settle exact originating success even for an orphan, before presentation publication; retain uncertainty on missing proof/write failure. Preserve authoritative exact incarnation rather than stringifying arbitrary numbers.

### W4 — High: ordinary producers still bypass the journal and lose exact target semantics

`packages/ui/src/os/OsShell.tsx:357-386,406-429`; `packages/ui/src/os/action-executor.ts:245-278,287-313`; `packages/ui/src/os/apps/TerminalsApp.tsx:100-106`.

`terminal:open` still creates directly outside reservation/settlement and ignores the newly declared owner-generation/requested-ID/destination metadata. The journaled app omits target/worktree wire fields. Executor does not revalidate captured owner/destination after reservation. Route ordinary producers through one captured creation path, preserving complete target/cwd/worktree/owner/destination and rejecting contradictions; no ambient retargeting.

### W5 — High: persistence remains fail-open against the stated safety contract

`packages/ui/src/os/persistence.ts:1012-1063,1107-1134,1142-1189`; `packages/ui/src/os/action-executor.ts:256`.

Missing Web Locks falls back to process-local serialization; absent localStorage is treated as a writable empty journal. Records are cast without full validation, byte limits use UTF-16 length, and the per-record bound is not enforced. Endpoint binding remains `default-endpoint`, with no endpoint/alias ambiguity fence; caller IDs need only be absent from retained records, not proven fresh. Block creation on capability/identity/malformed-state ambiguity; validate the complete bounded UTF-8 document and token/provenance under the shared lock. Existing-window focus can remain available.

### W6 — High: chooser fences adopt a reconnected owner instead of checking the captured transaction

`packages/ui/src/os/window-context.tsx:42-45`; `packages/ui/src/os/apps/EditorApp.tsx:61-109,194-216`; `packages/ui/src/os/apps/BrowserApp.tsx:46-83,169-177`.

Both chooser callbacks compare a current owner prop to the current snapshot, not `presentation.ownerGeneration`/delivery token/original destination. A pre-reconnect chooser can promote under the new lifetime. Editor uses free-text lexical identity instead of the contracted authorized Files/canonical document selection; Browser collisions omit generation; collision focus does not switch desktops. Fence the original transaction through selection/authorization/load/promotion and reuse existing resource-selection identity conventions.

### W7 — High: explicit-profile workspace deep links still inherit unrelated ambient targets

`packages/ui/src/os/OsShell.tsx:217-234`; `packages/ui/src/os/deep-links.ts:448-478`.

Without an explicit project, owner B can receive ambient A/project-X as target. Qualification validates parsed profile against owner but not supplied target against owner, and prefers that supplied target. Resolve workspace target under the explicit profile and reject contradictory tuples; do not borrow unrelated ambient selection.

### W8 — Medium: filename search still opens content mode

`packages/ui/src/os/action-executor.ts:193-209`; `packages/ui/src/os/OsShell.tsx:1167-1203`; `packages/ui/src/os/apps/SearchApp.tsx:146-153`; `packages/ui/src/components/organisms/SearchPanel.tsx:76-89`.

Executor emits filename mode, but the handler drops mode/target/generation and SearchPanel's isolated state initializes content mode. Preserve and consume the full delivery on both new and reused windows.

### W9 — Medium: keyboard/palette contexts and DoubleShift resets remain incomplete

`packages/ui/src/os/action-dispatch.ts:125-154,175-186,200-236,245-267`; `packages/ui/src/os/CommandPalette.tsx:134-153`; `packages/ui/src/os/action-executor.ts:194-198,245-250`.

Empty-desktop keyboard capture omits the selected desktop owner/default context. Palette omits owner/top-level target, triggering generation-1/workspace fallbacks. Capture/IME/modal early returns skip DoubleShift invalidation. Reuse immutable qualified context capture and reset gesture state at ownership/composition boundaries.

### W10 — Medium: Appearance navigation remains sticky

`packages/ui/src/os/apps/SettingsApp.tsx:20-31,39-42`.

The retained Appearance section forces General whenever Devices changes requestedTab. Consume each delivery token once at the parent tab-selection boundary, rather than continually enforcing the section.

### W11 — Medium: iframe slot visibility/position updates can be lost

`packages/ui/src/os/OsResourceHost.tsx:42-51,80-88,90-125`.

Slot update mutates the object already held in React state; setSlot can bail on the same reference and skip the geometry effect. ResizeObserver/resize/scroll do not cover same-size position-only movement. Publish immutable snapshots and observe actual presentation positioning without navigating/remounting the iframe. Inherited implementation gap still invalidates the newly claimed continuity guarantee.

### W12 — Medium: launcher modal accounting is not a focus lifecycle

`packages/ui/src/os/AppLauncher.tsx:44-73,136-154`.

The plain dialog registers modal depth but provides no focus trap/background inertness/opener restoration. Reuse the existing dialog/focus primitive instead of implementing a parallel incomplete modal convention.

### W13 — High acceptance gap: existing checks do not establish the claimed behavioral guarantees

`packages/ui/src/os/action-executor.test.ts:160-199`; `packages/ui/src/os/app-launch-journal.test.ts:91-150`; `packages/ui/e2e/os-desktop-polish/os-desktop-polish.spec.ts:19-20,42-61`; `plans/261105-0711-os-desktop-polish/reports/implementation-handoff.md:5-20`; `docs/CHANGELOG.md:4-8`.

Executor tests never mount the terminal creation flow. Journal tests accept arbitrary requested IDs and success provenance with invalid epochs/numeric incarnations. E2E checks a window frame and conditionally maximizes; it does not launch a PTY or assert byte/lifetime/attach/replay, Monaco undo/dirty/selection, iframe JS-context, two-tab/restart or visual-capture oracles. These tests cannot substantiate the handoff's completed/guaranteed safety and continuity claims. Retain those acceptance gates as incomplete until the named behavioral evidence exists; this is not an assertion that previously reported checks did not run.

## Suggestions — security, performance, architecture, YAGNI/KISS/DRY

1. One small terminal attempt state machine around existing reserve/settle helpers; no separate retry/recovery service. Distinguish renderer-ready, reserved, dispatched, confirmed and uncertain; keep network authority outside presentation state.
2. Use one terminal identity projection across executor/app/host/post-await guard. Current ID precedence differs: app prioritizes requested ID, while host/guard prioritize session ID. Normalize once; retain only necessary state rather than multiplying aliases.
3. Use one immutable owner/target/destination capture across action surfaces and deep links. Reject absent authority rather than using generation 1/default-endpoint/workspace substitutions.
4. Remove unused executor imports/in-flight Promise scaffolding/no-op browser hook after callers are migrated. Reuse shell focus-cycle and established dialog/Files primitives rather than parallel implementations.
5. Surface blocked ActionResult and pin-storage failures. Keep static binding projections out of repeated native-key allocation paths; no measured bottleneck claimed.
6. Main-owned validation: real fresh terminal launch, known failure versus uncertain response, reload/token fencing, exact request ID/target/worktree, owner/destination retirement, stale chooser, cross-profile workspace deep link, filename mode, Appearance → Devices, same-size iframe moves, and original runtime-continuity/two-tab oracles. Existing broad checks do not substitute for these.

## Positive observations

Executor now initializes sessionId/terminalId from the reserved requested ID; host fallback and post-create guard include requestedTerminalId. The mounted app now has a pre-send dispatch flag and avoids the former direct repeated same-ID button flow. Those are useful local corrections, but local xterm existence is not proof of server creation and an ID rotation is not durable retry authorization. Existing typed catalog, bounded appearance controls, immutable pin snapshots and presence-aware nullable shortcut hydration remain sensible narrow designs.

## Unresolved evidence

No reviewer-executed runtime/build/test/lint results. Actual fresh PTY usability, uncertain/reload/two-tab safety and runtime continuity remain unqualified by this review. No unresolved product decision blocks the source corrections above.
