# Independent plan-only review

## Status and scope

**Review: COMPLETE. Design disposition: revision required before readiness.** Six findings below; implementation and qualification remain pending by design. This report is neither implementation authorization nor user validation.

Read actual canonical overview, all nine phases, all three supporting contracts, binding intake, three evidence reports and approved brainstorm. Compared ownership and frozen interfaces with current callers/input/resource/config source. Product/source/other plan files unchanged; only this report written.

## Findings

### F1 — High: prerequisite completion requires checks that deferred consumers prevent

- Plan: `plans/261105-0711-os-desktop-polish/phase-01-shared-source-contracts.md:49-58,65-74`; `plans/261105-0711-os-desktop-polish/execution-ownership.md:15-25,158-162`.
- Evidence: `packages/ui/src/stores/settings.ts:433-447` consumes removed Fleet and assigns shortcut values to current nonnullable state; `packages/ui/src/components/organisms/SettingsKeyboardShortcutsSection.tsx:29-34,155-170` requires strings/Fleet. Rust test literals reference removed fields at `server/src/config/tests.rs:1268-1279` (reference search). Installed `/home/loidinh/.omp/agent/skills/planning/references/task-management.md:79-98,100-120` requires completed prerequisites and applicable passing compile/tests/review evidence, not implementation-terminal alone.
- Scenario: P01 makes nullable/removal/required-intent changes, but P02/P07/P08 own affected migrations. G1 build cannot pass; marking G1 completed despite diagnostics violates completion gate, while leaving it incomplete prevents dependent tasks. Internal sequential tasks also defer checks until their dependent chain finishes.
- Impact: execution deadlock or fabricated completion receipts; no executable durable DAG under installed workflow. Confidence: high.
- Smallest correction: make dependency nodes coherent checkable deliverables: group contract-breaking schema/caller/test cutovers under one sequential ownership slice, or move breaking cutover after nonbreaking preparation. Align task fences, transfers and check scheduling so each prerequisite can genuinely complete; do not use `not_applicable` for an applicable failed compile.

### F2 — High: known deep-link producers omitted from exhaustive migration ownership

- Plan: `plans/261105-0711-os-desktop-polish/phase-01-shared-source-contracts.md:65-74`; `plans/261105-0711-os-desktop-polish/phase-07-shared-consumer-integration.md:42-46,90-97`; `plans/261105-0711-os-desktop-polish/execution-ownership.md:53-144`.
- Evidence: `packages/ui/src/os/deep-links.ts:253-270` creates `file:reveal` and `search:query` without newly required target/generation/mode. Existing contracts at `packages/ui/src/os/intents.ts:81-87,125-130`; proposed required contract at `plans/261105-0711-os-desktop-polish/architecture-contracts.md:37`.
- Scenario: canonical search/file links still compile against old payloads or become compile errors after P01; permissive acceptance would instead deliver an unqualified target into stricter handlers. No task can edit this already-known producer or its regression tests.
- Impact: incomplete public-caller cutover; broken qualified navigation and AC1/AC2 integration. Confidence: high.
- Smallest correction: explicitly assign `packages/ui/src/os/deep-links.ts` and `packages/ui/src/os/deep-links.test.ts` to sequential integration. Freeze where URL parsing ends and current-owner/target authorization supplies generation; reject unavailable qualification rather than copy URL data into authority. Add actual search/reveal deep-link success and stale/unavailable-target cases. Generic future escalation does not cover this known caller.

### F3 — High: sole input authority omits existing outer capture/command owners

- Plan: `plans/261105-0711-os-desktop-polish/architecture-contracts.md:43,47,125-129`; `plans/261105-0711-os-desktop-polish/phase-07-shared-consumer-integration.md:30-51,59-77`.
- Evidence: `packages/ui/src/embed/dam-hopper-app.tsx:332-336,433-437` mounts Cognito/browser guards and separate font dispatcher. `packages/ui/src/hooks/use-browser-shortcut-guard.ts:6-21` uses window capture plus stopImmediatePropagation; `packages/ui/src/lib/browser-shortcut-guard.ts:6-13,42-54` blocks configurable chords including Mod+R. Cognito independently toggles and tracks physical release sequences at `packages/ui/src/hooks/use-cognito-mode-input-guard.ts:122-214,240-247`. Global font dispatch at `packages/ui/src/embed/dam-hopper-app.tsx:231-264` does not consult menu/modal/capture ownership.
- Scenario: outer guard already installed before lazy shell sees a remapped Mod+R, so shell cache/executor and Settings capture never receive it. Moving shell first without coordinating Cognito's activation/dismissal/release authority risks duplicate authority or losing release suppression. Merely installing before frame/xterm listeners does not order same-window capture listeners.
- Impact: AC2/AC3 single-resolution/remap/capture/Cognito guarantees not implementable as specified solely within listed writes. Confidence: high.
- Smallest correction: explicitly own root entry and affected guard/hooks/tests in sequential input integration; define one installation/cleanup sequence, browser-reserved-chord policy and Cognito keyboard authority preserving frozen dismissal/held-key releases. Remove/migrate global font duplicate. Test real mounted capture propagation, privacy keydown/keypress/keyup and late shell mount; do not replace this with matcher-only tests.

### F4 — High: frozen action request cannot preserve explicit folder-terminal intent

- Plan: `plans/261105-0711-os-desktop-polish/architecture-contracts.md:44-48,52`; `plans/261105-0711-os-desktop-polish/phase-07-shared-consumer-integration.md:59,65`.
- Evidence: `packages/ui/src/os/types.ts:24-32` WindowContext has no cwd; frozen ActionContext/ActionRequest add none. `packages/ui/src/os/intents.ts:51-58` carries cwd/requested terminal ID; `packages/ui/src/os/apps/FilesApp.tsx:157-198` emits explicit workspace/project folder launches. `server/src/api/terminal.rs:107-154` requires workspace cwd. Inherited `plans/261103-1608-workspace-file-tree-project-marks/plan.md:49` forbids reuse/cd/home fallback for explicit folder launch.
- Scenario: routing existing terminal:open through the only frozen executeAction request drops the selected folder, or treating it as generic Open/Focus restores a compatible terminal instead of explicitly creating in that folder. Workspace launch fails without cwd; project launch can silently use wrong directory. C3 journal identity also cannot encode the lost cwd.
- Impact: existing folder action regression and wrong launch/uncertainty scope; AC1/AC4. Confidence: high.
- Smallest correction: freeze an exact typed terminal-create payload/seam including authorized target, cwd, captured source/destination/owner and existing requested-ID semantics; route explicit folder creation through supported New Window semantics and the same journal, not generic reuse. Include two different folder launches, existing compatible terminal, desktop selection change and failed persistence tests.

### F5 — High: New Editor/Browser contract ignores existing exclusive resource claims

- Plan: `plans/261105-0711-os-desktop-polish/architecture-contracts.md:31,35,44-45,52`; `plans/261105-0711-os-desktop-polish/phase-03-action-input-core.md:92-98`; `plans/261105-0711-os-desktop-polish/acceptance-matrix.md:43-45`.
- Evidence: `packages/ui/src/os/apps/EditorApp.tsx:94-117,140-157` claims by document identity and denies a second visible window; `packages/ui/src/os/apps/BrowserApp.tsx:22-35,57-73` claims by owner/generation/URL and denies duplicates. These files are absent from exhaustive writable ownership.
- Scenario: New Window with the captured active editor document or preview URL creates a new OsWindow, but its adapter displays “already open/active in another window,” not a usable second editor/browser. Frozen request exposes no distinct document/URL selection contract, while preservation of existing resource policy prevents simply duplicating claims.
- Impact: required New Window behavior is underspecified at resource boundary; a window-count assertion could falsely certify AC4. Confidence: high for collision, medium for intended target-selection UX.
- Smallest correction: decide and freeze supported New Editor/Browser target/resource semantics before scheduling. Preserve canonical document exclusivity; specify an actual eligible distinct-target selection flow, or explicitly supported distinct presentation identity where valid. Assign actual adapters/selection consumers/tests needed by that decision. Qualification must interact with both usable windows and inspect claims/root lifetime, not only count frames.

### F6 — Medium: Desktop Appearance has no owned consumer for section navigation

- Plan: `plans/261105-0711-os-desktop-polish/architecture-contracts.md:45,151`; `plans/261105-0711-os-desktop-polish/phase-06-desktop-menu-cursor.md:49`; `plans/261105-0711-os-desktop-polish/phase-07-shared-consumer-integration.md:30-51`.
- Evidence: `packages/ui/src/os/apps/SettingsApp.tsx:12-28,74-79` only reads general/devices tab and target; `packages/ui/src/components/pages/SettingsPage.tsx:34-44,421-426` has no section-navigation input. `packages/ui/src/components/pages/settings-page/SettingsSectionAccordion.tsx:6-19,55-61` defaults Appearance closed and owns its open state locally. None is writable in this plan.
- Scenario: executor accepts settingsSection:appearance but existing singleton remains on Devices, or general Settings opens with Appearance collapsed; appState alone has no reader to reveal the section.
- Impact: advertised menu action fails AC9 navigation; confidence high.
- Smallest correction: assign SettingsApp/SettingsPage and necessary accordion/test paths to P07; define controlled/revisioned section request handling for new and already-open Settings without changing Settings target/Preferences Source. Test from Devices and after manually closing Appearance; avoid DOM-click/label-search workarounds.

## Coverage and retained strengths

- AC1–10 each have implementation and behavior-layer qualification owners (`acceptance-matrix.md:7-20,24-83`). Findings affect AC1–4/9; they are not demands that future TODOs already be implemented.
- C3 global transaction lock, token fences, pre-dispatch reservation, bounds, failed-settlement uncertainty, exact PTY provenance, no TTL/retry/reset and browser-local limits are explicit (`architecture-contracts.md:60-82`). No new safety-service/Recipe rewrite requested.
- Nullable scalar presence/default/JSON null/TOML empty encoding, extra-map merge/reset, Cognito exception, source/edit fences and downgrade constraints are specified (`architecture-contracts.md:84-123,161`; P02). Native nullable DTO compatibility is source-confirmed, not native runtime acceptance.
- Pin import notification seam avoids persistence/subscriber circular authority; valid empty pins and honest storage failures covered (C6/P04). Geometry correctly requires canvas sibling plane/stable slots rather than absolute positioning inside tile ancestors (C7/P05). Menu sibling/portal ownership and semantic cursors are bounded (C8/P06).
- G2/G3 literal write sets inspected: declared concurrent sets disjoint; persistence and canvas/frame transfers sequential. Missing needed writes above, not an observed overlap, are the issue.
- P08 demands observer-visible state, actual full-app/config restart/two-tab/physical PTY proof and fresh three-viewport/scale captures. Visual/native-cursor acceptance remains human-owned. SVG/accessibility tests are supplemental here, not sole acceptance. No separate finding merely for their existence.

## Exact inspected paths / ranges

Project-relative unless HOME-qualified. Ranges identify read windows; targeted reference-search matches called out separately.

- `plans/261105-0711-os-desktop-polish/plan.md:1-63`; `architecture-contracts.md:1-161` (long contract lines additionally read raw); `execution-ownership.md:1-177`; `acceptance-matrix.md:1-108`, all under that same plan directory.
- Same directory: `phase-01-shared-source-contracts.md:1-185`; `phase-02-preferences-roundtrip.md:1-187`; `phase-03-action-input-core.md:1-243`; `phase-04-dock-icons-pins.md:1-191`; `phase-05-work-area-maximize.md:1-145`; `phase-06-desktop-menu-cursor.md:1-149`; `phase-07-shared-consumer-integration.md:1-242`; `phase-08-integrated-qualification.md:1-243`; `phase-09-documentation-handoff.md:1-143`.
- Same directory reports: `planning-intake.md:1-60`; `command-evidence.md:1-35`; `preference-evidence.md:1-121`; `desktop-evidence.md:1-95`. Approved `plans/reports/brainstorm-261105-0650-os-desktop-polish.md:1-192`.
- Related overviews: `plans/261101-1738-ai-dev-os-redesign/plan.md:1-73`; `plans/261104-1529-os-session-management-and-interactions/plan.md:1-75`; `plans/261103-2016-user-concerns-resolution/plan.md:1-40`; `plans/261103-1608-workspace-file-tree-project-marks/plan.md:1-80`. Long historical result summaries not independently qualified.
- `README.md:1-95`; `docs/code-standards.md:1-130`; `docs/project-overview-pdr.md:1-125`; `docs/architecture/preferences-settings-and-host-resources.md:1-82` (long unrelated PDR table cells not expanded).
- `packages/ui/src/os/deep-links.ts:1-285,385-404`; `intents.ts:45-135`; `types.ts:1-150`; `app-registry.ts:1-249`; `persistence.ts:665-830`; `input-arbiter.ts:1-140`; `shell-input-context.tsx:1-173`; `window-context.tsx:1-130` (all after prefix `packages/ui/src/os/`).
- Same OS prefix: `OsShell.tsx:245-450,1125-1185,1450-1555,1620-1690`; `CommandPalette.tsx:125-220`; `DesktopCanvas.tsx:1-124`; `WindowFrame.tsx:1-215,365-435`; `MonacoKeepAliveHost.tsx:1-115,120-205,215-354`.
- Same OS prefix apps: `EditorApp.tsx:1-245`; `BrowserApp.tsx:1-94`; `SettingsApp.tsx:1-91`; `FilesApp.tsx:138-202`; `GitApp.tsx:15-50`.
- `packages/ui/src/components/organisms/MonacoHost.tsx:1-125,270-425`; `TerminalPanel.tsx:1045-1162`; `SettingsKeyboardShortcutsSection.tsx:1-170` (organisms prefix); `packages/ui/src/components/pages/SettingsPage.tsx:1-90,410-445`; `settings-page/SettingsSectionAccordion.tsx:1-65` (pages prefix).
- `packages/ui/src/embed/dam-hopper-app.tsx:231-345,425-485`; `packages/ui/src/hooks/use-cognito-mode-input-guard.ts:80-255`; `use-browser-shortcut-guard.ts:1-23`; `use-browser-context-menu-suppression.ts:1-28` (hooks prefix).
- `packages/ui/src/lib/browser-shortcut-guard.ts:1-55`; `terminal-keyboard-shortcuts.ts:1-185`; `shortcuts.ts:90-120,170-195`; `ui-config.ts:145-180,245-295`; `fresh-state-reset.ts:1-178`; `context-menu-coordinator.ts:1-27` (lib prefix); `packages/ui/src/components/ui/ContextMenu.tsx:1-160`.
- `packages/ui/src/stores/settings.ts:373-495,610-710`; `editor.ts:1-130` (stores prefix). Searches additionally inventoried nullable/Fleet fields, intent producers, MonacoHost producers and native event listeners across `packages/ui/src` and Rust source/tests; `os/deep-links.test.ts` and Rust `config/tests.rs` matches inspected, not entire tests.
- `packages/ui/src/api/client.ts:1-35,185-220,3345-3390`; `server-config.ts:1-100` (api prefix); `server/src/config/schema.rs:680-780,1000-1075,1160-1195`; `server/src/config/global.rs:85-135,165-250`; `server/src/api/config.rs:598-675,805-825`; `server/src/api/terminal.rs:87-232`.
- `packages/ui/e2e/fixtures/application-fixture.ts:1-84`; `application-services.ts:20-68,280-352` plus targeted capability search (fixtures prefix); `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/RemoteConfigModels.kt:25-100`.
- Installed guidance read: `/home/loidinh/.omp/agent/evcrate/AGENTS.md:1-56`, `workflows/development-rules.md:1-44`; `/home/loidinh/.omp/agent/skills/planning/SKILL.md:1-113`, `references/plan-review.md:1-46`, `references/task-management.md:1-137`; `/home/loidinh/.omp/agent/skills/code-review/SKILL.md:1-143`; `memory://root/memory_summary.md:1`.

## Checks, exclusions and missing evidence

Performed: read-only source/contract review, reference searches, manual AC traceability and writable-set/dependency comparison. Parent-reported parser result not rerun or claimed as this review's verification.
Not performed: implementation, plan/task-state updates, build/typecheck/tests/lint/formatters, runtime/browser/container/native/human qualification, installation, Git, nested agents/research/interview. No passing runtime/human claims. Entire-repository/security audit and related plans' nested phases/reports excluded. Historical reports are provenance, not fresh execution proof.

Missing future evidence is intentionally pending, not a review failure: real checks, cross-plan exclusive handoffs, supported endpoint/provenance observations, interactive native cursor and human acceptance. Known interface/ownership omissions above must be resolved before readiness.

## Unresolved questions

- F5 needs author-selected usable New Editor/Browser target/resource semantics, not permission to weaken exclusive identity or fabricate a target.
- Monaco provider can potentially derive exact slot/window context inside allowed MonacoHost instead of new props; no unsupported finding demands producer edits. Author should freeze that choice and prove registration survives imperative reparent/claim changes; prop-based design must explicitly add actual producers.
- P01/P03 pure lookup placement can be consistent if P01 implements its frozen actions.ts functions and P03 consumes them; clarify wording, not a separate blocker. No other unresolved product question asserted.
