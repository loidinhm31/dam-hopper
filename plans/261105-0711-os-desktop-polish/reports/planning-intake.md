# Planning intake and frozen coordinator constraints

## Authority / selection
- User explicitly requests detailed implementation plan from approved brainstorm using native-user `plan/parallel` protocol v3. Planning only; earlier planning deferral superseded, implementation still unauthorized.
- Root `/home/loidinh/WS/dam-hopper`; canonical `/home/loidinh/WS/dam-hopper/plans/261105-0711-os-desktop-polish/plan.md`. New plan selected because injected active plan none; brainstorm is evidence, not an existing plan selection.
- Date command returned `261105`; branch `main`; Linux x64/pnpm/Rust/React19, Asia/Saigon. Installed planning skill and command lifecycle read directly from `/home/loidinh/.omp/agent/`.
- Active-plan setter returned warning `EVCRATE_SESSION_ID not set`; session state NOT persisted. Explicit path must accompany every handoff.
- Validation owner: this route, prompt mode 3–8 only genuine questions; no take caller. Approved product decisions need not be reopened. Offer optional interview after review; no manufactured choices or implementation approval.

## Evidence set / sufficiency
1. Approved [brainstorm](../../reports/brainstorm-261105-0650-os-desktop-polish.md): five behaviors, ten acceptance rows, non-goals.
2. [Command evidence](command-evidence.md): parent source inspection + inherited plan contracts.
3. [Preferences evidence](preference-evidence.md): scout complete; actual source pipeline/global schema/merge/TOML, defects and callers.
4. [Desktop evidence](desktop-evidence.md): scout complete; geometry/menu/portal/visual boundaries.
5. Parent confirmed `server/src/config/schema.rs:1001-1003` has no deny_unknown_fields; `api/config.rs:611-655,815-821` shallow merges; `global.rs:171-240` maps fields and drops generic nulls.
6. Parent confirmed retained Android `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/RemoteConfigModels.kt:39-50` declares existing scalar shortcut fields nullable `String?`; decoder null compatibility source-confirmed, Android behavior not qualified or adopted in this plan.
- No new external research: no decision-relevant external gap. Two independent scouts complete; no tests/build/lint/formatter/runtime executed by this planning run.
- Advisor initial direction + bounded-launch consultation obtained. Corrections below are binding design input, not verification proof.

## Shared contracts to freeze in actual plan
### Settings/data
- Keep existing scalar authority for Search Text/Filename, Terminals, Files, Git, Ports, Project Info, Reveal, font controls, Cognito, palette/focus. `appShortcuts` holds only additional stable command IDs, not duplicate established commands; support opt-in Open/Focus for all 17 apps and New Window where actually supported.
- Preferred field names: `dockPadding` 8 [0,16], `dockItemSpacing` 6 [0,12], `dockOuterSpacing` 12 [0,24], `dockRadius` 18 [0,28], `cursorTheme` system|theme default system, existing `osPaletteShortcut` / `osCycleFocusShortcut`, `appShortcuts` map. snake_case disk aliases/mapping.
- JSON/store null means explicitly unbound; missing persisted field means default; omitted patch unchanged. Known shortcut paths only: TOML explicit unbound encoded `""`, deserialized back to null; nullable Rust schema with field-specific serde defaults so missing != null. Normalizer converts only scalar shortcut nulls and map-entry nulls to `""` before TOML serialization, not every null. API read emits null. Preserve non-unbindable Cognito validated keyboard dismissal chord; no DoubleShift/wheel there.
- Extra map: absent patch unchanged, `{}` no-op patch, per-entry null unbind; reject map-level null/malformed values/unknown or established-scalar-owned command IDs. Reset issues explicit per-command default (null for unassigned) entries, not `{}` deletion. Client pending debounce merges per entry AND server merges per entry; two edits in one debounce cannot drop each other. Finite bounded appearance validation at TS/API/TOML boundaries.
- Remove live Fleet row/default/TS/Rust schema/mapping/consumers and related behavioral tests; existing serde unknown-field tolerance absorbs retained old Android key inertly. No deprecated field/alias, no Android redesign. Regression: old patch tolerated, new preferences unchanged.
- Existing source-target/generation/edit fences reused. Pins browser-local only, valid [] retained. Existing import/export remains coherent; do not activate disconnected shortcut namespace or import old shortcut payload into a parallel authority. Define how dock-only valid import updates mounted subscribers.
### Commands/input
- Small typed catalog derived from APP_MANIFESTS, one executor, existing typed domain intents. No general command bus/runtime/scheduler/flags/API routes.
- Concrete sole dispatch boundary at document/window capture before app listeners; resolve event once with exact target-context provider, current capture/menu/modal/Cognito/IME/AltGraph guards; mark/cache resolution for xterm suppression, never second dispatch. Resolve before consuming bytes; preserve copy/find/font/normal input. DoubleShift recognizes gesture only, resets under capture/modal/menu/composition/Cognito and does not swallow ordinary Shift.
- Editor context includes exact owner generation + FsTargetRef + worktree + selected text/file path. Minimal typed intent migration supports workspace-authorized Search/Reveal, not fabricated project or ambient stores. Generic desktop action captures selected launch context. Fleet/singletons follow manifest instancing; current-desktop compatible window then explicit runtime MRU elsewhere. No unrelated owner fallback. Qualified window selection can switch owner/desktop; restore without resource creation.
- Session Changes immutable existing eight-tuple or actionable disabled explanation; Conflict Resolver real operation/root or actionable disabled explanation. No fake targets/scanning service.
### Ordinary launch safety (necessary explicit addition, not new service)
- Current source has no proven generic F1 cross-reload mechanism; in-memory coalescing alone insufficient. Plan bounded ordinary-launch journal metadata in existing `os/persistence.ts` plus shared action executor using existing Web Locks/storage patterns; **not** Recipe journal/engine rewrite. New non-exportable browser-local key `dam-hopper:os:v1:app-launch-attempts`; must not be cleared/imported as portable OS view state or treated as a shortcut preference.
- One global journal lock for all read/validate/reserve/write/settle transactions; release before network I/O. Per-key locks alone lose updates to shared JSON. Attempt-token-fenced settlement, never stale callback clearing replacement state.
- Canonical versioned structured compatibility identity: stable profile + endpoint binding, resource-producing action, exact authorized workspace/project/worktree/cwd; NOT desktop/generation/tab/launch-mode. Separate attempt UUID/requested terminal ID/captured desktop/generation/provenance. Open/Focus and New Window consult same unresolved compatible guard. New Window distinct only after original attempt authoritatively settled. Missing/ambiguous target/profile replacement/alias cannot silently bypass uncertainty; define fail-closed profile/endpoint/target-identity change policy.
- Durable dispatch-capable record before request; crash-before-send conservatively uncertain. Timeout/lost response/disconnect/reload/destination removal/failed settlement write stay blocked, no TTL/eviction/dismiss-to-retry. Missing locks/storage/corrupt journal/capacity exhausted: existing focus allowed, resource creation blocked. Never evict unresolved attempts.
- Returned exact originating identity only; no manufactured String(unsafe-number) incarnation. If lost response lacks incarnation, no list/name/time inference; may remain indefinitely blocked absent authoritative cannot-still-succeed proof. Explain user impact; no new automatic reconciliation API, retry or kill. Existing confirmed PTY orphan after destination removal not retargeted/killed.
- Browser-local guarantee only while storage intact and cooperating same-origin tabs; no cross-browser/cleared-storage/independent-server-alias dedup promise. Prior Recipe/F1 release gates remain inherited, not closed by this plan. New guard qualifies its own exact scenarios.
### Geometry/menus/pointer
- Floating left-only content-height dock, 44px targets/20px SVGs; padding+gaps+outer gutter+radius, overflow app scroller with permanent reachable Apps control. Pins first then stable running-unpinned IDs, dedup; no Close/Kill/reorder/auto-hide.
- Maximize tiled and floating through canvas-level maximized presentation plane/slots so nested tile containing blocks cannot constrain it; retain tile topology/restore placement/saved float bounds and same runtime hosts. Do not assume replacing fixed with absolute inside tile is sufficient.
- Browser viewport determines screen-support tiers; canvas dimensions remain geometry authority; 1024x640 remains supported despite reserved chrome.
- Dedicated focusable background trigger, not ancestor wrapping windows; menu ownership/Cognito dismissal/current modal guards/captured context revalidation. Existing coordinated Radix wrapper/trigger marker/collision/focus return. Scoped owned menu portals for native CSS cursor, no global body-wide semantic cursor override; forced-colors/system fallback. Preserve text/resize/grab/drag, cross-origin iframe untouched.

## Phase/ownership direction
- P01 sequential shared schemas/interfaces/contracts before consumers; no unfinished required schema masquerading as parallel backend.
- P02 preferences roundtrip and P03 action/input core can be concurrent only with exhaustive disjoint paths after P01.
- P04 dock/icons/pins, P05 work-area/maximize, P06 desktop menu/cursor may be concurrent after P02+P03 only if exact files disjoint. `persistence.ts` transfers P03 launch helpers -> P04 pins sequentially; shell/css shared integration has one owner. P05 WindowFrame geometry -> P07 frame shortcut migration ordered. Never overlap P04-P06 writes to os.css/DesktopCanvas/coordinator.
- P07 IntegrationOwner sequential migration of shared OsShell/CommandPalette/terminal/Monaco/Settings consumers + CSS/portal wiring after all workers terminal. All public references and consumers migrated, no shims.
- P08 full-app qualification and meaningful behavioral regression coverage, physical PTY byte probe plus ordinary unhandled input, two-tab journal races, null/default API->disk->restart roundtrip, tiled/float/resize/desktop resource continuity, three viewport captures and supported scale, human acceptance explicitly separate.
- P09 docs/architecture/changelog/roadmap handoff; exact ownership, no unrelated predecessor status edits. Every phase has one durable task fence exact schema + stable markers/dependencies/allowlists. No tasks.json/hydration or new task engine.
- Existing user-concerns/project-marks/OS/session-management plans overlap actual files; external exclusive handoff required before implementation. No whole-predecessor-completion prerequisite; inherited live/human gates remain open.

## Validation and review
- Parent will inspect all authored artifacts and use installed read-only `plan-tasks/source.cjs` loader plus marker/link/DAG/parallel path-overlap checks. Not helper hydrate/list creating state.
- One independent evc-code-reviewer plan-only report <=150 lines because concurrency/lifecycle/owner risks; at most one targeted follow-up. Parent triages and propagates accepted corrections.
- Product checks remain future commands/scenarios, not passing receipts. Readiness design != implementation permission or production/human release qualification.

Unresolved user questions: none after approved design. New internal contract decisions above are conservative implementations, not new optional product scope.
