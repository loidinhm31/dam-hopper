# OS Desktop Polish — Cycle 4 Code Review

- **score: 5/10**
- **critical_count: 1**
- **Disposition: request changes.** The renderer/remote distinction repairs the original creation-control dead-end; it does not yet establish a usable fresh terminal or safe retry.

## Scope and evidence

Reviewed the C1 delta in `packages/ui/src/os/apps/TerminalsApp.tsx`; traced executor, resource host, keep-alive host, TerminalPanel, transport, journal, restore projection and owner context. Re-inspected Cycle 3 carryovers in shell producers, chooser apps, deep links, search, input dispatcher, palette, Settings, iframe host, launcher and qualification claims. Read README, PDR, code standards, installed development rules/code-review skill, frozen architecture contracts and previous review. This is a C1 delta plus affected-call-chain/carryover review, not a new exhaustive audit of every pre-existing repository subsystem or unchanged preference/backend implementation.

No production/test/plan-status edits. No reviewer-run builds, tests, lint or live reproduction; checks remain main/tester-owned. Failure consequences below are **source-derived [INFERENCE]**, not observed runtime failures. Tester peer explicitly confirms its assigned suites do not exercise executor → OsResourceHost → TerminalsApp with initially empty inventory, deferred create and actual attach/output/input assertions. Advisor consultation was used to challenge finding scope; conclusions below rely on directly inspected source.

## Critical issues

### C1 — Fresh creation can succeed without starting the terminal attachment lifecycle

**Evidence:** `packages/ui/src/os/apps/TerminalsApp.tsx:107-168,198-215`; `packages/ui/src/os/OsResourceHost.tsx:211-234`; `packages/ui/src/components/organisms/TerminalPanel.tsx:204-216,643-644,1021-1023,1388-1398`; `packages/ui/src/api/ws-transport.ts:3302-3308`.

The resource host mounts TerminalPanel before the asynchronous create completes. If its initial inventory returns empty, the panel sets attachment state to idle and never starts its recovery controller. A later successful create writes incarnation/epoch fields to appState but not the `target`/runtime identity that the host forwards as `terminalTarget`. Thus the panel's supported target-driven rebind is never triggered. `terminal:changed` only probes when a process restart is already pending; it does not rescue initial creation. The create transport branch returns metadata, not an implicit attach.

**Failure/impact:** with inventory-before-create ordering, the overlay disappears because an incarnation is present, while the xterm remains unattached and stdin stays gated. A remote PTY exists but the fresh executor-created terminal is unusable without an unrelated lifecycle change. This is a release-blocking terminal regression, not a demonstrated security exploit. **Confidence: high** for the source control flow; live reproduction pending.

**Correction:** settle validated originating creation provenance, then propagate the exact target through the existing host/panel rebind seam. Do not infer successful attachment from an incarnation field or add blind create/retry. Acceptance must defer create until the first inventory is proven empty, then assert exactly one create, attach/replay completion, visible PTY output and usable stdin.

## Warnings

### W1 — High: fresh-ID retry leaves the kept-alive renderer bound to the previous ID

`packages/ui/src/os/apps/TerminalsApp.tsx:240-255`; `packages/ui/src/os/OsResourceHost.tsx:223-234`; `packages/ui/src/components/organisms/TerminalKeepAliveHost.tsx:75-89`; `packages/ui/src/components/organisms/TerminalPanel.tsx:237,451-458,729-731,1041-1046,1523-1547`.

Retry now correctly reserves a new attempt/ID, but the panel React key remains the window ID. Its main effect depends on profile/transport, not session ID, and data/input listeners retain the old `safeSessionId`. The registry effect searches the new key rather than moving the old entry, so it does not repair the binding. A genuinely different PTY identity needs explicit lifecycle handling, distinct from preserving a runtime during mere presentation changes. Add a real failed-attempt → fresh-ID retry → output/input regression.

### W2 — High: ambiguous outcomes are still authoritatively released; owner-change uncertainty is overwritten

`packages/ui/src/os/apps/TerminalsApp.tsx:123-129,169-177`; `packages/ui/src/os/persistence.ts:1236-1263`.

The error-message substring classifier labels timeout, abort, malformed response and most server/network errors `confirmed-not-created`, although creation may have happened. The owner-change branch first settles uncertain, then throws `Connection owner changed during launch`; that message contains neither lowercase `generation` nor `connected`, so catch settles `confirmed-not-created`. The journal unconditionally accepts the second transition, reopening compatible creation. Classify by pre-dispatch proof versus dispatched/unknown outcome, not English text. Unknown post-dispatch outcomes must remain blocked.

### W3 — High: awaited settlement is not authoritative success validation or a post-await fence

`packages/ui/src/os/apps/TerminalsApp.tsx:131-168`; `packages/ui/src/api/client.ts:202-211`; `packages/ui/src/os/persistence.ts:1210-1277`.

The returned settlement status is ignored. Missing epoch skips settlement but still publishes incarnation/success presentation. `String(sessionRes.incarnation)` can be `"undefined"` or a rounded unsafe integer, ignoring available `incarnationExact`. Closing/replacing the window returns before recording known successful provenance. Ownership/window/attempt currency is checked before settlement await, not after it, so a late callback can publish into a retired/replaced presentation. Validate exact target/response identity, record originating success even for an orphan, honor uncertain write results, then recheck the captured owner/destination/window/attempt before UI publication.

### W4 — High: dispatch authorization remains presentation-local and optional

`packages/ui/src/os/apps/TerminalsApp.tsx:41-42,89-107,198-215,218-255`; `packages/ui/src/os/persistence.ts:43-48,1086-1207`.

The send boundary checks appState booleans, not the durable attempt/ID binding or captured reservation generation. Manual launch can send without any attemptId. Restore drops attempt/dispatched/provenance and retains sessionId; its Launch button can create using a previously used ID without consulting surviving unresolved history. The backend can terminate and replace an existing same-ID PTY (`server/src/pty/manager.rs:1847-1852`). Retry also publishes after reservation await without revalidating its original window/owner/destination, and records activeDesktopId rather than the window's captured destination. Consume one exact durable reservation at the send boundary; stale/restored/unknown tokens must never authorize another create. Reentrant/StrictMode execution should be covered, not assumed safe from React state guards.

### W5 — High carryover: ordinary intent producers still bypass the journal

`packages/ui/src/os/OsShell.tsx:357-386,406-429`; `packages/ui/src/os/action-executor.ts:245-278,287-313`.

`terminal:open` creates directly, ignores captured generation/destination/requested-ID metadata, and publishes to whichever desktop is active after await. Executor also does not revalidate captured destination/owner after reservation. The C1 app now forwards wireTarget, which fixes that local omission, but does not migrate these remaining producers. Route ordinary creation through one captured, lossless request/reservation path; reject contradictory owner/target tuples.

### W6 — High carryover: journal storage/capability and identity ambiguity remain fail-open

`packages/ui/src/os/persistence.ts:1012-1063,1107-1189,1228-1263`; `packages/ui/src/os/action-executor.ts:256`; `packages/ui/src/os/apps/TerminalsApp.tsx:224-238`.

Missing Web Locks falls back to process-local locking; missing localStorage silently reads/writes as empty/success. Parsed records are cast without full validation; limits count UTF-16 units, not UTF-8 bytes, and no per-record cap is enforced. Endpoint binding remains `default-endpoint`, with no alias/replacement ambiguity fence. Caller IDs are accepted merely when absent from retained records. Settlement does not validate reserved terminal ID/provenance or legal state transitions. These violate the frozen fail-closed C3/C12 contract. Block missing authority/capabilities and malformed/ambiguous state; validate the complete bounded document and token-bound transitions under the shared lock.

### W7 — High carryover: chooser transactions adopt the current owner lifetime

`packages/ui/src/os/window-context.tsx:42-45`; `packages/ui/src/os/apps/EditorApp.tsx:61-109,194-216`; `packages/ui/src/os/apps/BrowserApp.tsx:46-83,169-177`.

Checks compare current owner props with current connection state, not the chooser's originally captured owner/delivery/destination. A chooser survives reconnect and can promote under the new lifetime. Editor still uses free-text lexical paths instead of the contracted authorized Files/canonical selection flow. Browser collision checks omit generation; both collision focus paths omit desktop switching. Fence the original transaction and reuse existing selection/focus conventions.

### W8 — High carryover: explicit-profile workspace links can inherit another profile's target

`packages/ui/src/os/OsShell.tsx:217-234`; `packages/ui/src/os/deep-links.ts:448-478`.

Without an explicit project, target construction borrows ambient profile/project selection even when the link names another owner. Qualification verifies parsed owner but does not verify supplied target against that owner. Resolve workspace context under the explicit profile and reject contradictory tuples; never borrow ambient authority.

### W9 — Medium carryover: Filename Search still opens content mode

`packages/ui/src/os/action-executor.ts:193-209`; `packages/ui/src/os/OsShell.tsx:1167-1203`; `packages/ui/src/os/apps/SearchApp.tsx:146-153`; `packages/ui/src/components/organisms/SearchPanel.tsx:76-89`.

The executor sends filename mode, but the handler drops mode/target/generation and isolated SearchPanel initializes content mode. Preserve and consume the complete delivery for new and reused windows.

### W10 — Medium carryover: keyboard/palette context and gesture reset remain incomplete

`packages/ui/src/os/action-dispatch.ts:125-154,175-186,200-236,245-267`; `packages/ui/src/os/CommandPalette.tsx:134-153`; `packages/ui/src/os/action-executor.ts:194-198,245-250`.

Empty-desktop capture omits selected desktop context/owner; running-window context omits owner. Palette omits owner/top-level target, so execution can use generation 1/workspace fallbacks. Capture/IME/modal early returns bypass DoubleShift reset. Share immutable qualified capture; reset gestures at ownership/composition boundaries.

### W11 — Medium carryover: Appearance delivery traps subsequent Devices navigation

`packages/ui/src/os/apps/SettingsApp.tsx:20-31,39-42`.

Retained appearance section forces General again whenever requestedTab changes. Consume each delivery ID once at tab-selection authority; do not continually enforce a historical section request.

### W12 — Medium carryover: iframe visibility/geometry updates can be dropped

`packages/ui/src/os/OsResourceHost.tsx:42-51,80-88,90-125`.

Slot updates mutate the object already held in React state, so same-reference setState can skip the geometry effect. ResizeObserver/resize/scroll do not capture same-size position-only movement. Use immutable slot snapshots and actual presentation-position observation without iframe navigation/remounting. This inherited gap remains relevant to the new continuity claims.

### W13 — Medium carryover: launcher modal accounting lacks modal focus lifecycle

`packages/ui/src/os/AppLauncher.tsx:44-73,136-154`.

The plain dialog registers modal depth but lacks focus trapping, background inertness and opener restoration. Reuse the established dialog primitive instead of maintaining a second incomplete modal convention.

### W14 — High acceptance gap: claimed qualification does not cover the blocking behavior

`packages/ui/src/os/app-launch-journal.test.ts:91-150`; `packages/ui/e2e/os-desktop-polish/os-desktop-polish.spec.ts:19-20,42-61`; `plans/261105-0711-os-desktop-polish/reports/implementation-handoff.md:5-20`.

Journal tests accept invalid epoch/numeric provenance and success IDs unrelated to reservation. The E2E checks a frame and conditionally skips maximize; the observer only resets viewport/zoom. It does not prove fresh PTY creation/attachment/I/O, retry, cross-tab/reload safety, Monaco undo/dirty/selection, iframe JS context or zero attach/replay continuity. Tester confirms the fresh/deferred creation pipeline is absent from its assigned suite. Mark these acceptance claims incomplete pending behavioral evidence; do not reinterpret a passing broad suite as these missing oracles.

## Suggestions — security, performance, architecture, YAGNI/KISS/DRY

1. Use one small terminal attempt state machine around existing reserve/settle and target-driven panel rebinding. Separate reserved/dispatched/confirmed/uncertain from renderer-ready and stream-attached. No new recovery service, polling scaffold or command bus.
2. Reuse one exact terminal identity and one immutable owner/target/destination projection across executor, app, host and post-await guards; remove competing ID precedence and English-text failure classification.
3. Preserve conservative safety even when it blocks retry indefinitely. A reachable Retry button is not authorization to forget an uncertain request or resend an old ID.
4. Delete newly unused `generateUUID` import and unused `hasRendererRegistered` state/subscription updates in `TerminalsApp.tsx:16,80-82,279`, unless the renderer state serves an actual UI purpose. Avoid needless registry-triggered renders; no measured performance bottleneck claimed.
5. Reuse existing Files picker, modal and cross-desktop focus primitives. Surface blocked ActionResult/pin-persistence errors instead of silently dropping them. Do not add abstraction solely to satisfy file-size rules.
6. Main-owned checks should cover deferred fresh creation after empty inventory; known non-creation versus lost response; owner change before/after settlement; window close/retry during settlement; fresh-ID retry attachment and I/O; reload/two-tab dispatch fences; exact target/worktree; and the carried chooser/search/Settings/iframe behaviors.

## Positive observations

Renderer registration no longer controls launch-overlay visibility. Reserved windows now initiate creation independently of a transient registry lookup. The app forwards filesystem wireTarget, clears local retry error and reserves a fresh attempt/ID pair. Awaiting success settlement is a better ordering than the prior fire-and-forget path. These are useful corrections, but a successful create response is not proof of a usable attached terminal, and awaiting an ignored result is not authoritative durable confirmation.

## Unresolved evidence

No reviewer-executed runtime/build/test/lint results. Actual fresh/retry PTY usability, uncertain/reload/two-tab safety and runtime continuity remain unqualified here. No unresolved product decision blocks the source corrections identified above.
