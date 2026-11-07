# Acceptance matrix — approved AC1–10

Status: **all product implementation/qualification pending**. No check here executed in planning. [Approved brainstorm](../reports/brainstorm-261105-0650-os-desktop-polish.md), [C1–C14](architecture-contracts.md), [task-derived ownership](execution-ownership.md), [accepted triage](reports/review-triage.md). Phase IDs below match revised 18-task DAG; parent owns structural parser/follow-up, not runtime approval.

## Exhaustive support graph

| AC | Required outcome / contracts | Implementation tasks | Qualification tasks / layers |
|---|---|---|---|
| AC1 | Actual17 app Open/Focus, no Fleet/obsolete panel, exact qualified target / C1/C2/C11/C12 | define-action-contracts; persist-preference-pipeline; resolve-action-bindings; execute-captured-actions; capture-and-cache-input; integrate-settings-palette | qualify-behavioral-regressions unit/browser; exercise-full-app-journey actual deep-links/choosers; probe-live-terminal-boundary exact protected target |
| AC2 | Remap replaces old chord, null source roundtrip, conflicts/current palette hints / C4/C5 | persist-preference-pipeline; resolve-action-bindings; capture-and-cache-input; integrate-settings-palette | earlier node checks before dependents; qualify-behavioral-regressions; exercise-full-app-journey API/TOML/restart |
| AC3 | One ordered root resolution/privacy physical authority, guards/editor/xterm, zero handled PTY bytes and normal input / C5 | resolve-action-bindings; capture-and-cache-input; scope-desktop-menus; integrate-shell-layout | root-mounted tests in capture-and-cache-input; qualify-behavioral-regressions; exercise-full-app-journey; probe-live-terminal-boundary actual PTY |
| AC4 | Compatible focus/MRU; explicit folder New; real distinct usable Editor/Browser chooser/resources; uncertainty fences / C2/C3/C10/C12 | guard-ordinary-launches; execute-captured-actions; capture-and-cache-input | executor/adapter tests at owning node; qualify-behavioral-regressions; exercise-full-app-journey two tabs/pickers; probe-live-terminal-boundary |
| AC5 | Mounted pins/order/[]/reload/import-export/storage failure/Apps, no close/kill / C6 | persist-and-render-dock; integrate-shell-layout | qualify-behavioral-regressions; exercise-full-app-journey; capture-visual-human-ledger |
| AC6 | Exhaustive shared SVG source, meaningful accessible names/focus/states and fresh theme visuals / C6/C14 | persist-and-render-dock; integrate-shell-layout; integrate-settings-palette | actual Dock/launcher/palette keyboard accessibility tests; qualify-behavioral-regressions; capture-visual-human-ledger plus actual human |
| AC7 | Source-managed appearance/cursor/bindings source/API/TOML reload and wrong-source fences; pins local / C4/C6 | persist-preference-pipeline; expose-appearance-controls; persist-and-render-dock; integrate-shell-layout | P02 real roundtrip before dependent; qualify-behavioral-regressions; exercise-full-app-journey restart/source switch |
| AC8 | Three viewports + supported scale; overflow/chrome/work-area/maximize/restore; runtime lifetime / C7 | define-action-contracts; execute-captured-actions host; persist-and-render-dock; present-maximized-work-area; integrate-shell-layout | qualify-behavioral-regressions; exercise-full-app-journey iframe JS/Monaco/xterm; probe-live-terminal-boundary; capture-visual-human-ledger |
| AC9 | Background-only pointer/keyboard menu/collision/focus/captured owner/privacy/modal; actual repeat Appearance / C8/C13 | execute-captured-actions token; scope-desktop-menus producer; integrate-shell-layout; integrate-settings-palette consumers | root/Settings owned tests; qualify-behavioral-regressions; exercise-full-app-journey; capture-visual-human-ledger |
| AC10 | Optional native cursor owned shell/portals, semantic/system/forced-colors/iframe boundary / C8 | expose-appearance-controls; scope-desktop-menus; integrate-shell-layout | qualify-behavioral-regressions scope; exercise-full-app-journey; capture-visual-human-ledger actual interactive native/human |

P09 document-delivered-contracts covers every row; reconcile-final-handoff reconciles each actual receipt. Every implementation task appears above or is the explicit docs/finalizer support. Each implementation prerequisite gets applicable checks/smoke/review **before** child starts; P08 not first compile pass. All G3 nodes independent, all writers terminal before one coordinator checks/completes each. No checkbox/terminal receipt substitutes completion.

## Required observable scenarios and failure/rollback

### AC1 — real actions and qualified sources
1. Manifest-derived catalog includes all actual17 Open/Focus and only terminal/editor/browser New. Existing scalar-owned actions cannot be extra-map aliases. Singleton Settings/Monitor/Hub/Recipes not needlessly project-filtered; Recipes opening does not execute.
2. Settings/palette/Apps/Dock/keyboard call same executor for Search/Terminals/Files/Git/Ports/Project Info and extra opt-in apps. Session Changes exact eight-tuple only; Conflict Resolver real operation/root or actionable disabled, no scan/fake metadata.
3. Monaco owner/worktree A + selected text while desktop selected B -> text/filename Search and Reveal use A target/generation/path/mode, including authorized workspace without fake project. Parked/unclaimed Monaco no editor authority.
4. Deep links: pure parse unresolved request, actual connected-owner/bound authorization qualifier -> successful workspace/project Search/Reveal; stale URL generation, unavailable/unauthorized target or owner changed during await -> notice/no delivery. Omitted file/URL chooser, no default untitled.ts/localhost. URL values not authority.
5. Existing `os-workspace-apps.browser.tsx` direct Search/Reveal behavioral producers use exact target/current generation and search mode; migrate and run this suite in P03 `execute-captured-actions` before its dependent starts, not only src typecheck or P08.
6. Failure wrong/ambient/fake target or residual Fleet blocks. Coherent owning node repair, not weakened payload or alias.

### AC2 — bindings/null/defaults/conflicts
1. Remap palette/app to new free chord, including delivered formerly browser-blocked Mod+R: once on new chord, old unowned default no action. Explicit null no listener fallback. Browser/OS interception before JS recorded limitation, not false pass.
2. API null -> known TOML empty string -> backend restart -> GET null/client unbound. Missing field -> default, omitted PATCH unchanged, unrelated null not encoded. Cognito null/DoubleShift/wheel rejected with valid frozen dismissal preserved.
3. Two map edits one debounce + unrelated update survive client and server entry merge; {} no-op; malformed/map-null/scalar-owned/unknown rejected without config change. Reset explicit per-command defaults/null extras, appearance defaults preserve valid zero.
4. Effective overlaps name exact conflict, imported invalid duplicates nonexecuting. Protected local copy/find/frame reserved interactions preserved, no listener-order winner. Palette hints current configuration.
5. Failure null/default resurrection/lost entry/old chord action blocks; restore matching lastSavedSettings only. Explicit valid chords before binary downgrade, journal untouched.

### AC3 — ordered root authority and physical input
1. Actual DamHopperApp root listener lifecycle, lazy shell mount/unmount/remount/StrictMode: one keydown/keypress/keyup coordinator; existing Cognito policy first, no duplicate physical toggle. Shell delegate cleanup cannot clear held-key releases.
2. Settings capture, current menu/modal, IME/Dead/Process/AltGraph, desktop/frame/Monaco/xterm matrix. Capture can record browser-reserved chord; menu/modal blocks background command/default while owns interaction. Authoritative menu claim/replacement/release synchronous: claim->immediate key/stdin before React render, replacement/stale release and privacy dismiss->held releases covered. P03 owns seam and tests before root completion; P06 reruns coordinator regression after transfer. DoubleShift resets under guards, ordinary Shift untouched.
3. Full activation/dismissal/repeat/held-key/keyup sequence, frozen activation chord despite preference edit, focus restoration/timers/blur and root cleanup. No keypress/keyup leak after dismissal; no independent Cognito/browser/font listener still registered.
4. One native event cached once -> one action. Terminal only reads handled/owned result, never executes again. Global terminal-font shortcut still page-wide supported behavior, once, blocked under capture/menu/modal; local find/copy/Shift+Enter and editor wheel zoom preserved. Normal remapped/unbound chord input intact.
5. Real authorized server PTY raw-byte observer: handled command zero input bytes/exactly one action; ordinary chars/Enter actual bytes + expected interaction. Guarded stdin uses terminal-input-policy separately from handled event. Record exact probe environment/invocation/output; xterm callback-only evidence insufficient.
6. Cross-origin iframe keyboard outside parent authority; demonstrate dock/palette after returning focus, no keyboard lock/injection. Failure duplicate/leak/swallowed normal bytes blocks; stop dispatcher, retain PTY, repair ordering not preventDefault-all.

### AC4 — reuse/New/directory/picker/uncertainty
1. Compatible usable resource current desktop preferred, then explicit runtime MRU elsewhere; minimized restores. No unrelated profile/worktree fallback. Qualified window entry intentionally switches exact owner/desktop.
2. Files explicit workspace folder/root and project/worktree folder; Git and ProjectInfo producer cases verify full FsTargetRef/worktree/cwd/source/destination/owner/requested ID survives adapter. Existing compatible terminal MUST NOT be reused/cd/HOME fallback. Workspace root cwd dot, invalid/contradictory target rejects. Desktop selection change retains capture; removed destination/retired owner no publication/retarget/kill.
3. Journal same exact folder unresolved Open/New -> one dispatch; known distinct authorized directories -> independent records both retained. Key omits tab/desktop/generation/mode. Supplied arbitrary/previous destructive requested ID blocks pre-network; fresh reservation ID used once, never resend uncertain/closed ID. Existing inventory absence not proof.
4. New Editor/Browser -> actual independent target-selection views; no preselection claim/editor load/iframe/navigation/PTY/server mutation. Editor uses authorized Files selection, Browser explicit valid http/https URL. Select two distinct docs/URLs and interact meaningfully with both usable resource views; assert canonical exclusive claim/root lifetime, not frame count.
5. Cancel closes only picker; repeated New independent pickers. Same already-open canonical doc/URL focuses/restores exact holder across desktops while picker remains with explanation/another selection available. Alias canonical collision no synthetic identity. Context/owner change or late selection after cancel fails closed, never new ambient context. Generic Open compatible usable resource else chooser.
6. Global transaction lock same-key races/distinct-key lost-update, 128 records/8192 bytes/1MiB document bounds, corrupt/unsupported storage, missing locks, reservation/settlement failure/stale token. Existing focus allowed, create blocked. No unresolved eviction.
7. Lost response/reload/crash-before-send/disconnect/profile endpoint replacement/unknown alias/target: indefinite unresolved block; exact originating epoch/incarnation only. No unsafe numeric string, inventory-name/time inference, TTL/retry/dismiss/reset/kill-to-recover. Browser-local intact-storage/cooperating-tabs only, no cross-browser guarantee.
8. Any duplicate creation/lost reservation/unusable distinct target blocks affected AC; freeze creation/preserve journal/PTY receipts, repair coherent node. Original Recipe/F1 gate not closed.

### AC5 — mounted pins
1. Pin unopened from launcher -> mounted Dock; unpin running remains tail until final view close, no PTY kill/pin-driven close. Pins ordered first + stable manifest-order running tail deduped across desktops.
2. Saved [] survives reload, permanent Apps reachable outside overflow; unknown IDs/duplicates normalize without invalid launch.
3. Existing export/import canonical pins; dock-only import updates this mounted tab and other storage-event tab. Obsolete shortcut payload ignored, journal excluded/unchanged.
4. Deny/quota write -> visible unsaved/error, prior durable value retained. Failure blocks; rollback pin state honestly, never resources/safety key.

### AC6 — shared visuals and meaningful accessibility
1. Static exhaustive SVG type map; no permanent wiring/name-map/theme-token-copy assertion tests. Actual dock/launcher/palette keyboard actions identify app via accessible name, decorative SVG semantics sensible with labels hidden/visible, tooltips/focus available.
2. Fresh themes/forced-colors visuals: consistent20px SVG/44px hit targets, focused/running/minimized distinct legible, no emoji/glyph fallback. Automated interactions plus actual human observations, no icon snapshot count as UX pass.
3. Missing legibility/name/focus fails relevant row; fix shared presentation, no per-surface duplicate artwork. Human still pending until real review.

### AC7 — preferences ownership
1. Source A saves appearance/cursor/bindings, reload/restart/hydrate preserve. Switch B/unset/source-removed offline snapshot correct, Settings target independent. Pins local across source switches.
2. Undispatched A edit canceled on source switch; dispatched captured A completion cannot write B; disconnected/stale owner/edit failure cannot roll back newer edit/source.
3. Finite bounds at client/API/TOML import, zero accepted, invalid config unchanged. Old retained Android Fleet patch inert; native nullable DTO source compatibility not native runtime adoption.
4. Failure wrong-source/null loss blocks; matching saved snapshot restore only, no disconnected legacy shortcut namespace.

### AC8 — geometry and actual runtime continuity
1. Real exact1024×640/1440×900/1920×1080 + supported app zoom/system font max: left centered content-height Dock/gutter, overflow app scroller/permanent Apps, menus inside viewport, no unsupported minimum from reserved canvas. Browser support dimensions separate canvas geometry.
2. Nested tile and floating maximize canvas sibling plane above tile ancestors, topbar/dock available; restore exact tile topology/floatBounds/restorePlacement. Resize/minimize/tile/float/desktop moves preserve exclusivity.
3. Same xterm object/exact session, **zero extra transport attach/replay/reset**. Same Monaco editor/model, dirty contents/selection plus usable undo history after transitions. Actual iframe JS heap nonce/counter stays alive; **no navigation/reload**, not DOM identity or Frame proxy equality alone. Controlled fixture page + navigation/load evidence, no product iframe injection. Position-only browser slot moves/visibility track correctly via immutable host snapshots.
4. Any lost lifetime/layout/bounds blocks; restore saved presentation, never recreate runtime to conceal failure.

### AC9 — scoped menu and actual Appearance
1. Blank-background pointer/Menu-key/Shift+F10, arrows/Escape/outside/collision/focus return. Terminal/editor/file tree/iframe body right-click never desktop menu; trigger sibling not ancestor.
2. Menu captured A then selection B/remove A -> no B mutation. Cognito dismisses menu, current modal prevents opening, background keys blocked by owned state.
3. Appearance from new/existing/minimized Settings, existing Devices and manually collapsed Appearance: each fresh delivery token selects General, expands/scrolls/focuses stable section. Repeat same section works; manual collapse afterward allowed, no refetch snap. Settings target/Preferences Source/route unchanged, no DOM label-click implementation.
4. Failure blocks; dismiss stale context with reason, repair typed delivery consumer, no fallback owner/global selector.

### AC10 — native cursor
1. System default; Theme explicit shell and owned menu portal default/pointer, persisted via source pipeline. Interactive text/all resize/move/grab/grabbing/drag retained; forced-colors system, cross-origin preview cursor untouched.
2. No body-wide selector/overlay/trails/mousemove React state. Automated scope/cleanup tests not sufficient to prove native pointer appearance; actual interactive human + fresh visuals mandatory production gate.
3. Failure blocks affected acceptance; System functional fallback while fixing assets/scope, never broaden ownership or inject iframe.

## Future command/evidence ledger — not executed receipts

- Each phase verification lists node-local build/focused tests/smoke/review, checked before dependent. All independent G3 terminal before coordinator batch checks, never concurrent suite storms.
- UI compile: `pnpm --filter @dam-hopper/ui build` is actual `tsc -p tsconfig.json` (`packages/ui/package.json:7`, source inspection only); unit: `pnpm --filter @dam-hopper/ui test` (node-local focused tests before full P08).
- Browser: `pnpm --filter @dam-hopper/ui test:browser browser-tests/os-desktop-polish.browser.tsx browser-tests/os-input-isolation.browser.tsx browser-tests/os-shell.browser.tsx browser-tests/os-workspace-apps.browser.tsx browser-tests/project-worktree-target.browser.tsx browser-tests/terminal-panel-replay-notifications.browser.tsx`.
- Rust: `cargo check --manifest-path server/Cargo.toml`; `cargo test --manifest-path server/Cargo.toml config::tests`; `cargo test --manifest-path server/Cargo.toml api::tests`; `cargo test --manifest-path server/Cargo.toml --test settings_import_export`.
- E2E: `pnpm --filter @dam-hopper/ui test:e2e:typecheck`; `pnpm --filter @dam-hopper/ui test:e2e os-desktop-polish/os-desktop-polish.spec.ts`. Existing authenticated backend-container fixture required; image build only with execution authorization, no mocked replacement.
- P08 report paths: `reports/behavioral-qualification.md`, `reports/full-app-qualification.md`, `reports/live-terminal-qualification.md`, `reports/visual-qualification.md`. Exact real probe invocation/bytes recorded, no invented host command/pass.
- Fresh `packages/ui/e2e/os-desktop-polish/{screenshot.png,fhd.png,compact.png,evidence.json,review.md}` plus supported-scale artifact, hashes/dimensions from capture helper. Human ledger default `PENDING_HUMAN_REVIEW`; artifact generation != production human acceptance.
- P09 `reports/implementation-handoff.md` reconciles every exact task/AC/command/exit/failure/skip/blocker with separate human verdict. All current statuses pending.

## Rollback / remaining gates

Coherent authorized code/config rollback, stop new dispatch/create first, preserve exact live resources/unresolved safety journal/pins/config backup; explicit chords before old-binary downgrade. No destructive Git/storage purge/automatic kill/uncertain retry. External overlapping-plan handoffs required; inherited Recipe/F1/owner/Cognito/live/human gates not closed by this bounded journal or labels. Parent structural checks passed; independent follow-up completed, residual fixture ownership corrected afterward and parent-verified, not independently re-reviewed. No unresolved product question; optional interview not performed, future infrastructure/checks/implementation permission remain separate gates.
