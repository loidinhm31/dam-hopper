# OS Desktop Polish — Cycle 2 Code Review

- **Score: 5/10**
- **critical_count: 1**
- **Disposition: request changes; terminal retry safety is release-blocking.**

## Scope and evidence

Inspected current changed action/catalog/coordinator/executor, shell/Dock/launcher/palette, settings hydration/delivery, chooser apps, terminal/resource hosts, deep links, persistence/pins, canvas/frame/window operations, input consumers, Rust preference schema/merge/TOML normalization, and representative unit/browser/E2E coverage. Read PDR, code standards, architecture contracts and Cycle 1 report. Traced terminal creation through existing transport, API and PTY manager to establish consequences. No production code, tests or plan status changed. No build, lint, tests or live reproduction run; Main owns validation. All behavioral consequences below are **source-derived [INFERENCE]**, not runtime observations. Coverage percentages unavailable.

## Critical issues

### C1 — Repeated Launch can destructively recreate an already-created PTY

**Evidence:** `packages/ui/src/os/action-executor.ts:303-308`; `packages/ui/src/os/apps/TerminalsApp.tsx:35-43,96-119,154-156,242-249`; `packages/ui/src/os/OsResourceHost.tsx:216-220`; `server/src/api/terminal.rs:178-190`; `server/src/pty/manager.rs:1594-1605,1635-1636`.

New Terminal initializes `requestedTerminalId`, but no `sessionId`/`terminalId`. TerminalsApp creates the requested ID, then checks only `currentWin.appState.sessionId ?? terminalId`; that comparison fails for the executor-created window and returns before provenance update and success settlement. ResourceHost independently mounts `${profileId}:${window.id}`, not the requested ID. The created PTY therefore cannot attach through this window's host. `finally` enables Launch again; clicking it reuses the same dispatched ID without another reservation/state check. The API forwards the ID to manager.create; manager explicitly kills any existing session with that ID before recreation. Replacement failure does not preserve the original PTY.

**Impact:** repeated ordinary UI action can terminate a live PTY and its work; successful attempts remain unresolved. **Confidence: high, source-established control flow.**

**Correction:** use one exact launch/attach identity throughout executor, app, keep-alive host and post-await guard; gate every create by the durable attempt's single-dispatch state. Settle originating success independently of presentation lifetime, durably before publication. Never resend a dispatched ID after success or uncertainty. Validate with create-call count/ID, actual attachment identity, journal receipt and a disposable PTY lifetime oracle.

## Warnings

### W1 — High: ambiguous failures release the launch guard

`packages/ui/src/os/apps/TerminalsApp.tsx:104-111,145-152`; `packages/ui/src/os/persistence.ts:1107-1112,1250-1263`.

Catch unconditionally settles `confirmed-not-created`, including network timeout/disconnect and the explicitly thrown owner-change error after successful creation. Those outcomes cannot prove no PTY exists and permit a new compatible reservation. Use `uncertain` after dispatch unless authoritative API semantics prove non-creation. Preserve exact successful orphan provenance even when owner/window retires; do not turn known success into non-creation. Success also needs validated exact incarnation, not unconditional `String(sessionRes.incarnation)` at lines128/140, and awaited durable settlement before UI publication.

### W2 — High: ordinary terminal producers still bypass the journal and lose target semantics

`packages/ui/src/os/OsShell.tsx:357-386`; `packages/ui/src/os/apps/TerminalsApp.tsx:96-103`; `packages/ui/src/os/action-executor.ts:245-278,287-310`.

`terminal:open` still creates directly, outside reserve/settle, and ignores newly declared requested-ID/generation/destination/directory-kind metadata. The new journaled app sends project/cwd but omits `target` and `worktreePath`; an exact worktree or workspace-folder request no longer reaches the corresponding server target branch. Executor also lacks post-reservation owner/destination revalidation. Route all ordinary producers through one captured creation path and preserve the complete payload; reject contradictions instead of defaulting.

### W3 — High: launch persistence remains fail-open against its safety contract

`packages/ui/src/os/persistence.ts:1012-1063,1107-1112,1122-1134,1172-1194`; `packages/ui/src/os/action-executor.ts:256`.

Missing Web Locks falls back to process-local locking; absent localStorage is treated as an empty successfully writable journal. Reads cast records without full validation. The 8192-byte record limit is unused and document bounds count UTF-16 code units, not UTF-8 bytes. Endpoint identity is hardcoded `default-endpoint`, with no alias/replacement ambiguity handling. Explicit IDs are accepted merely when absent from retained records, not backed by fresh allocation provenance. Capability, malformed-state and identity ambiguity must block creation. Validate the entire bounded document and exact settlement provenance under the shared lock.

### W4 — High: chooser reconnect fences still compare the current owner to itself

`packages/ui/src/os/apps/EditorApp.tsx:61-66,76-109,194-216`; `packages/ui/src/os/apps/BrowserApp.tsx:46-83,169-177`; `packages/ui/src/os/window-context.tsx:42-43`; `packages/ui/src/os/action-executor.ts:339-345,375-381`.

WindowContext adopts the newest snapshot generation. The chooser checks that live owner against the same snapshot; it never checks captured `presentation.ownerGeneration`, delivery token or original destination. A chooser opened before reconnect can still promote under the new owner lifetime. Editor collision comparison now includes lexical target/path, an improvement, but it still promotes before canonical server document identity and uses a text field rather than the required authorized Files selection flow. Browser collisions omit generation; neither collision path explicitly switches desktops. Fence the original transaction through selection/loading/promotion; resolve canonical identity before exclusivity.

### W5 — High: workspace deep links still inherit unrelated ambient targets

`packages/ui/src/os/OsShell.tsx:217-234`; `packages/ui/src/os/deep-links.ts:448-478`.

Explicit project links now construct the right profile-qualified target. However, an explicit-profile link without `project` still receives ambient `activeProject` and ambient `profileId` as target. Example: workspace editor link to B while A/project-X is selected yields owner B but target A/project-X. Qualifier verifies only parsed profile versus owner, not supplied target versus owner, and prefers the supplied target. A file consumer can consequently route to A. Resolve a workspace target under the explicit profile; never use unrelated ambient project/target. Validate tuple consistency at qualification.

### W6 — Medium: filename search delivery still opens content mode

`packages/ui/src/os/action-executor.ts:193-209`; `packages/ui/src/os/OsShell.tsx:1167-1203`; `packages/ui/src/os/apps/SearchApp.tsx:146-153`; `packages/ui/src/components/organisms/SearchPanel.tsx:77-83`.

DoubleShift now dispatches the correct `search.filename` action, but the handler drops intent `mode`, `target` and `generation`, retaining only query. SearchApp never supplies a mode; isolated SearchPanel initializes `content`. Deliver and consume the exact owner/target/mode for both new and reused search windows. A dispatch-only test would miss this integration defect.

### W7 — Medium: keyboard and palette contexts remain incomplete

`packages/ui/src/os/action-dispatch.ts:125-154,175-186,200-236,245-267`; `packages/ui/src/os/CommandPalette.tsx:134-153`; `packages/ui/src/os/action-executor.ts:54-60,324,363,404`.

Empty-desktop keyboard context contains no selected desktop owner/defaultCtx, disabling profile actions despite a selected connected server. Palette supplies windowContext but no owner or top-level target, causing generation 1/workspace fallbacks downstream. DoubleShift reset occurs after capture/IME/modal early returns, so those intervening events do not invalidate a pending gesture. Reuse a single immutable current-context capture and reset gesture state at every ownership/composition boundary.

### W8 — Medium: Appearance delivery remains sticky and overrides later Devices navigation

`packages/ui/src/os/apps/SettingsApp.tsx:20-31,39-42`.

Field alignment now works, but `requestedSection` remains `appearance` in appState. Clicking Devices changes requestedTab, rerunning the effect; the still-present section forces General again. Consume each deliveryId once at SettingsApp's tab-selection boundary. SettingsPage's own consumed-delivery ref does not prevent this parent effect.

### W9 — Medium: iframe visibility and position tracking do not meet maximize continuity

`packages/ui/src/os/OsResourceHost.tsx:42-51,80-88,90-125`.

Slot updates mutate the object already held in React state; the subscriber sets the same reference, allowing React bailout while the geometry effect depends on `[slot]`. ResizeObserver/resize/scroll do not observe a same-size position-only move. An iframe can remain visible/hidden incorrectly or at its old position. This is an inherited implementation gap in the newly claimed continuity behavior, not an assertion of a newly introduced backend defect. Publish immutable slot snapshots and observe presentation position changes without iframe navigation.

### W10 — Medium: launcher modal registration does not supply a focus lifecycle

`packages/ui/src/os/AppLauncher.tsx:44-73,136-154`; `packages/ui/src/os/shell-input-context.tsx:104-112`.

Modal-depth registration now blocks configured background actions and pin key propagation is corrected. But registration only counts tokens: the plain dialog div still has no Tab focus trap, background inertness or opener restoration. Reuse the established dialog/focus primitive instead of treating accounting as full modality.

### W11 — High acceptance gap: completion claims still exceed executable qualification

`packages/ui/e2e/os-desktop-polish/os-desktop-polish.spec.ts:19-20,50-61,63-83`; `plans/261105-0711-os-desktop-polish/reports/implementation-handoff.md:5-20`; `docs/CHANGELOG.md:4-8`.

The inspected E2E uses the terminal observer only for viewport reset, conditionally skips maximize, and has no PTY-byte, attach/replay, iframe heap-context, Monaco undo/dirty/selection, two-tab/restart or screenshot-capture assertions. Yet journal safety, usable chooser fencing and runtime continuity are marked PASSED/guaranteed. Prior reported unit/browser passes cannot prove these boundaries. Preserve qualification as incomplete until real named oracles and artifacts exist; no assertion here that reported tests never ran.

## Suggestions — security, performance, architecture, YAGNI/KISS/DRY

1. One context capture/validation helper for Dock, launcher, palette, desktop menu, keyboard and deep links; no ambient substitution or generation-1 authority.
2. One typed Appearance delivery shape. Current producer duplicates `section` and `settingsSection` and consumer accepts both; choose the contract's canonical field and migrate tests/callers, rather than retaining a shim.
3. Use the shell delegate for focus cycling as well as palette (`action-executor.ts:166-190`); current cycling duplicates shell logic and omits its actual DOM focus step.
4. Reuse the existing authorized Files picker and editor identity/open flow; do not establish a parallel free-text resource-selection convention.
5. Remove unused executor imports, unused in-flight Promise scaffolding, and no-op browser-shortcut hook once call sites are cut over. Avoid adding generic launch/recovery abstractions beyond the agreed journal.
6. Surface ActionResult and pin persistence failures. DesktopCanvas supplies no onNotice (`DesktopCanvas.tsx:206-224`); menu blocked results and `toggleDockPin` failures are otherwise discarded.
7. Supply actual owned portal roots to cursor synchronization (`OsShell.tsx:81-85`), not only shellRoot; body-portaled menus do not inherit shell cursor variables.
8. Keep native-key hot paths allocation-light: static descriptor/binding projections can replace repeated Object.values/parsing once correctness is restored. No measured performance bottleneck claimed.
9. Main's targeted regression checks: executor→real TerminalsApp→host→journal; uncertain response fencing; reconnect chooser promotion; B workspace deep link with A ambient; DoubleShift→filename mode; empty-desktop shortcut; Appearance→Devices→repeat Appearance; same-size iframe drag/hide/show; two coordinator consumers cleaning up in both orders. Follow with designated integrated checks and real continuity qualification, not structure-only assertions.

## Positive observations

Presence-aware hydration now retains explicit null OS/font shortcuts. Module-scoped coordinator callbacks plus idempotent teardown remove the specific reference-count cleanup defect. Direct Dock callback retains captured context. Appearance producer/consumer fields agree. Launcher pin key propagation and modal accounting are improved. Rust finite bounds, targeted TOML null encoding and canonical immutable pin snapshots remain sensible narrow designs.

## Unresolved evidence

No reviewer-executed runtime/build/test/lint results. Actual multi-profile routing, PTY byte/lifetime probes, two-tab/restart safety, iframe/Monaco/xterm continuity and visual qualification remain for Main's validation. No unresolved product question blocks the corrections above.
