# DamHopper OS — shortcuts, floating dock, desktop interaction

- Status: **approved** — user explicitly selected “Approve this design” in this brainstorm.
- Date: 2026-11-05 (`date +%y%m%d` returned `261105`).
- Scope decision: all five requests, staged; optional native themed cursor; opt-in app shortcuts; persistent OS dock.
- Planning consent: **explicitly deferred** by user after design approval. Central plan router not invoked; no new implementation plan. Implementation remains unauthorized.
- Implementation: none. Existing runtime inspected; no tests/builds/lint executed.

## Problem / final artifact

The OS cutover retained Settings shortcut controls without reconnecting many legacy panel commands. The left rail uses mixed emoji/text glyphs, shows only pinned apps, provides no pin-editing menu, and sits flush against the viewport. Desktop background has no configured context menu in the inspected implementation.

Approved output: this decision-ready design, including interaction contracts, boundaries, touchpoints, evidence, and acceptance criteria. A future authorized implementation delivers the five behaviors below; this brainstorm changes no product code.

## Scope, constraints, stakeholders

In scope:
1. Settings bindings that execute OS app/contextual commands, not obsolete panels.
2. Theme-coherent SVG app icons.
3. Dock/launcher pin-unpin menus and pinned-plus-running model.
4. Floating left dock with padding, item spacing, outer spacing, radius settings; work-area-aware maximize.
5. Background-only desktop context menu and optional native themed cursor.

Out of scope: implementation in this command; backend service redesign; recipe engine rewrite; mobile/Android adoption; auto-hide, magnification, bottom/right positioning, pin drag-reorder; arbitrary command scripting; cursor trails/DOM pointer overlays; cross-origin iframe control; dock Close/Kill actions; browser-fullscreen changes; closure of prior OS release gates.

Constraints: React 19, existing static app catalog, Lucide, Radix menu wrapper, Settings/preference-source conventions. Preserve immutable owner/profile/generation fences, Cognito input isolation, explicit terminal creation, and terminal/editor resource lifetime. No extra UI framework or cursor animation dependency. No timeline promised; staged scope is the delivery boundary.

Users gain predictable navigation and recovery of unpinned apps. Developers maintain one action-resolution path rather than divergent dock/palette/keyboard implementations. Operators retain existing preference-source semantics and API routes. Native OS/browser shortcut interception remains outside the web app's authority.

## Alternatives and decision

| Approach | Benefit | Cost / rejection |
| --- | --- | --- |
| Cosmetic rail only | Small presentation change | Leaves orphaned shortcuts, missing pin editing, and inconsistent launch behavior. Does not satisfy request. |
| **Bounded OS polish — selected** | Shared actions, coherent dock, native menus/cursor; reuses existing infrastructure | Requires command routing plus complete preference round-trips and work-area correction; not CSS-only. |
| Full macOS-style dock/pointer system | Rich customization and animated behavior | Adds auto-hide, magnification, drag positioning, gesture, accessibility and iframe complexity without requested benefit. Rejected. |

## 1. Shared OS actions and keyboard shortcuts

Use a small typed action catalog derived from `APP_MANIFESTS`, not a general command bus. Keep keyboard arbitration pure; a shared action executor owns execution. Dock, palette, keyboard, and desktop menus resolve the same actions and configured hints. Existing typed domain intents remain the payload-delivery mechanism.

### Commands

- Every current registered app (17 in inspected source) has **Open / Focus**. Extra app bindings start unassigned.
- Existing useful bindings remain authoritative for Text Search, Filename Search, Terminals, Files, Git, Ports, Project Info, and Reveal Active File. Replace “panel” / “switch IDE modes” wording with actual OS behavior.
- Remove the redundant Fleet Terminal panel row and obsolete consumers/config plumbing rather than silently assign its chord to a different app. No duplicate live aliases.
- **New Window** is distinct from Open / Focus and offered only for supported multi-instance apps.
- Session Changes and Conflict Resolver need their actual target. Without one, present target selection or an actionable disabled explanation. Never invent session/conflict metadata or open a fabricated target.
- Existing terminal font controls and Cognito command remain supported.

### Context and focus contract

- Editor-local Search/Reveal uses that editor's exact owner and worktree, including selected text where applicable.
- Desktop/dock generic actions use the selected desktop's launch context.
- Apply the app's instancing rules: fleet/single-instance apps are not filtered like project apps.
- Generic Open / Focus prefers a compatible window on the current desktop, then a compatible window elsewhere; select by explicit lightweight runtime focus history. Object enumeration is not MRU.
- Never choose an unrelated profile/project as a generic fallback. An explicitly selected qualified running-window entry may switch to its desktop and owner.
- Restore minimized windows without changing their owner or creating backend resources.

### Binding authority and precedence

One command-to-setting descriptor is authoritative for Settings, dispatch, terminal interception, window-frame handling, and displayed hints. Reuse existing scalar settings for established commands; a new binding map holds only additional commands. Do not store the same command in both.

- Missing value: use command default. Explicit null/unbound: no binding. The persistence/config normalization path must preserve the distinction.
- Remapping replaces the old chord, including default chords; remove hardcoded fallback shadowing.
- Reject duplicate effective bindings in overlapping scopes. Intentional local/global differences require explicit precedence, not listener order.
- Settings capture, menu/modal ownership, Cognito, IME/Dead-key/AltGr guards precede normal command execution. Read current state, not stale handler closures.
- Resolve each event once; xterm must suppress handled command bytes without dispatching a second action. Preserve normal unhandled terminal input.
- DoubleShift is a recognized gesture, not suppression of ordinary Shift input; never launch during shortcut capture, modal/menu ownership, or composition.
- Parent-shell commands are not guaranteed when a cross-origin preview iframe owns focus. Provide dock/palette routes outside it; no keyboard-lock promise.

### Asynchronous activation

Capture destination desktop, owner, generation, and command context before terminal creation. Revalidate after await; never publish on whichever desktop happens to be active afterward. Repeated Open / Focus during an in-flight compatible launch must not create duplicate PTYs. Explicit New Window remains a distinct operation. Do not retry an uncertain creation result or weaken the original plan's exact-identity/F1 guarantees. Existing recipe launch gates remain separate.

## 2. Icons

Replace `Dock.tsx` emoji/text map with a shared exhaustive app-icon mapping using existing Lucide SVG components and theme foreground/accent tokens. Reuse across dock, launcher, and app-command results. Consistent optical size/stroke; no new dependency or emoji fallback. Keep accessible labels/tooltips. Running, focused, and minimized states remain distinct indicators, not different icon artwork.

## 3. Persistent dock / pinning

Display ordered pins, then running unpinned app IDs across desktops; deduplicate. Preserve stable order while windows change. An independent permanent **Apps** launcher stays available even when no apps are pinned.

Single-click Open / Focus follows the shared action contract, including multi-instance apps; it must not create a terminal merely because a compatible terminal already exists.

Dock app menu:
- Open / Focus.
- Pin to Dock / Unpin from Dock.
- New Window, where supported.
- Qualified running-window list with desktop/owner information, respecting existing privacy presentation.

Launcher entries support pinning unopened apps. Unpin changes preference only, never closes or kills. Running unpinned apps remain visible until their last window closes. Empty pins `[]` are a valid saved state, not missing configuration. Unknown IDs cannot launch; duplicate pins are normalized. Update mounted state consistently and surface storage write failure rather than claim it persisted.

Reuse the existing coordinated Radix ContextMenu wrapper, keyboard entry, collision handling, and focus restoration. No Close All, Kill, or safe-close extraction in this scope.

## 4. Floating dock / work area / Settings

Left-only, content-height, vertically centered. Reserve a horizontal gutter rather than overlaying windows; visible spacing on both dock sides. For many items, cap height and scroll app items while keeping the Apps launcher reachable.

| Appearance field | Default | Range |
| --- | ---: | ---: |
| Internal padding | 8 px | 0–16 px |
| App spacing | 6 px | 0–12 px |
| Outer spacing | 12 px | 0–24 px |
| Corner radius | 18 px | 0–28 px |

Use 44 px app targets, 20 px glyphs, theme-token surface/border/focus state. Values update live; validate finite bounded values at configuration boundaries. Preserve accessible focus indicators and overflow usability at supported zoom/font settings.

Maximize fills the **desktop work area**, leaving top bar/dock accessible. Support both tiled and floating windows without corrupting tile topology, saved float bounds, or restore placement. Correct containing blocks and stacking, not just `fixed` versus `absolute`. Work-area resize must not remount live xterm/Monaco resources.

Screen-support thresholds use browser viewport dimensions; canvas dimensions remain the source of window geometry. Verify 1024×640 with reserved chrome/gutter rather than falsely rejecting it because canvas is smaller.

### Preference ownership

Appearance, cursor enum (`system` / `theme`), and shortcut bindings follow the existing **Workbench Preferences Source** pipeline. Extend TS config types/defaults, hydration/save/source-reset paths, existing global-config serialization and TOML mapping. No new API routes or parallel local shortcut store. Do not activate disconnected `OS_SHORTCUTS_STORAGE_KEY` as a second authority.

Pins remain browser-local via `dam-hopper:os:v1:dock`, retaining OS import/export behavior. Settings labels distinguish browser-local pins from source-managed appearance/shortcuts. Preserve existing source-unset/defaults semantics and disconnected/generation-fenced writes. Verify whether every existing OS shortcut field survives source reload; current excerpts show incomplete coverage and do not establish persistence correctness.

## 5. Desktop menu / optional cursor

Dedicated background layer is the desktop menu trigger. Do not wrap app/window descendants in the trigger; their existing menus, selection, and native/suppressed behavior stay isolated.

Menu: Apps submenu; New Terminal with visible launch context; Command Palette; Desktop Appearance. No fake OS Refresh or file-desktop features.

Provide deliberate background keyboard focus and Menu-key / Shift+F10 entry, arrow navigation, Escape, outside dismissal, focus return, viewport collision handling. Menu ownership blocks unrelated commands behind it. Cognito activation dismisses menus; active modal blocks background activation. Capture desktop/context when opening and revalidate before selecting a command; never redirect to a newly selected unrelated target.

Cursor defaults to **System**; **Theme** is optional native CSS cursor assets for default/pointer on shell surfaces and shell-owned portal menus. Retain text, resize, grab/grabbing, and other semantic cursors. Respect forced-colors/system accessibility overrides. Cross-origin previews retain their cursor. No per-mousemove React state, overlay, trails, or cross-origin injection.

## Touchpoints / dependency order

1. **Command authority:** `os/{OsShell,CommandPalette,input-arbiter,shortcuts,app-registry,types}`, Settings shortcut section/store, `lib/shortcuts`, terminal shortcut consumer, Monaco search/reveal consumers. Fix stale modal state and default shadowing in affected paths.
2. **Dock and layout:** `os/{Dock,persistence,os.css,DesktopCanvas,WindowFrame,use-os-viewport}`, shared icon presentation; existing window focus/store operations. Pin normalization and launch routing must agree with command authority.
3. **Desktop/pointer:** existing `components/ui/ContextMenu`, coordinator/trigger marker, browser context-menu suppression, shell input context/Cognito, background menu and scoped cursor styling/assets.
4. **Configuration:** `components/organisms/SettingsAppearanceSection.tsx`, `stores/settings.ts`, `lib/ui-config.ts`, `api/client.ts`, `server/src/config/global.rs`, and corresponding actual UI-config read/normalization code resolved during planning. This is an additive data-contract change to existing settings APIs, not frontend-only styling.
5. **Evidence/docs:** extend existing full-application journey/visual-review convention and relevant behavioral coverage; document shortcut meanings, preference ownership, dock settings, iframe limits, maximize semantics. Do not rewrite unrelated original plan status.

Build order is dependency guidance only, not an implementation plan or authorization: command resolution first; dock behavior/presentation next; desktop menu/cursor last. Configuration round-trips accompany their consumers.

## Acceptance / future validation

1. Settings exposes live app actions, no obsolete panel rows; meaningful existing chords reach correct OS windows. Every app has a command with target requirements honored.
2. Remapping deactivates old chords; explicit unbinding survives reload/source round-trip; conflict handling is deterministic. Palette hints use actual configuration.
3. Exercise desktop, window chrome, Monaco, terminal, capture, menu, modal, IME/AltGr, and Cognito. A live PTY probe verifies handled commands emit no input bytes; normal terminal input still works. Do not claim iframe-owned keyboard coverage.
4. Existing compatible terminal/editor/browser windows are focused/restored rather than duplicated. Explicit New Window creates separately. Rapid Open / Focus and desktop switching during async creation preserve resource count, captured destination, and owner authority; uncertainty does not trigger retry.
5. Pin unopened app, unpin running app, close its final window, clear all pins, reload, and import/export: correct membership/order, no duplicate/unknown launch, permanent launcher reachable, no accidental close/kill.
6. All icons use shared theme-coherent SVGs; tooltips, focus, running/minimized states remain legible in available themes and accessibility modes.
7. Appearance/cursor/binding values save/reload through existing config APIs/TOML; source switching/disconnect does not leak writes or retain wrong-source fields. Pins remain browser-local.
8. At 1024×640, 1440×900, and 1920×1080 plus supported UI scale, dock overflow/menus remain reachable and windows do not overlap reserved chrome. Maximize/restore both tiled and floating windows without losing layout or live xterm/Monaco continuity.
9. Background menu opens by pointer and keyboard, stays in viewport, restores focus, and does not appear for terminal/editor/file-tree/iframe-body right-clicks. Menu actions cannot mutate a stale captured owner/context or execute behind Cognito/modal state.
10. Theme cursor works on shell and owned menu portals; text/resize/drag semantics and system fallback remain correct. Cross-origin preview cursor remains unchanged.

Use existing meaningful tests where appropriate plus fresh real full-app interaction/visual captures. Component assertions alone do not certify app integration. Production visual acceptance remains human-governed. No tests were run for this brainstorm.

## Feasibility, risks, dependencies

Feasible using existing libraries and state models; no new server service needed. Nontrivial work is command/persistence correctness and window geometry, not icon replacement.

Primary risks: shortcut defaults shadow remaps; separate listeners dispatch twice or leak PTY bytes; preference hydration loses explicit unbinding; terminal launch races follow active desktop after await; app-ID-only focus crosses owners; maximize changes containing blocks or resource lifetimes; context-menu trigger captures app descendants; local pin persistence failure; browser/host shortcuts and cross-origin iframe limits.

Original plan administrative DONE statuses are not proof of resolved runtime/release/human gates. This design does not close inherited F1/lifecycle/owner/Cognito qualification findings.

## Evidence and coverage limits

Source inspection (current working tree):
- `packages/ui/src/os/Dock.tsx:13-31,33-42,86-161`: glyph map, pins-only render, flush layout, no menu.
- `packages/ui/src/os/persistence.ts:677-727`: local dock namespace, default pins, empty-array reset, export shape.
- `packages/ui/src/os/OsShell.tsx:254-315`: palette/focus-only shortcut handling; closure references modal/palette/nonmodal state missing from dependency list.
- `packages/ui/src/os/input-arbiter.ts:83-139`: input precedence and hardcoded default-chord fallback.
- `packages/ui/src/os/OsShell.tsx:1455-1540`: generic launch matching, terminal creation, post-await active-desktop selection.
- `packages/ui/src/os/CommandPalette.tsx:128-175`: separate launch implementation and hardcoded terminal shortcut hint.
- `packages/ui/src/os/DesktopCanvas.tsx:24-38,100-124`: canvas geometry observer and background/window layers.
- `packages/ui/src/os/WindowFrame.tsx:380-387`: viewport-covering maximize.
- `packages/ui/src/os/use-os-viewport.ts:13-24`: screen support currently derives from canvas-backed store viewport.
- `packages/ui/src/os/{app-registry.ts:3-157,types.ts:5-22,108-122}`: 17 apps and instancing/context metadata. Existing catalog documentation still describing 14 is not authoritative for current count.
- `packages/ui/src/components/ui/ContextMenu.tsx:20-109`: coordinated menu root and keyboard trigger.
- `packages/ui/src/components/organisms/{SettingsKeyboardShortcutsSection.tsx:154-385,SettingsAppearanceSection.tsx:19-107}`: existing controls and preference consumers.
- `packages/ui/src/stores/settings.ts:1-6,81-132,147-170`, `lib/ui-config.ts`, `api/client.ts:2090-2092,2760-2761`, `server/src/config/global.rs:230-234`: preference ownership and existing config contract.
- Both delegated read-only scouts completed: `ShortcutEvidence`, `DockDesktopEvidence`. Source reports only, not executed tests; recommendations independently reconciled with source. Scout miscount of app catalog excluded.

Runtime smoke inspection on existing `http://127.0.0.1:5173/`, isolated managed browser tab, 1440×900 CSS viewport:
- Observed actual shell/dock screenshot and Files window.
- Ctrl+Alt+K opened Command Palette; Open Settings command displayed Settings.
- Keyboard Shortcuts section rendered legacy panel/mode descriptions and configured chords.
- Ctrl+Shift+F while Settings had focus displayed no new Search UI in the inspected scenario.
- Right-click Files dock item and blank desktop: zero DOM `[role=menu]` in those scenarios; source also lacks configured triggers there.
- Tab released after inspection. No intentional Settings edits. Opening Settings changed window/session state, which shell autosave can persist; no claim of zero persistence effects.

Limit: no exhaustive shortcut proof, remap/source round-trip, live PTY-byte probe, iframe interaction, new behavior, or production release verification. No implementation, build/lint/test execution. No external research required to select existing repository primitives.

## Unresolved questions

No blocking design questions after explicit approval. Planning explicitly deferred; next step is a separately authorized central-router planning request. Decision journal completion is reported separately with its actual artifact path.
