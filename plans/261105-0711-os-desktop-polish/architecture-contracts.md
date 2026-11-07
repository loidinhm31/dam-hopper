# Frozen implementation contracts — OS desktop polish

Status: **planned, not implemented**. Authority: [approved brainstorm](../reports/brainstorm-261105-0650-os-desktop-polish.md), [binding intake](reports/planning-intake.md), evidence reports and [accepted review triage](reports/review-triage.md). D1–D8 supersede intake's provisional cutover/group placement and the original contracts where noted below; evidence/intake/reviewer reports remain immutable. P01 prepares nonbreaking pure contracts; P02 performs coherent preference cutover; P03 performs coherent intent/resource and root-input cutovers. All source paths project-relative.

## C1. Catalog, IDs, authority and context

`os/actions.ts` owns a small typed descriptor catalog derived from `APP_MANIFESTS`: `id`, `appId?`, label, launch mode, context requirement, binding source/default, enabled explanation. `os/action-executor.ts` is the sole executor. Existing typed intents remain domain delivery, not a new command bus. No scheduler, service, flags, routes, arbitrary scripts or Recipe rewrite.

Stable app IDs and **exact Open / Focus action IDs**, scalar authority where established:

| App | Action ID | Binding source | Eligibility / instancing |
|---|---|---|---|
| Terminals | `app.terminals.open` | `terminalWorkspaceShortcut` | profile; multi-instance |
| Editor | `app.editor.open` | `appShortcuts[app.editor.open]` | exact authorized filesystem context (workspace or genuine project/worktree); multi-instance usable target/chooser per C10 |
| Browser Preview | `app.browser.open` | `appShortcuts[app.browser.open]` | profile; multi-instance |
| Files | `app.files.open` | `terminalFilePanelShortcut` | exact project/worktree or authorized workspace target; worktree-instance |
| Search | `app.search.open` | `searchTextShortcut` | text mode, exact project/worktree or authorized workspace target; worktree-instance |
| Changes | `app.changes.open` | `appShortcuts[app.changes.open]` | project/worktree; worktree-instance |
| Git | `app.git.open` | `gitPanelShortcut` | project/worktree; worktree-instance |
| Conflict Resolver | `app.conflict-resolver.open` | `appShortcuts[app.conflict-resolver.open]` | real operation + root + project, else actionable disabled; project-instance |
| Session Changes | `app.session-changes.open` | `appShortcuts[app.session-changes.open]` | immutable ReviewTarget, else actionable disabled; tuple-instance |
| Workflow & Plans | `app.workflow-plans.open` | `appShortcuts[app.workflow-plans.open]` | project; project-instance |
| Ports & Tunnels | `app.ports-tunnels.open` | `portsPanelShortcut` | profile; profile-instance |
| Project Info | `app.project-info.open` | `projectPanelShortcut` | project; project-instance |
| Agent Store | `app.agent-store.open` | `appShortcuts[app.agent-store.open]` | profile; profile-instance |
| Settings | `app.settings.open` | `appShortcuts[app.settings.open]` | no owner required; single-instance |
| System Monitor | `app.system-monitor.open` | `appShortcuts[app.system-monitor.open]` | no owner required; single-instance |
| Agent Hub | `app.agent-hub.open` | `appShortcuts[app.agent-hub.open]` | no owner required; single-instance |
| Recipes | `app.recipes.open` | `appShortcuts[app.recipes.open]` | no owner required; single-instance; opening UI does not execute recipe |

Only `app.terminals.new-window`, `app.editor.new-window`, `app.browser.new-window` exist as New Window IDs; all use `appShortcuts`, default null. Other apps must not expose New Window. Additional stable IDs: `search.filename` -> `searchFilenameShortcut`; `file.reveal-active` -> `revealActiveFileShortcut`; `terminal.font-increase` / `terminal.font-decrease` -> corresponding established scalar; `privacy.cognito` -> `cognitoModeShortcut`; `os.palette` -> `osPaletteShortcut`; `os.cycle-focus` -> `osCycleFocusShortcut`. Existing frame-close/mode, terminal find/copy and editor font/wheel behavior remain their local authorities, explicitly behind shell/global arbitration; no new duplicate persisted aliases.

Defaults: Text `Mod+Shift+KeyF`, Filename `DoubleShift`, Terminals `Mod+Shift+Backquote`, Files `Mod+Shift+KeyE`, Project Info `Mod+Shift+KeyZ`, Reveal `Alt+F1`, Git `Mod+Shift+KeyG`, Ports `Mod+Shift+KeyP`, terminal increase `Ctrl+Alt+Shift+Equal`, decrease `Ctrl+Alt+Minus`, Cognito `Mod+Alt+KeyB`, palette `Ctrl+Alt+KeyK`, focus `Ctrl+Alt+Escape`. All additional map IDs start unassigned. Established-scalar-owned IDs are invalid map entries. No Fleet action, alias, row, default, TS/Rust field or consumer survives cutover.

`ActionContext` is immutable: desktop capture (`desktopId`, selected authorized `WindowContext`, exact connection owner), editor capture (same plus window/resource identity, owner generation, `FsTargetRef`, exact worktree, selected text, active path), or qualified running window (exact window/desktop/context/runtime identity). No default/first-connected profile, fake project or unrelated-owner fallback. Context-free singleton remains eligible. Generic Editor/Browser Open focuses compatible **usable selected-resource** view first; absent one, opens the real target chooser defined in C10. New always opens an independent chooser, never copies active document/URL into a second claim.

Minimal intent cutover is atomic in P03 `execute-captured-actions`: `search:query` requires `profileId`, `generation`, `target: FsTargetRef`, optional genuine project/worktree, `mode: text|filename`, `query`; `file:reveal` requires exact target/generation/path and optional genuine project/worktree. Own all known producers/handlers/tests, including `deep-links.ts`/tests, OsShell, SearchApp and FilesApp. No ambient search-store authority; workspace targets require no fake project. C11 freezes parse/authorization seam. Monaco context dispatch transfers in the subsequent atomic input node, not by weakening required payloads.

Protected ReviewTarget remains the existing exact eight-tuple: `(profileId, generation, terminalId, terminalIncarnation, ompSessionId, serverEpoch, rootId, baselineId)`. Never omit generation, synthesize root/baseline or infer tuple from inventory names. Conflict Resolver requires current real operation/root, not a scanning service. Unavailable target gets specific selection/recovery guidance.

### Concrete public seams and staged ownership

- P01 `actions.ts` implements pure `getActionDescriptor` and `resolveActionBinding`, all exact IDs above, `ExtraActionId` (eleven extra Open plus three New), `BindingValue=string|null` and single scalar/extra binding source. Readonly descriptors carry app, label, launch mode, requirement, scope/default. Binding resolver accepts a readonly structural settings projection, so P01 can compile before DTO cutover; no transitional runtime defaults/aliases. Terminal font commands retain existing **page-wide** supported scope (not terminal-only), gated by root ownership; find/copy/frame reserved behavior stays local. Global effective conflicts are rejected.
- P01 adds readonly context/result/layout types without changing existing callers. `ActionContext` has kind, desktopId, owner and windowContext; editor variant requires windowId/resourceId/owner/target/selectedText/filePath and exact optional worktree. Review/conflict accept only captured existing ReviewTarget or `{projectId,gitRootId,operation}`; no discovery. Null owner/context only for context-free shell/singleton actions.
- `ActionRequest` is a discriminated union: ordinary `{id,context}`; Settings `{id:"app.settings.open",context,settingsSection?:"appearance"}`; terminal creation `{id:"app.terminals.new-window",context,terminalCreate?:TerminalCreatePayload}`. Only explicit supported New accepts terminalCreate; no caller-controlled launch-mode bypass. C12 defines complete terminal payload. `ActionResult` is focused/opened with exact windowId, executed for real nonwindow effect, disabled/blocked/failed with actionable reason, or uncertain with attemptId/reason. Chooser opening is a real opened view, not a resource-created claim.
- `action-executor.ts`: `executeAction(request):Promise<ActionResult>` and `canExecuteAction(request)` revalidate at execution. window-store owns runtime `recordWindowFocus`/focus sequence, not portable MRU. Settings request delivery semantics in C13.
- `action-dispatch.ts`: root `installActionDispatch()` owns one capture listener set and cleanup; `registerShellActionDelegate(delegate):()=>void` attaches/detaches current shell capability **without another native listener**. `registerActionContext(element,provider):()=>void` registers exact nearest composed-path context. `getEventResolution(nativeEvent)` is readonly to xterm/frame/local consumers. WeakMap result is handled(action/context), disabled(reason), owned(capture/menu/modal/privacy/browser), or passthrough; unobserved event never causes a second OS dispatch. C5 defines ordered root stages; install owner is DamHopperApp, not lazy shell.
- `persistence.ts`: reserve/settle helpers both use global transaction lock. Reserve returns attemptId plus fresh single-use requestedTerminalId or blocked reason. Settlement needs exact originating TerminalTarget or authoritative cannot-still-succeed failure; uncertainty never removes reservation. C12 binds caller requested-ID validation; Promise coalescing in-process, durable guard cross-tab.
- `dock-pins.ts`: `getDockPinsSnapshot(): readonly OsAppId[]`; `subscribeDockPins(listener:()=>void):()=>void`; `setDockPins(pins:readonly OsAppId[]): {persisted:true}|{persisted:false;reason:string}`. Existing import uses this same commit/notify path through a dependency-safe notification seam in persistence (no persistence -> dock-pins -> persistence cycle).
- Geometry: `CanvasWorkArea = Readonly<{width:number;height:number}>`; presentation kinds are `tile|float|maximized` for the same window ID/slot. DesktopCanvas owns slot parent selection; WindowFrame consumes presentation kind and canvas area, not browser dimensions. `DesktopContextMenu` receives a dedicated background element/ref and captured-context provider; `cursor.ts` receives explicit shell root and owned portal roots, never document.body as universal scope.

Journal scope only ordinary PTY creation (`terminal.create`); chooser/editor/browser presentation creates no PTY. Canonical tuple `[1,profileId,endpointBinding,"terminal.create",targetKind,workspaceIdOrNull,projectIdOrNull,worktreeIdOrNull,authorizedPathOrNull,cwdOrNull]`, exact authorized directory represented distinctly, explicit null slots. No desktop/generation/tab/launchmode in key; both unresolved Open/New same-folder block, known distinct authorized directories independent. No client path guess/current-selection substitution. See C12 for explicit folder/root and requested-ID rules.

## C2. Open/focus, MRU and await fences

Compatibility first: app manifest instancing plus exact required profile/project/worktree/target; protected targets compare their full immutable identity. Multi-instance Open / Focus searches compatible existing views too (do not reuse current matcher returning none for all multi-instance apps). Prefer current desktop, then explicit monotonically updated **runtime** focus history; ties use stable window ID. Focus history is in window-store runtime state, not portable authority. Qualified running-window choice can deliberately switch desktop/owner; generic action cannot choose unrelated owner. Restore minimized existing view without resource creation.

Before await capture desktop, immutable context, connection owner/generation, requested resource identity and attempt token. Use bound client. After every await recheck desktop existence and owner generation before publication. Destination removal/retirement rejects publication; never retarget to active desktop, kill confirmed orphan or silently retry. Existing keep-alive resource hosts, claims and terminal close coordinator remain owners.

## C3. Ordinary resource-launch journal — bounded safety addition

Why: source has no generic cross-reload ordinary-launch F1 mechanism; an in-memory Promise map is insufficient. Add only bounded helpers in existing `os/persistence.ts`, consumed by executor. Key **`dam-hopper:os:v1:app-launch-attempts`** is browser-local safety metadata, never portable view state, shortcut config, import/export payload or a reset target. Existing Web Locks/storage patterns only; no reconciliation API/service and no Recipe journal change.

One exclusive Web Lock named `dam-hopper:os:v1:app-launch-attempts:transaction` guards **every** read/parse/validate/reserve/write/settle transaction over the shared JSON document. Release lock before network I/O. No per-key-only transaction locks: they lose concurrent updates. Capability failure (no locks or durable storage), invalid/corrupt/oversize document, unsupported version, failed durable write or exhausted cap blocks creation while existing-window focus remains allowed.

Version 1 structured compatibility identity: `{version:1, profileId, endpointBinding, action:resource-producing-action, target:{workspaceId?, projectId?, worktreeId?, targetKind, canonicalAuthorizedPath?, cwd?}}`. Encode canonically as a structured tuple, not delimiter concatenation. Endpoint binding uses stable configured endpoint identity, excluding credentials; include exact authorized scope/cwd. Both launch modes map to the same resource-producing action (e.g. `terminal.create`). **Exclude desktop, generation, tab and launch mode.** Record separately attempt UUID, requested terminal UUID, captured owner generation/desktop, dispatch state and exact returned provenance when available. Do not persist selected text, file contents, tokens or URLs containing secrets.

Bounds: at most **128 records**, at most **8192 UTF-8 bytes/record**, at most **1 MiB serialized document** (including envelope). Oversized identity blocks before request. Never evict unresolved records. Authoritatively settled records may be compacted under the global lock; unresolved records have no TTL. A compacted settled receipt is not a retry permit for another unresolved token.

State transitions (all disk transitions under global lock, token fenced):

1. `absent -> reserved-dispatch-capable`: validate entire journal and any scope ambiguity; durable reservation **before** request. Mark dispatch-capable before sending: crash-before-send is conservatively uncertain.
2. Same compatible unresolved record -> return existing in-flight observation/blocked explanation, never send another request. Open / Focus and New Window obey same guard. New Window is distinct only after original attempt authoritatively settles.
3. `reserved -> confirmed-success`: only exact response from originating bound request with exact authoritative identity; store durable receipt before publishing. If owner/destination no longer valid retain successful orphan provenance, do not publish elsewhere or kill. Such known-success outcome is authoritatively settled, not evidence no resource exists.
4. `reserved -> confirmed-not-created`: only originating authoritative failure whose API semantics prove creation cannot still succeed; validation before dispatch is safe. Generic HTTP error/timeout/abort/disconnect is not proof.
5. Lost response, missing exact provenance, timeout, reload, destination removal before known outcome, stale callback or failed settlement write -> record stays unresolved/uncertain and blocks compatible creation. A stale token cannot erase or replace another attempt. No user dismiss-to-retry, auto-retry, list/name/time inference, kill-to-recover or timeout release.

Fail-closed identity changes: before reserve inspect unresolved records for same profile, same endpoint, or ambiguous identity. Profile endpoint replacement/removal/re-add, alternate aliases to same endpoint, unknown endpoint equality or changed/missing target provenance cannot bypass unresolved history. Block new creation on implicated profile/endpoint until the exact original outcome is authoritatively resolved; if alias relation cannot be established, block creation rather than treat it as distinct. Known distinct stable endpoint/target identities are not coalesced. Existing focus remains available. No new identity-discovery service; absence of sufficient local identity evidence means blocked.

Exact PTY provenance is existing `TerminalTarget` `(profileId,generation,serverEpoch,terminalId,incarnation)` with canonical epoch UUID and exact positive-u64 **string returned from authoritative response**. Preserve `incarnationExact`; only a proven safe-integer response may be exactly converted under existing contract. Never `String(unsafe-number)`, current epoch substitution or fabricated authority. If creation response does not supply exact originating provenance, do not invent it; record uncertainty. Current API may therefore leave ordinary creation blocked indefinitely after lost/malformed response; source-only planning does not assert server capability beyond evidence.

Guarantee is browser-local while this storage survives and same-origin tabs cooperate. No dedup guarantee across browsers, storage clearing, incognito partitions, independent server aliases or noncooperating clients. Explain indefinite-block user impact and operator need for authoritative cannot-still-succeed proof; do not offer reset as safe recovery. Preserve inherited Recipe/F1 release gates as separately open.

## C4. Preference representation, patch and reset

Single authority: Workbench Preferences Source pipeline (`api/client.ts`, `lib/ui-config.ts`, `stores/settings.ts`, Rust schema/API/global TOML). No activation of disconnected `OS_SHORTCUTS_STORAGE_KEY`; old imported shortcut payload ignored as non-authority, not merged into a second namespace.

| Field | Default / bounds | Disk snake_case |
|---|---|---|
| dockPadding | 8 / finite 0–16 px | dock_padding |
| dockItemSpacing | 6 / finite 0–12 px | dock_item_spacing |
| dockOuterSpacing | 12 / finite 0–24 px | dock_outer_spacing |
| dockRadius | 18 / finite 0–28 px | dock_radius |
| cursorTheme | system / system or theme | cursor_theme |
| osPaletteShortcut | Ctrl+Alt+KeyK or null | os_palette_shortcut |
| osCycleFocusShortcut | Ctrl+Alt+Escape or null | os_cycle_focus_shortcut |
| appShortcuts | map of only extra IDs to chord or null | app_shortcuts |

Established scalar JSON/store -> TOML paths (defaults fixed in C1; all nullable except Cognito):

| Scalar | TOML path |
|---|---|
| searchTextShortcut | search_text_shortcut |
| searchFilenameShortcut | search_filename_shortcut |
| terminalWorkspaceShortcut | terminal_workspace_shortcut |
| terminalFilePanelShortcut | terminal_file_panel_shortcut |
| projectPanelShortcut | project_panel_shortcut |
| revealActiveFileShortcut | reveal_active_file_shortcut |
| gitPanelShortcut | git_panel_shortcut |
| portsPanelShortcut | ports_panel_shortcut |
| terminalFontSizeIncreaseShortcut | terminal_font_size_increase_shortcut |
| terminalFontSizeDecreaseShortcut | terminal_font_size_decrease_shortcut |
| cognitoModeShortcut | cognito_mode_shortcut |
| osPaletteShortcut | os_palette_shortcut |
| osCycleFocusShortcut | os_cycle_focus_shortcut |

All established scalar shortcuts except Cognito become nullable `string|null` in JSON/store and field-defaulted nullable Rust fields. Missing persisted scalar -> descriptor default; explicit JSON null -> unbound; omitted PATCH -> unchanged. Known shortcut paths only: encode explicit unbound as TOML `""`, decode `""` back to JSON null. Normalize scalar shortcut nulls/map-entry nulls **before** generic TOML null dropping; never rewrite unrelated nulls. Field-specific serde defaults distinguish missing from explicit null. TS defaults use own-property presence, not `??` for nullable bindings. Reject nonfinite/out-of-range appearance at client/API/import boundaries; valid zero retained.

Cognito exception: keep a validated nonempty keyboard dismissal chord; cannot unbind, DoubleShift or wheel. Activation/dismissal state remains ephemeral. Retained Android nullable `String?` DTO accepts null source-wise; no Android adoption/runtime qualification claimed. Remove Fleet schema entirely; existing serde unknown-field tolerance accepts inert old Android field and changes no new settings. No deprecated field retained.

Map semantics: omitted patch unchanged; `{}` no-op; entries string/null; reject map-level null/array/nonstring/unknown/scalar-owned IDs. Client pending 500ms debounce merges entries; server merges entries against stored map. Reset sends explicit per-descriptor defaults (null extras), Appearance reset its defaults. Duplicate effective overlapping chords rejected with exact conflicting command. Imported invalid duplicates remain non-executing. Find/copy/frame local reserved chords retain explicit precedence; page-wide terminal font action executes once through root coordinator, never both local and root dispatchers.

Reuse source/client/generation/edit revision captures and rollback to lastSavedSettings; source switch cancels undispatched edits, never retargets dispatched work. Hydration, snapshot, source-unset, disconnected, source removal, save rollback, reset and import all cover new fields. Settings target independent of Preferences Source. Concurrent server saves follow existing atomic config write semantics; this scope adds per-entry map merge, not a new revision protocol.

## C5. Single input resolution and exact editor context

DamHopperApp installs one root keyboard coordinator in a client layout effect and owns deterministic keydown/keypress/keyup/blur cleanup. The existing Cognito hook supplies its physical keyboard policy to this coordinator **instead of registering separate keyboard listeners**; its pointer/focus isolation remains owned there. Remove standalone browser-keyboard listener and GlobalTerminalFontSizeShortcuts listener. Shell registers a delegate/context providers after lazy mount; unregister removes only that delegate/providers, never root policy or held-key state. Remount/StrictMode produces no duplicate listener; final root cleanup retains existing privacy reset/focus/timer behavior.

Ordered stages per native event: (1) existing Cognito consumed-physical-code/release policy, frozen activation-chord dismissal and inactive activation (Settings capture exemption retained), (2) Settings shortcut capture ownership, (3) IME/Dead/Process/AltGraph passthrough, (4) current modal/menu ownership, (5) configured enabled action resolution including the migrated page-wide font action, (6) browser shortcut suppression, (7) frame/local app behavior and ordinary input. Root calls stages directly; same-window listener registration order is not a coordination mechanism. Cognito is the **only** physical toggle executor; catalog privacy ID delegates to this authority, never toggles again. Composition/repeat/held sequences and keypress/keyup remain consumed until physical release; shell unmount does not clear them. Fresh configured activation retains existing privacy precedence; all other commands respect capture/menu/modal.

Browser-reserved policy: existing intercepted Mod+R/Mod+P/Mod+U/Mod+Shift+I/J/C are remappable when a valid enabled configured action resolves first. Capture may record these chords without browser guard stealing them (capture owner prevents browser default); menu/modal owns interaction and cancels reserved defaults without allowing background dispatch. Unclaimed chords retain prior browser suppression. Ctrl/Meta+Shift+C keeps existing terminal-copy prevent-default behavior and outside-terminal suppression; reject conflicting configured bindings to protected local copy/find/frame chords. Browser/OS chords never delivered to JS cannot be promised; disclose/test observed limitations, no Keyboard Lock.

Resolve current state once, native-event WeakMap caches outcome; only coordinator dispatches OS actions. xterm reads handled/owned suppression only, never rematches/executes. Existing terminal-input-policy suppresses capture/menu/modal/privacy stdin separately, not by fake handled actions. DoubleShift resets under ownership/composition and ordinary Shift is untouched. Remove independent hook/frame/terminal/Monaco OS listeners and hardcoded fallback ORs. Editor context registers on stable claimed EditorApp slot; MonacoHost decorates actual editor event context with current selection/path/model refs, validates nearest slot/window/resource/owner on each event and cleans registration on disposal. No new Monaco props or upstream producer migration; parked/unclaimed node has no editor authority. Preserve wheel zoom/local edit commands.

P03 root-input node implements/tests current `context-menu-coordinator.ts` authoritative snapshot/subscription/dismiss seam before P06. claim/replacement/release updates snapshot synchronously; root reads it per native event and TerminalPanel subscriber immediately applies existing terminal-input-policy suppression (not waiting for React render), while shell context subscribes for UI state. Tests claim->immediate key/input, menu replacement, stale release callback, Cognito dismissal then held releases. Preserve claim/release API and token-safe cleanup. P06 consumes completed seam/adds background/portal capability and reruns coordinator regression tests; no later export prerequisite.

Cross-origin iframe keyboard focus is outside parent authority; dock/palette remain reachable after returning focus. No keyboard-lock or iframe injection promise.

## C6. Dock and pins

Shared exhaustive `app-icons.tsx` maps all 17 IDs to existing Lucide components; 20px SVG/consistent stroke/theme tokens; no glyph/emoji fallback. Dock/Apps/palette reuse it. 44px targets; running/focused/minimized separate accessible indicators.

Pins browser-local at `dam-hopper:os:v1:dock`; valid saved `[]` retained; invalid IDs removed and duplicates normalized. Render ordered pins then stable manifest-order running-unpinned IDs across desktops, deduped. Permanent separate Apps button stays outside app overflow scroller. Menus offer Open / Focus, pin toggle, only supported New Window, qualified running windows; no Close/Kill/reorder/auto-hide. Unpin does not mutate resources. Storage failure retains honest unsaved/error state and prior persisted value.

`dock-pins.ts` supplies one mounted subscription/snapshot authority and storage-event handling. Successful existing `importOsEnvelope` dock import publishes via the same pin setter/subscriber notification in this tab and updates other tabs through storage events; export reads current canonical normalized pins. Ignore obsolete shortcut payload; preserve other existing portable view-state projections and keep launch journal out of all reset/import/export. No hidden import path without mounted notification.

## C7. Work-area plane and continuity

Left-only content-height dock, vertically centered in reserved horizontal gutter: `gutter = 44 + 2*dockPadding + 2*dockOuterSpacing`; radius independent of geometry; app item spacing only vertical. Cap height to work area, scroll app items, keep Apps control fixed/reachable. Theme surface/border/focus tokens. P07 alone wires shared shell CSS variables/reservation.

Browser `innerWidth/innerHeight` controls support tiers (1024x640 remains supported); canvas ResizeObserver controls geometry. Never use reserved canvas dimensions to reject browser support.

DesktopCanvas owns a maximized plane sibling to tiles/floats; stable presentation slots and tile placeholders preserve topology/restorePlacement/floatBounds, inset 0 to actual canvas. Never recreate runtime resources or use fixed viewport sizing. Continuity acceptance: same xterm object/session with **zero additional transport attach/replay/reset**, same Monaco editor/model with dirty buffer/selection/undo history, same iframe browsing context with JavaScript heap nonce/counter and no navigation/reload. DOM-node equality alone is insufficient. Browser host uses immutable slot snapshots and observes position-only presentation moves/visibility so it tracks canvas slots without navigating iframe; P03 owns host correction, P05 presentation, P08 real proof.

## C8. Background menu, owned portals and cursor

Focusable background-only trigger is a dedicated sibling behind windows, not ancestor around them. Existing coordinated Radix wrapper and trigger marker own pointer/Menu-key/Shift+F10, arrows, collision, dismissal/focus return. Context captured on opening: desktop, exact launch target, owner generation. Selection revalidates captured context; stale/removed owner blocks with guidance, never substitutes current selection. New Terminal shows captured context; Apps submenu, Palette and Desktop Appearance use same executor; Appearance opens Settings section without global target side effects. No Refresh/file-desktop fiction.

Menu coordinator exposes current ownership and dismisses on Cognito activation; current modal prevents background activation. No unrelated commands behind open menu; background trigger must not intercept terminal/editor/file-tree/iframe-body right-clicks.

`cursor.ts` synchronizes `system|theme` on shell root and explicitly **owned** Radix menu portal container/attribute. Theme uses two static native SVG cursor assets with `auto`/`pointer` fallbacks. No global body-wide semantic override, pointer overlay, per-mousemove state or dependencies. Only shell default/pointer surfaces change; preserve text, all resize, move/grab/grabbing/drag and cross-origin iframe cursors. Forced-colors uses system fallback. P06 implements wrapper capability; P07 applies shell scope.

## C9. Evidence and rollout boundaries

Unit/browser tests prove behavior, not descriptions/default strings. Remove obsolete Fleet/legacy-label/default-only assertions rather than re-pin them to new wording. P08 writes real full-app Playwright journey under `packages/ui/e2e/os-desktop-polish`, using existing authenticated fixture/container and capture-evidence helper. Fresh compact/standard/FHD PNGs + hashes + dimensions + human review ledger; default `PENDING_HUMAN_REVIEW`, never manufactured sign-off. Physical PTY byte probe and ordinary input are separate observed gates. No concurrent full suites across half-edited groups.

Rollback stops dispatch/new resource creation first; preserve unresolved journal, backend PTYs, existing pins and source-managed config. Roll back coherent consumer/schema groups together, not a single file or nullable serialization alone. No destructive Git/reset/storage purge or automatic resource kill. Old binaries' handling of TOML empty shortcuts is not assumed safe: restore explicit chords through authorized settings/config backup before binary downgrade, without touching safety journal. All inherited lifecycle/F1/owner/Cognito/live/human gates stay open until their own evidence exists.

## C10. Usable New Editor/Browser selection and exclusive claims (D5)

`appState.presentation` is discriminated `choose-target|resource`; chooser carries immutable captured context, owner generation, destination and delivery token; resource variant carries validated explicit file target/path/document identity or URL. Unset restored selections show chooser/guidance, never default `untitled.ts`/localhost. EditorApp/BrowserApp split chooser from resource child so no conditional hook/claim mutation; root MonacoKeepAliveHost and OsResourceHost **skip chooser/unset/invalid-target windows**. No resource claim, editor load, iframe, navigation or server mutation before valid selection.

Editor chooser embeds the existing FilesApp authorized FileTree/open flow through explicit controlled selection callback scoped to picker window/token; normal Files behavior unchanged. It may browse only captured authorized workspace/project/worktree; selecting a file uses existing editor-store open/identity resolution and owner-bound target. Browser chooser has explicit URL form, validates absolute http/https URL with existing browser policy, rejects empty/malformed/unsupported scheme. Neither creates a PTY or fabricates a resource.

Transitions: New -> independent chooser; cancel closes only that chooser, never holder/resource; repeat New creates another independent chooser. On explicit selection revalidate original owner/generation/context/destination, then canonical identity/claim. Already-open canonical document or owner/generation/URL -> focus/restore exact holder across desktops, retain chooser with explicit collision explanation and ability to choose another. Distinct target -> promote **that picker window** to usable resource with canonical exclusivity; race-lost claim returns chooser/explanation, no synthetic identity or duplicate visible root. Context/owner changes during choosing/loading invalidate the captured token and fail closed; never adopt current selection or reconnect generation. Disposed/canceled token cannot publish late result. Generic Open chooses compatible usable view else chooser. Qualification interacts with two distinct usable documents/URLs, collision/cancel/repeat/owner transitions and counts actual claims/resources, not frames alone.

## C11. Deep-link source qualification (D2)

Keep pure `parseOsDeepLink(search,knownProfiles)` for URL syntax/known-profile checks and a typed unresolved request (not a qualified search/reveal intent). Add `qualifyOsDeepLink(parsed,capture)` in deep-links.ts; OsShell captures owner via `getConnectionSnapshot(explicitProfile)` and bound existing workspace/project authorization/query flow, target/worktree and destination **before** delivery. Capture must prove connected current generation, genuine authorized project/worktree or workspace epoch and path. Missing qualification returns actionable unhandled/disabled notice; no first-connected/default profile or fake project.

Only qualifier builds required search/reveal payloads (mode text unless explicit valid filename selection); URL generation/target strings are requests, **never** authority. Any supplied generation must match current captured owner or reject stale. Recheck after authorization await and before dispatch; destination removal/reconnect invalidates. Terminal/editor/browser links use same captured action/selection paths; omitted file/URL opens chooser, never fabricated defaults. Deep-link tests and shell/browser tests cover qualified search/reveal success, workspace target, stale/unavailable/unauthorized target and no implicit side effect.

## C12. Lossless terminal-create payload and requested-ID safety (D4)

`TerminalCreatePayload = Readonly<{target:FsTargetRef; cwd:string|null; directoryKind:"explicit-folder"|"target-root"|"profile-default"; requestedTerminalId?:string; sourceWindowId?:string; owner:ConnectionRef; destinationDesktopId:string; windowContext:WindowContext}>`. Full captured context plus source is retained through intent adapter/executor/journal; target/profile/project/worktree contradictions reject before reserve. Normalize GitApp/ProjectInfoApp project+worktree to exact FsTargetRef; never drop worktree. Existing intent `terminalId` maps to requestedTerminalId without treating it as existing-session focus.

Explicit Files/ProjectInfo folder action maps to supported terminal New semantics even if compatible terminal exists: create at selected authorized cwd, **never reuse, cd, or HOME fallback**. Workspace-root selection has cwd `"."` relative to authorized workspace root (not undefined/empty); project-root uses exact project target and explicit root semantic. Generic profile-default creation may use existing supported server default only when no explicit folder was requested; absent directory authority blocks folder action. Journal keys use exact validated authorized cwd/root provenance; different known directories independent, aliases/missing proof conservatively blocked.

Current PTY manager can destructively replace an existing requested ID (`server/src/pty/manager.rs:1847-1852`). Generate a fresh cryptographic ID once per durable reservation; never resend it after uncertain outcome or reuse a settled/closed ID. Caller-supplied legacy requested ID is honored only with locally proven fresh allocation provenance bound to this reservation and absent from all retained attempts/resources; arbitrary/previous/unknown ID blocks before network, never guesses safety from inventory absence. No endpoint/create-if-absent service added or cross-client uniqueness guarantee. Preserve exact response target/epoch/incarnationExact; no unsafe numeric conversion or fallback attach. Failed reservation/settlement and destination retirement follow C3.

## C13. Repeat-delivered Appearance navigation (D6)

Each accepted Settings Appearance action writes `{section:"appearance",deliveryId:freshToken}` into existing/new singleton appState and `activeTab:"general"`; focus/restore existing singleton even when on Devices. SettingsApp consumes each new delivery token, sets General and passes typed section request to SettingsPage. Page controls Appearance accordion `open/onOpenChange`, scrolls/focuses stable section/header ref after General mounts; accordion preserves its ordinary uncontrolled default for other callers. Repeated request after manual collapse reopens/focuses, no dependence on changed section string. Consumed-delivery tracking prevents refetch snapping; remount honors current explicit request once. Never click by DOM label, alter Settings target, Preferences Source, profile selectors or route URL.

## C14. Executable completion barriers and review supersession (D1/D7/D8)

Supersede intake P01 breaking-schema-first, old G2 P02||P03 and all-checks-deferred-to-P07/P08. Nine phases remain; **18 coherent tasks**. P01 pure additive prep -> P02 atomic preference schema/callers/tests then controls -> P03 resolver -> journal -> atomic executor/intents/chooser caller cutover -> atomic root-input caller cutover. Source schema plus actual callers/tests change in the **same node**; no backend-on-unfinished-schema fiction, shims or knowingly broken prerequisite.

Only G3 dock/geometry/menu tasks concurrent, one node per branch. No child of unfinished/unchecked node starts. Wait all independent G3 writers terminal, coordinator executes applicable build/tests/smoke and review for each branch, then complete each with real receipts. Every sequential node is checked/reviewed **before** its dependent starts; “implementation-terminal” alone never completion. No applicable failed compile becomes N/A; checks in P08 add integration evidence, not retroactive prerequisite validity. Planning runs none.

P01 implements pure actions.ts functions; P03 consumes, no contradictory second write ownership. Shared icons use static exhaustive `satisfies Record<OsAppId,...>` type; **no permanent icon-wiring/name-map/theme-token-copy assertion file**. Real dock/launcher/palette keyboard/accessibility interactions plus fresh themed visuals qualify names/decorative semantics and focus/running/minimized state. F1–F6 corrections and immutable-report limitations recorded in review-triage; parent owns parser and targeted independent follow-up/validation. This revision does not assert approval.
