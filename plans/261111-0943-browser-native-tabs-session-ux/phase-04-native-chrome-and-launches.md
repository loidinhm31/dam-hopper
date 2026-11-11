# Phase 04 — Native chrome and launch cutover

Priority P2 · Pending · 10h (6h chrome, 4h launch/recipes). Owner: BrowserIntegrator, sequential edits. Depends on phase 03. [Design](design.md) sections 3–6; acceptance A02/A05/A06/A09–A15. All source paths below under `packages/ui/src/`.

## compose-native-browser-chrome
1. In `os/apps/BrowserApp.tsx`, replace whole-window chooser/flat session lookup and session-swap banners with canonical tab shell. Keep existing selection/terminal handoff logic with exact active-tab scope. Remove obsolete chooser Cancel→window-close behavior and old popup swap actions. Do not blanket-rewrite remaining large module.
2. Create `os/browser/browser-tab-strip.tsx`: horizontal flex strip, readable title→URL hostname→New Tab fallback; generic Lucide icon, pending indicator only for actual request; explicit sibling close button, fixed add button, scroll-into-view, roving tab selection and tabpanel IDs. No nested buttons, dragging/pinning/groups, fake favicon/audio-playing state or global chords.
3. Create `browser-address-bar.tsx`: Back/Forward/Reload, labelled flexible address input, active viewer-local audio mute/unlock and compact tools trigger. Live status/control badge visible; actual history bounds unknown so do not fabricate canGoBack/TLS/load percentage/Stop behavior. Navigation disabled for pending/nonlive except explicit unavailable Reload; dirty draft does not change Reload address.
4. Create `browser-new-tab-page.tsx`: selected content panel with URL input/Open, helper (HTTP(S), scheme-less host convenience only; no search), plaintext continuity notice and clear action. New Tab blank costs no native target. Selecting another tab never dismisses whole window. Address input/New Tab share the current tab draft, not divergent copies.
5. Create `browser-navigation.ts`: per-tab single flight/preflight GET/one CAS mutation; exact scope/session/runtime/action retirement; 409 refresh no replay. Validate userinfo/scheme/free text and defer network policy. Enter once outside composition; Escape current committed URL; clean snapshots update draft, dirty intact. Explicit validated submit resets owner suppression via origin-wide recovery lock and fresh read before dispatch; lock/storage failure visible, no navigation/create or false remember success. Reload/snapshots never clear suppression. Unavailable Reload/Enter uses lifecycle, never visibility-driven create.
6. Create `browser-tools.tsx`: keyboard-accessible disclosure for existing Control/Release, DOM selection start/cancel, diagnostic session ID and current error/status, clear metadata and recovery. Existing selection preview + terminal artifact handoff remain reachable and session/revision fenced; moving controls is not permission to remove them. Retain existing test IDs for semantic actions where behavior unchanged, scope them within active tab; retire chooser-specific IDs and migrate test consumers.
7. Create `browser-recovery-panel.tsx`: pending/unknown notice, Check/Retry exact close, explicit inventory refresh/list/selected-ID attach/reveal/close and fresh-start duplicate-risk acknowledgment. Click captures verified profile owner; selected-ID admission/close uses lifecycle native-key gate/census across profiles without credential transfer. No URL inference, broad delete, unknown POST replay or empty-list success. Clear and settlement await locked store results; pending/failure never shown successful. Unknown record remains after fresh start.
8. CSS scoped to Browser in `os/os.css`: ~34px strip/~36px toolbar baseline using current semantic tokens/adaptive text; 120–220px tabs, narrow min96px horizontal scrolling, readable labels, fixed add; coarse pointer >=44px hits; 400/640/1024+ widths and text 10–32px no clipped controls. Tools collapse before address. No global theme changes/assets/fonts/animation loop.
9. Privacy-safe accessible labels/tooltips/title fallbacks, masked drafts/recovery inventory in Cognito/lock. Scoped tablist Arrow/Home/End/Delete must not consume canvas, address composition, dialogs or outer browser chords. Deleting tab returns focus to nearest tab; closing tools returns to trigger; adding focuses address.

## cutover-browser-launch-recipes
1. `os/action-executor.ts`: New Window/generic Browser launch use canonical helpers; preserve candidates/MRU and existing-window focus. Only no eligible window/no URL/current verified scope may restore saved group. Use shared origin-wide recovery lock, reread eligibility/unknown blockers, consume once and install local window intent before releasing; no network inside lock. Two independent documents cannot consume same group; failed installation visible, no stale replay. On missing lock/storage no restore dispatch; blank New Window remains explicit. Acknowledgment is new explicit intent, never clears unknown record or unblocks automatic group restore.
2. `os/OsShell.tsx` intent handlers produce canonical explicit resource window, preserve `browser:open`/`browser:preview` new-window semantics. Supported validated URL launch resets suppression under shared recovery lock before dispatch and rechecks captured owner after await; snapshots/Reload/New Window do not reset it. Startup/autosave/notifications already migrated in phase 02; preserve that async exclusion. No targetMode/intent schema expansion or implicit external-launch rerouting.
3. `os/deep-links.ts`: qualified URL continues explicit intent; absent valid URL yields blank canonical New Tab, no last-closed restore. Captured owner/context preserved. Editor and other app chooser behavior unchanged.
4. `os/recipes/recipe-engine.ts`: change Browser capture projection only, preserving full ordered ordinary committed tab metadata + active choice without popup/auth/session/runtime fields. `executeRecipeLaunch:397-477` currently executes terminal steps only; intentionally leave app-step non-execution unchanged. No Browser-special-case dispatcher, new recipe engine, native target creation or promise recipes instantiate Browser pages.
5. `os/recipes/schema.ts`: validation and export call same portable recipe projector and plaintext metadata warning; legacy URL-only recipe converts at input only. Keep RecipeV1/layout/version and independent project/server recipe selection semantics. Existing `recipe-source-context.test.ts` only classifies Browser as a utility and stays unchanged; no recipe editor redesign.
6. Migrate Browser fixtures/tests in these files to canonical shape and verified connection identities; do not allow legacy flat runtime shape merely to keep old tests passing. Pure placement-only windows without appState intentionally remain New Tab via canonical initialization, not a legacy alias path.

## Files, risk and rollback
Exact modify/create allowlists below; no source deletes except obsolete inline chooser/session-swap code. Existing large modules get targeted change, new components/helpers <200 LOC. No auth cookie/profile storage client copy. Prevent launch ambiguity via tests for default reopen versus New Window/URL and unchanged recipe execution. Rollback needs explicit portable conversion/recovery preservation per design; not duplicate aliases.

## Success and next dependency
All production Browser state writers use one canonical schema and every visible lifecycle has honest controls. Phase 05 fixture cutover/qualification must complete before any implementation completion claim. No tests or visual verification run by planner.

```evcrate-tasks
[
  {
    "id": "compose-native-browser-chrome",
    "title": "Compose native tab chrome, address drafts and recovery controls",
    "blocked_by": [
      "tab-key-root-viewers"
    ],
    "allowed_files": [
      "packages/ui/src/os/apps/BrowserApp.tsx",
      "packages/ui/src/os/apps/BrowserApp.test.tsx",
      "packages/ui/src/os/browser/browser-tab-strip.tsx",
      "packages/ui/src/os/browser/browser-address-bar.tsx",
      "packages/ui/src/os/browser/browser-new-tab-page.tsx",
      "packages/ui/src/os/browser/browser-tools.tsx",
      "packages/ui/src/os/browser/browser-recovery-panel.tsx",
      "packages/ui/src/os/browser/browser-navigation.ts",
      "packages/ui/src/os/browser/browser-navigation.test.ts",
      "packages/ui/src/os/os.css"
    ],
    "constraints": [
      "Replace obsolete whole-window chooser and session-swap controls; no new global shortcut, dependency, icon fetch or fabricated server metadata.",
      "Keep existing selection preview/terminal handoff/control/dialog/IME behavior accessible; every new code module <200 LOC."
    ],
    "acceptance": [
      "Tab strip above compact navigation supports add/select/close/overflow and scoped ARIA tab keyboard/focus behavior; last close stays New Tab.",
      "Dirty drafts survive tab/placement; Escape current committed URL; Enter once/composition-safe; explicit submit resets suppression only via locked fresh read, failures block dispatch; CAS 409 no replay.",
      "Live Reload ignores dirty draft and preserves suppression; unavailable Reload explicit fresh creation; no automatic restart target creation.",
      "Tools retain existing controls/selection/diagnostics and honest locked clear/settlement status; inventory uses cross-profile native-key gate and captured profile authority; acknowledgment never erases unresolved notices.",
      "Cognito/lock mask title/address/tooltips/ARIA and recovery data; active-only audio toggle/unlock remains usable."
    ],
    "verification": [
      "Add BrowserApp/navigation tests for A02/A06/A09/A11/A13/A14/A15; execute integrated phase 05 only."
    ]
  },
  {
    "id": "cutover-browser-launch-recipes",
    "title": "Cut over every Browser launch, deep-link and recipe producer",
    "blocked_by": [
      "compose-native-browser-chrome"
    ],
    "allowed_files": [
      "packages/ui/src/os/action-executor.ts",
      "packages/ui/src/os/action-executor.test.ts",
      "packages/ui/src/os/OsShell.tsx",
      "packages/ui/src/os/deep-links.ts",
      "packages/ui/src/os/deep-links.test.ts",
      "packages/ui/src/os/recipes/schema.ts",
      "packages/ui/src/os/recipes/schema.test.ts",
      "packages/ui/src/os/recipes/recipe-engine.ts",
      "packages/ui/src/os/recipes/recipe-engine.test.ts"
    ],
    "constraints": [
      "Preserve existing intent/API shape and explicit URL new-window behavior; do not invent new targetMode or reroute all browser:open to tabs.",
      "One current Browser state model/projection, legacy parse only at input boundary; no flat aliases, backend changes or recipe session authority. Recipe app-step non-execution stays unchanged; no Browser recipe dispatcher."
    ],
    "acceptance": [
      "Default open focuses existing eligible window; only no-window/no-URL consumes current matching closed group under origin-wide exclusive recovery lock, rereads blockers and installs one fresh lazy intent across two independent documents.",
      "New Window always blank; supported URL intents/deep links never restore another group; recipe execution remains unchanged.",
      "Recipe capture/schema/export/import uses ordinary committed tab addresses/order/active selection only; no app-step execution added.",
      "Every writer uses canonical tabs; imported/legacy hints cannot auto-create/attach. Supported explicit URL launch resets suppression under same recovery exclusion; missing lock/storage blocks dispatch, no stale group replay or async persistence bypass."
    ],
    "verification": [
      "Add action/deep-link/schema/engine tests for trigger distinctions, locked two-document single consume, owner recheck after await, unavailable locks/storage, explicit-only suppression reset and portable authority injection; run phase 05."
    ]
  }
]
```

- [ ] <!-- evcrate-task:compose-native-browser-chrome --> Compose native tab chrome, address drafts and recovery controls
- [ ] <!-- evcrate-task:cutover-browser-launch-recipes --> Cut over every Browser launch, deep-link and recipe producer
