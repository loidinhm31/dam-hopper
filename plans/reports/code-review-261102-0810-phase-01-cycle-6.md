# Cycle 6 Code Review — Phase 01: Lifecycle prototype first

## Score: 6/10 — changes required

### Scope / overall assessment

Focused review of C1/C2 and H4/H5 corrections; security, performance, architecture, YAGNI/KISS/DRY. Approximately 2,400 source/test lines inspected selectively, plus requirements and previous-cycle evidence. Used published `code-review/SKILL.md`, development rules, README, PDR and code standards.

**H4 destination validation and H5 marker alignment are corrected structurally.** Duplicate encryption-provider shadowing and ambient generation props are removed. **C1/C2 remain unsafe:** encrypted policy uses an invented generation and encrypted completion can clear newer edits; terminal retirement still permits ambient transport binding. CSS pointer suppression is not a keyboard/transport ownership fence.

Report-only changes. No source or plan/task-state modifications; coordinator retains plan ownership under this assignment's no-TODO-tracking constraint. No reviewer test/build/lint execution; existing Cycle 6 tester results attributed below. Runtime consequences below are **[INFERENCE] from inspected control flow**, not reproduced incidents.

## Requested fix disposition

| Item | Disposition | Evidence |
|---|---|---|
| C1: remove nested `EncryptProvider` | **Addressed structurally.** Shell consumes host context; browser fixture supplies its own root provider. | `OsShell.tsx:106–108,219–223`; `embed/dam-hopper-app.tsx:334–335,454`; browser test `:29–35` |
| C1: owner-qualified encrypted save | **Not resolved.** Lookup now accepts an owner, but that owner hard-codes generation 1 and is not passed to `saveText`; completion remains unfenced. | `MonacoKeepAliveHost.tsx:163–188`; Critical C1 |
| C2: remove ambient generation plumbing | **Addressed structurally.** Shell/Canvas no longer pass selected-profile generation; provider reads the window's own profile snapshot. | `OsShell.tsx:24–26,214–217`; `DesktopCanvas.tsx:9–17,45–50`; `window-context.tsx:36–55` |
| C2: disconnected input isolation | **Partial only.** Pointer suppression present; attachment, focused keyboard input and transport callbacks are not gated by it. | `TerminalsApp.tsx:40–61,83–99`; Critical C2 |
| C2: qualified terminal deduplication | **Addressed for ordinary equal raw IDs across profiles.** Merge includes profile ID; delimiter key remains noncanonical/collision-prone. | `OsResourceHost.tsx:210–223`; Suggestion S1 |
| H4: destination-pane validation | **Addressed for reported stale-pane path.** Nonempty destination requires `findTilePaneById` before any source removal/window mutation; empty desktop initialization preserved. No dedicated regression. | `window-ops.ts:474–483,485–550`; `window-ops.test.ts:143–165` |
| H5: slot-marker alignment | **Addressed for reported selector mismatch.** Capture handler and rendered slot both use `data-os-window-slot`. Full input contract still incomplete; no rendered-slot regression. | `WindowFrame.tsx:151–162,218–224,327–332`; Warning W4 |

## Critical issues — MUST FIX

### C1 — Encryption policy uses the wrong generation; async completion can falsely declare newer text saved

**Evidence:** `packages/ui/src/os/MonacoKeepAliveHost.tsx:163–188`; `contexts/EncryptContext.tsx:52–65,196–216`; `hooks/use-encrypted-write.ts:121–137,283–351`; `stores/editor.ts:891–937,1318–1332`; `components/atoms/LockToggle.tsx:27–45`.

- Policy lookup constructs `{profileId, generation: 1}` instead of capturing the current connected owner. Context keys include generation. For an enabled `{A,g}` policy where `g !== 1`, the lookup misses, creates a disabled entry and takes ordinary `store.save` → `fsWriteFile`. **[INFERENCE] An encryption-required save can take the plaintext path.** Existing LockToggle also writes ambient policy, whereas this handler reads qualified policy; removing provider shadowing alone does not reconcile these authorities.
- `saveText` receives no explicit owner, so it resolves an owner independently from the policy lookup. A policy checked for generation 1 is not a policy checked for the actual transport generation.
- Handler neither captures tab request identity nor checks ownership/content after upload. Hook checks freshness before `fsPutSave`, not after its final response. `markSaved` clears dirty and copies the *then-current* tab content to `savedContent`.
- **[INFERENCE] Save A, type B before upload completes: backend receives A; success marks B saved.** A late completion can also affect a reopened same-key tab. The ordinary store save already preserves `savedContent` from the submitted snapshot; the new encrypted branch does not.
- Missing passphrase becomes `""` without distinguishing a cached session from a missing session/prompt. The handler also bypasses ordinary saving/dirty/availability guards and does not surface encrypted failure to the tab/UI.

**Correction:** capture the real connected owner once; use it for policy, session/passphrase and explicit `saveText` owner. Establish one explicit encryption-policy authority with existing controls; do not add an ambient fallback to hide the mismatch. Reuse/extract the existing save/request flow, including prompt/cancel and visible failure handling. Fence completion by owner, tab request identity and submitted text/edit revision; only submitted bytes become `savedContent`, newer edits remain dirty. Unknown/stale encryption requirements must fail closed, never silently select plaintext.

**Confidence:** high for key mismatch and dirty-state mutation; consequences source-derived, not runtime reproduced.

### C2 — Profile retirement still allows ambient binding; pointer-events does not isolate terminal input

**Evidence:** `packages/ui/src/os/OsResourceHost.tsx:184–208`; `os/apps/TerminalsApp.tsx:40–61,83–99`; `components/organisms/TerminalPanel.tsx:405–438,817–825,1095–1116`; `api/connections.ts:339–344,762–790`; `api/transport.ts:131–150`.

- Resource host reads connection snapshots inside a memo dependent only on `sessionWindows`. Retirement does not itself recompute this list; the parked panel can survive owner removal. Unknown literal `default` is explicitly exempted from initial rejection.
- `removeProfileConnection` removes the snapshot and notifies subscribers. TerminalPanel's connection listener then selects `ambient:<generation>` for a missing owner; binding obtains ambient `getTransport()` and enables stdin. Input forwarding only checks that binding's `isCurrent` and replay gate, not the OS owner.
- New `pointerEvents: none` blocks pointer targeting, not keyboard/paste on an already-focused xterm textarea. Attachment effect still runs without `owner.isConnected`, subscribes to registry changes and can schedule terminal focus. CSS cannot prevent the panel's socket attachment or output subscriptions either.
- **[INFERENCE] Retire A while another ambient profile B is available and has the same raw terminal ID: A's parked surface can attach/read/write through B.** A disconnected banner does not establish fail-closed routing.

**Correction:** fail closed at the qualified transport-binding/input boundary on missing, retired or disconnected owner, including every connection callback. Never enter ambient routing for a supplied qualified profile, including the string `default`. Preserve xterm/scrollback but disable stdin and owner-specific subscriptions until revalidated; UI pointer treatment is supplemental. Add two-profile equal-ID retirement and retained-focus keyboard/paste regressions.

**Confidence:** high for fallback and missing gating; cross-profile network outcome source-derived, not runtime reproduced.

## Warnings — SHOULD FIX

### W1 — Editor adapter still fabricates a loaded file instead of opening the requested target — High

`MonacoKeepAliveHost.tsx:113–144,235–244` appends an empty, non-loading, available, normal-tier tab with `mtime: Date.now()` and no stat/read. Missing project/path become `global` / `untitled.ts`. Ordinary save later submits that fabricated mtime (`stores/editor.ts:915–920`). **[INFERENCE] Existing files appear blank; saves can conflict or operate from a draft unrelated to backend bytes.** No new-buffer semantics or real file-opening flow exists here.

**Correction:** enter the existing owner-bound file-open/load flow with real metadata and availability before enabling editing. Represent a genuine unsaved buffer explicitly; reject unresolved file/project targets. This also removes duplicated tab defaults and save policy. **Confidence: high, source-only.**

### W2 — Monaco parking still reparents a React-owned host node — High

`MonacoKeepAliveHost.tsx:67–92,150–161,191–220,277–284` moves the keyed React-rendered wrapper from its original parent into a disposable app slot. Closing the last window removes that keyed child while React expects its original parent; app cleanup reparks it only in an effect (`EditorApp.tsx:50–69`). **[INFERENCE] Close/unmount can encounter a DOM ownership/removal failure.** Registration cleanup also deletes solely by key (`MonacoKeepAliveHost.tsx:34–44`), without entry identity.

**Correction:** keep a stable React-owned wrapper and move an imperatively owned attachment boundary, following established resource-host patterns; identity-check unregister. Qualify actual Monaco close/StrictMode/undo and inactive-desktop transitions. **Confidence: high structural risk; exception not reproduced.**

### W3 — Real resource/controller integration and lifecycle gate remain incomplete — High

- Terminal launch invents `<profile>:default` with empty command instead of selecting/discovering/creating through the existing manager (`OsResourceHost.tsx:193–205`; `TerminalsApp.tsx:18–20`).
- Terminal claim uses the latest observed incarnation, not a pinned verified target (`TerminalsApp.tsx:22–35`). Shared TerminalPanel accepts newer incarnation data/buffers (`TerminalPanel.tsx:549–568,664–695`); required changed-incarnation unavailable/recovery behavior is not enforced by this adapter.
- Browser root constructs raw per-window iframes, even for denied duplicate claims (`OsResourceHost.tsx:153–173`; `BrowserApp.tsx:25–55`). It does not reuse the specified controller. Pure float translation has no size/scroll event to update overlay geometry (`OsResourceHost.tsx:86–121`), and fixed z-index 20 disagrees with focused float 30/maximized 50 (`WindowFrame.tsx:195–211`). **[INFERENCE] Dragged previews can lag their slot or be covered.**
- No `/os` integration found in inspected embed source, and no lifecycle E2E path found. These remain open tasks, not an unexpected regression of a completed route.
- Browser “JavaScript state” test stores `iframe.dataset.domMarker`, not state inside the iframe document (`browser-tests/os-lifecycle.browser.tsx:232–248,291–295`). Other component assertions do not measure real xterm/editor identity or attach/replay/reset deltas.

**Correction:** complete the planned existing-controller integrations and coherent route-level qualification before advancing the lifecycle gate. Assert real in-document state, real Monaco model/undo and PTY instance/counter behavior; test reconnect separately. Avoid another fallback ID or parallel resource framework. **Confidence: high for inspected wiring/coverage; visual consequences source-derived.**

### W4 — H4/H5 fixes lack targeted regressions; H5 is not full input-contract completion — Medium

`window-ops.test.ts:143–165` tests docking into an empty desktop, not missing-pane rejection on a nonempty tree. Add same-desktop floating/tiled and cross-desktop stale-pane cases: original session unchanged, source placement/focus preserved, `validateOsSession` valid; retain valid cross-desktop focus coverage.

`WindowFrame.tsx:151–188` now identifies the real slot correctly but ignores `frame-focused-handled`; `input-arbiter.ts:58–83` has no shortcut-capture exemption. Root-host iframe keyboard events also do not traverse this frame's capture handler. Existing arbiter unit tests pass context booleans, not events originating inside the rendered slot/toolbar or physical terminal/preview input.

**Correction:** add real rendered-slot/toolbar regressions, then qualify remaining frame/app/shortcut-capture/iframe precedence against the stated contract. Do not reopen H4/H5's exact reported structural defects; those corrections are present. **Confidence: high, source/test inspection.**

## Suggestions — NICE TO HAVE

1. **S1: Canonical qualified terminal identity.** Replace `${pId}::${sId}` (`OsResourceHost.tsx:214–216`) with existing `terminalKey({profileId:pId,id:sId})` (`api/ownership.ts:126–129`). Avoid collisions such as `['a::b','c']` vs `['a','b::c']` and another identity convention.
2. Stabilize per-resource editor targets. Every windows-object change rebuilds target objects (`MonacoKeepAliveHost.tsx:228–251`) and retriggers initialization effects (`:113–144`), including unrelated floating-window updates. Resource-key-based initialization avoids repeated scans; no benchmark performed.
3. Preserve the good simplifications: one host encryption provider, own-profile connection subscription, one editor host per tab key, qualified terminal merge, early destination validation and one slot marker. Prefer extracting only genuinely shared loading/save/attachment behavior over growing a second editor/browser stack.

## Reviewed files

Primary implementation/test sections:
- `packages/ui/src/os/OsShell.tsx:1–223`
- `packages/ui/src/os/MonacoKeepAliveHost.tsx:1–290`
- `packages/ui/src/os/OsResourceHost.tsx:1–231`
- `packages/ui/src/os/window-context.tsx:1–75`
- `packages/ui/src/os/DesktopCanvas.tsx:1–119`
- `packages/ui/src/os/apps/TerminalsApp.tsx:1–105`
- `packages/ui/src/os/apps/EditorApp.tsx:1–103`
- `packages/ui/src/os/apps/BrowserApp.tsx:1–94`
- `packages/ui/src/os/window-ops.ts:440–560`
- `packages/ui/src/os/window-ops.test.ts:1–196`
- `packages/ui/src/os/WindowFrame.tsx:100–236,308–335`
- `packages/ui/src/os/input-arbiter.ts:1–84`
- `packages/ui/browser-tests/os-lifecycle.browser.tsx:1–95,217–330`

Supporting ownership/save/attachment code:
- `packages/ui/src/contexts/EncryptContext.tsx:1–245`
- `packages/ui/src/hooks/use-encrypted-write.ts:1–370`
- `packages/ui/src/stores/editor.ts:865–993,1310–1348,1565–1655`
- `packages/ui/src/components/organisms/EditorTabs.tsx:85–205`
- `packages/ui/src/components/atoms/LockToggle.tsx:1–100`
- `packages/ui/src/components/organisms/TerminalKeepAliveHost.tsx:1–100`
- `packages/ui/src/components/organisms/TerminalPanel.tsx:393–454,535–574,651–697,801–859,1080–1135,1170–1306`
- `packages/ui/src/lib/terminal-host-attachment.ts:1–63`
- `packages/ui/src/api/connections.ts:1–105,220–280,326–352,754–797`
- `packages/ui/src/api/transport.ts:124–165`; `api/ownership.ts:110–140`
- `packages/ui/src/lib/tile-tree.ts:250–365`
- Embed encryption-provider and route callsites located by search.

Requirements/evidence: README `:1–120`; PDR `:1–100`; code standards `:1–130`; Phase 01 `:1–275`; overview `:1–85`; Cycle 5 reviewer report `:1–189`; Cycle 6 tester report `:1–97`.

## Validation commands / results

**Reviewer executed:** `git diff --stat && git status --short` for scope — 5 tracked modified, 15 untracked entries at inspection; `date +%y%m%d` — `261102`. Read/search inspection only. No reviewer compilation, tests, lint or production bundle commands; no duplicate validation while tester/integration owner owns execution.

**Existing tester evidence, not independently rerun:** `plans/reports/tester-261102-0801-phase-01-cycle-6-validation.md:5–8,19–31,47–90`. Report records HEAD `d2b4b65d12753270d0533864062f229f17e84b4d` and matching pre/post 29-file fingerprint `c272b50075b501309ab28ab8ca48ea1cf507620a43e7c934d4ca4e97b4de39f0`. Reviewer did not recompute fingerprint; attribution is to that recorded snapshot, not independent certification of all current bytes.

| Command | Reported result |
|---|---|
| `pnpm --filter @dam-hopper/ui test src/lib/tile-tree.test.ts src/lib/terminal-layout-docking.test.ts src/components/organisms/SplitLayout.test.ts src/os` | Exit 0; 7 files, 52 tests passed |
| `pnpm --filter @dam-hopper/ui test` | Exit 0; 335 files, 3,128 tests passed |
| `pnpm --filter @dam-hopper/ui test:browser os-lifecycle.browser.tsx` | Exit 0; Chromium, 7 tests passed |
| `pnpm --filter @dam-hopper/ui build` | Exit 0; `tsc -p tsconfig.json`, 0 compiler errors |

Tester records two non-failing jsdom navigation diagnostics and React act-environment warnings in verbose browser diagnostics. No lint count, numeric type/test coverage, web production bundle or real lifecycle E2E result established. Passing commands do not resolve control-flow findings.

## Recommended actions / task completeness

1. Resolve C1 real-owner encryption policy and revision-fenced completion; resolve C2 qualified-owner retirement/input boundary before treating adapters as safe.
2. Add focused H4/H5 and C1/C2 regressions; then integration owner runs targeted/unit/browser/typecheck and relevant lint once source settles.
3. Complete real resource adapters and route/qualification contracts; prove xterm identity and zero placement-only attach/replay/reset deltas separately from reconnect.
4. Phase 01 remains **in-progress**. Implementation, route and qualification tasks are explicitly unchecked (`phase-01-lifecycle-prototype.md:273–275`). Review does not mark them complete or authorize Phase 04 progression. Updated plans: none, per report-only/no-TODO-tracking ownership.

## Unresolved questions / evidence

No user clarification required. Missing execution evidence: enabled host/current-generation encryption policy; concurrent edit and stale save completion; profile retirement with another profile/equal raw terminal ID and retained keyboard focus; changed-incarnation recovery; stale-pane no-op; rendered-slot/toolbar/shortcut-capture input; actual Monaco close/undo; real iframe-document state and coherent `/os` PTY lifecycle identity/counters. These remain qualification gaps, not passing acceptance claims.
